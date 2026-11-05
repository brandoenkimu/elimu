import { spawn } from 'node:child_process';

const children = new Map();
let shuttingDown = false;

function start(name, script, env = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });

  children.set(name, child);

  child.on('error', (error) => {
    console.error(`[launcher] ${name} failed:`, error.message);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    console.log(`[launcher] ${name} exited: code=${code}, signal=${signal}`);

    if (!shuttingDown) {
      shutdown(code === 0 ? 1 : (code ?? 1));
    }
  });

  console.log(`[launcher] Started ${name}`);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('[launcher] Stopping all processes...');

  for (const child of children.values()) {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(exitCode), 5000).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

start('NODE_A', 'backend/dist/main.js', {
  NODE_ID: 'NODE_A',
  HOST: '127.0.0.1',
  PORT: '3001',
});

start('NODE_B', 'backend/dist/main.js', {
  NODE_ID: 'NODE_B',
  HOST: '127.0.0.1',
  PORT: '3002',
});

start('NODE_C', 'backend/dist/main.js', {
  NODE_ID: 'NODE_C',
  HOST: '127.0.0.1',
  PORT: '3003',
});

start('GATEWAY', 'gateway/server.mjs', {
  HOST: '0.0.0.0',
});
