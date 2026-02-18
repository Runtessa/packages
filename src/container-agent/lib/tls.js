const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');

const resolveTlsPath = (filePath, cwd) =>
  path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

const readTlsFile = (filePath, label, cwd) => {
  const resolved = resolveTlsPath(filePath, cwd);
  try {
    return fs.readFileSync(resolved);
  } catch (error) {
    throw new Error(`Failed to read ${label} at ${resolved}: ${error.message}`);
  }
};

const ensureSelfSignedCerts = ({
  keyPath,
  certPath,
  pickEnv,
  parseIntBounded,
  ensureDir,
  cwd,
  logger = console,
}) => {
  const resolvedKeyPath = resolveTlsPath(keyPath, cwd);
  const resolvedCertPath = resolveTlsPath(certPath, cwd);
  if (fs.existsSync(resolvedKeyPath) && fs.existsSync(resolvedCertPath)) return;

  ensureDir(path.dirname(resolvedKeyPath));
  ensureDir(path.dirname(resolvedCertPath));

  const attrs = [
    {
      name: 'commonName',
      value: pickEnv('CONTAINER_MANAGER_TLS_CN', 'CONTAINER_AGENT_TLS_CN') || 'localhost',
    },
  ];
  const cert = selfsigned.generate(attrs, {
    keySize: 2048,
    algorithm: 'sha256',
    days: parseIntBounded(
      pickEnv('CONTAINER_MANAGER_TLS_SELF_SIGNED_DAYS', 'CONTAINER_AGENT_TLS_SELF_SIGNED_DAYS'),
      825,
      1,
      3650
    ),
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  fs.writeFileSync(resolvedKeyPath, cert.private, { mode: 0o600 });
  fs.writeFileSync(resolvedCertPath, cert.cert, { mode: 0o644 });
  logger.log(`[container-manager] generated self-signed cert at ${resolvedCertPath}`);
};

const createServerFactory =
  ({
    app,
    pickEnv,
    asBool,
    parseIntBounded,
    ensureDir,
    cwd,
    logger = console,
    defaultTlsRequired = true,
  }) =>
  () => {
    const tlsRequired = asBool(
      pickEnv('CONTAINER_MANAGER_TLS_REQUIRED', 'CONTAINER_AGENT_TLS_REQUIRED'),
      defaultTlsRequired
    );
    const tlsEnabled = asBool(
      pickEnv('CONTAINER_MANAGER_TLS_ENABLED', 'CONTAINER_AGENT_TLS_ENABLED'),
      true
    );
    const autoSelfSigned = asBool(
      pickEnv('CONTAINER_MANAGER_TLS_AUTO_SELF_SIGNED', 'CONTAINER_AGENT_TLS_AUTO_SELF_SIGNED'),
      true
    );
    const keyPath =
      pickEnv('CONTAINER_MANAGER_TLS_KEY_PATH', 'CONTAINER_AGENT_TLS_KEY_PATH') ||
      './certs/server.key';
    const certPath =
      pickEnv('CONTAINER_MANAGER_TLS_CERT_PATH', 'CONTAINER_AGENT_TLS_CERT_PATH') ||
      './certs/server.crt';
    const caPath = pickEnv('CONTAINER_MANAGER_TLS_CA_PATH', 'CONTAINER_AGENT_TLS_CA_PATH');
    const mtlsEnabled = asBool(
      pickEnv('CONTAINER_MANAGER_TLS_MUTUAL', 'CONTAINER_AGENT_TLS_MUTUAL'),
      false
    );

    if (!tlsEnabled) {
      if (tlsRequired) {
        throw new Error('TLS is required but CONTAINER_MANAGER_TLS_ENABLED=false');
      }
      return { server: http.createServer(app), protocol: 'http' };
    }

    if (autoSelfSigned) {
      ensureSelfSignedCerts({
        keyPath,
        certPath,
        pickEnv,
        parseIntBounded,
        ensureDir,
        cwd,
        logger,
      });
    } else if (
      !fs.existsSync(resolveTlsPath(keyPath, cwd)) ||
      !fs.existsSync(resolveTlsPath(certPath, cwd))
    ) {
      throw new Error(
        'TLS key/cert missing. Set CONTAINER_MANAGER_TLS_KEY_PATH and CONTAINER_MANAGER_TLS_CERT_PATH or enable CONTAINER_MANAGER_TLS_AUTO_SELF_SIGNED'
      );
    }

    const options = {
      key: readTlsFile(keyPath, 'TLS key', cwd),
      cert: readTlsFile(certPath, 'TLS cert', cwd),
      requestCert: mtlsEnabled,
      rejectUnauthorized: mtlsEnabled,
    };
    if (caPath) {
      options.ca = readTlsFile(caPath, 'TLS CA cert', cwd);
    }
    return { server: https.createServer(options, app), protocol: 'https' };
  };

module.exports = {
  resolveTlsPath,
  readTlsFile,
  ensureSelfSignedCerts,
  createServerFactory,
};
