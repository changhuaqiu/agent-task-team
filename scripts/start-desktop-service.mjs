import { spawn } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(pnpm, ['dev', '--', '--hostname', '127.0.0.1', '--port', '1420'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    ATH_DESKTOP_BOOTSTRAP_SECRET: 'agent-task-hub-desktop-development',
    ATH_BUILD_REVISION: 'development',
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
