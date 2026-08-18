<div align="center">

<img src="public/favicon.svg" width="112" alt="Storyloom Studio logo">

# Storyloom Studio

### Don’t just read the story. Enter it.

Turn any EPUB, PDF, or manuscript into a living chapter—with narration, a persistent cast, cinematic scenes, and the original words left untouched.

[![Open source](https://img.shields.io/badge/open_source-MIT-bd5d36?style=for-the-badge)](LICENSE)
[![Bring your own AI](https://img.shields.io/badge/AI-bring_your_own_key-7c5cff?style=for-the-badge)](https://openrouter.ai/keys)
[![SvelteKit](https://img.shields.io/badge/built_with-SvelteKit-ff3e00?style=for-the-badge&logo=svelte&logoColor=white)](https://svelte.dev/)

**[Try Storyloom →](https://storyloom.emadev.co/)**

[Bring your OpenRouter key](#your-key-your-stories) · [Run it yourself](#run-it-in-5-minutes) · [Self-hosting guide](docs/SELF_HOSTING.md)

<a href="https://storyloom.emadev.co/"><img src="public/og.png" alt="Storyloom Studio — your books, staged in time"></a>

</div>

## Your book, with a pulse

Storyloom turns chapters into navigable audiovisual performances. Read the untouched text while voices, characters, and scenes move with the story.

- **Faithful by design.** The performance lives beside your text. It never rewrites it.
- **Characters that stay themselves.** Identity, appearance, aliases, and voices carry across chapters.
- **Generate what you want.** Build one scene or one chapter at a time—not an expensive whole-book render.
- **Made to be yours.** Use your own OpenRouter balance, share one key on a private install, or run local models.

> Import a chapter. Meet its cast. Press play. Regenerate a single scene without starting over.

## Your key. Your stories.

[Create your studio](https://storyloom.emadev.co/) and add an [OpenRouter key](https://openrouter.ai/keys) in **Settings**. Every generation runs on your balance.

Your key is encrypted at rest, never returned to the browser, and never replaced by a hidden platform key. Your books, jobs, and generated media are private to your account.

**No subscription lock-in. No mystery AI bill. Revoke the key whenever you like.**

## Run it in 5 minutes

The built-in demo needs no AI account, model download, Redis, or external database.

```sh
git clone https://github.com/epavanello/storyloom-studio.git
cd storyloom-studio
pnpm install
cp .env.example .env

# Add two values generated with: openssl rand -base64 32
# STORYLOOM_ENCRYPTION_KEY=...
# BETTER_AUTH_SECRET=...

pnpm db:migrate
pnpm dev
```

Open [localhost:4173](http://localhost:4173), temporarily set `STORYLOOM_ALLOW_SIGNUP=true`, and create your studio.

Want real generation? Copy `.env.storyloom-cloud.example` to `.env.storyloom-cloud`, choose `account` or `shared` key mode, then run `pnpm dev:cloud`. The [self-hosting guide](docs/SELF_HOSTING.md) has the exact setup.

## Open, inspectable, yours

Storyloom is an early open-source proof of concept, built for one convincing chapter before a thousand mediocre ones. The mock path demonstrates the full workflow; real-provider quality and production-scale limits are documented honestly.

Ideas, issues, and focused pull requests are welcome. Before sending one:

```sh
pnpm test && pnpm check && pnpm build
```

[Self-hosting & configuration](docs/SELF_HOSTING.md) · [Product vision & technical context](PROJECT_CONTEXT.md) · [MIT license](LICENSE)

<div align="center">

### Your next chapter is waiting.

**[Open Storyloom →](https://storyloom.emadev.co/)**

</div>
