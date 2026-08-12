import type { z } from 'zod';
import type { ArtifactRef, Character, VoiceProfile } from '$lib/core/schemas';

export type StructuredRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  onStatus?: (detail: string) => Promise<void>;
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
  synthesize(request: SpeechRequest): Promise<ArtifactRef>;
}

export type ImageRequest = {
  bookId: string;
  artifactName: string;
  prompt: string;
  characters: Character[];
  kind: 'character-reference' | 'scene';
  seed: number;
};

export interface ImageProvider {
  id: string;
  model: string;
  supportsMultipleReferences: boolean;
  generate(request: ImageRequest): Promise<ArtifactRef>;
}

export interface AlignmentProvider {
  id: string;
  align(audioPath: string, text: string, durationMs: number): Promise<{ words: { text: string; startMs: number; endMs: number }[]; quality: 'exact' | 'approximate' }>;
}
