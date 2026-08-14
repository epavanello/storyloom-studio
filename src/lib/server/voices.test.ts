import { describe, expect, it } from 'vitest';
import { BookManifestSchema } from '../core/schemas';
import { assignVoiceProfiles, geminiVoiceOptions } from './voices';

describe('voice registry assignment', () => {
  it('keeps narrator and actors distinct while respecting known voice gender', () => {
    const manifest = BookManifestSchema.parse({
      schemaVersion: 1,
      id: 'book-one',
      title: 'Book one',
      sourceName: 'book.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
      chapters: [],
      characters: [
        { id: 'anna', canonicalName: 'Anna', physicalDescription: 'young woman', personality: 'calm', narrativeRole: 'lead', voiceGender: 'female', voiceDescription: 'young and composed', firstAppearanceChapterId: 'one' },
        { id: 'marco', canonicalName: 'Marco', physicalDescription: 'older man', personality: 'stern', narrativeRole: 'supporting', voiceGender: 'male', voiceDescription: 'low and restrained', firstAppearanceChapterId: 'one' }
      ]
    });
    const voices = assignVoiceProfiles(manifest, { id: 'openrouter', model: 'google/gemini-3.1-flash-tts-preview', voiceOptions: geminiVoiceOptions });
    expect(new Set(voices.map((voice) => voice.voiceId)).size).toBe(3);
    expect(voices.find((voice) => voice.characterId === 'anna')?.gender).toBe('female');
    expect(voices.find((voice) => voice.characterId === 'marco')?.gender).toBe('male');
    expect(voices.every((voice) => voice.provider === 'openrouter')).toBe(true);
  });
});
