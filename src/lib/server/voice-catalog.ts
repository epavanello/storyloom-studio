import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { runtimeHome } from './runtime';

const VoiceCandidateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  gender: z.enum(['female', 'male', 'neutral', 'unknown']),
  role: z.enum(['narrator', 'character']),
  seed: z.number().int(),
  prompt: z.string(),
  file: z.string().regex(/^[a-z0-9-]+\.wav$/),
  auditionFile: z.string().regex(/^[a-z0-9-]+\.wav$/).optional(),
  auditionText: z.string().optional(),
  auditionControls: z.object({
    exaggeration: z.number(),
    cfgWeight: z.number(),
    temperature: z.number()
  }).optional(),
  sourceModel: z.string(),
  language: z.string().optional(),
  referenceText: z.string(),
  fictionalSyntheticVoice: z.literal(true)
});

const VoiceCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  candidates: z.array(VoiceCandidateSchema)
});

export type VoiceCandidate = z.infer<typeof VoiceCandidateSchema>;

function catalogDirectory() {
  return resolve(runtimeHome(), 'chatterbox-v3', 'voices', 'synthetic');
}

export async function getVoiceCandidates(): Promise<VoiceCandidate[]> {
  try {
    const payload = JSON.parse(await readFile(join(catalogDirectory(), 'catalog.json'), 'utf8'));
    return VoiceCatalogSchema.parse(payload).candidates;
  } catch {
    return [];
  }
}

export async function getVoiceAudio(voiceId: string, kind: 'reference' | 'audition') {
  const candidate = (await getVoiceCandidates()).find((item) => item.id === voiceId);
  if (!candidate) return null;
  const file = kind === 'audition' ? candidate.auditionFile : candidate.file;
  if (!file) return null;
  const path = resolve(catalogDirectory(), file);
  if (!path.startsWith(`${catalogDirectory()}/`)) return null;
  return readFile(path);
}
