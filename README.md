<div align="center">

<img src="public/favicon.svg" width="112" alt="Storyloom Studio mark">

# Storyloom Studio

### Your books, staged in time.

Turn EPUB, PDF, TXT, or an original prompt into a chapter you can read, hear, and see—without changing a word of the source text.

[![SvelteKit](https://img.shields.io/badge/SvelteKit-5-ff3e00?style=for-the-badge&logo=svelte&logoColor=white)](https://svelte.dev/docs/kit)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](package.json)
[![MIT](https://img.shields.io/badge/license-MIT-bd5d36?style=for-the-badge)](LICENSE)

**[Run the demo](#run-it-in-five-minutes)** · **[Use your OpenRouter key](#hosted-byok)** · **[Self-host](#self-host-with-one-shared-key)**

</div>

Storyloom is an open-source, local-first studio for creating navigable audiovisual book performances. It builds a stable cast, plans a chapter as structured annotations, generates narration and cinematic scenes on demand, and keeps the original manuscript separate and intact.

> Storyloom is an early proof of concept. The deterministic mock is ideal for exploring the product; real providers still need representative end-to-end validation before production use.

## What makes it different

- **The book remains the book.** Imported text is never rewritten by the performance planner.
- **Characters have memory.** Character and voice registries keep identity, evidence, aliases, and references stable across chapters.
- **Generation is granular.** Prepare one chapter, one voice pass, one character reference, or one scene without rerendering everything.
- **Cloud use is explicit.** Run locally, bring your own OpenRouter key, or configure a trusted self-host with one shared key.
- **Artifacts stay private.** Every book, job, render, and media object is owner-scoped and served through authorized routes.

## Run it in five minutes

The mock mode needs no model downloads, cloud account, Redis, or external database.

```sh
git clone https://github.com/epavanello/storyloom-studio.git
cd storyloom-studio
cp .env.example .env

# Generate the two required secrets and paste them into .env
openssl rand -base64 32
openssl rand -base64 32

pnpm install
pnpm db:migrate
pnpm dev
```

Open [http://localhost:4173](http://localhost:4173). Set `STORYLOOM_ALLOW_SIGNUP=true` in `.env` while creating the first account. You can then import a book, generate a story, or open the built-in demo.

Mock narration is silent audio, mock scenes are procedural, and word timing is proportional. It demonstrates the workflow—not generative quality.

## Hosted BYOK

A public Storyloom deployment should use account-owned keys:

```dotenv
STORYLOOM_MODE=cloud
STORYLOOM_ALLOW_SIGNUP=true
OPENROUTER_KEY_MODE=account
OPENROUTER_API_KEY=
STORYLOOM_REQUIRE_EMAIL_VERIFICATION=true
RESEND_API_KEY=re_your_key
STORYLOOM_EMAIL_FROM="Storyloom <accounts@your-domain.example>"
```

Then each reader:

1. creates an account and verifies the email delivered by Resend;
2. opens **Settings** and saves an OpenRouter key;
3. imports or writes a book;
4. generates chapters against their own OpenRouter balance.

The same transactional mailer handles verification retries and enumeration-safe password recovery. Reset links expire after one hour and resetting a password revokes existing sessions. Signed-in password accounts can also change their password from **Settings**, with every other session revoked.

The key is sealed with AES-256-GCM using `STORYLOOM_ENCRYPTION_KEY`, stored only as ciphertext, and decrypted inside the requesting account's job. In `account` mode Storyloom fails closed: it never falls back to an operator key, even if one is present in the environment.

Create or revoke keys from [OpenRouter settings](https://openrouter.ai/settings/keys). OpenRouter currently supplies structured text, speech, and images; its cloud timing path is duration-derived and is correctly labeled `approximate`, not forced alignment.

## Self-host with one shared key

For a trusted home, studio, or team deployment, one operator key can fund every account:

```sh
cp .env.example .env
cp .env.storyloom-cloud.example .env.storyloom-cloud
```

In `.env`, configure:

```dotenv
OPENROUTER_KEY_MODE=shared
OPENROUTER_API_KEY=sk-or-v1-your-key
```

Then start the cloud profile:

```sh
pnpm db:migrate
pnpm dev:cloud
```

`shared` mode deliberately ignores account keys. This keeps the self-host simple and prevents ambiguous billing behavior.

For an entirely local or hybrid Apple Silicon setup, use `.env.storyloom-local.example` or `.env.storyloom-hybrid.example`. The local runtime coordinates heavy models sequentially by default; see [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the validated hardware history and remaining quality work.

An isolated self-host can leave `STORYLOOM_REQUIRE_EMAIL_VERIFICATION=false` and omit Resend. In that configuration email verification and password recovery are intentionally unavailable; use it only where the operator controls account creation.

## How it works

```text
browser ──▶ SvelteKit web app ──▶ SQLite or Turso
                    │          ├─▶ filesystem or S3/R2 artifacts
                    │          └─▶ in-process or Redis queue
                    ▼
             deterministic worker
                    ├─▶ structured chapter planner
                    ├─▶ narration provider
                    ├─▶ forced or approximate alignment
                    └─▶ reference-aware image provider
```

A deployment is one of `mock`, `local`, `cloud`, or `hybrid`. Every job on that deployment follows the same execution policy. `STORYLOOM_WORKER_MODE` controls whether the web process drains the queue itself, a separate worker does it, or execution is disabled.

| One machine | Distributed deployment |
| --- | --- |
| SQLite `file:` database | Turso/libSQL |
| Filesystem artifacts | S3-compatible storage |
| Durable in-process queue | Redis/BullMQ |
| Inline worker | Inline or detached worker |

## Configuration map

Configuration is layered so infrastructure and inference policy stay separate:

- `.env` — URLs, storage, database, queue, auth, encryption, accounts, and key ownership.
- `.env.storyloom-cloud` — OpenRouter models and cloud-only capability policies.
- `.env.storyloom-local` — local model endpoints and local-only policies.
- `.env.storyloom-hybrid` — explicit local/cloud policy per capability.

The essential variables are:

| Variable | Purpose |
| --- | --- |
| `STORYLOOM_PUBLIC_URL` | Canonical public origin used by auth and SEO |
| `STORYLOOM_MODE` | `mock`, `local`, `cloud`, or `hybrid` |
| `OPENROUTER_KEY_MODE` | `account` for SaaS BYOK, `shared` for a trusted self-host |
| `STORYLOOM_ENCRYPTION_KEY` | Seals account provider keys; changing it makes stored keys unreadable |
| `BETTER_AUTH_SECRET` | Signs sessions |
| `STORYLOOM_REQUIRE_EMAIL_VERIFICATION` | Requires verified email/password accounts before sign-in |
| `RESEND_API_KEY` | Sends verification and password-recovery mail |
| `STORYLOOM_EMAIL_FROM` | Verified Resend sender identity |
| `DATABASE_URL` | Local `file:` SQLite or remote `libsql:` database |
| `STORAGE_DRIVER` | `fs` or `s3` |
| `REDIS_URL` | Optional inline; required for a detached worker |

Every option is documented in [.env.example](.env.example) and the three inference profile examples.

## Commands

```sh
pnpm dev                 # mock/default web app
pnpm dev:local           # local inference profile
pnpm dev:hybrid          # mixed capability policy
pnpm dev:cloud           # OpenRouter profile
pnpm worker:cloud        # detached cloud worker
pnpm db:migrate          # apply Drizzle migrations
pnpm test                # deterministic unit suite
pnpm check               # Svelte and TypeScript checks
pnpm build               # production build
```

## Current limits

- Real local providers were validated before artifacts moved behind object storage and the distributed queue; that vertical needs to be rerun.
- OpenRouter has no forced-alignment endpoint, so cloud word timing is approximate.
- Cache identity is still chapter-based rather than a complete provider/model/input fingerprint.
- Public registration still needs operator-level storage quotas and rate limits before an unrestricted launch.
- S3/R2 and hosted Turso request shapes compile but have not yet been exercised against production endpoints.

See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) for the product contract, architecture decisions, roadmap, and honest validation record.

## Contributing

Focused issues and pull requests are welcome. Please preserve the core invariants: source-text fidelity, owner-scoped data, explicit cloud use, stable registries, deterministic orchestration, and honest mock/approximate labels.

```sh
pnpm test
pnpm check
pnpm build
```

Do not commit books, provider keys, generated media, model weights, or the local `data/` directory.

## License

[MIT](LICENSE) © 2026 Emanuele Pavanello
