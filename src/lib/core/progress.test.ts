import { describe, expect, it } from 'vitest';
import { jobPercent, stepBarKind, stepPercent } from './progress';
import type { GenerationJob, GenerationJobStep } from './schemas';

function makeStep(overrides: Partial<GenerationJobStep> = {}): GenerationJobStep {
  return { id: 'plan', label: 'Direct the chapter', status: 'pending', completed: 0, total: 1, ...overrides };
}

function makeJob(steps: GenerationJobStep[]): GenerationJob {
  return {
    schemaVersion: 1,
    id: 'job-1',
    kind: 'chapter',
    bookId: 'book-1',
    chapterId: 'chapter-1',
    characterId: null,
    force: false,
    userId: 'user-1',
    mode: 'mock',
    status: 'active',
    queuePosition: null,
    attempts: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    error: null,
    steps,
    audioPreview: [],
    alignedPreview: [],
    visualPreview: []
  };
}

describe('generation progress', () => {
  it('moves a step with nothing countable in it while its call is in flight', () => {
    expect(stepPercent(makeStep({ status: 'running', progress: 0.4 }))).toBe(40);
    expect(stepBarKind(makeStep({ status: 'running', progress: 0.4 }))).toBe('waiting');
  });

  it('never lets elapsed time claim a step is finished', () => {
    expect(stepPercent(makeStep({ status: 'running', progress: 1 }))).toBe(95);
    expect(stepPercent(makeStep({ status: 'completed', progress: 0.2 }))).toBe(100);
  });

  it('creeps inside the item currently being worked on', () => {
    const step = makeStep({ status: 'running', completed: 2, total: 4, progress: 0.5 });
    expect(stepPercent(step)).toBe(63);
    expect(stepBarKind(step)).toBe('items');
  });

  it('draws no bar for a step that has not started', () => {
    expect(stepBarKind(makeStep())).toBeNull();
    expect(stepBarKind(makeStep({ status: 'pending', progress: 0.5 }))).toBeNull();
  });

  it('rolls the steps up into one job figure', () => {
    const job = makeJob([
      makeStep({ id: 'registry', status: 'completed', completed: 1 }),
      makeStep({ id: 'plan', status: 'running', progress: 0.5 }),
      makeStep({ id: 'speech', total: 10 })
    ]);
    expect(jobPercent(job)).toBe(50);
  });
});
