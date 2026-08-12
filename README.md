# Storyloom Studio

Local-first proof of concept for turning EPUB, PDF and plain-text books into synchronized audiovisual performances. Storyloom analyzes a book once, locks characters into a central registry, and renders chapters on demand with expressive voices and reference-conditioned scene images.

For the complete product vision, boundaries, quality goals, current limitations and recommended roadmap, read [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md). Future implementation sessions should treat that document as product intent and verify every claimed capability against the current code.

## Verified locally

- EPUB, PDF and TXT ingestion with deterministic chapter splitting
- schema-validated Character, Voice and selective World registries
- deterministic demo character extraction without external models
- Reference-sheet generation before scene generation
- Full-chapter creative planning into typed utterances, performance directions, visual beats and sound cues
- deterministic validation that the performance plan preserves the original chapter text and uses valid references
- explicit narrator and per-character voice profiles with gender, provider, model, stable voice ID and seed
- Sequential multi-voice playback with synchronized scene changes and highlighted script
- Artifact persistence and resumable chapter cache
- persisted background jobs with per-step progress that survives browser reloads
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

Character and world references remain square in both profiles. Narrative scenes are generated natively at 16:9: the local MLX runtime uses 1024×576 and OpenRouter requests the same aspect ratio, so local and cloud players receive the same scene shape without cropping.

The built-in `The Observatory` validation render contains 14 real WAV passages, exact alignment, five generated scenes and a 61-second synchronized timeline. No cloud provider or mock artifact participates in that render.

## Quick start

```bash
cp .env.storyloom-local.example .env.storyloom-local
pnpm install
pnpm dev:local
```

Set `STORYLOOM_MODE=mock` when model-free development is desired. On the configured target Mac, `.env` is currently set to `local`; open `http://localhost:4173` and select `The Observatory` to inspect the verified render.

## Local mode

Use `pnpm dev:local` and leave the LM Studio API server running on port `1234`. Storyloom owns the heavy-model lifecycle during a pipeline; do not start the media servers separately.

The deterministic coordinator executes one heavy phase at a time:

```text
LM Studio text → unload
Qwen3-TTS → stop
Qwen3 ForcedAligner → stop
FLUX text-to-image → stop
FLUX reference edit → stop
```

Text work is batched before LM Studio is unloaded. Audio for all utterances is generated before TTS is released, alignment is then performed in its own phase, and plain/reference-conditioned visuals are grouped separately. Generation requests from every browser tab become persisted jobs. Local jobs share a global FIFO queue, and the runtime coordinator remains a second safety boundary around individual heavy phases. The UI reconnects automatically after a browser reload and shows the current step plus completed and remaining work.

The media runtime installations live outside the repository under `STORYLOOM_RUNTIME_HOME` (default `~/.local/share/storyloom-studio`). The configured target Mac already contains:

- `qwen3-tts-api/.venv-mlx`
- `qwen3-aligner/.venv`
- `mlx-openai-server/.venv`

Storyloom adds `runtime/mlx-openai-server` to that process's `PYTHONPATH`. The contained compatibility overlay extends mlx-openai-server 1.8.1's square-only request enum with `1024x576` and forwards that size through its image-edit path. The underlying MFLUX model accepts independent width and height values; the installed virtual environment is not modified.

Model weights remain in the local Hugging Face and LM Studio caches and are never committed to the project.

## Cloud mode (one OpenRouter key)

```bash
cp .env.storyloom-cloud.example .env.storyloom-cloud
# set OPENROUTER_API_KEY in .env.storyloom-cloud
pnpm dev:cloud
```

The cloud profile routes structured text, TTS and reference-capable image generation through OpenRouter. Structured planning uses DeepSeek V4 Flash 0731; speech defaults to Gemini 3.1 Flash TTS Preview because OpenRouter exposes 30 stable voices for it, allowing deterministic gender-compatible casting and a distinct narrator; images use Gemini 3.1 Flash Image. It uses `data/cloud` by default, keeping cloud artifacts and job state separate from the local profile. Cloud jobs are not serialized by Storyloom, so independent tabs may run concurrently. OpenRouter does not currently expose a dedicated forced-alignment endpoint: cloud renders therefore use duration-derived proportional word timing and record it as `approximate`, never as exact. No local inference endpoint is called in cloud mode.

Registry analysis may also retain at most eight central recurring locations or objects. Every selectively retained continuity anchor receives a reusable illustrated reference; incidental props and generic scenery are excluded before that stage. Character references are generated as one subject on a neutral background with no labels, collage panels or duplicate poses. Character, world and scene images share one versioned storybook-illustration style in both local and cloud modes. For a normal chapter the planner selects a bounded set of visual beats distributed from the opening to the ending, rather than collapsing the whole chapter into one scene.

The book screen exposes explicit maintenance actions for qualitative iteration: regenerate one character reference, force a complete chapter regeneration, refresh outdated illustrated registry references, or remove a whole book. Forced chapter runs create new media files instead of overwriting the previous audio and images. Removing a book is refused while generation is active and moves its complete directory under the profile data root's `.trash` folder, so the operation is recoverable from disk.

`Regenerate all audio` reuses the validated chapter plan and existing scene images, creates a new immutable WAV for every passage, runs alignment again, and reanchors the existing scenes to the new audio timeline. Local Qwen requests explicitly send `language: Italian` and use the server's `instruct` field for character identity, emotion, intensity and pace; `instructions` is not part of that local API and must not be used. The generated artifact records the effective language and instruction for diagnosis and cache provenance.

The SvelteKit API routes are intentional. Experimental `.remote.ts` functions would provide typed client/server calls, but not durable background execution, cross-tab queueing, or process-independent progress. Keeping jobs as explicit HTTP resources also makes polling and future external clients straightforward while remote functions remain experimental.

## Hybrid mode

The ready-made hybrid profile sends only structured registry/planning work to DeepSeek V4 Flash 0731 through OpenRouter. Speech, forced alignment, character/world references and scene images remain local and are loaded and released sequentially by the same memory coordinator used in local mode:

```bash
cp .env.storyloom-hybrid.example .env.storyloom-hybrid # already configured in this workspace
pnpm dev:hybrid
```

`dev:hybrid` reads only `OPENROUTER_API_KEY` from the existing ignored `.env.storyloom-cloud`; it does not duplicate or print the secret. Hybrid books and artifacts live under `data/hybrid`, separately from both local and cloud data. Jobs share the persisted local FIFO queue, the remote LLM never causes LM Studio to load, and the three media policies are `local-required`, so a local media failure is surfaced rather than silently sent to a cloud model. `pnpm build:hybrid` builds the same profile.

Complete chapter plans use a five-minute OpenRouter request timeout and at most two transport retries. Short registry requests retain the 90-second default. Provider retries and Storyloom's separate source-coverage correction attempts are shown as distinct counters in job progress.

The underlying hybrid router also supports explicit per-capability policies:

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
pnpm check
pnpm test
pnpm build:local
pnpm build:cloud
pnpm start
```

Generated books and media are written below `data/` and are ignored by Git.
