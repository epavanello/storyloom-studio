# Storyloom Studio

Local-first proof of concept for turning EPUB, PDF and plain-text books into synchronized audiovisual performances. Storyloom analyzes a book once, locks characters into a central registry, and renders chapters on demand with expressive voices and reference-conditioned scene images.

For the complete product vision, boundaries, quality goals, current limitations and recommended roadmap, read [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md). Future implementation sessions should treat that document as product intent and verify every claimed capability against the current code.

## What works

- EPUB, PDF and TXT ingestion with deterministic chapter splitting
- Incremental, schema-validated character extraction and deduplication
- Stable character and voice registries
- Reference-sheet generation before scene generation
- Full-chapter creative planning into typed utterances, performance directions, visual beats and sound cues
- Narrator and per-character voice seeds
- Sequential multi-voice playback with synchronized scene changes and highlighted script
- Artifact persistence and resumable chapter cache
- Local, cloud, hybrid and deterministic demo providers
- Strict execution policies per capability
- Shared Zod schemas for persisted data, model output and TypeScript types

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

The default `STORYLOOM_MODE=mock` requires no model or API key. Open the built-in demo, prepare its registry and render a chapter to exercise the complete pipeline.

## Local mode

Set `STORYLOOM_MODE=local`. The text adapter targets LM Studio's OpenAI-compatible endpoint. Enable these LM Studio server settings:

- Just-In-Time model loading
- Auto-unload unused JIT models
- Only keep the last JIT-loaded model
- A short idle TTL, such as five minutes

TTS and image adapters expect OpenAI-compatible local endpoints. They intentionally live behind Storyloom's own contracts, so a model-specific runner can be integrated without changing the orchestrator.

## Hybrid mode

Set `STORYLOOM_MODE=hybrid`, add `OPENROUTER_API_KEY`, then select a policy for each capability:

- `local-required`: never sends this workload to cloud
- `local-preferred`: local first, cloud only after a local failure
- `cloud-preferred`: cloud first, local fallback
- `cloud-only`: no local attempt

Artifacts always record the provider and model that produced them.

## Architecture

```text
SvelteKit UI
  -> deterministic orchestrator
    -> capability router
      -> Vercel AI SDK text adapter (LM Studio / OpenRouter)
      -> speech adapter (local / OpenRouter)
      -> image adapter (local / OpenRouter)
      -> alignment adapter
    -> validated immutable artifacts
```

The orchestrator itself makes no creative decisions. The chapter planner reads the complete chapter and emits a typed performance plan. The orchestrator validates that plan, invokes the selected providers, aligns audio, resolves scene cues to real timeline positions, caches the result and exposes it to the player.

## Commands

```bash
npm run check
npm test
npm run build
npm start
```

Generated books and media are written below `data/` and are ignored by Git.
