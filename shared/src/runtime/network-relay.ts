import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { authorizeNetworkTarget } from './network-policy';

export async function createNetworkRelay(allowPublicHttp: boolean) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runtessa-egress-'));
  const servers: net.Server[] = [], sockets = new Set<net.Socket>();
  let active = 0, total = 0, bytes = 0, closed = false;
  return {
    directory,
    async connect(value: unknown) {
      if (closed || ++total > 128) throw new Error('Runtime network connection budget exceeded');
      const target = await authorizeNetworkTarget(value, allowPublicHttp);
      if (closed) throw new Error('Runtime network relay closed');
      const name = `${servers.length}.sock`, filename = path.join(directory, name);
      const server = net.createServer((local) => {
        if (closed || active >= 32) { local.destroy(); return; }
        active++; sockets.add(local);
        const remote = net.connect({ host: target.address, port: target.port }); sockets.add(remote);
        const finish = () => { local.destroy(); remote.destroy(); };
        local.once('close', () => { active--; sockets.delete(local); finish(); });
        remote.once('close', () => { sockets.delete(remote); local.destroy(); });
        local.on('error', finish); remote.on('error', finish);
        for (const socket of [local, remote]) {
          socket.setTimeout(10_000, finish);
          socket.on('data', (chunk) => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) finish(); });
        }
        // Pipe immediately: net.Socket buffers writes during connection setup.
        // Waiting for connect while a data listener is active would discard early protocol bytes.
        local.pipe(remote); remote.pipe(local);
      });
      servers.push(server);
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(filename, resolve); });
      if (closed) throw new Error('Runtime network relay closed');
      return { path: `/run/runtessa-egress/${name}` };
    },
    async close() {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}
