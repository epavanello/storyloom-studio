import { describe, expect, it } from 'vitest';
import { ChapterGenerationCheckpointSchema, ChapterPlanSchema, GenerationJobSchema } from './schemas';

describe('chapter performance plan', () => {
  it('rejects invalid performance intensity', () => {
    const result = ChapterPlanSchema.safeParse({
      schemaVersion: 1, chapterId: 'one', synopsis: '', cast: [], visuals: [], sounds: [],
      utterances: [{ id: 'u1', order: 0, text: 'Hello', textStart: 0, textEnd: 5, speakerCharacterId: null, direction: { emotion: 'calm', intensity: 2, pace: 'natural', pauseAfterMs: 0 } }]
    });
    expect(result.success).toBe(false);
  });
});

describe('generation job', () => {
  const base = {
    schemaVersion: 1,
    id: 'job-1',
    kind: 'chapter',
    bookId: 'book-1',
    chapterId: 'chapter-1',
    userId: 'user-1',
    mode: 'local',
    status: 'queued',
    queuePosition: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    steps: [{ id: 'speech', label: 'Generate speech', status: 'running', completed: 3, total: 7, detail: 'Generated 3 of 7 passages' }]
  };

  it('persists queue position, ownership and granular progress', () => {
    const job = GenerationJobSchema.parse(base);
    expect(job.queuePosition).toBe(2);
    expect(job.userId).toBe('user-1');
    expect(job.mode).toBe('local');
    expect(job.steps[0]).toMatchObject({ completed: 3, total: 7 });
    expect(job.startedAt).toBeNull();
    expect(job.error).toBeNull();
    expect(job.audioPreview).toEqual([]);
  });

  it('accepts only complete, playable passage previews', () => {
    const preview = {
      utterance: { id: 'u1', order: 0, text: 'Hello', textStart: 0, textEnd: 5, speakerCharacterId: null, direction: { emotion: 'calm', intensity: 0.2, pace: 'natural', pauseAfterMs: 100 } },
      audio: { key: 'books/book-1/audio/u1.wav', path: '/api/artifacts/books/book-1/audio/u1.wav', mimeType: 'audio/wav', provider: 'mock', model: 'mock-tts', createdAt: '2026-01-01T00:00:00.000Z' },
      voice: { characterId: 'narrator', voiceId: 'narrator', seed: 1, description: 'Narrator', gender: 'neutral', language: 'it', provider: 'mock', model: 'mock-tts' },
      durationMs: 1200
    };
    expect(GenerationJobSchema.parse({ ...base, audioPreview: [preview] }).audioPreview[0].utterance.id).toBe('u1');
    expect(GenerationJobSchema.safeParse({ ...base, audioPreview: [{ ...preview, durationMs: 0 }] }).success).toBe(false);
  });

  it('validates durable chapter checkpoints with their owning job and fingerprint', () => {
    const plan = ChapterPlanSchema.parse({
      schemaVersion: 1, chapterId: 'chapter-1', synopsis: '', cast: [], visuals: [], sounds: [],
      utterances: [{ id: 'u1', order: 0, text: 'Hello', textStart: 0, textEnd: 5, speakerCharacterId: null, direction: { emotion: 'calm', intensity: 0.2, pace: 'natural', pauseAfterMs: 0 } }]
    });
    const checkpoint = ChapterGenerationCheckpointSchema.parse({
      schemaVersion: 1, jobId: 'job-1', userId: 'user-1', bookId: 'book-1', chapterId: 'chapter-1', kind: 'chapter',
      fingerprint: 'sha256', plan, audioPreview: [], createdAt: base.createdAt, updatedAt: base.updatedAt
    });
    expect(checkpoint.jobId).toBe('job-1');
  });

  it('rejects a job without an owner, so an unattributed job can never be persisted', () => {
    const { userId, ...orphan } = base;
    expect(GenerationJobSchema.safeParse(orphan).success).toBe(false);
  });

  it('rejects a status the queue does not model', () => {
    expect(GenerationJobSchema.safeParse({ ...base, status: 'running' }).success).toBe(false);
  });
});
