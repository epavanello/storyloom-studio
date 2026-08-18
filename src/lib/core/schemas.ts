import { z } from 'zod';

export const ArtifactRefSchema = z.object({
  /**
   * Object-storage key, stable across storage drivers and deployments. It is the only
   * durable handle to the bytes: server code reads artifacts through the storage layer
   * with this key and never by parsing `path`.
   */
  key: z.string(),
  /** Access-controlled application URL used by the browser. Derived from `key`. */
  path: z.string(),
  mimeType: z.string(),
  provider: z.string(),
  model: z.string(),
  createdAt: z.string(),
  generationId: z.string().optional(),
  voiceId: z.string().optional(),
  language: z.string().optional(),
  instructions: z.string().optional(),
  styleId: z.string().optional()
});

export const DEFAULT_VISUAL_STYLE = {
  id: 'arctic-illustrated-v1',
  prompt: 'Hand-drawn animated storybook illustration with clean inked contours, textured digital gouache, expressive but grounded anatomy, cinematic lighting, and a restrained Arctic palette. Clearly illustrated, never photorealistic and never a 3D render.'
} as const;

export const VisualStyleSchema = z.object({
  id: z.string(),
  prompt: z.string()
});

export const ChapterSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  text: z.string(),
  characterCount: z.number().int().nonnegative()
});

export const StoryCreationRequestSchema = z.object({
  prompt: z.string().trim().min(20, 'Describe the story in at least 20 characters.').max(4_000, 'Keep the story request under 4,000 characters.'),
  chapterCount: z.coerce.number().int().min(1).max(12)
});

export const StoryOutlineChapterSchema = z.object({
  order: z.number().int().nonnegative(),
  title: z.string().trim().min(1),
  synopsis: z.string().trim().min(1),
  continuityNotes: z.string().trim().min(1)
});

export const StoryOutlineSchema = z.object({
  title: z.string().trim().min(1),
  premise: z.string().trim().min(1),
  language: z.string().trim().min(1),
  styleGuide: z.string().trim().min(1),
  chapters: z.array(StoryOutlineChapterSchema).min(1).max(12)
});

export const GeneratedStoryChapterSchema = z.object({
  title: z.string().trim().min(1),
  /** A complete source chapter, not an outline or performance annotation. */
  text: z.string().trim().min(1_200)
});

export const BookOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('imported') }),
  z.object({
    kind: z.literal('generated'),
    prompt: z.string(),
    requestedChapterCount: z.number().int().min(1).max(12),
    status: z.enum(['pending', 'generating', 'ready', 'failed']),
    outline: StoryOutlineSchema.optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    generatedAt: z.string().optional()
  })
]);

export const CharacterSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  aliases: z.array(z.string()).default([]),
  physicalDescription: z.string(),
  personality: z.string(),
  narrativeRole: z.string(),
  voiceGender: z.enum(['female', 'male', 'neutral', 'unknown']).default('unknown'),
  voiceDescription: z.string().default('Voice qualities are not established'),
  firstAppearanceChapterId: z.string(),
  referenceImages: z.array(ArtifactRefSchema).default([])
});

export const WorldElementSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  aliases: z.array(z.string()).default([]),
  kind: z.enum(['location', 'object']),
  visualDescription: z.string(),
  continuityRole: z.string(),
  textualEvidence: z.string(),
  firstAppearanceChapterId: z.string(),
  referencePriority: z.enum(['essential', 'useful', 'none']).default('none'),
  referenceImages: z.array(ArtifactRefSchema).default([])
});

export const VoiceProfileSchema = z.object({
  characterId: z.string(),
  voiceId: z.string(),
  seed: z.number().int(),
  description: z.string(),
  gender: z.enum(['female', 'male', 'neutral', 'unknown']).default('unknown'),
  language: z.string().default('it'),
  provider: z.string().default('unassigned'),
  model: z.string().default('unassigned'),
  referenceAudioPath: z.string().optional()
});

export const BookManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  sourceName: z.string(),
  origin: BookOriginSchema.default({ kind: 'imported' }),
  createdAt: z.string(),
  chapters: z.array(ChapterSchema),
  characters: z.array(CharacterSchema).default([]),
  worldElements: z.array(WorldElementSchema).default([]),
  voices: z.array(VoiceProfileSchema).default([]),
  visualStyle: VisualStyleSchema.default(DEFAULT_VISUAL_STYLE),
  /** One wordless key image for the whole book, drawn once the registry is known. */
  coverImage: ArtifactRefSchema.nullable().default(null),
  registryStatus: z.enum(['pending', 'processing', 'ready', 'failed']).default('pending')
});

/**
 * The art direction of a cover, decided from the book before anything is drawn. It carries
 * no title, byline, or lettering: the cover is meant to be recognised as an image.
 */
export const CoverConceptSchema = z.object({
  /** The single memorable subject the cover is built around. */
  concept: z.string().trim().min(1),
  composition: z.string().trim().min(1),
  palette: z.string().trim().min(1)
});

export const PerformanceDirectionSchema = z.object({
  emotion: z.string(),
  intensity: z.number().min(0).max(1),
  pace: z.enum(['slow', 'natural', 'fast']),
  pauseAfterMs: z.number().int().min(0).max(5000)
});

export const UtteranceSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  text: z.string(),
  textStart: z.number().int().nonnegative(),
  textEnd: z.number().int().nonnegative(),
  speakerCharacterId: z.string().nullable(),
  direction: PerformanceDirectionSchema
});

export const VisualCueSchema = z.object({
  id: z.string(),
  utteranceId: z.string(),
  prompt: z.string(),
  characterIds: z.array(z.string()),
  worldElementIds: z.array(z.string()).default([]),
  shot: z.string(),
  mood: z.string()
});

export const SoundCueSchema = z.object({
  id: z.string(),
  utteranceId: z.string(),
  description: z.string(),
  gain: z.number().min(0).max(1)
});

export const ChapterPlanSchema = z.object({
  schemaVersion: z.literal(1),
  chapterId: z.string(),
  synopsis: z.string(),
  cast: z.array(z.string()),
  utterances: z.array(UtteranceSchema),
  visuals: z.array(VisualCueSchema),
  sounds: z.array(SoundCueSchema).default([])
});

export const WordTimingSchema = z.object({
  text: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative()
});

export const RenderedUtteranceSchema = z.object({
  utterance: UtteranceSchema,
  audio: ArtifactRefSchema,
  voice: VoiceProfileSchema.optional(),
  startMs: z.number().nonnegative(),
  durationMs: z.number().positive(),
  words: z.array(WordTimingSchema),
  alignment: z.enum(['exact', 'approximate'])
});

/**
 * A complete audio file that can be auditioned while the rest of the chapter is still
 * being synthesized. It deliberately has no timeline or word alignment: those only
 * become authoritative when the complete RenderedChapter is published.
 */
export const GenerationAudioPreviewSchema = z.object({
  utterance: UtteranceSchema,
  audio: ArtifactRefSchema,
  voice: VoiceProfileSchema,
  durationMs: z.number().positive()
});

export const RenderedVisualSchema = z.object({
  cue: VisualCueSchema,
  image: ArtifactRefSchema,
  startMs: z.number().nonnegative()
});

export const RenderedChapterSchema = z.object({
  schemaVersion: z.literal(1),
  chapterId: z.string(),
  plan: ChapterPlanSchema,
  utterances: z.array(RenderedUtteranceSchema),
  visuals: z.array(RenderedVisualSchema),
  totalDurationMs: z.number().positive(),
  createdAt: z.string()
});

export const GenerationJobStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  detail: z.string().optional(),
  /**
   * Share of the time budget a single in-flight model call has already used. It exists so
   * a step with nothing countable in it can still show visible movement; it is never a
   * completion estimate, and it only lives as long as the call reporting it.
   */
  progress: z.number().min(0).max(1).optional()
});

export const JobKindSchema = z.enum(['story', 'registry', 'chapter', 'chapter-audio', 'character-reference', 'book-cover']);
export const JobStatusSchema = z.enum(['queued', 'active', 'completed', 'failed', 'cancelled']);

export const ChapterGenerationCheckpointSchema = z.object({
  schemaVersion: z.literal(1),
  jobId: z.string(),
  userId: z.string(),
  bookId: z.string(),
  chapterId: z.string(),
  kind: z.enum(['chapter', 'chapter-audio']),
  fingerprint: z.string(),
  plan: ChapterPlanSchema,
  audioPreview: z.array(GenerationAudioPreviewSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const PlaybackProgressSchema = z.object({
  schemaVersion: z.literal(1),
  userId: z.string(),
  bookId: z.string(),
  chapterId: z.string(),
  utteranceId: z.string(),
  positionMs: z.number().int().nonnegative(),
  updatedAt: z.string()
});

export const GenerationJobSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  kind: JobKindSchema,
  bookId: z.string(),
  chapterId: z.string().nullable().default(null),
  characterId: z.string().nullable().default(null),
  force: z.boolean().default(false),
  userId: z.string(),
  /** The runtime profile of the deployment that accepted the job. */
  mode: z.enum(['mock', 'local', 'cloud', 'hybrid']),
  status: JobStatusSchema,
  /** Position among the jobs still waiting, 1-based. */
  queuePosition: z.number().int().positive().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  steps: z.array(GenerationJobStepSchema),
  /** Redis-only progressive artifacts; the durable render is still published atomically. */
  audioPreview: z.array(GenerationAudioPreviewSchema).default([]),
  chapterPlan: ChapterPlanSchema.optional(),
  alignedPreview: z.array(RenderedUtteranceSchema).default([]),
  visualPreview: z.array(RenderedVisualSchema).default([])
});

/** Aggregate queue health, read from Redis so it costs no database compute. */
export const QueueSnapshotSchema = z.object({
  name: z.string(),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** False when no worker has been seen, i.e. work would sit forever. */
  hasWorker: z.boolean()
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type BookManifest = z.infer<typeof BookManifestSchema>;
export type BookOrigin = z.infer<typeof BookOriginSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type StoryCreationRequest = z.infer<typeof StoryCreationRequestSchema>;
export type StoryOutline = z.infer<typeof StoryOutlineSchema>;
export type GeneratedStoryChapter = z.infer<typeof GeneratedStoryChapterSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type CoverConcept = z.infer<typeof CoverConceptSchema>;
export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;
export type RenderedChapter = z.infer<typeof RenderedChapterSchema>;
export type GenerationAudioPreview = z.infer<typeof GenerationAudioPreviewSchema>;
export type ChapterGenerationCheckpoint = z.infer<typeof ChapterGenerationCheckpointSchema>;
export type PlaybackProgress = z.infer<typeof PlaybackProgressSchema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type WorldElement = z.infer<typeof WorldElementSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type GenerationJobStep = z.infer<typeof GenerationJobStepSchema>;
export type JobKind = z.infer<typeof JobKindSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;
