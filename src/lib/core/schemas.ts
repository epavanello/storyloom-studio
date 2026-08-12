import { z } from 'zod';

export const ArtifactRefSchema = z.object({
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

export const GenerationJobSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  kind: z.enum(['registry', 'chapter']),
  bookId: z.string(),
  chapterId: z.string().optional(),
  mode: z.enum(['mock', 'local', 'cloud', 'hybrid']),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  queuePosition: z.number().int().positive().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  steps: z.array(GenerationJobStepSchema)
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
