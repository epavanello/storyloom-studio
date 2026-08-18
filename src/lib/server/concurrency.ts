/**
 * Runs `task` over every item with at most `lanes` in flight.
 *
 * Generation steps are long lists of independent provider calls — a hundred passages, a
 * dozen scenes — where the wall-clock cost is almost entirely waiting. Lanes exist to stop
 * that waiting from being serial, and the cap exists because the alternative, firing a
 * hundred requests at once, buys a rate limit instead of speed.
 *
 * The first failure stops new work from being handed out and is rethrown, so a caller that
 * checkpoints keeps everything already finished and fails fast on the rest. Items are
 * started in order; they finish in whatever order the provider answers.
 */
export async function runInLanes<T>(items: readonly T[], lanes: number, task: (item: T, index: number) => Promise<void>) {
  const width = Math.max(1, Math.min(Math.trunc(lanes), items.length));
  if (!items.length) return;
  let next = 0;
  let stopped = false;
  const lane = async () => {
    while (!stopped) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        await task(items[index], index);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: width }, () => lane()));
}
