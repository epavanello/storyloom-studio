import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] === 'build' ? 'build' : 'dev';
const cloudEnvironment = resolve(root, '.env.storyloom-cloud');

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

let apiKey = process.env.OPENROUTER_API_KEY?.trim();
if (!apiKey && existsSync(cloudEnvironment)) {
  const match = readFileSync(cloudEnvironment, 'utf8').match(/^OPENROUTER_API_KEY=(.*)$/m);
  if (match) apiKey = unquote(match[1]);
}

if (!apiKey) {
  console.error('Hybrid mode needs OPENROUTER_API_KEY in .env.storyloom-cloud or the process environment.');
  process.exit(1);
}

const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const child = spawn(process.execPath, [vite, command, '--mode', 'storyloom-hybrid'], {
  cwd: root,
  env: { ...process.env, OPENROUTER_API_KEY: apiKey },
  stdio: 'inherit'
});

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
