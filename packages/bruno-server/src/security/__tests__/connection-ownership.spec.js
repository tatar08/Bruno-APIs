const { createConnectionOwnership, wsConnectionOwnership, grpcConnectionOwnership } = require('../connection-ownership');

describe('connection-ownership', () => {
  it('records and reports the owner of a connection', () => {
    const tracker = createConnectionOwnership();
    tracker.recordOwner('session-a', 'conn-1');
    expect(tracker.getOwner('conn-1')).toBe('session-a');
  });

  it('treats an untracked connection as owned by nobody, so isOwnedBy allows it', () => {
    const tracker = createConnectionOwnership();
    expect(tracker.getOwner('conn-never-started')).toBe(null);
    expect(tracker.isOwnedBy('any-session', 'conn-never-started')).toBe(true);
  });

  it('allows the recorded owner and denies every other session', () => {
    const tracker = createConnectionOwnership();
    tracker.recordOwner('session-b', 'conn-2');
    expect(tracker.isOwnedBy('session-b', 'conn-2')).toBe(true);
    expect(tracker.isOwnedBy('session-c', 'conn-2')).toBe(false);
  });

  it('is a no-op when either id is missing (auth off / malformed args)', () => {
    const tracker = createConnectionOwnership();
    tracker.recordOwner(undefined, 'conn-3');
    tracker.recordOwner('session-d', undefined);
    expect(tracker.getOwner('conn-3')).toBe(null);
    expect(tracker.getOwner(undefined)).toBe(null);
  });

  it('forgets ownership after release, reverting to unowned/allowed', () => {
    const tracker = createConnectionOwnership();
    tracker.recordOwner('session-e', 'conn-4');
    expect(tracker.isOwnedBy('session-f', 'conn-4')).toBe(false);

    tracker.release('conn-4');

    expect(tracker.getOwner('conn-4')).toBe(null);
    expect(tracker.isOwnedBy('session-f', 'conn-4')).toBe(true);
  });

  it('re-recording a connection under a new owner overwrites the previous one', () => {
    const tracker = createConnectionOwnership();
    tracker.recordOwner('session-g', 'conn-5');
    tracker.recordOwner('session-h', 'conn-5');
    expect(tracker.getOwner('conn-5')).toBe('session-h');
    expect(tracker.isOwnedBy('session-g', 'conn-5')).toBe(false);
  });

  it('getOwnedConnections lists only the connections owned by that session', () => {
    const tracker = createConnectionOwnership();
    tracker.recordOwner('session-i', 'conn-6');
    tracker.recordOwner('session-i', 'conn-7');
    tracker.recordOwner('session-j', 'conn-8');

    expect(tracker.getOwnedConnections('session-i').sort()).toEqual(['conn-6', 'conn-7']);
    expect(tracker.getOwnedConnections('session-j')).toEqual(['conn-8']);
  });

  it('getOwnedConnections returns an empty array for a session that owns nothing', () => {
    const tracker = createConnectionOwnership();
    expect(tracker.getOwnedConnections('session-with-no-connections')).toEqual([]);
  });

  it('wsConnectionOwnership and grpcConnectionOwnership are independent trackers', () => {
    wsConnectionOwnership.recordOwner('session-k', 'shared-id');
    expect(grpcConnectionOwnership.getOwner('shared-id')).toBe(null);
    expect(grpcConnectionOwnership.isOwnedBy('session-l', 'shared-id')).toBe(true);
  });
});
