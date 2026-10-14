import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const unavailable = () => Object.assign(new Error('Runtime requires a writable delegated cgroup v2 with cpu, memory and pids controllers'), { statusCode: 503 });
let hostVerified = false;
function assertSandboxHost() {
  if (hostVerified) return;
  try {
    if (process.platform !== 'linux') throw new Error();
    const version = execFileSync('bwrap', ['--version'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    const match = version.match(/bubblewrap\s+(\d+)\.(\d+)/);
    if (!match || (Number(match[1]) === 0 && Number(match[2]) < 12)) throw new Error();
    hostVerified = true;
  } catch { throw Object.assign(new Error('Native execution requires Linux and bubblewrap 0.12 or newer'), { statusCode: 503 }); }
}

export function createProcessBudget(memoryMb: number, tasks = 48) {
  assertSandboxHost();
  const root = process.env.RUNTIME_CGROUP_ROOT ||
    `/sys/fs/cgroup/user.slice/user-${process.getuid!()}.slice/user@${process.getuid!()}.service/runtessa-runtime`;
  if (!path.resolve(root).startsWith('/sys/fs/cgroup/') || !path.basename(root).startsWith('runtessa-')) throw unavailable();
  const group = path.join(root, `run-${process.pid}-${randomUUID()}`);
  const write = (directory: string, name: string, value: string) => fs.writeFileSync(path.join(directory, name), value);
  try {
    if (!fs.existsSync(root)) {
      const parent = fs.readFileSync(path.join(path.dirname(root), 'cgroup.subtree_control'), 'utf8');
      if (!['cpu', 'memory', 'pids'].every((name) => parent.split(/\s+/).includes(name))) throw unavailable();
      fs.mkdirSync(root);
    }
    // Aggregate limits protect the service host even when several invocations are busy.
    write(root, 'memory.max', String(4096 * 1024 * 1024));
    write(root, 'pids.max', '512'); write(root, 'cpu.max', '200000 100000');
    write(root, 'cgroup.subtree_control', '+cpu +memory +pids');
    fs.mkdirSync(group);
    write(group, 'memory.max', String((memoryMb + 128) * 1024 * 1024));
    write(group, 'memory.swap.max', '0'); write(group, 'memory.oom.group', '1');
    write(group, 'pids.max', String(tasks)); write(group, 'cpu.max', '100000 100000');
  } catch {
    if (fs.existsSync(group)) { try { fs.rmdirSync(group); } catch { /* Preserve a group if it still contains a process. */ } }
    throw unavailable();
  }
  return {
    group,
    kill() { try { write(group, 'cgroup.kill', '1'); } catch { /* Already exited. */ } },
    async close() {
      try { write(group, 'cgroup.kill', '1'); } catch { /* Already exited. */ }
      for (let attempt = 0; attempt < 50; attempt++) {
        try { fs.rmdirSync(group); return; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
      }
      throw new Error('Runtime cgroup cleanup did not finish');
    },
  };
}
