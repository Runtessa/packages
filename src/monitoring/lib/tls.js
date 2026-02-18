const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');
const { DEFAULTS } = require('./constants');
const { asBool, parseIntBounded } = require('./utils');

const resolveTlsPath = (filePath) =>
  path.isAbsolute(filePath) ? filePath : path.resolve(__dirname, '..', filePath);

const readTlsFile = (filePath, label) => {
  const resolved = resolveTlsPath(filePath);
  try {
    return fs.readFileSync(resolved);
  } catch (error) {
    throw new Error(`Failed to read ${label} at ${resolved}: ${error.message}`);
  }
};

const ensureSelfSignedCerts = (keyPath, certPath) => {
  const resolvedKeyPath = resolveTlsPath(keyPath);
  const resolvedCertPath = resolveTlsPath(certPath);
  const hasKey = fs.existsSync(resolvedKeyPath);
  const hasCert = fs.existsSync(resolvedCertPath);
  if (hasKey && hasCert) return;

  fs.mkdirSync(path.dirname(resolvedKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(resolvedCertPath), { recursive: true });

  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
  const hostName = (process.env.MONITORING_HOST || '').trim();
  if (hostName && hostName !== '0.0.0.0' && hostName !== '127.0.0.1' && hostName !== '::') {
    altNames.push({ type: 2, value: hostName });
  }

  const attrs = [{ name: 'commonName', value: process.env.MONITORING_TLS_CN || 'localhost' }];
  const cert = selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    days: parseIntBounded(process.env.MONITORING_TLS_SELF_SIGNED_DAYS, 825, 1, 3650),
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  fs.writeFileSync(resolvedKeyPath, cert.private, { mode: 0o600 });
  fs.writeFileSync(resolvedCertPath, cert.cert, { mode: 0o644 });

  console.log(
    `[monitoring] generated self-signed TLS certificate at ${resolvedCertPath} (key: ${resolvedKeyPath})`,
  );
};

const createIngressServer = (app) => {
  const tlsRequired = asBool(process.env.MONITORING_TLS_REQUIRED, DEFAULTS.tlsRequired);
  const tlsEnabled = asBool(process.env.MONITORING_TLS_ENABLED, true);
  const autoSelfSigned = asBool(process.env.MONITORING_TLS_AUTO_SELF_SIGNED, true);
  const keyPath = process.env.MONITORING_TLS_KEY_PATH || './certs/server.key';
  const certPath = process.env.MONITORING_TLS_CERT_PATH || './certs/server.crt';
  const caPath = process.env.MONITORING_TLS_CA_PATH || '';

  if (!tlsEnabled) {
    if (tlsRequired) {
      throw new Error('TLS is required but MONITORING_TLS_ENABLED is false');
    }
    return { server: http.createServer(app), protocol: 'http' };
  }

  if (autoSelfSigned) {
    ensureSelfSignedCerts(keyPath, certPath);
  } else if (!fs.existsSync(resolveTlsPath(keyPath)) || !fs.existsSync(resolveTlsPath(certPath))) {
    throw new Error(
      'TLS cert/key not found. Set MONITORING_TLS_KEY_PATH and MONITORING_TLS_CERT_PATH or enable MONITORING_TLS_AUTO_SELF_SIGNED',
    );
  }

  const mtlsEnabled = asBool(process.env.MONITORING_TLS_MUTUAL, false);
  const options = {
    key: readTlsFile(keyPath, 'TLS key'),
    cert: readTlsFile(certPath, 'TLS certificate'),
    requestCert: mtlsEnabled,
    rejectUnauthorized: mtlsEnabled,
  };

  if (caPath) {
    options.ca = readTlsFile(caPath, 'TLS CA certificate');
  }

  return { server: https.createServer(options, app), protocol: 'https' };
};

module.exports = {
  createIngressServer,
};
