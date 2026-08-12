# Storyloom Studio

Local-first proof of concept for turning EPUB, PDF and plain-text books into synchronized audiovisual performances. Storyloom analyzes a book once, locks characters into a central registry, and renders chapters on demand with expressive voices and reference-conditioned scene images.

For the complete product vision, boundaries, quality goals, current limitations and recommended roadmap, read [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md). Future implementation sessions should treat that document as product intent and verify every claimed capability against the current code.

## Verified locally

- EPUB, PDF and TXT ingestion with deterministic chapter splitting
- schema-validated Character and Voice registries
- deterministic demo character extraction without external models
- Reference-sheet generation before scene generation
- Full-chapter creative planning into typed utterances, performance directions, visual beats and sound cues
- deterministic validation that the performance plan preserves the original chapter text and uses valid references
- Narrator and per-character voice seeds
- Sequential multi-voice playback with synchronized scene changes and highlighted script
- Artifact persistence and resumable chapter cache
- deterministic local demo providers that require no credentials or model downloads
- responsive chapter player for desktop, medium and mobile viewports
- Shared Zod schemas for persisted data, model output and TypeScript types

The default demo uses procedural SVGs, silent timed audio and approximate proportional word timing. It validates the application flow, not the creative quality of real inference.

## Real local vertical validated

The local stack has been exercised end to end on an Apple M4 Max with 36 GB unified memory:

- Qwen3.6 35B A3B 4-bit in LM Studio for structured character extraction and chapter planning
- Qwen3-TTS 1.7B CustomVoice 8-bit through a local MLX OpenAI-compatible endpoint
- Qwen3 ForcedAligner 0.6B for exact word timestamps
- FLUX.2 Klein 4B MLX 4-bit for 1024 px character sheets and scenes
- FLUX.2 multi-reference editing for scenes that contain locked characters

The built-in `The Observatory` validation render contains 14 real WAV passages, exact alignment, five generated scenes and a 61-second synchronized timeline. No cloud provider or mock artifact participates in that render.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Set `STORYLOOM_MODE=mock` when model-free development is desired. On the configured target Mac, `.env` is currently set to `local`; open `http://localhost:4173` and select `The Observatory` to inspect the verified render.

## Local mode

Set `STORYLOOM_MODE=local` and leave the LM Studio API server running on port `1234`. Storyloom owns the heavy-model lifecycle during a pipeline; do not start the media servers separately.

The deterministic coordinator executes one heavy phase at a time:

```text
LM Studio text → unload
Qwen3-TTS → stop
Qwen3 ForcedAligner → stop
FLUX text-to-image → stop
FLUX reference edit → stop
```

Text work is batched before LM Studio is unloaded. Audio for all utterances is generated before TTS is released, alignment is then performed in its own phase, and plain/reference-conditioned visuals are grouped separately. Concurrent generation requests are serialized through the same coordinator, so adapters cannot independently saturate unified memory.

The media runtime installations live outside the repository under `STORYLOOM_RUNTIME_HOME` (default `~/.local/share/storyloom-studio`). The configured target Mac already contains:

- `qwen3-tts-api/.venv-mlx`
- `qwen3-aligner/.venv`
- `mlx-openai-server/.venv`

Model weights remain in the local Hugging Face and LM Studio caches and are never committed to the project.

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
      -> forced-alignment adapter
    -> shared local runtime coordinator (load, batch, release)
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
