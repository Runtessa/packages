import { Socket } from 'node:net';

export function installNetworkSockets(call: (operation: string, value?: any) => Promise<any>) {
  const original = Socket.prototype.connect;
  Socket.prototype.connect = function (this: Socket, ...args: any[]): Socket {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof values[0] === 'object' ? { ...values[0] }
      : { port: values[0], host: typeof values[1] === 'string' ? values[1] : 'localhost' };
    const callback = values.find((value: unknown) => typeof value === 'function');
    if (options.path) { queueMicrotask(() => this.destroy(new Error('Direct Unix socket access denied'))); return this; }
    (this as any).connecting = true;
    void call('__network', { host: options.host || 'localhost', port: Number(options.port) }).then(({ path }) => {
      if (this.destroyed) return;
      delete options.host; delete options.port; delete options.lookup;
      (original as any).call(this, { ...options, path }, callback);
    }, () => this.destroy(new Error('Network destination denied or unavailable')));
    return this;
  } as typeof Socket.prototype.connect;
}
