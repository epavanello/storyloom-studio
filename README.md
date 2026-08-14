# Storyloom Studio

Storyloom turns imported or AI-authored books into synchronized audiovisual chapter performances: it analyzes a book once, locks characters into a central registry, and renders chapters on demand with expressive voices and reference-conditioned scene images. EPUB, PDF and plain text can be imported; alternatively, the queued story writer can turn a prompt into a complete multi-chapter source manuscript.

It runs as a deployable service where **the web tier and the machine doing inference do not have to be the same box**. For the product vision, boundaries and quality goals, read [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md); treat that document as intent and verify every claimed capability against the code.

## Architecture

```text
browser ──▶ SvelteKit web tier ──▶ SQLite   (books, chapters, renders, job records)
                    │                          local file, or Turso when distributed
                    │             ──▶ Redis    (job queue + live progress)
                    │             ──▶ storage  (audio, images, reference sheets)
                    │                          local filesystem, or S3/R2
                    ▼
             one BullMQ queue
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

**A deployment is either cloud or local, never both.** `STORYLOOM_MODE` decides it, and every job on that deployment runs that way — there is no per-account choice and no mixed routing. What is parametric is *which process* drains the queue:

- `STORYLOOM_WORKER_MODE=inline` — the web process runs the worker. One box does everything.
- `STORYLOOM_WORKER_MODE=external` — the web process only accepts and reports jobs; a separate `pnpm worker` drains the queue, on this machine or another one.
- `STORYLOOM_WORKER_MODE=off` — this process never executes jobs.

Switching from local to cloud later is a configuration change, not a code change: point `STORYLOOM_MODE` and the capability policies at the cloud and let the web process run the worker inline.

A worker holds direct database and Redis credentials, so it can read every account's data. Run it only on a machine you operate.

### Swappable infrastructure

Both stateful pieces sit behind one interface, so the same code serves a laptop and a hosted deployment:

| | one machine | distributed |
| --- | --- | --- |
| Database | `DATABASE_URL=file:./data/storyloom.db` | `DATABASE_URL=libsql://…turso.io` + `DATABASE_AUTH_TOKEN` |
| Artifacts | `STORAGE_DRIVER=fs` | `STORAGE_DRIVER=s3` + bucket credentials |

| Queue | in-process, no `REDIS_URL` | `REDIS_URL` pointing at Redis |

A `file:` database and the in-process queue only work when everything runs in one place: two machines cannot share a SQLite file, and nothing outside the process can see an in-memory queue. Selecting either while `STORYLOOM_WORKER_MODE` is not `inline` is refused at startup rather than leaving jobs silently unexecuted.

The in-process queue is not a toy: work already accepted is durable, because the `jobs` table is the record of what is owed and anything still queued is re-enqueued at boot. What it does not survive is a render already in flight, which is reported as interrupted so the user can restart it.

### Cost shape

Nothing polls the database. Live per-step job progress is written to Redis, the browser polls Redis-backed endpoints, and the database only sees state transitions — a job accepted, started, finished — plus the durable result of a render. Sessions are cached in a signed cookie for a minute. That keeps a hosted database's request count proportional to real work rather than to open browser tabs.

## Quick start

```bash
cp .env.example .env
# fill in STORYLOOM_ENCRYPTION_KEY and BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm install
pnpm db:migrate
pnpm dev                                      # mock inference by default
```

Open `http://localhost:4173`, create an account, and either generate a story from a prompt, import a book, or open the built-in demo story. With `STORYLOOM_MODE=mock` no credentials or model downloads are needed.

## Story sources and reading

The library accepts two source paths:

- import EPUB, PDF or TXT while preserving the extracted chapter text;
- request an original story and choose 1–12 chapters. A queued text-provider job first creates the complete narrative outline, then writes and stores every full chapter in order.

Generated chapters become immutable source text as soon as each chapter completes. If the writer stops, retrying resumes from the first missing chapter rather than rewriting successful chapters. The saved prompt, requested chapter count, outline, provider route and model remain attached to the book as provenance.

Every available chapter can be opened in **Read** mode before registries, voices, audio or images exist. Audiovisual augmentation remains a separate on-demand action, and a prepared chapter can switch between its source text and its performance.

Speech is generated as ordered, independently stored passages. As soon as the first complete passage is available, the active job exposes a private progressive preview so it can be heard while the remaining passages are still being synthesized. Preview playback is intentionally marked as awaiting word alignment; the published chapter render is replaced atomically only after its complete audio timeline and visual cues are ready.

## Deployment topologies

**1. Everything on one machine** — `.env` + `.env.storyloom-hybrid`

The app, a SQLite file, artifacts on disk, an in-process durable queue, and hybrid inference: the language model on OpenRouter, speech, alignment and images on this machine. No database or queue server is required.

```bash
cp .env.example .env
cp .env.storyloom-hybrid.example .env.storyloom-hybrid
pnpm db:migrate && pnpm dev:hybrid
```

Use `.env.storyloom-local.example` as the overlay instead when the language model must run in LM Studio too, so nothing at all leaves the machine.

**2. Full SaaS** — `.env` + `.env.storyloom-cloud`

One small always-on box, Turso for the database, R2 for artifacts, all inference through OpenRouter with each account's own key. Put Turso, Redis, R2 and auth settings in `.env`; copy `.env.storyloom-cloud.example` to `.env.storyloom-cloud` for models and policies. `STORYLOOM_WORKER_MODE=inline`, so the web process drains its own queue and no second machine is involved.

**3. Deployed app, your own hardware doing the inference** — `.env.worker.example`

The web deployment points at Turso and R2 with `STORYLOOM_WORKER_MODE=off`, so it only accepts and reports jobs. Your machine drains the queue against the same database and bucket:

```bash
cp .env.worker.example .env
cp .env.storyloom-hybrid.example .env.storyloom-hybrid
pnpm worker:hybrid
```

Media generated here is written to the shared bucket, so the deployed app serves it immediately. When your machine is off, jobs queue up and both the book page and `/jobs` report that no worker is connected — nothing hangs silently. This is also the migration path: switching to topology 2 later means changing the policies and turning the inline worker back on, not changing code.

## Configuration

Configuration is layered deliberately:

1. `.env` owns stable deployment information: database, Redis, storage, secrets, accounts and worker placement.
2. `.env.storyloom-local`, `.env.storyloom-hybrid` or `.env.storyloom-cloud` owns only inference mode, capability policies, provider models and model concurrency.
3. Variables exported by the host override both files.

Vite applies this inheritance for `dev:*` and `build:*`; the matching `worker:*` commands do the same. `db:migrate` reads only `.env`, because migrations need infrastructure credentials but no inference model. The variables that decide the topology:

| Variable | Meaning |
| --- | --- |
| `STORYLOOM_MODE` | `mock`, `local`, `cloud`, `hybrid` — how this deployment executes every job |
| `STORYLOOM_WORKER_MODE` | `inline` (worker inside the web process), `external`, `off` |
| `DATABASE_URL` | `file:…` for one machine, `libsql://…turso.io` when distributed |
| `DATABASE_AUTH_TOKEN` | Required for a `libsql://` URL |
| `REDIS_URL` | Optional on one machine; required as soon as the worker is a separate process |
| `STORYLOOM_QUEUE_PREFIX` | Namespaces Redis keys; must match across a deployment's web tier and workers |
| `STORAGE_DRIVER` | `fs` or `s3`; defaults to `s3` when `S3_BUCKET` is set |
| `STORYLOOM_ENCRYPTION_KEY` | Encrypts stored provider keys. Changing it makes them unreadable |
| `BETTER_AUTH_SECRET` | Signs sessions |

## Accounts and credentials

Sign-in is email/password, with GitHub and Google enabled automatically when their client ID and secret are configured. Every book, chapter, render, artifact and job belongs to exactly one account and every read is scoped by that owner, including artifact downloads — media is served through an authorizing route that hands out a short-lived signed URL, never from a public bucket.

Provider keys are bring-your-own: each account stores its own OpenRouter key, sealed with AES-256-GCM and decrypted only while one of that account's jobs runs. `OPENROUTER_API_KEY` in the environment is an operator fallback for a single-tenant deployment and is left empty on a public one. A deployment in `local` or `mock` mode needs no key at all.

## Modes

- **mock** — deterministic demo providers, no credentials. Procedural SVGs, silent timed audio and proportional word timing. It exercises the flow, not creative quality.
- **local** — every mandatory step runs on the machine's own runtimes; nothing is sent to a cloud provider.
- **cloud** — structured text, TTS and reference-capable image generation through OpenRouter. OpenRouter exposes no forced-alignment endpoint, so cloud renders use duration-derived proportional timing and record it as `approximate`, never as exact.
- **hybrid** — a policy per capability: `local-required`, `local-preferred`, `cloud-preferred`, `cloud-only`. Artifacts always record the provider and model that produced them.

In `local` mode Storyloom owns the heavy-model lifecycle and executes one phase at a time — LM Studio text → unload, Qwen3-TTS → stop, forced aligner → stop, FLUX text-to-image → stop, FLUX reference edit → stop — so a worker on that machine defaults to `STORYLOOM_WORKER_CONCURRENCY=1`. Media runtime installations live outside the repository under `STORYLOOM_RUNTIME_HOME` (default `~/.local/share/storyloom-studio`).

## Commands

```bash
pnpm dev            # web app, base .env (mock unless STORYLOOM_MODE is exported)
pnpm dev:local      # .env + .env.storyloom-local
pnpm dev:hybrid     # .env + .env.storyloom-hybrid
pnpm dev:cloud      # .env + .env.storyloom-cloud
pnpm worker         # standalone queue consumer using base .env
pnpm worker:local   # base + local profile
pnpm worker:hybrid  # base + hybrid profile
pnpm worker:cloud   # base + cloud profile
pnpm start:local    # run a built server with base + local profile
pnpm start:hybrid   # run a built server with base + hybrid profile
pnpm start:cloud    # run a built server with base + cloud profile
pnpm db:generate    # write a migration after changing the Drizzle schema
pnpm db:migrate     # apply migrations using database settings from .env
pnpm check
pnpm test
pnpm build && pnpm start
```

## Verified

Exercised end to end in `mock` mode against a real SQLite database and Redis, through the HTTP API with real sessions:

- account creation, sign-in and rejection of anonymous requests;
- book import, chapter render, and artifacts written and read back;
- a job produced by the web tier and executed by a **separate worker process**, with the web tier observing the completed render;
- a queued job correctly waiting, and being reported as waiting, while no worker is connected;
- cancellation of a queued job, refusal to delete a book with unfinished work, and deletion removing rows and objects together;
- one account being unable to read another account's book, artifacts or jobs, or to queue work against them (404 in every case).

`src/lib/server/pipeline.integration.test.ts` covers that pipeline and runs automatically when `DATABASE_URL` and `REDIS_URL` are set; the default `pnpm test` skips it and needs no services.

Every one of those runs used `STORAGE_DRIVER=fs` and a local SQLite file. **The S3/R2 driver and a hosted Turso database have never been exercised against a real endpoint** — they are written to the documented request shapes and type-check, which is not evidence that they work. Verify both before relying on topology 2 or 3.

The earlier local vertical — Qwen3.6 35B A3B for structured planning, Qwen3-TTS 1.7B, Qwen3 ForcedAligner for exact word timestamps, FLUX.2 Klein 4B for character sheets and scenes — was validated on an Apple M4 Max with 36 GB unified memory **before** this restructuring. Those providers are unchanged in substance but have not been re-run end to end since artifacts moved behind the storage layer.

## Not built yet

- **Per-account execution.** Every job on a deployment runs the deployment's way. There is no mixed cloud/local deployment and no per-user routing, by design.
- **Quotas and rate limits.** Nothing bounds how much work an account can queue.
- **Email verification and password reset.** better-auth supports both; no mailer is wired.
- **Artifact cache fingerprints.** A render is still addressed by chapter, not by a fingerprint of input, provider, model and settings, so a provider change does not invalidate a cached chapter.
