const { encodeFileHandle, decodeFileHandle, isFileHandle, resolvePathOrHandle } = require('./file-handles');

describe('file-handles (Improvement.md P1.1 opaque file handle API)', () => {
  it('round-trips an absolute path through encode/decode', () => {
    const handle = encodeFileHandle('/home/user/Collections/my-collection');
    expect(isFileHandle(handle)).toBe(true);
    expect(decodeFileHandle(handle)).toBe('/home/user/Collections/my-collection');
  });

  it('mints a different handle for the same path each time (fresh IV)', () => {
    const a = encodeFileHandle('/same/path');
    const b = encodeFileHandle('/same/path');
    expect(a).not.toBe(b);
    expect(decodeFileHandle(a)).toBe('/same/path');
    expect(decodeFileHandle(b)).toBe('/same/path');
  });

  it('does not treat a raw path string as a handle', () => {
    expect(isFileHandle('/home/user/foo')).toBe(false);
    expect(isFileHandle('C:\\Users\\foo')).toBe(false);
  });

  it('rejects a tampered handle instead of returning a wrong path', () => {
    const handle = encodeFileHandle('/safe/root/file.txt');
    const tampered = handle.slice(0, -4) + 'AAAA';
    expect(() => decodeFileHandle(tampered)).toThrow(/Invalid or tampered file handle/);
  });

  it('rejects a malformed (too-short) handle', () => {
    expect(() => decodeFileHandle('bruno-fh:AA')).toThrow(/Malformed file handle/);
  });

  describe('resolvePathOrHandle', () => {
    it('decodes a handle', () => {
      const handle = encodeFileHandle('/decoded/path');
      expect(resolvePathOrHandle(handle)).toBe('/decoded/path');
    });

    it('passes a raw path through unchanged', () => {
      expect(resolvePathOrHandle('/raw/path')).toBe('/raw/path');
    });

    it('passes null/undefined through unchanged', () => {
      expect(resolvePathOrHandle(null)).toBeNull();
      expect(resolvePathOrHandle(undefined)).toBeUndefined();
    });
  });
});
