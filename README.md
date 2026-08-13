# Storyloom Studio

Storyloom turns EPUB, PDF and plain-text books into synchronized audiovisual chapter performances: it analyzes a book once, locks characters into a central registry, and renders chapters on demand with expressive voices and reference-conditioned scene images.

It runs as a deployable service where **the web tier and the machine doing inference do not have to be the same box**. For the product vision, boundaries and quality goals, read [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md); treat that document as intent and verify every claimed capability against the code.

## Architecture

```text
browser ──▶ SvelteKit web tier ──▶ Postgres    (books, chapters, renders, job records)
                    │             ──▶ Redis      (job queue + live progress)
                    │             ──▶ S3 / R2    (audio, images, reference sheets)
                    ▼
              BullMQ queues
                    ├── storyloom-cloud            drained by any worker with cloud access
                    └── storyloom-local-<userId>   drained only by that user's own machine
                                   │
                                   ▼
                      worker ──▶ deterministic orchestrator
                                   └─▶ capability router
                                         ├─ text (LM Studio / OpenRouter)
                                         ├─ speech (local / OpenRouter)
                                         ├─ forced alignment
                                         └─ images (local / OpenRouter)
```

The orchestrator makes no creative decisions. The chapter planner reads the complete chapter and emits a typed performance plan; the orchestrator validates it, invokes the selected providers, aligns audio, resolves scene cues to real timeline positions, stores the result and exposes it to the player.

### Where a job runs

Each account chooses, under **Settings**, whether its heavy work runs in the cloud or on its own machine.

- **Cloud** puts the job on the shared `storyloom-cloud` queue, executed with that account's own OpenRouter key.
- **My own machine** puts the job on `storyloom-local-<userId>`, which nothing else consumes. The job waits — visibly, with the dashboard reporting that no worker is connected — until that user starts `pnpm worker`. Book text never reaches a cloud provider in this mode.

Only trust a machine with direct Redis and Postgres credentials when its operator is allowed to see every account's data. That makes the detached worker right for self-hosting and for the operator's own machine; a public "bring your own hardware" runner needs a token-scoped HTTP protocol instead, which does not exist yet (see *Not built yet*).

### Cost shape

Nothing polls Postgres. Live per-step job progress is written to Redis, the browser polls Redis-backed endpoints, and Postgres only sees state transitions — a job accepted, started, finished — plus the durable artifacts of a render. Sessions are cached in a signed cookie for a minute. A serverless Postgres is therefore free to suspend whenever no generation is running, which is what keeps a Neon deployment inside a small compute budget.

## Quick start

```bash
cp .env.storyloom-local.example .env
# fill in STORYLOOM_ENCRYPTION_KEY and BETTER_AUTH_SECRET: openssl rand -base64 32
docker compose -f docker-compose.dev.yml up -d
pnpm install
pnpm db:migrate
pnpm dev
```

Open `http://localhost:4173`, create an account, and either import a book or open the built-in demo story. With `STORYLOOM_MODE=mock` no credentials or model downloads are needed.

## Deployment topologies

**One cheap box, cloud inference.** `STORYLOOM_WORKER_MODE=inline` and `STORYLOOM_WORKER_QUEUES=cloud`: the web process also drains the shared queue. Postgres on Neon, Redis managed, artifacts on Cloudflare R2. See `.env.storyloom-cloud.example`.

**Cheap box + your Mac.** The same web deployment with `STORYLOOM_WORKER_MODE=off` (or `inline` if you also want to serve cloud accounts), plus a worker started on the machine that owns the models:

```bash
STORYLOOM_MODE=local \
STORYLOOM_WORKER_QUEUES=local:<your-user-id> \
DATABASE_URL=… REDIS_URL=… S3_BUCKET=… \
pnpm worker
```

The exact queue selector is shown under **Settings** once that account switches to *My own machine*. See `.env.worker.example`.

**Everything local.** One machine, `STORAGE_DRIVER=fs`, `docker compose -f docker-compose.dev.yml up -d` for Postgres and Redis, `STORYLOOM_WORKER_MODE=inline`.

## Configuration

`.env.example` documents every setting. The ones that decide the topology:

| Variable | Meaning |
| --- | --- |
| `STORYLOOM_MODE` | `mock`, `local`, `cloud`, `hybrid` — what this process can execute |
| `STORYLOOM_WORKER_MODE` | `inline` (worker inside the web process), `external`, `off` |
| `STORYLOOM_WORKER_QUEUES` | `cloud`, `local:<userId>`, or a full queue name |
| `DATABASE_URL` / `REDIS_URL` | Shared by the web tier and every worker |
| `STORYLOOM_QUEUE_PREFIX` | Namespaces Redis keys; must match across a deployment's web tier and workers |
| `STORAGE_DRIVER` | `fs` or `s3`; defaults to `s3` when `S3_BUCKET` is set |
| `STORYLOOM_ENCRYPTION_KEY` | Encrypts stored provider keys. Changing it makes them unreadable |
| `BETTER_AUTH_SECRET` | Signs sessions |

## Accounts and credentials

Sign-in is email/password, with GitHub and Google enabled automatically when their client ID and secret are configured. Every book, chapter, render, artifact and job belongs to exactly one account and every read is scoped by that owner, including artifact downloads — media is served through an authorizing route that hands out a short-lived signed URL, never from a public bucket.

Provider keys are bring-your-own: each account stores its own OpenRouter key, sealed with AES-256-GCM and decrypted only while one of that account's jobs runs. `OPENROUTER_API_KEY` in the environment is an operator fallback for a single-tenant deployment and is left empty on a public one.

## Modes

- **mock** — deterministic demo providers, no credentials. Procedural SVGs, silent timed audio and proportional word timing. It exercises the flow, not creative quality.
- **local** — every mandatory step runs on the machine's own runtimes; nothing is sent to a cloud provider.
- **cloud** — structured text, TTS and reference-capable image generation through OpenRouter. OpenRouter exposes no forced-alignment endpoint, so cloud renders use duration-derived proportional timing and record it as `approximate`, never as exact.
- **hybrid** — a policy per capability: `local-required`, `local-preferred`, `cloud-preferred`, `cloud-only`. Artifacts always record the provider and model that produced them.

In `local` mode Storyloom owns the heavy-model lifecycle and executes one phase at a time — LM Studio text → unload, Qwen3-TTS → stop, forced aligner → stop, FLUX text-to-image → stop, FLUX reference edit → stop — so a worker on that machine should run with `STORYLOOM_WORKER_CONCURRENCY=1`. Media runtime installations live outside the repository under `STORYLOOM_RUNTIME_HOME` (default `~/.local/share/storyloom-studio`).

## Commands

```bash
pnpm dev            # web app
pnpm worker         # standalone queue consumer
pnpm db:generate    # write a migration after changing the Drizzle schema
pnpm db:migrate     # apply migrations
pnpm check
pnpm test
pnpm build && pnpm start
```

## Verified

Exercised end to end in `mock` mode against real Postgres and Redis, through the HTTP API with real sessions:

- account creation, sign-in and rejection of anonymous requests;
- book import, chapter render, and artifacts written and read back;
- a job produced by the web tier and executed by a **separate worker process** on a private per-user queue, with the web tier observing the completed render;
- a queued job correctly waiting, and being reported as waiting, while no worker is connected;
- cancellation of a queued job and removal of a finished one;
- one account being unable to read another account's book, artifacts or jobs, or to queue work against them (404 in every case).

`src/lib/server/pipeline.integration.test.ts` covers that pipeline and runs automatically when `DATABASE_URL` and `REDIS_URL` are set; the default `pnpm test` skips it and needs no services.

The earlier local vertical — Qwen3.6 35B A3B for structured planning, Qwen3-TTS 1.7B, Qwen3 ForcedAligner for exact word timestamps, FLUX.2 Klein 4B for character sheets and scenes — was validated on an Apple M4 Max with 36 GB unified memory **before** this restructuring. Those providers are unchanged in substance but have not been re-run end to end since artifacts moved behind the storage layer.

## Not built yet

- **Untrusted remote runners.** A user who is not the operator cannot safely run their own worker today, because the worker needs direct Redis and Postgres credentials. Doing that properly needs a runner token, an HTTP claim/heartbeat/report protocol and presigned upload URLs, so a runner only ever sees its own account's jobs.
- **Quotas and rate limits.** Nothing bounds how much work an account can queue.
- **Email verification and password reset.** better-auth supports both; no mailer is wired.
- **Artifact cache fingerprints.** A render is still addressed by chapter, not by a fingerprint of input, provider, model and settings, so a provider change does not invalidate a cached chapter.
