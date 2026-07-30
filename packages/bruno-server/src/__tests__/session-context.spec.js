const { runWithSession, getCurrentSessionId } = require('../session-context');

describe('session-context', () => {
  it('returns undefined outside of any runWithSession call', () => {
    expect(getCurrentSessionId()).toBeUndefined();
  });

  it('exposes the session id for synchronous work inside runWithSession', () => {
    const result = runWithSession('session-a', () => getCurrentSessionId());
    expect(result).toBe('session-a');
  });

  it('preserves the session id across awaited async work', async () => {
    const result = await runWithSession('session-a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getCurrentSessionId();
    });
    expect(result).toBe('session-a');
  });

  it('clears the session id once runWithSession returns', async () => {
    await runWithSession('session-a', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
    expect(getCurrentSessionId()).toBeUndefined();
  });

  it('keeps concurrent sessions isolated from each other (the core P0.4 guarantee)', async () => {
    const observedForA = [];
    const observedForB = [];

    const runA = runWithSession('session-a', async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        observedForA.push(getCurrentSessionId());
      }
    });

    const runB = runWithSession('session-b', async () => {
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        observedForB.push(getCurrentSessionId());
      }
    });

    await Promise.all([runA, runB]);

    expect(observedForA).toEqual(['session-a', 'session-a', 'session-a', 'session-a', 'session-a']);
    expect(observedForB).toEqual(['session-b', 'session-b', 'session-b', 'session-b', 'session-b']);
  });

  it('propagates into nested promise chains without an explicit await at every level', async () => {
    const inner = () => Promise.resolve().then(() => getCurrentSessionId());
    const result = await runWithSession('session-a', () => inner());
    expect(result).toBe('session-a');
  });
});
