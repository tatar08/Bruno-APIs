describe('download-resume.js (Improvement.md P1.1)', () => {
  // Each test gets a fresh copy of the module (and therefore a fresh, empty
  // registry Map) since the real module is a process-wide singleton — same
  // technique as idempotency.spec.js.
  let downloadResume;

  beforeEach(() => {
    jest.resetModules();
    downloadResume = require('./download-resume');
  });

  describe('createResumeToken() / getResumeEntry()', () => {
    it('returns null for a token that was never created', () => {
      expect(downloadResume.getResumeEntry('never-created', 'session-a')).toBeNull();
    });

    it('returns null for a falsy token', () => {
      expect(downloadResume.getResumeEntry(null, 'session-a')).toBeNull();
      expect(downloadResume.getResumeEntry('', 'session-a')).toBeNull();
    });

    it('returns the stored entry when looked up by the same sessionKey', () => {
      const token = downloadResume.createResumeToken({
        tempPath: '/tmp/foo.zip',
        sessionKey: 'session-a',
        sha256: 'abc123',
        downloadName: 'foo.zip'
      });

      expect(downloadResume.getResumeEntry(token, 'session-a')).toEqual({
        tempPath: '/tmp/foo.zip',
        sessionKey: 'session-a',
        sha256: 'abc123',
        downloadName: 'foo.zip',
        expiresAt: expect.any(Number)
      });
    });

    it('rejects a lookup from a different sessionKey than the one that created the token', () => {
      const token = downloadResume.createResumeToken({
        tempPath: '/tmp/foo.zip',
        sessionKey: 'session-a',
        sha256: 'abc123',
        downloadName: 'foo.zip'
      });

      expect(downloadResume.getResumeEntry(token, 'session-b')).toBeNull();
    });

    it('expires an entry once its TTL has elapsed (lazy expiry on read)', () => {
      const realNow = Date.now;
      try {
        Date.now = () => 1000;
        const token = downloadResume.createResumeToken({
          tempPath: '/tmp/foo.zip',
          sessionKey: 'session-a',
          sha256: 'abc123',
          downloadName: 'foo.zip'
        });

        Date.now = () => 1000 + downloadResume.DOWNLOAD_RESUME_TTL_MS - 1;
        expect(downloadResume.getResumeEntry(token, 'session-a')).not.toBeNull();

        Date.now = () => 1000 + downloadResume.DOWNLOAD_RESUME_TTL_MS + 1;
        expect(downloadResume.getResumeEntry(token, 'session-a')).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });

    it('evicts the oldest entry once MAX_ENTRIES is reached', () => {
      const tokens = [];
      for (let i = 0; i < downloadResume.MAX_ENTRIES; i++) {
        tokens.push(
          downloadResume.createResumeToken({
            tempPath: `/tmp/foo-${i}.zip`,
            sessionKey: 'session-a',
            sha256: `hash-${i}`,
            downloadName: `foo-${i}.zip`
          })
        );
      }
      expect(downloadResume.getResumeEntry(tokens[0], 'session-a')).not.toBeNull();

      const overflowToken = downloadResume.createResumeToken({
        tempPath: '/tmp/overflow.zip',
        sessionKey: 'session-a',
        sha256: 'hash-overflow',
        downloadName: 'overflow.zip'
      });

      expect(downloadResume.getResumeEntry(tokens[0], 'session-a')).toBeNull();
      expect(downloadResume.getResumeEntry(overflowToken, 'session-a')).not.toBeNull();
    });
  });

  describe('discardResumeToken()', () => {
    it('removes the entry so a subsequent lookup misses', () => {
      const token = downloadResume.createResumeToken({
        tempPath: '/tmp/foo.zip',
        sessionKey: 'session-a',
        sha256: 'abc123',
        downloadName: 'foo.zip'
      });

      downloadResume.discardResumeToken(token);

      expect(downloadResume.getResumeEntry(token, 'session-a')).toBeNull();
    });

    it('is a no-op for a token that does not exist', () => {
      expect(() => downloadResume.discardResumeToken('does-not-exist')).not.toThrow();
    });
  });
});
