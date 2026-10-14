import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Duplex } from 'stream';
import { attachProcessChannel } from './process-channel';
import { processSyscallFilter } from './process-syscalls';
import { createProcessBudget } from './process-budget';
import { createNetworkRelay } from './network-relay';

let activeProcesses = 0;
const maxProcesses = 8;

export interface RestrictedProcessOptions {
  entrypoint: string;
  readOnlyRoots: string[];
  input: unknown;
  timeoutMs: number;
  memoryMb: number;
  call?: (operation: string, value: any) => Promise<unknown>;
  allowPublicHttp?: boolean;
  networkDirectory?: string;
}

export const restrictedProcessArguments = (options: RestrictedProcessOptions): string[] => {
  if (process.platform !== 'linux') throw Object.assign(new Error('Restricted execution requires Linux and bubblewrap'), { statusCode: 503 });
  const args = ['--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-net',
    '--unshare-cgroup-try', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
    '--clearenv', '--setenv', 'NODE_ENV', 'production', '--seccomp', '4',
    '--size', String(64 * 1024 * 1024), '--tmpfs', '/tmp', '--dev', '/dev'];
  if (options.networkDirectory) args.push('--dir', '/run', '--ro-bind', options.networkDirectory, '/run/runtessa-egress');
  const roots = new Set(['/usr/lib', '/usr/lib64', '/lib', '/lib64', '/usr/share/zoneinfo',
    '/etc/ssl/certs', '/etc/resolv.conf', '/etc/hosts',
    fs.realpathSync(process.execPath), ...options.readOnlyRoots.map((root) => path.resolve(root))]);
  for (const root of roots) if (fs.existsSync(root)) {
    const resolved = fs.realpathSync(root);
    args.push('--ro-bind', resolved, root);
    if (resolved !== root && !roots.has(resolved)) args.push('--ro-bind', resolved, resolved);
  }
  args.push('--setenv', 'NODE_PATH', options.readOnlyRoots.filter((root) => path.basename(root) === 'node_modules').join(path.delimiter));
  args.push('--chdir', '/tmp', process.execPath,
    `--max-old-space-size=${options.memoryMb}`, '--disable-proto=throw',
    '--permission', '--allow-fs-read=*', '--allow-fs-write=/tmp', options.entrypoint);
  return args;
};

// No insecure fallback: lack of OS isolation must not execute code in the service.
export const runRestrictedProcess = async <T>(options: RestrictedProcessOptions): Promise<T> => {
  if (process.platform !== 'linux') throw Object.assign(new Error('Restricted execution requires Linux and bubblewrap'), { statusCode: 503 });
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 30000 ||
      !Number.isInteger(options.memoryMb) || options.memoryMb < 32 || options.memoryMb > 2048) {
    return Promise.reject(new Error('Invalid runtime resource limits'));
  }
  if (activeProcesses >= maxProcesses) return Promise.reject(Object.assign(new Error('Runtime execution capacity reached'), { statusCode: 503 }));
  activeProcesses++;
  let budget: ReturnType<typeof createProcessBudget> | undefined;
  let relay: Awaited<ReturnType<typeof createNetworkRelay>> | undefined;
  try {
    budget = createProcessBudget(options.memoryMb);
    relay = await createNetworkRelay(Boolean(options.allowPublicHttp));
    const args = restrictedProcessArguments({ ...options, networkDirectory: relay.directory });
    const filter = processSyscallFilter();
    return await new Promise<T>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'budget-launcher.js'), budget!.group, 'bwrap', ...args],
        { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
      (child.stdio[4] as Duplex).on('error', () => {});
      (child.stdio[4] as Duplex).end(filter);
      let complete = false, outcome: { value?: T; error?: Error } | undefined;
      let calls = 0, activeCalls = 0;
      const stop = (error?: Error, value?: T) => {
        if (complete) return;
        complete = true;
        outcome = { value, error };
        clearTimeout(deadline);
        budget!.kill(); child.kill('SIGKILL');
      };
      const deadline = setTimeout(() => stop(Object.assign(new Error('Execution timed out'), { statusCode: 504 })), options.timeoutMs);
      const stream = child.stdio[3] as Duplex;
      const send = attachProcessChannel(stream, (message) => {
        if (complete) return;
        if (message.type === 'result') stop(undefined, message.value as T);
        else if (message.type === 'error') stop(Object.assign(new Error(message.error || 'Runtime execution failed'), { statusCode: message.status || 500 }));
        else if (message.type === 'rpc' && Number.isSafeInteger(message.id) && typeof message.operation === 'string') {
          if (++calls > 10000 || ++activeCalls > 64) { stop(new Error('Runtime call limit exceeded')); return; }
          void Promise.resolve().then(() => {
            if (message.operation === '__network') return relay!.connect(message.value);
            if (!options.call) throw new Error('Runtime capability is not available');
            return options.call(message.operation!, message.value);
          }).then(
            (value) => { if (!complete) send({ type: 'reply', id: message.id, value }); },
            (error) => { if (!complete) send({ type: 'reply', id: message.id,
              error: message.operation === 'models' && error?.statusCode === 409
                ? 'Activate the tenant models before using the published ORM' : 'Runtime capability denied or unavailable',
              status: message.operation === 'models' && error?.statusCode === 409 ? 409 : 500 }); },
          ).catch(() => stop(new Error('Runtime channel failed'))).finally(() => { activeCalls--; });
        } else stop(new Error('Invalid runtime message'));
      }, () => { if (!complete) stop(Object.assign(new Error('Restricted runtime channel unavailable'), { statusCode: 503 })); });
      child.on('error', () => { stop(Object.assign(new Error('Restricted runtime unavailable; install bubblewrap and enable user namespaces'), { statusCode: 503 })); });
      child.on('close', () => {
        clearTimeout(deadline);
        stream.destroy();
        if (outcome?.error) reject(outcome.error);
        else if (complete) resolve(outcome?.value as T);
        else reject(Object.assign(new Error('Restricted runtime exited before returning a result; check resource budgets and OS sandbox support'), { statusCode: 503 }));
      });
      try { send({ type: 'run', value: options.input }); }
      catch { stop(new Error('Runtime input cannot be serialized')); }
    });
  } finally {
    activeProcesses--;
    await relay?.close();
    await budget?.close();
  }
};

export const runtimeDependencyRoots = (): string[] => {
  const roots = [path.resolve(__dirname, '..'), path.resolve(__dirname, '../../package.json')];
  // Resolve only dependency directories, never service cwd (which may contain .env).
  for (const start of [__dirname, process.cwd()]) {
    let current = start;
    while (current !== path.dirname(current)) {
      const modules = path.join(current, 'node_modules');
      if (fs.existsSync(modules)) { roots.push(modules); break; }
      current = path.dirname(current);
    }
  }
  return [...new Set(roots)];
};
