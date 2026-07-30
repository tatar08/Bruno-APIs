import { runWithSessionKey, getCurrentSessionKey } from './session-context';

describe('session-context', () => {
  it('returns undefined outside of runWithSessionKey', () => {
    expect(getCurrentSessionKey()).toBeUndefined();
  });

  it('exposes the session key for the duration of the callback', () => {
    runWithSessionKey('key-a', () => {
      expect(getCurrentSessionKey()).toBe('key-a');
    });
    expect(getCurrentSessionKey()).toBeUndefined();
  });

  it('keeps the session key attached across an awaited async gap', async () => {
    await runWithSessionKey('key-b', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getCurrentSessionKey()).toBe('key-b');
    });
  });

  it('nested calls see the innermost key, then restore the outer one on return', () => {
    runWithSessionKey('outer', () => {
      expect(getCurrentSessionKey()).toBe('outer');
      runWithSessionKey('inner', () => {
        expect(getCurrentSessionKey()).toBe('inner');
      });
      expect(getCurrentSessionKey()).toBe('outer');
    });
  });

  it('returns whatever the wrapped function returns', () => {
    const result = runWithSessionKey('key-c', () => 42);
    expect(result).toBe(42);
  });
});
