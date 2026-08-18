import { spawn, execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';
import { getConfig } from './config';

export type LocalRuntimePhase = 'text' | 'speech' | 'alignment' | 'image-generate' | 'image-edit';

const execFileAsync = promisify(execFile);

type RuntimeState = {
  tail: Promise<void>;
  children: Map<LocalRuntimePhase, ChildProcess>;
  exitHookInstalled: boolean;
};

const stateKey = Symbol.for('storyloom.local-runtime-state');
const globalState = globalThis as typeof globalThis & { [stateKey]?: RuntimeState };
const state = globalState[stateKey] ??= { tail: Promise.resolve(), children: new Map(), exitHookInstalled: false };

export function runtimeHome() {
  return process.env.STORYLOOM_RUNTIME_HOME || join(homedir(), '.local/share/storyloom-studio');
}

async function responds(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(url: string, child: ChildProcess, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local runtime exited during startup with code ${child.exitCode}`);
    if (await responds(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Local runtime did not become ready at ${url}`);
}

async function stopChild(phase: LocalRuntimePhase) {
  const child = state.children.get(phase);
  if (!child) return;
  state.children.delete(phase);
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000))
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function stopMediaRuntimes() {
  await Promise.all((['speech', 'alignment', 'image-generate', 'image-edit'] as const).map(stopChild));
}

async function unloadText() {
  const config = getConfig();
  try {
    await execFileAsync('lms', ['unload', config.localLlmModel], { timeout: 30_000 });
  } catch {
    // The requested instance may already be absent.
  }
}

async function startChild(phase: LocalRuntimePhase, command: string, args: string[], cwd: string, readyUrl: string, env: NodeJS.ProcessEnv = {}) {
  if (await responds(readyUrl)) {
    throw new Error(`Cannot coordinate ${phase}: ${readyUrl} is already served by an external process. Stop it and retry so Storyloom can own its lifecycle.`);
  }
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env, PYTHONUNBUFFERED: '1' },
    stdio: 'inherit'
  });
  state.children.set(phase, child);
  try {
    await waitUntilReady(readyUrl, child);
  } catch (error) {
    await stopChild(phase);
    throw error;
  }
}

async function activate(phase: LocalRuntimePhase) {
  const config = getConfig();
  await stopMediaRuntimes();
  await unloadText();

  if (phase === 'text') {
    if (!(await responds(`${config.localLlmBaseUrl.replace(/\/v1\/?$/, '')}/api/v1/models`))) {
      await execFileAsync('lms', ['server', 'start'], { timeout: 30_000 });
    }
    await execFileAsync('lms', [
      'load', config.localLlmModelKey,
      '--identifier', config.localLlmModel,
      '--context-length', '8192',
      '--parallel', '1',
      '--ttl', '900',
      '--yes'
    ], { timeout: 120_000 });
    return;
  }

  const home = runtimeHome();
  if (phase === 'speech') {
    if (config.localTtsEngine === 'chatterbox-v3') {
      const cwd = join(process.cwd(), 'runtime', 'chatterbox-server');
      const installation = join(home, 'chatterbox-v3');
      await startChild(phase, join(installation, '.venv/bin/python'), [
        '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '7861'
      ], cwd, `${config.localTtsBaseUrl.replace(/\/v1\/?$/, '')}/health`, {
        CHATTERBOX_VOICE_DIR: join(installation, 'voices')
      });
      return;
    }
    const cwd = join(home, 'qwen3-tts-api');
    await startChild(phase, join(cwd, '.venv-mlx/bin/python'), [
      '-m', 'uvicorn', 'api.main:app', '--host', '127.0.0.1', '--port', '7861'
    ], cwd, `${config.localTtsBaseUrl.replace(/\/v1\/?$/, '')}/health`, {
      TTS_BACKEND: 'mlx',
      MLX_MODEL_ID: config.localTtsRuntimeModel,
      TTS_LAZY_LOAD: 'false',
      TTS_WARMUP_ON_START: 'false'
    });
    return;
  }

  if (phase === 'alignment') {
    const cwd = join(home, 'qwen3-aligner');
    await startChild(phase, join(cwd, '.venv/bin/python'), [
      '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '7863'
    ], cwd, `${config.localAlignerBaseUrl.replace(/\/v1\/?$/, '')}/health`);
    return;
  }

  const cwd = join(home, 'mlx-openai-server');
  const compatibilityPath = join(process.cwd(), 'runtime', 'mlx-openai-server');
  await startChild(phase, join(cwd, '.venv/bin/mlx-openai-server'), [
    'launch',
    '--model-type', 'image-generation',
    '--model-path', config.localImageRuntimeModel,
    '--served-model-name', config.localImageModel,
    '--config-name', phase === 'image-edit' ? 'flux2-klein-edit-4b' : 'flux2-klein-4b',
    '--host', '127.0.0.1', '--port', '7862',
    '--queue-timeout', '600', '--queue-size', '4', '--no-log-file'
  ], cwd, `${config.localImageBaseUrl}/models`, {
    PYTHONPATH: [compatibilityPath, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
  });
}

async function deactivate(phase: LocalRuntimePhase) {
  if (phase === 'text') await unloadText();
  else await stopChild(phase);
}

/**
 * Whether this deployment runs the phase on its own machine. Callers use it to decide how
 * much work may be in flight at once: a local runtime holds one model and must stay
 * serial, while a cloud provider answers independent requests concurrently.
 */
export function usesLocalRuntime(phase: LocalRuntimePhase) {
  const config = getConfig();
  const capability = phase === 'text' ? 'text' : phase === 'speech' ? 'tts' : phase === 'alignment' ? 'alignment' : 'image';
  return config.mode === 'local' || (config.mode === 'hybrid' && config.policies[capability] !== 'cloud-only');
}

export async function withLocalRuntime<T>(phase: LocalRuntimePhase, task: () => Promise<T>): Promise<T> {
  if (!usesLocalRuntime(phase)) return task();
  let unlock!: () => void;
  const previous = state.tail;
  state.tail = new Promise<void>((resolve) => { unlock = resolve; });
  await previous;
  try {
    await activate(phase);
    return await task();
  } finally {
    await deactivate(phase);
    unlock();
  }
}

if (!state.exitHookInstalled) {
  state.exitHookInstalled = true;
  process.once('exit', () => {
    for (const child of state.children.values()) child.kill('SIGTERM');
  });
}
