import { Socket } from 'net';
import type { Duplex } from 'stream';
import { installNetworkSockets } from './network-socket';

export type ProcessMessage = { type: string; id?: number; operation?: string; value?: any; error?: string; status?: number };
export const attachProcessChannel = (stream: Duplex, receive: (message: ProcessMessage) => void, fail: () => void) => {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    if (Buffer.byteLength(pending) > 8 * 1024 * 1024) { fail(); return; }
    let newline: number;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || typeof message.type !== 'string') { fail(); return; }
        receive(message);
      } catch { fail(); return; }
    }
  });
  stream.on('error', fail);
  return (message: ProcessMessage) => {
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > 8 * 1024 * 1024) throw new Error('Runtime message exceeds limit');
    stream.write(line);
  };
};

export const serveRestrictedProcess = (run: (input: any, call: (operation: string, value?: any) => Promise<any>) => Promise<any>) => {
  const stream = new Socket({ fd: 3, readable: true, writable: true });
  let nextId = 0, started = false;
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const send = attachProcessChannel(stream, (message) => {
    if (message.type === 'reply' && typeof message.id === 'number') {
      const promise = waiting.get(message.id);
      if (!promise) return;
      waiting.delete(message.id);
      if (message.error) promise.reject(Object.assign(new Error(message.error), { statusCode: message.status || 500 })); else promise.resolve(message.value);
    } else if (message.type === 'run' && !started) {
      started = true;
      const call = (operation: string, value?: any) => new Promise<any>((resolve, reject) => {
        const id = ++nextId;
        waiting.set(id, { resolve, reject });
        try { send({ type: 'rpc', id, operation, value }); }
        catch (error) { waiting.delete(id); reject(error); }
      });
      installNetworkSockets(call);
      void run(message.value, call).then(
        (value) => send({ type: 'result', value }),
        (error) => send({ type: 'error', error: error instanceof Error ? error.message : 'Runtime execution failed', status: error?.statusCode || error?.status || 500 }),
      );
    }
  }, () => process.exit(1));
  stream.on('end', () => process.exit(0));
};
