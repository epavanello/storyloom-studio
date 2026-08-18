# Self-hosting Storyloom

This guide contains the operational detail intentionally kept out of the project README.

## Requirements

- Node.js 22.13 or newer
- pnpm
- OpenSSL for secret generation

The default single-machine setup uses SQLite, filesystem storage, an in-process queue, and an inline worker. It does not need Redis or a separate database server.

## Base setup

```sh
git clone https://github.com/epavanello/storyloom-studio.git
cd storyloom-studio
pnpm install
cp .env.example .env
```

Generate `STORYLOOM_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` separately:

```sh
openssl rand -base64 32
openssl rand -base64 32
```

Paste the values into `.env`, then initialize and start the default mock deployment:

```sh
pnpm db:migrate
pnpm dev
```

Open [http://localhost:4173](http://localhost:4173). Set `STORYLOOM_ALLOW_SIGNUP=true` while creating an account, then disable it again if registration should be closed.

## OpenRouter modes

Copy the cloud inference profile:

```sh
cp .env.storyloom-cloud.example .env.storyloom-cloud
```

### Public BYOK deployment

Every account supplies its own OpenRouter key in **Settings**:

```dotenv
STORYLOOM_MODE=cloud
OPENROUTER_KEY_MODE=account
OPENROUTER_API_KEY=
```

Account keys are sealed with AES-256-GCM using `STORYLOOM_ENCRYPTION_KEY`. They are decrypted only while that account's job runs and are never sent back to the browser or written to artifacts and logs. Account mode fails closed and never falls back to an environment key.

Start the cloud profile with:

```sh
pnpm dev:cloud
```

### Private deployment with one shared key

A trusted home, studio, or team installation can fund all accounts with one operator key:

```dotenv
OPENROUTER_KEY_MODE=shared
OPENROUTER_API_KEY=sk-or-v1-your-key
```

Shared mode deliberately ignores account keys, keeping billing behavior unambiguous.

## Email verification and account recovery

For open registration, configure a verified Resend sender:

```dotenv
STORYLOOM_PUBLIC_URL=https://storyloom.example.com
STORYLOOM_ALLOW_SIGNUP=true
STORYLOOM_REQUIRE_EMAIL_VERIFICATION=true
RESEND_API_KEY=re_your_key
STORYLOOM_EMAIL_FROM="Storyloom <accounts@storyloom.example.com>"
```

Verification, resend, password recovery, and password change are built in. Reset links expire after one hour and a successful reset revokes existing sessions. Storyloom refuses to start when verification is required but Resend is not configured.

An isolated self-host may use `STORYLOOM_REQUIRE_EMAIL_VERIFICATION=false` and omit Resend. Email verification and password recovery are unavailable in that configuration.

## Deployment shape

A deployment has one inference mode—`mock`, `local`, `cloud`, or `hybrid`—and all jobs follow it. `STORYLOOM_WORKER_MODE` decides whether the web process drains the queue (`inline`), a detached process does (`external`), or execution is disabled (`off`).

| Single machine | Distributed deployment |
| --- | --- |
| SQLite `file:` database | Turso/libSQL |
| Filesystem artifacts | S3-compatible storage |
| Durable in-process queue | Redis/BullMQ |
| Inline worker | Inline or detached worker |

Configuration is layered:

- `.env` contains infrastructure, auth, storage, queue, and account-key ownership.
- `.env.storyloom-cloud` contains OpenRouter models and cloud policies.
- `.env.storyloom-local` contains local endpoints and local-only policies.
- `.env.storyloom-hybrid` contains explicit local/cloud policy per capability.

All supported variables and safety notes are documented in `.env.example` and the three profile examples.

## Useful commands

```sh
pnpm dev                 # default mock app
pnpm dev:local           # local inference profile
pnpm dev:hybrid          # mixed capability policy
pnpm dev:cloud           # OpenRouter profile
pnpm worker:cloud        # detached cloud worker
pnpm db:migrate          # apply database migrations
pnpm test                # deterministic tests
pnpm check               # Svelte and TypeScript checks
pnpm build               # production build
```

## Current limits

- OpenRouter does not provide forced alignment here, so cloud word timing is marked approximate.
- Real local providers need another end-to-end validation after the object-storage and queue migration.
- Cache identity is not yet a complete provider/model/input fingerprint.
- Add operator-level quotas and rate limits before opening unrestricted public registration.
- S3/R2 and hosted Turso configurations compile but have not been exercised against production services.

See [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) for the full architecture, product invariants, validation record, and roadmap.
