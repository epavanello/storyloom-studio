import { describe, expect, it } from 'vitest';
import { CLOUD_QUEUE, localQueueFor, queueFor, resolveQueueNames, targetOfQueue } from './names';

describe('queue routing', () => {
  it('sends cloud work to the shared queue and local work to the owner\'s private queue', () => {
    expect(queueFor('cloud', 'user-a')).toBe(CLOUD_QUEUE);
    expect(queueFor('local', 'user-a')).toBe('storyloom-local-user-a');
  });

  it('never routes two accounts onto the same local queue', () => {
    expect(localQueueFor('user-a')).not.toBe(localQueueFor('user-b'));
  });

  it('reads the execution target back from a queue name', () => {
    expect(targetOfQueue(CLOUD_QUEUE)).toBe('cloud');
    expect(targetOfQueue(localQueueFor('user-a'))).toBe('local');
  });

  it('expands the operator-facing queue selectors a worker is started with', () => {
    expect(resolveQueueNames(['cloud', 'local:user-a'])).toEqual([CLOUD_QUEUE, 'storyloom-local-user-a']);
    // A fully qualified name passes through, which is what a support instruction pastes.
    expect(resolveQueueNames(['storyloom-local-user-b'])).toEqual(['storyloom-local-user-b']);
  });
});
