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
const OpenRouterKeyModeSchema = z.enum(['account', 'shared']);

export const AppConfigSchema = z.object({
  mode: RuntimeModeSchema,
  /** Reveals provider, model and timing detail in the UI. Off for ordinary readers. */
  technicalUi: z.boolean(),
  publicUrl: z.string().url(),
  /** `file:./data/storyloom.db` for one machine, `libsql://…turso.io` when distributed. */
  databaseUrl: z.string(),
  databaseAuthToken: z.string(),
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
    requireEmailVerification: z.boolean(),
    resendApiKey: z.string(),
    emailFrom: z.string(),
    github: z.object({ clientId: z.string(), clientSecret: z.string() }),
    google: z.object({ clientId: z.string(), clientSecret: z.string() })
  }),
  localLlmBaseUrl: z.string(),
  localLlmModel: z.string(),
  localLlmModelKey: z.string(),
  openRouterApiKey: z.string(),
  /**
   * `account` is the public SaaS posture: only the requesting account's sealed key
   * may fund a run. `shared` is for a trusted self-host where the operator key funds
   * every account. Keeping this explicit prevents an accidental SaaS fallback.
   */
  openRouterKeyMode: OpenRouterKeyModeSchema,
  openRouterLlmModel: z.string(),
  // How OpenRouter picks between the providers serving a model. Empty keeps OpenRouter's
  // default price-weighted load balancing; any sort value disables that balancing.
  openRouterProviderSort: z.enum(['throughput', 'latency', 'price', '']),
  /** How many chapter passages may be synthesized at once against a cloud speech provider. */
  speechConcurrency: z.number().int().min(1).max(16),
  /** How many scene or reference images may be generated at once against a cloud provider. */
  imageConcurrency: z.number().int().min(1).max(8),
  localTtsEngine: z.enum(['qwen', 'chatterbox-v3']),
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
    technicalUi: flag(env.STORYLOOM_TECHNICAL_UI, false),
    publicUrl: (env.STORYLOOM_PUBLIC_URL ?? 'http://localhost:4173').replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL ?? '',
    databaseAuthToken: env.DATABASE_AUTH_TOKEN ?? '',
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
      // Registration is closed unless a deployment opts in, so an instance that is put
      // online before its owner thinks about auth does not collect strangers' accounts.
      allowSignUp: flag(env.STORYLOOM_ALLOW_SIGNUP, false),
      // Supplying Resend opts into the safe public-registration posture by default.
      // An isolated self-host without mail can explicitly keep this false.
      requireEmailVerification: flag(env.STORYLOOM_REQUIRE_EMAIL_VERIFICATION, Boolean(env.RESEND_API_KEY)),
      resendApiKey: env.RESEND_API_KEY ?? '',
      emailFrom: env.STORYLOOM_EMAIL_FROM ?? '',
      github: { clientId: env.GITHUB_CLIENT_ID ?? '', clientSecret: env.GITHUB_CLIENT_SECRET ?? '' },
      google: { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' }
    },
    localLlmBaseUrl: env.LOCAL_LLM_BASE_URL ?? 'http://127.0.0.1:1234/v1',
    localLlmModel: env.LOCAL_LLM_MODEL ?? 'local-model',
    localLlmModelKey: env.LOCAL_LLM_MODEL_KEY ?? env.LOCAL_LLM_MODEL ?? 'local-model',
    openRouterApiKey: env.OPENROUTER_API_KEY ?? '',
    openRouterKeyMode: env.OPENROUTER_KEY_MODE ?? 'shared',
    openRouterLlmModel: env.OPENROUTER_LLM_MODEL ?? 'deepseek/deepseek-v4-flash-0731',
    openRouterProviderSort: env.OPENROUTER_PROVIDER_SORT ?? 'throughput',
    // A chapter is often a hundred short passages, and a cloud provider answers them
    // independently. Local speech ignores this and stays serial: one model, one GPU.
    speechConcurrency: integer(env.STORYLOOM_SPEECH_CONCURRENCY, 6),
    // Images cost far more per request than speech, so the default stays modest: enough to
    // overlap the waiting, not enough to trip a provider's rate limit.
    imageConcurrency: integer(env.STORYLOOM_IMAGE_CONCURRENCY, 3),
    localTtsEngine: env.LOCAL_TTS_ENGINE ?? 'qwen',
    localTtsBaseUrl: env.LOCAL_TTS_BASE_URL ?? 'http://127.0.0.1:7861/v1',
    localTtsModel: env.LOCAL_TTS_MODEL ?? 'qwen3-tts',
    localTtsRuntimeModel: env.LOCAL_TTS_RUNTIME_MODEL ?? 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit',
    localImageBaseUrl: env.LOCAL_IMAGE_BASE_URL ?? 'http://127.0.0.1:7862/v1',
    localImageModel: env.LOCAL_IMAGE_MODEL ?? 'qwen-image-edit',
    localImageRuntimeModel: env.LOCAL_IMAGE_RUNTIME_MODEL ?? 'mlx-community/flux2-klein-4b-4bit',
    localAlignerBaseUrl: env.LOCAL_ALIGNER_BASE_URL ?? '',
    openRouterTtsModel: env.OPENROUTER_TTS_MODEL ?? 'google/gemini-3.1-flash-tts-preview',
    openRouterTtsVoices: list(env.OPENROUTER_TTS_VOICES, ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat']),
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
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Use file:./data/storyloom.db for a single machine, or a libsql://…turso.io URL when the worker runs elsewhere.');
  }
  return databaseUrl;
}

/**
 * Redis is optional. Without it the queue runs in-process, which is only viable when
 * this process is also the worker; `getQueueDriver` enforces that.
 */
export function usesRedisQueue() {
  return Boolean(getConfig().redisUrl);
}
