const { runWithConcurrencyLimit, RUNNER_PARALLEL_CONCURRENCY_LIMIT } = require('../../src/ipc/network/index');

describe('runWithConcurrencyLimit', () => {
  it('processes every item exactly once', async () => {
    const items = [1, 2, 3, 4, 5];
    const seen = [];
    await runWithConcurrencyLimit(items, 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual(items);
  });

  it('never runs more than `limit` workers concurrently', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrencyLimit(items, 4, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('runs everything at once when the item count is below the limit (small datasets unchanged)', async () => {
    const items = [1, 2, 3];
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrencyLimit(items, RUNNER_PARALLEL_CONCURRENCY_LIMIT, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });
    expect(maxInFlight).toBe(3);
  });

  it('propagates a worker rejection', async () => {
    const items = [1, 2, 3];
    await expect(
      runWithConcurrencyLimit(items, 2, async (item) => {
        if (item === 2) throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('stops starting new work once shouldStop() returns true', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const started = [];
    let stop = false;
    await runWithConcurrencyLimit(
      items,
      2,
      async (item) => {
        started.push(item);
        if (started.length === 2) stop = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      () => stop
    );
    // exactly the 2 in-flight workers get to run one more item each after the
    // stop flag flips (they already passed the check before it flipped), then
    // no further items are pulled from the queue
    expect(started.length).toBeLessThan(items.length);
  });

  it('does not start any work when items is empty', async () => {
    const worker = jest.fn();
    await runWithConcurrencyLimit([], 5, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});
