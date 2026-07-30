const { recordOwner, release, getOwnedPaths } = require('../watcher-ownership');

describe('watcher-ownership', () => {
  it('is a no-op when either id is missing (auth off / malformed args)', () => {
    recordOwner(undefined, 'session-a');
    recordOwner('/path/a', undefined);
    expect(getOwnedPaths('session-a')).toEqual([]);
  });

  it('release on an untracked path is a no-op and reports "safe to tear down"', () => {
    expect(release('/path/never-opened', 'session-a')).toBe(true);
  });

  it('releasing the only owner reports "safe to tear down"', () => {
    recordOwner('/path/b', 'session-b');
    expect(release('/path/b', 'session-b')).toBe(true);
    expect(getOwnedPaths('session-b')).toEqual([]);
  });

  it('two sessions sharing a path: releasing one leaves the other as sole owner', () => {
    recordOwner('/path/c', 'session-c1');
    recordOwner('/path/c', 'session-c2');

    expect(release('/path/c', 'session-c1')).toBe(false);
    expect(getOwnedPaths('session-c1')).toEqual([]);
    expect(getOwnedPaths('session-c2')).toEqual(['/path/c']);

    expect(release('/path/c', 'session-c2')).toBe(true);
    expect(getOwnedPaths('session-c2')).toEqual([]);
  });

  it('recording the same session for the same path twice does not duplicate ownership', () => {
    recordOwner('/path/d', 'session-d');
    recordOwner('/path/d', 'session-d');

    expect(getOwnedPaths('session-d')).toEqual(['/path/d']);
    expect(release('/path/d', 'session-d')).toBe(true);
  });

  it('getOwnedPaths lists every path a session has open, across multiple sessions', () => {
    recordOwner('/path/e1', 'session-e');
    recordOwner('/path/e2', 'session-e');
    recordOwner('/path/e1', 'session-f');

    expect(getOwnedPaths('session-e').sort()).toEqual(['/path/e1', '/path/e2']);
    expect(getOwnedPaths('session-f')).toEqual(['/path/e1']);
  });

  it('getOwnedPaths returns an empty array for a session that owns nothing', () => {
    expect(getOwnedPaths('session-with-no-watchers')).toEqual([]);
  });
});
