import type { GenerationJob, GenerationJobStep } from './schemas';

/**
 * How full one step is, as a fraction of its own work. A step that counts items reports
 * them; a step that is a single long model call has nothing to count, so it reports the
 * share of its time budget instead and the bar keeps creeping inside the item currently
 * in flight. The in-flight part is capped below a whole item on purpose: time spent is
 * not evidence that the call is about to return, and a bar that fills completely and
 * then waits reads as a hang.
 */
export function stepFraction(step: GenerationJobStep) {
  if (step.status === 'completed') return 1;
  const inFlight = step.status === 'running' ? Math.min(0.95, step.progress ?? 0) : 0;
  return Math.min(1, (step.completed + inFlight) / Math.max(1, step.total));
}

export function stepPercent(step: GenerationJobStep) {
  return Math.round(stepFraction(step) * 100);
}

/**
 * Which bar a step deserves: one that measures finished items, one that only shows a
 * call is alive, or none at all for a step that has not started.
 */
export function stepBarKind(step: GenerationJobStep): 'items' | 'waiting' | null {
  if (step.total > 1) return 'items';
  return step.status === 'running' && step.progress !== undefined ? 'waiting' : null;
}

export function jobPercent(job: GenerationJob) {
  const done = job.steps.reduce((sum, step) => sum + stepFraction(step), 0);
  return Math.round(done / Math.max(1, job.steps.length) * 100);
}
