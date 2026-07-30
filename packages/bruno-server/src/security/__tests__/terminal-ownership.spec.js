const { recordOwner, getOwner, isOwnedBy, release } = require('../terminal-ownership');

describe('terminal-ownership', () => {
  it('records and reports the owner of a terminal session', () => {
    recordOwner('session-a', 'terminal-1');
    expect(getOwner('terminal-1')).toBe('session-a');
  });

  it('treats an untracked terminal as owned by nobody, so isOwnedBy allows it', () => {
    expect(getOwner('terminal-never-created')).toBe(null);
    expect(isOwnedBy('any-session', 'terminal-never-created')).toBe(true);
  });

  it('allows the recorded owner and denies every other session', () => {
    recordOwner('session-b', 'terminal-2');
    expect(isOwnedBy('session-b', 'terminal-2')).toBe(true);
    expect(isOwnedBy('session-c', 'terminal-2')).toBe(false);
  });

  it('is a no-op when either id is missing (auth off / malformed args)', () => {
    recordOwner(undefined, 'terminal-3');
    recordOwner('session-d', undefined);
    expect(getOwner('terminal-3')).toBe(null);
    expect(getOwner(undefined)).toBe(null);
  });

  it('forgets ownership after release, reverting to unowned/allowed', () => {
    recordOwner('session-e', 'terminal-4');
    expect(isOwnedBy('session-f', 'terminal-4')).toBe(false);

    release('terminal-4');

    expect(getOwner('terminal-4')).toBe(null);
    expect(isOwnedBy('session-f', 'terminal-4')).toBe(true);
  });

  it('re-recording a terminal under a new owner overwrites the previous one', () => {
    recordOwner('session-g', 'terminal-5');
    recordOwner('session-h', 'terminal-5');
    expect(getOwner('terminal-5')).toBe('session-h');
    expect(isOwnedBy('session-g', 'terminal-5')).toBe(false);
  });
});
