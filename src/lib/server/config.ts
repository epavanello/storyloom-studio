import { z } from 'zod';

// This module is imported by the standalone worker, which runs outside SvelteKit.
// It must therefore read `process.env` directly instead of `$env/dynamic/private`.
// `src/hooks.server.ts` copies SvelteKit's dynamic env into `process.env` at boot so
// both entrypoints observe the same values.

const PolicySchema = z.enum(['local-required', 'local-preferred', 'cloud-preferred', 'cloud-only']);

/**
 * What a process is able to execute. `mock` needs no credentials, `local` needs the
 * Mac inference runtimes, `cloud` needs an OpenRouter key, `hybrid` accepts both.
 */
const RuntimeModeSchema = z.enum(['mock', 'local', 'cloud', 'hybrid']);

/**
 * `inline` runs a BullMQ worker inside the web process, which is what a single-box
 * deployment wants. `external` means the queue is drained by a separate `pnpm worker`
 * process, possibly on another machine. `off` disables job execution in this process.
 */
const WorkerModeSchema = z.enum(['inline', 'external', 'off']);

export const AppConfigSchema = z.object({
  mode: RuntimeModeSchema,
  publicUrl: z.string(),
  databaseUrl: z.string(),
  redisUrl: z.string(),
  /**
   * Namespaces every queue and live-state key in Redis. Two deployments — or a dev
   * server and a test run — can share one Redis instance without draining each
   * other's queues.
   */
  queuePrefix: z.string().min(1),
  encryptionKey: z.string(),
  storage: z.object({
    driver: z.enum(['fs', 's3']),
    dataDir: z.string(),
    bucket: z.string(),
    endpoint: z.string(),
    region: z.string(),
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
    forcePathStyle: z.boolean(),
    signedUrlTtlSeconds: z.number().int().positive()
  }),
  worker: z.object({
    mode: WorkerModeSchema,
    concurrency: z.number().int().positive(),
    lockDurationMs: z.number().int().positive(),
    stalledIntervalMs: z.number().int().positive()
  }),
  auth: z.object({
    secret: z.string(),
    trustedOrigins: z.array(z.string()),
    allowSignUp: z.boolean(),
    github: z.object({ clientId: z.string(), clientSecret: z.string() }),
    google: z.object({ clientId: z.string(), clientSecret: z.string() })
  }),
  localLlmBaseUrl: z.string(),
  localLlmModel: z.string(),
  localLlmModelKey: z.string(),
  openRouterApiKey: z.string(),
  openRouterLlmModel: z.string(),
  localTtsBaseUrl: z.string(),
  localTtsModel: z.string(),
  localTtsRuntimeModel: z.string(),
  localImageBaseUrl: z.string(),
  localImageModel: z.string(),
  localImageRuntimeModel: z.string(),
  localAlignerBaseUrl: z.string(),
  openRouterTtsModel: z.string(),
  openRouterTtsVoices: z.array(z.string()).min(1),
  openRouterImageModel: z.string(),
  policies: z.object({
    text: PolicySchema,
    tts: PolicySchema,
    image: PolicySchema,
    alignment: PolicySchema
  })
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;
export type WorkerMode = z.infer<typeof WorkerModeSchema>;

function list(value: string | undefined, fallback: string[]) {
  const items = (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function flag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function integer(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfig(): AppConfig {
  const env = process.env;
  const mode = env.STORYLOOM_MODE ?? 'mock';
  return AppConfigSchema.parse({
    mode,
    publicUrl: (env.STORYLOOM_PUBLIC_URL ?? 'http://localhost:4173').replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? '',
    queuePrefix: env.STORYLOOM_QUEUE_PREFIX || 'storyloom',
    encryptionKey: env.STORYLOOM_ENCRYPTION_KEY ?? '',
    storage: {
      driver: env.STORAGE_DRIVER ?? (env.S3_BUCKET ? 's3' : 'fs'),
      dataDir: env.STORYLOOM_DATA_DIR ?? './data',
      bucket: env.S3_BUCKET ?? '',
      endpoint: (env.S3_ENDPOINT ?? '').replace(/\/$/, ''),
      region: env.S3_REGION ?? 'auto',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      // Cloudflare R2 and MinIO both expect path-style addressing.
      forcePathStyle: flag(env.S3_FORCE_PATH_STYLE, true),
      signedUrlTtlSeconds: integer(env.S3_SIGNED_URL_TTL_SECONDS, 900)
    },
    worker: {
      mode: env.STORYLOOM_WORKER_MODE ?? 'inline',
      // Local inference loads one heavy model at a time, so a machine in local mode
      // must not take a second job while the first is holding a runtime.
      concurrency: integer(env.STORYLOOM_WORKER_CONCURRENCY, mode === 'local' ? 1 : 2),
      lockDurationMs: integer(env.STORYLOOM_WORKER_LOCK_MS, 120_000),
      stalledIntervalMs: integer(env.STORYLOOM_WORKER_STALLED_MS, 60_000)
    },
    auth: {
      secret: env.BETTER_AUTH_SECRET ?? '',
      trustedOrigins: list(env.BETTER_AUTH_TRUSTED_ORIGINS, []),
      allowSignUp: flag(env.STORYLOOM_ALLOW_SIGNUP, true),
      github: { clientId: env.GITHUB_CLIENT_ID ?? '', clientSecret: env.GITHUB_CLIENT_SECRET ?? '' },
      google: { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' }
    },
    localLlmBaseUrl: env.LOCAL_LLM_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    localLlmModel: env.LOCAL_LLM_MODEL ?? 'local-model',
    localLlmModelKey: env.LOCAL_LLM_MODEL_KEY ?? env.LOCAL_LLM_MODEL ?? 'local-model',
    openRouterApiKey: env.OPENROUTER_API_KEY ?? '',
    openRouterLlmModel: env.OPENROUTER_LLM_MODEL ?? 'deepseek/deepseek-v4-flash-0731',
    localTtsBaseUrl: env.LOCAL_TTS_BASE_URL ?? 'http://127.0.0.1:7861/v1',
    localTtsModel: env.LOCAL_TTS_MODEL ?? 'qwen3-tts',
    localTtsRuntimeModel: env.LOCAL_TTS_RUNTIME_MODEL ?? 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit',
    localImageBaseUrl: env.LOCAL_IMAGE_BASE_URL ?? 'http://127.0.0.1:7862/v1',
    localImageModel: env.LOCAL_IMAGE_MODEL ?? 'qwen-image-edit',
    localImageRuntimeModel: env.LOCAL_IMAGE_RUNTIME_MODEL ?? 'mlx-community/flux2-klein-4b-4bit',
    localAlignerBaseUrl: env.LOCAL_ALIGNER_BASE_URL ?? '',
    openRouterTtsModel: env.OPENROUTER_TTS_MODEL ?? 'qwen/qwen-audio-3.0-tts-flash',
    openRouterTtsVoices: list(env.OPENROUTER_TTS_VOICES, ['loongjohn', 'longanhuan_v3.6']),
    openRouterImageModel: env.OPENROUTER_IMAGE_MODEL ?? 'google/gemini-3.1-flash-image',
    policies: {
      text: env.TEXT_POLICY ?? 'local-preferred',
      tts: env.TTS_POLICY ?? 'local-preferred',
      image: env.IMAGE_POLICY ?? 'local-preferred',
      alignment: env.ALIGNMENT_POLICY ?? 'local-preferred'
    }
  });
}

/** Fails loudly instead of letting a missing connection string surface as a driver error. */
export function requireDatabaseUrl() {
  const { databaseUrl } = getConfig();
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. Point it at your Neon (or local) Postgres instance.');
  return databaseUrl;
}

export function requireRedisUrl() {
  const { redisUrl } = getConfig();
  if (!redisUrl) throw new Error('REDIS_URL is not set. The job queue needs Redis to accept and dispatch work.');
  return redisUrl;
}
