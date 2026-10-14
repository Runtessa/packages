import { lookup } from 'node:dns/promises';
import net from 'node:net';

export type NetworkTarget = { host: string; port: number; address: string };
const localAddress = (address: string): boolean => {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0))
      || (a === 100 && b >= 64 && b <= 127) || a === 198;
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) return true;
  // Only global unicast IPv6 is eligible for implicit public HTTP access.
  return !/^[23][a-f0-9]{3}:/.test(normalized);
};

/** DNS is resolved once in the parent; the relay connects to that pinned address. */
export async function authorizeNetworkTarget(value: unknown, allowPublicHttp = false, scopedRedis = false): Promise<NetworkTarget> {
  const { host, port } = (value || {}) as { host?: unknown; port?: unknown };
  if (typeof host !== 'string' || host.length > 253 || !/^[a-zA-Z0-9.:_-]+$/.test(host)
    || !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid network destination');
  const normalized = host.toLowerCase().replace(/\.$/, '');
  if (!scopedRedis && Number(port) === 6379) throw new Error('Raw Redis connections are denied; use the scoped Redis adapter');
  const configured = (process.env.RUNTIME_EGRESS_ALLOW || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const explicit = configured.includes(`${normalized}:${port}`);
  if (!explicit && !(allowPublicHttp && [80, 443].includes(Number(port)))) throw new Error('Network destination denied');
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || (!explicit && addresses.some((row) => localAddress(row.address)))) throw new Error('Private network destination denied');
  // Metadata endpoints are never an installation integration target.
  if (addresses.some((row) => row.address.startsWith('169.254.') || row.address.toLowerCase().startsWith('::ffff:')
    || new URL(`http://[${net.isIP(row.address) === 6 ? row.address : '::'}]`).hostname === '[fd00:ec2::254]')) throw new Error('Metadata destination denied');
  return { host: normalized, port: Number(port), address: addresses[0].address };
}
