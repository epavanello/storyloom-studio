import type { z } from 'zod';
// Relative, not `$lib`: this tree is imported directly by the standalone worker, which
// runs outside SvelteKit and cannot resolve its aliases.
import type { ArtifactRef, Character, VoiceProfile, WorldElement } from '../../core/schemas';

export type VoiceOption = {
  id: string;
  gender: 'female' | 'male' | 'neutral' | 'unknown';
  description: string;
};

/**
 * What one in-flight request reports while it runs. `detail` is a short plain sentence
 * for the reader; `progress` is the share of the time budget already spent, which the UI
 * draws as a creeping bar instead of printing a stopwatch on the page.
 */
export type ProviderStatus = { detail: string; progress?: number };

export type StructuredRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  timeoutMs?: number;
  providerAttempts?: number;
  onStatus?: (status: ProviderStatus) => Promise<void>;
};

export interface StructuredTextProvider {
  id: string;
  model: string;
  generate<T>(request: StructuredRequest<T>): Promise<T>;
}

export type SpeechRequest = {
  bookId: string;
  artifactName: string;
  text: string;
  voice: VoiceProfile;
  emotion: string;
  intensity: number;
  pace: 'slow' | 'natural' | 'fast';
};

export interface SpeechProvider {
  id: string;
  model: string;
  voiceOptions: readonly VoiceOption[];
  synthesize(request: SpeechRequest): Promise<ArtifactRef>;
}

export type ImageRequest = {
  bookId: string;
  artifactName: string;
  prompt: string;
  characters: Character[];
  worldElements: WorldElement[];
  kind: 'character-reference' | 'world-reference' | 'scene' | 'cover';
  seed: number;
  styleId: string;
};

export function imageDirectory(kind: ImageRequest['kind']) {
  if (kind === 'scene') return 'scenes';
  if (kind === 'world-reference') return 'world';
  if (kind === 'cover') return 'cover';
  return 'characters';
}

export interface ImageProvider {
  id: string;
  model: string;
  supportsMultipleReferences: boolean;
  generate(request: ImageRequest): Promise<ArtifactRef>;
}

export interface AlignmentProvider {
  id: string;
  /**
   * Takes the artifact reference rather than a URL: the bytes are fetched through the
   * storage layer by key, so alignment works the same on a local disk and on R2.
   */
  align(audio: ArtifactRef, text: string, durationMs: number): Promise<{ words: { text: string; startMs: number; endMs: number }[]; quality: 'exact' | 'approximate' }>;
}
