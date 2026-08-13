import { describe, expect, it } from 'vitest';
import { ChapterPlanSchema, GenerationJobSchema } from './schemas';

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
  });

  it('rejects a job without an owner, so an unattributed job can never be persisted', () => {
    const { userId, ...orphan } = base;
    expect(GenerationJobSchema.safeParse(orphan).success).toBe(false);
  });

  it('rejects a status the queue does not model', () => {
    expect(GenerationJobSchema.safeParse({ ...base, status: 'running' }).success).toBe(false);
  });
});
