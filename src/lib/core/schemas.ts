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
  createdAt: z.string()
});

export const ChapterSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  text: z.string(),
  characterCount: z.number().int().nonnegative()
});

export const CharacterSchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  aliases: z.array(z.string()).default([]),
  physicalDescription: z.string(),
  personality: z.string(),
  narrativeRole: z.string(),
  firstAppearanceChapterId: z.string(),
  referenceImages: z.array(ArtifactRefSchema).default([])
});

export const VoiceProfileSchema = z.object({
  characterId: z.string(),
  voiceId: z.string(),
  seed: z.number().int(),
  description: z.string(),
  referenceAudioPath: z.string().optional()
});

export const BookManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  sourceName: z.string(),
  createdAt: z.string(),
  chapters: z.array(ChapterSchema),
  characters: z.array(CharacterSchema).default([]),
  voices: z.array(VoiceProfileSchema).default([]),
  registryStatus: z.enum(['pending', 'processing', 'ready', 'failed']).default('pending')
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
  startMs: z.number().nonnegative(),
  durationMs: z.number().positive(),
  words: z.array(WordTimingSchema),
  alignment: z.enum(['exact', 'approximate'])
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
  detail: z.string().optional()
});

export const JobStatusSchema = z.enum(['queued', 'active', 'completed', 'failed', 'cancelled']);

export const GenerationJobSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  kind: z.enum(['registry', 'chapter']),
  bookId: z.string(),
  chapterId: z.string().nullable().default(null),
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
  steps: z.array(GenerationJobStepSchema)
});

/** Aggregate queue health, read from Redis so it costs no database compute. */
export const QueueSnapshotSchema = z.object({
  name: z.string(),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** False when no worker has been seen on this queue, i.e. work would sit forever. */
  hasWorker: z.boolean()
});

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type BookManifest = z.infer<typeof BookManifestSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;
export type RenderedChapter = z.infer<typeof RenderedChapterSchema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type GenerationJobStep = z.infer<typeof GenerationJobStepSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;
