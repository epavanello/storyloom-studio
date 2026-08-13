# Storyloom Studio agent contract

This file defines how AI coding agents must reason about, change, validate, and hand off work in this repository. It applies to the entire repository unless a deeper `AGENTS.md` introduces more specific rules for its subtree.

## Required reading

Before planning, reviewing, or changing the project, read these files completely:

1. `AGENTS.md` — operating rules for repository work.
2. `PROJECT_CONTEXT.md` — product vision, scope, quality bar, limitations, and roadmap.
3. `README.md` — current setup, commands, modes, and advertised behavior.
4. The code and tests directly involved in the requested task.

Do not rely on a previous ChatGPT or Codex conversation being available. The repository documents are the persistent handoff.

## Source-of-truth hierarchy

When sources disagree, use this order:

1. the user's current explicit request;
2. this `AGENTS.md` and any more specific nested instructions;
3. `PROJECT_CONTEXT.md` for product intent;
4. current schemas, code, tests, and stored data for implemented behavior;
5. `README.md` for operator-facing documentation;
6. historical discussions, generated plans, and assumptions.

`PROJECT_CONTEXT.md` states what Storyloom is trying to become. It is not evidence that a capability is already implemented. The code may reveal that a README claim is aspirational or only demonstrated with mocks. Report that distinction clearly.

## Mission

Storyloom Studio is a local-first proof of concept that turns EPUB, PDF, or plain-text books into navigable audiovisual chapter performances.

The intended experience combines:

- the unmodified original text;
- expressive narration and optionally character-specific dialogue voices;
- a stable Character Registry and a separate Voice Registry;
- scene images conditioned on approved character references;
- a structured chapter-level creative plan;
- real audio-derived synchronization among text, speech, and images;
- on-demand generation rather than eager whole-book rendering;
- explicit local, cloud, or hybrid execution policies.

The immediate product goal is one convincing end-to-end vertical on a representative chapter. Breadth, generalized infrastructure, and whole-book automation are secondary until that vertical is qualitatively validated.

## Product quality priorities

When tradeoffs are necessary, preserve this order:

1. fidelity to the original book text;
2. stable and recognizable character identity;
3. conservative speaker attribution;
4. natural and stable voices;
5. accurate audio/text/image synchronization;
6. narrative and visual continuity;
7. recoverability, provenance, and user control;
8. privacy and explicit execution location;
9. maintainability and low conceptual overhead;
10. speed and monetary cost.

Do not optimize cost or throughput by silently weakening a higher-priority requirement.

## Non-negotiable product invariants

### Preserve the source text

- Store imported text separately from all generated interpretation.
- Never rewrite, summarize, normalize away, or embellish the original text as part of performance planning.
- Performance metadata must be a parallel annotation layer linked by stable IDs and source offsets.
- A chapter performance plan must preserve the original text exactly across its ordered utterances, except for explicitly represented non-spoken material.
- Add deterministic validation for text coverage before trusting model output.

### Separate creative planning from execution

- The Chapter Planner may interpret meaning and choose speaker, emotion, pause, visual beats, shot, and mood.
- Planner output must be structured, schema-validated, and inspectable.
- The orchestrator must not make hidden creative decisions. It validates, routes, executes, persists, aligns, and assembles.
- Keep orchestration explicit and deterministic. Do not introduce a generic autonomous agent or universal workflow engine for the PoC.

### Treat registries as stable sources of truth

- The Character Registry owns canonical identity, aliases, textual evidence, narrative role, appearance, and visual references.
- The Voice Registry owns voice identity and generation configuration.
- A future World/Continuity Registry should own places, objects, clothing, physical changes, relationships, time, and environmental state.
- Registry updates must be incremental, evidence-based, reviewable, and schema-versioned.
- Never invent an unsupported physical trait and persist it as canonical fact.
- Never merge characters solely because names look similar.

### Keep tenants separated

Storyloom is a multi-account service. Books, chapters, renders, artifacts, jobs and provider keys belong to exactly one account.

- Every read and write of user data must be scoped by owner. Do not add a query that takes only a book, chapter or job ID from a request and trusts it.
- Authorize artifact reads against book ownership. Generated media is user data and must never be served from a public bucket URL.
- An unauthorized request must be indistinguishable from a missing resource, so that identifiers cannot be probed.
- Provider keys are per account, sealed at rest, decrypted only while that account's job runs, and never returned to the browser, written into an artifact, or logged.
- Direct database and Redis credentials imply full access to every account. Only give them to a process whose operator is entitled to that.

### Keep the deployment shape simple

A deployment is **either cloud or local**, decided by `STORYLOOM_MODE`, and every job on it runs that way. There is one queue.

- Do not add per-account execution targets, per-user queues, or mixed cloud/local routing. Switching a deployment from local to cloud must remain a configuration change.
- What is parametric is which process drains the queue: `STORYLOOM_WORKER_MODE` is `inline`, `external` or `off`.
- Infrastructure that a deployment must be able to swap — the database and the object store — belongs behind a driver with one interface and one key space, so the same code serves a local file and a hosted service.

### Generate on demand

- Analyze enough of the book to establish chapters, identities, and continuity.
- Generate expensive audio and scene media only for requested chapters or segments.
- Make every expensive step resumable and independently regenerable.
- Do not add eager whole-book media generation unless the user explicitly expands scope.

### Make cloud use explicit

- `local-required` means no cloud request under any failure condition.
- `local-preferred` may use cloud only if the configured policy explicitly permits it and the transition is visible and recorded.
- `cloud-preferred` and `cloud-only` must remain explicit configuration choices.
- Never send book text, character data, reference media, or voice data to a cloud provider silently.
- A fallback is valid only when the fallback provider satisfies the required capability contract.

### Do not confuse deterministic identity with seeds

- A seed alone does not guarantee a stable voice or visual identity.
- Persist model identity, relevant generation settings, reference audio or embeddings when available, and visual references.
- Provider or model changes must invalidate affected caches unless compatibility is deliberately established.

## Intended end-to-end pipeline

Keep the pipeline conceptually close to this sequence:

1. `ingestBook`
   - detect source format;
   - extract and clean text without semantic rewriting;
   - identify ordered chapters or equivalent sections;
   - assign stable IDs and source metadata.
2. `extractCharacters`
   - analyze chapters incrementally with access to the current registry;
   - collect aliases, evidence, role, appearance, and first appearance;
   - reconcile without destructive guessing.
3. `generateCharacterReferences`
   - generate reusable identity sheets before scene images;
   - preserve reference versions and approval status.
4. `planChapter`
   - read the complete chapter plus relevant registries and prior continuity;
   - emit typed utterances, directions, visual cues, and optional sound cues;
   - preserve source coverage and stable character IDs.
5. `generateNarration`
   - choose narrator or character voice by registry;
   - synthesize each unit with explicit emotion, intensity, pace, and pauses;
   - retain provider and model provenance.
6. `alignNarration`
   - use exact provider timestamps when genuinely supported;
   - otherwise run forced alignment;
   - expose approximate timing only as an explicitly degraded/demo state.
7. `generateSceneImages`
   - generate sparse, meaningful visual beats;
   - pass only the references for characters present in the scene;
   - bind each reference to a named role or composition constraint;
   - keep visual style references separate from character identity references.
8. `validateArtifacts`
   - check text coverage, expected speakers, reference usage, scene cast, continuity, dimensions, duration, and required metadata;
   - support retry or human approval without regenerating unrelated artifacts.
9. `assembleChapter`
   - resolve image cues against actual audio timestamps;
   - preserve conceptually separate narration, dialogue, ambience, and SFX tracks;
   - write a validated, versioned rendered manifest.
10. `playChapter`
    - navigate, seek, highlight, display active scene and speaker, and resume cached work;
    - communicate whether timing and artifacts are exact, approximate, mock, local, or cloud-generated.

Changes may improve this sequence, but they must preserve the separation of responsibilities and remain proportional to the PoC.

## Architecture boundaries

### `src/lib/core`

- Contains framework-independent domain schemas, types, invariants, and pure logic.
- Must not depend on Svelte components, route request objects, environment variables, or a specific provider SDK.
- Zod schemas are the runtime source of truth; derive TypeScript types with `z.infer`.
- Persisted schemas must carry a version and eventually have explicit migrations.

### `src/lib/server`

- Contains ingestion, orchestration, persistence, queueing, runtime coordination, and provider implementations.
- Provider-specific payloads must remain behind Storyloom-owned contracts.
- Environment parsing belongs in validated configuration code, reading `process.env`.
- Server modules must not leak secrets into client-side data.
- **Must not import SvelteKit aliases or modules** (`$lib/*`, `$env/*`, `@sveltejs/kit`). The standalone worker imports this tree directly and runs outside SvelteKit; use relative imports. `src/lib/server/session.ts` is the deliberate exception and is only reachable from routes.
- `db/` owns the Drizzle schema, the connection and the migrations. `storage/` owns the object-storage drivers. `queue/` owns queue naming, live job state and the worker runtime.
- Nothing may poll Postgres. Frequent or periodic state belongs in Redis; the database sees durable transitions only.

### `src/lib/server/providers`

- Define capability contracts owned by Storyloom, not by OpenAI-compatible conventions.
- Keep text analysis, speech synthesis, alignment, and image generation separate.
- Describe capabilities explicitly: timestamps, multi-reference support, identity preservation, image editing, output formats, language/voice support, and relevant limits.
- Do not label an endpoint “compatible” based only on path shape. Verify the exact request fields and response behavior used.
- Keep mocks visibly distinct from real providers.

### `src/routes`

- Routes and components coordinate user interaction and call the domain/server layer.
- Do not put core planning, routing, registry reconciliation, or storage rules in Svelte components.
- API routes must validate identifiers and inputs and return actionable errors without exposing secrets or internal paths.

### Artifact storage

- Binary artifacts live in object storage behind `src/lib/server/storage`, addressed by a key of the form `books/<bookId>/<path>`. `data/` is only the local filesystem driver's root and is not source code.
- Read artifact bytes through the storage layer by key. Do not parse an application URL or build a filesystem path to reach them.
- Reject traversal, absolute and empty key segments before a key reaches a driver.
- Do not commit user books, generated voices, reference images, or rendered media by default.
- Tests should use isolated temporary directories or explicit small fixtures, not mutate the user's working data.
- Never delete material user data without explicit authorization and exact target verification.

## Schema and data rules

- Reuse Zod schemas for model outputs, API boundaries, persisted JSON, and TypeScript inference.
- Avoid parallel hand-written interfaces for the same domain entity.
- Prefer stable IDs over names or array positions for cross-artifact references.
- Validate referential integrity: referenced chapters, characters, utterances, voices, and artifacts must exist.
- Validate ordered and non-overlapping source ranges where required.
- Persist uncertainty and evidence when a model-derived fact can be ambiguous.
- Add `schemaVersion` to durable formats and plan migrations before changing an existing persisted shape.
- Do not silently accept corrupt or incompatible persisted data.
- Avoid destructive in-place migration of artifacts; preserve or back up the prior representation when material.

## Character and continuity rules

- Character extraction must use textual evidence and the current registry.
- Deduplication should consider canonical name, aliases, title, context, relationships, and incompatible attributes.
- Pronouns, ordinary capitalized words, locations, adjectives, and formatting artifacts are not characters.
- Unknown appearance details must remain unknown rather than becoming generated canon.
- Reference generation should distinguish canonical traits from optional artistic interpretation.
- Scene generation must use the current narrative state, not only the global character portrait.
- Multi-character scenes are a known high-risk case; expose validation and regeneration instead of claiming guaranteed consistency.

## Voice and audio rules

- Keep narrator and character voices explicitly addressable.
- Store more than a seed: provider, model, voice ID, reference material when permitted, generation settings, and version.
- Do not use or clone a real person's voice without clear authorization.
- Preserve the requested language and pronunciation context.
- Effects and ambience are separate conceptual tracks; do not bake them irreversibly into spoken text.
- Duration estimates are acceptable for demo placeholders only.
- Mark proportional alignment as `approximate`; never present it as exact forced alignment.

## Image-generation rules

- A provider may be selected for a scene only if it supports the required reference behavior.
- Pass only characters present in the scene, with an explicit mapping between reference and identity/composition role.
- Keep style reference, character reference, and prior-scene continuity inputs semantically distinct.
- Store the exact prompt and provider-relevant generation metadata needed for provenance and cache invalidation.
- Validate scene cast, identity, clothing/state, setting, prohibited text, and basic technical properties before marking an image final.
- Make regeneration granular. Do not rerender narration because one image failed.

## Provider routing rules

- Route by required capability, not merely by `local` versus `cloud`.
- Represent unsupported capabilities honestly; do not emulate them with ignored request fields.
- Do not assume every OpenAI-compatible endpoint supports structured output, speech, seed, instructions, reference images, or the same response formats.
- A fallback chain must preserve mandatory requirements and must record the provider that actually produced the result.
- Surface fallback use and failure causes in logs and, where relevant, in the UI.
- Add timeouts, cancellation, actionable errors, and bounded retries around remote or long-running generation.
- Retries must be safe and must not overwrite a valid artifact accidentally.

## Local runtime and memory rules

- Optimize for a single-user Apple Silicon Mac, with exact target memory still treated as a user decision.
- Start with sequential heavy-model execution unless measurements justify concurrency.
- Batch work that reuses the same model.
- Coordinate model acquisition and release across LLM, TTS, image, and alignment runtimes.
- Prefer JIT loading, TTL, and eviction where the runtime provides them.
- Do not let separate adapters independently load large models without a shared memory policy.
- Measure peak memory and wall time during real end-to-end validation rather than estimating success from model size alone.

## Artifact, cache, and provenance rules

- Treat generated artifacts as immutable versions.
- Address reusable work by a deterministic fingerprint of normalized input, schema version, provider, model, relevant settings, references, and prompt/template version.
- A chapter ID alone is not a sufficient cache key.
- Persist who/what generated each artifact and when.
- Distinguish approved, generated, failed, superseded, and mock artifacts when those states are introduced.
- Resume from the last valid step after interruption.
- A forced regeneration must create or select a new version deliberately.
- Never reuse an artifact when a relevant reference, voice, planner output, provider, or model configuration changed.

## Demo versus real behavior

- Demo mode exists to exercise UI, schemas, persistence, sequencing, and caching without models or keys.
- Mock character extraction, silent audio, procedural SVGs, proportional alignment, and scripted planning are not evidence of creative quality.
- Label mock or approximate output visibly where confusion is possible.
- Keep demo behavior deterministic enough for tests.
- Do not weaken production contracts to accommodate a simplistic mock; improve the mock or isolate demo-specific behavior.
- Never describe an adapter as validated merely because the project compiles.

## UX expectations

- The user should always know what is being prepared and whether the result is cached, mock, local, cloud, approximate, or exact.
- Long operations need progress or at least clear step-level status and recoverable errors.
- The interface should prioritize the reading/listening experience over infrastructure controls.
- Preserve navigation and player usability while adding generation controls.
- Make registry state and regeneration scope understandable without exposing provider internals unnecessarily.
- Avoid presenting inferred character details as facts without confidence/evidence cues.
- Cloud transitions and privacy-relevant actions must be visible before or when they occur.

## Implementation style

- Keep the core TypeScript small, explicit, and framework-independent.
- Prefer a few typed functions and narrow interfaces over factories, service locators, generic DAGs, or speculative abstractions.
- Reuse schemas and derived types instead of duplicating shapes.
- Keep provider SDK details at adapter boundaries.
- Prefer pure validation and transformation functions that can be tested without models.
- Use clear domain names such as `ChapterPlan`, `VoiceProfile`, `VisualCue`, and `ArtifactRef`.
- Avoid broad refactors while implementing a focused task unless the current design genuinely blocks correctness.
- Postgres, Redis, BullMQ and S3-compatible storage are the deliberate infrastructure of the deployable service. Anything beyond them — another datastore, a container platform, a distributed workflow engine — still needs a demonstrated requirement and explicit scope expansion.
- Keep the queue a queue. Job handlers map a queue entry onto the orchestrator; they do not acquire creative or routing decisions of their own.
- Preserve existing formatting and conventions unless the task includes a formatting migration.
- Add comments for non-obvious invariants and provider quirks, not for code that explains itself.
- Avoid `latest` dependency ranges for foundational build tooling. Pin compatible versions intentionally and update the lockfile consistently.
- Preserve the existing package-manager lockfile; do not introduce another lockfile without explicit agreement.

## Testing requirements

Every change should be verified in proportion to its risk.

### Baseline commands

Use the scripts defined in `package.json`:

```bash
pnpm test
pnpm check
pnpm build
```

If the repository standardizes on another invocation later, update this section and the README together. Do not report the project as healthy if one required command fails; explain whether the failure is introduced, pre-existing, or environment-specific.

### Required test coverage by area

- **Ingestion:** representative EPUB, PDF, TXT; ordering; empty input; malformed input; preserved text.
- **Schemas:** valid and invalid persisted/model payloads; schema versions; referential integrity.
- **Registry:** aliases, repeated mentions, false positives, conflicting candidates, incremental updates.
- **Planner validation:** exact text coverage, ordering, offsets, known speaker IDs, valid cue anchors.
- **Routing:** all execution policies, absent credentials, unsupported capabilities, explicit fallback behavior.
- **Storage:** path traversal, interrupted writes where relevant, cache hit/miss, version invalidation, key round-trips across drivers.
- **Tenancy:** a second account must not be able to read, queue against, cancel or delete the first account's books, artifacts and jobs.
- **Queue:** duplicate suppression, cancellation of queued and running work, and a queue with no worker being reported rather than silently stalling.
- **Audio/timeline:** duration handling, exact versus approximate alignment, seeking, utterance boundaries.
- **Images:** reference mapping, multi-character requirements, missing references, regeneration isolation.
- **UI/API:** successful state, long-running state, partial failure, retry, cached result, accessible controls.

Use deterministic mocks for unit tests. Real-provider tests must be opt-in, clearly named, protected from accidental cost, and must never require secrets for the default test suite.

Tests that need Postgres and Redis are named `*.integration.test.ts` and skip themselves unless `DATABASE_URL` and `REDIS_URL` are set, so `pnpm test` runs with no services. Start them with `docker compose -f docker-compose.dev.yml up -d`, then `pnpm db:migrate`. An integration test must clean up the rows and objects it created.

### End-to-end validation

A provider path is verified only when a representative request completes through the application and produces an artifact that is opened or inspected for expected content and metadata.

For the PoC milestone, validate at least one representative chapter on the target Mac and record:

- input and configuration;
- provider/model per capability;
- total and per-step duration;
- peak memory when practical;
- cloud cost when applicable;
- text coverage;
- alignment quality;
- voice stability;
- character consistency across multiple scenes;
- failures, retries, and manual interventions.

## Security, privacy, and rights

- Treat imported books, generated media, API keys, reference images, and voice samples as sensitive user data.
- Never commit secrets or user content.
- Keep secrets server-side and out of logs, browser payloads, fixtures, and error messages.
- Validate artifact paths and all externally supplied identifiers.
- Do not fetch arbitrary artifact URLs or write outside configured data roots without explicit safeguards.
- Record when book text or references are sent to external providers.
- Do not assume the user owns distribution, likeness, or voice-cloning rights; surface material rights questions before expanding into publishing or cloning workflows.

## Repository and change hygiene

- Inspect the working tree before editing when Git is available.
- Preserve user changes and avoid unrelated rewrites.
- Do not initialize Git, create branches, commit, push, or publish unless the user requests or clearly authorizes that action.
- Do not commit `data/`, secrets, build output, model weights, or user-uploaded books.
- Keep generated demo data out of source control unless it is a deliberately reviewed fixture.
- Update documentation when behavior, configuration, architecture boundaries, or known limitations change.
- If a README claim is disproven, correct it rather than preserving an aspirational statement as current behavior.

## Working procedure for every task

### 1. Orient

- Read the required documents.
- Inspect relevant code, schemas, tests, configuration, and current data shape.
- Check repository status when Git exists.
- Identify whether the task is product design, diagnosis, implementation, validation, or documentation.

### 2. Establish the baseline

- Reproduce the reported issue or run the smallest relevant validation.
- Distinguish current failures from failures introduced by the task.
- Do not erase local data or cached artifacts merely to obtain a clean run.

### 3. Define the smallest complete change

- State assumptions that materially affect privacy, providers, quality, data shape, or user experience.
- Prefer progress with safe reversible assumptions.
- Ask the user when a missing decision would meaningfully change the result, especially for cloud use, sample book, visual style, voice cloning, or destructive data migration.

### 4. Implement

- Preserve the product invariants and architecture boundaries above.
- Make narrow, reviewable edits.
- Add or update tests with the behavior.
- Keep persisted schemas and documentation synchronized.

### 5. Verify

- Run the relevant focused tests first.
- Run the full baseline commands for changes that affect shared types, build configuration, orchestration, routes, or UI.
- Inspect generated audiovisual artifacts when quality or layout matters; compilation alone is insufficient.
- Do not use paid or cloud providers unless the request and configured policy authorize it.

### 6. Hand off

Report concisely:

- what changed in user/product terms;
- which files or areas changed;
- validations run and their outcomes;
- what was not validated, especially real providers or Mac-specific performance;
- remaining risks or the next concrete step;
- any generated or deleted user data and whether it is recoverable.

## Definition of done

A change is complete only when all applicable items are true:

- requested behavior is implemented, not merely scaffolded;
- original-text fidelity and registry invariants remain intact;
- schemas and persisted data are valid;
- relevant tests cover the new behavior or regression;
- required checks pass, or unrelated pre-existing failures are explicitly reported with evidence;
- demo behavior remains usable when applicable;
- real-provider claims are supported by end-to-end evidence;
- cloud use is explicit and provenance is stored;
- documentation reflects the actual state;
- no secrets, books, model files, or unintended generated artifacts were added;
- the handoff states limitations honestly.

## Decisions that require user direction

Do not silently choose among materially different product outcomes. Ask for direction when the task depends on:

- the representative book/chapter or permission to use it;
- target Mac memory or runtime constraints that cannot be inspected;
- visual art direction;
- image density and acceptable manual review;
- narrator-only versus multi-voice scope;
- real-person voice cloning or likeness;
- permission to transmit book text or media to cloud services;
- acceptable cloud spend;
- destructive migration or deletion of generated/user data;
- expanding the PoC into publishing, multiuser collaboration, payments, DRM, or continuous video.

When a safe local mock or reversible implementation can proceed without resolving one of these decisions, continue within that boundary and label the limitation.

## Known traps

- Treating EPUB pages as stable narrative units.
- Extracting every capitalized token as a character.
- Letting model output paraphrase or omit source text.
- Trusting speaker attribution without evidence.
- Treating seed reuse as identity preservation.
- Passing all character references into every scene.
- Assuming `reference_images` is honored by an OpenAI-compatible image endpoint.
- Assuming a speech endpoint returns timestamps.
- Calling proportional timing “alignment.”
- Caching only by book or chapter ID.
- Hiding provider fallbacks.
- Loading LLM, TTS, and image models concurrently on unified memory without coordination.
- Considering compilation proof that local/cloud media generation works.
- Building generalized infrastructure beyond the deployment the user asked for. The database, queue and object storage exist because a multi-account service with a detached worker requires them; that is not a licence to generalize further.
- Scoping a query by an ID from the request without also scoping it by owner.
- Polling the database, or writing per-step progress to it.
- Handing database or Redis credentials to a machine whose operator may not read every account's data.
- Reintroducing per-account execution routing because a single deployment mode felt limiting.

## Current strategic next step

The service now has accounts, a shared database, a distributed job queue and object storage. Unless the user gives a different priority:

1. re-validate the real local vertical end to end through the queue, since providers now read and write artifacts through object storage rather than the filesystem;
2. add quotas or rate limits before opening registration, because nothing currently bounds queued work;
3. wire a mailer so email verification and password reset work;
4. address cached renders by a fingerprint of input, schema version, provider, model and settings, so a provider change invalidates them;
5. only then consider the token-scoped runner protocol that would let an account run inference on a machine the operator does not trust.

Always re-check `PROJECT_CONTEXT.md` for the fuller rationale and current roadmap before changing this priority.
