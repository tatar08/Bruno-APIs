const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * allowed-roots.js reads BRUNO_SERVER_ALLOWED_ROOTS once at module-require
 * time, so each scenario below sets the env var and re-requires the module
 * via jest.isolateModules() to get a fresh evaluation.
 */
const loadModule = () => {
  let mod;
  jest.isolateModules(() => {
    mod = require('../allowed-roots');
  });
  return mod;
};

describe('allowed-roots filesystem sandbox', () => {
  let tmpDir;
  let allowedRoot;
  let outsideDir;
  const originalEnv = process.env.BRUNO_SERVER_ALLOWED_ROOTS;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-allowed-roots-test-'));
    allowedRoot = path.join(tmpDir, 'allowed-root');
    outsideDir = path.join(tmpDir, 'outside');
    fs.mkdirSync(allowedRoot, { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'top secret');
    fs.symlinkSync(outsideDir, path.join(allowedRoot, 'escape-link'), 'dir');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.BRUNO_SERVER_ALLOWED_ROOTS;
    else process.env.BRUNO_SERVER_ALLOWED_ROOTS = originalEnv;
  });

  describe('disabled (no BRUNO_SERVER_ALLOWED_ROOTS configured)', () => {
    it('reports the sandbox as disabled and allows any path', () => {
      delete process.env.BRUNO_SERVER_ALLOWED_ROOTS;
      const { isFilesystemSandboxEnabled, isPathAllowed, findDisallowedPath } = loadModule();

      expect(isFilesystemSandboxEnabled()).toBe(false);
      expect(isPathAllowed('/anything/at/all')).toBe(true);
      expect(findDisallowedPath('renderer:delete-item', [outsideDir])).toBeNull();
    });
  });

  describe('enabled (BRUNO_SERVER_ALLOWED_ROOTS configured)', () => {
    let sandbox;

    beforeEach(() => {
      process.env.BRUNO_SERVER_ALLOWED_ROOTS = allowedRoot;
      sandbox = loadModule();
    });

    it('allows a path directly inside the allowed root', () => {
      const p = path.join(allowedRoot, 'requests', 'foo.bru');
      expect(sandbox.isPathAllowed(p)).toBe(true);
    });

    it('allows a not-yet-existing nested path whose ancestors are all inside the root', () => {
      const p = path.join(allowedRoot, 'new', 'nested', 'dir', 'file.txt');
      expect(fs.existsSync(p)).toBe(false);
      expect(sandbox.isPathAllowed(p)).toBe(true);
    });

    it('rejects a path outside the allowed root', () => {
      expect(sandbox.isPathAllowed(outsideDir)).toBe(false);
    });

    it('rejects `..` traversal out of the allowed root', () => {
      const traversal = path.join(allowedRoot, '..', 'outside', 'secret.txt');
      expect(sandbox.isPathAllowed(traversal)).toBe(false);
    });

    it('rejects a symlink inside the root that escapes to an outside directory', () => {
      const viaSymlink = path.join(allowedRoot, 'escape-link', 'secret.txt');
      // The file is reachable on disk (symlinks resolve transparently)...
      expect(fs.existsSync(viaSymlink)).toBe(true);
      // ...but the sandbox must still reject it once resolved to its real location.
      expect(sandbox.isPathAllowed(viaSymlink)).toBe(false);
    });

    it('does not flag a sibling directory that merely shares a name prefix with the root', () => {
      const prefixSibling = `${allowedRoot}-evil`;
      fs.mkdirSync(prefixSibling, { recursive: true });
      try {
        expect(sandbox.isPathAllowed(prefixSibling)).toBe(false);
      } finally {
        fs.rmSync(prefixSibling, { recursive: true, force: true });
      }
    });

    it('findDisallowedPath scans nested object/array args and flags the first bad path', () => {
      const args = [{ workspacePath: path.join(allowedRoot, 'ok') }, [outsideDir, 'not-a-path']];
      expect(sandbox.findDisallowedPath('renderer:some-channel', args)).toBe(outsideDir);
    });

    it('findDisallowedPath returns null when every candidate path is inside the root', () => {
      const args = [{ collectionPathname: path.join(allowedRoot, 'a') }, path.join(allowedRoot, 'b')];
      expect(sandbox.findDisallowedPath('renderer:some-channel', args)).toBeNull();
    });
  });

  describe('findPathsInValue', () => {
    it('extracts absolute-path-shaped strings from nested arrays and objects, ignoring non-paths', () => {
      const { findPathsInValue } = loadModule();
      const value = [
        'not-a-path',
        '/abs/one',
        { nested: '/abs/two', other: 42 },
        { deeper: { path: '/abs/three' } }
      ];
      expect(findPathsInValue(value)).toEqual(['/abs/one', '/abs/two', '/abs/three']);
    });
  });
});
