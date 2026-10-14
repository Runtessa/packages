// Trusted launcher joins the resource group before bubblewrap or tenant code starts.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [group, command, ...args] = process.argv.slice(2);
try {
  if (!group?.startsWith('/sys/fs/cgroup/') || !command) throw new Error('Invalid resource group');
  fs.writeFileSync(`${group}/cgroup.procs`, String(process.pid));
  const child = spawn(command, args, { env: process.env, stdio: [0, 1, 2, 3, 4] });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
    try { fs.writeFileSync(`${group}/cgroup.kill`, '1'); } catch { child.kill(signal); }
  });
  child.on('error', () => process.exit(127));
  child.on('exit', (code) => process.exit(code ?? 1));
} catch { process.exit(126); }
