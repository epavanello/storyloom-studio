import { describe, expect, it } from 'vitest';
import { runInLanes } from './concurrency';

describe('bounded lanes', () => {
  it('covers every item and never exceeds the lane cap', async () => {
    const items = Array.from({ length: 25 }, (_, index) => index);
    const done: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await runInLanes(items, 6, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, item % 4));
      done.push(item);
      inFlight -= 1;
    });
    expect(done.sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it('stops handing out work after a failure and reports it', async () => {
    const started: number[] = [];
    await expect(runInLanes(Array.from({ length: 30 }, (_, index) => index), 2, async (item) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (item === 3) throw new Error('provider refused');
    })).rejects.toThrow('provider refused');
    // The lanes in flight finish, but nothing near the end of the list is ever started.
    expect(started.length).toBeLessThan(10);
  });

  it('stays serial when only one lane is allowed, and does nothing for an empty list', async () => {
    const order: number[] = [];
    await runInLanes([0, 1, 2], 1, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 2 - item));
      order.push(item);
    });
    expect(order).toEqual([0, 1, 2]);
    await expect(runInLanes([], 4, async () => { throw new Error('never runs'); })).resolves.toBeUndefined();
  });
});
