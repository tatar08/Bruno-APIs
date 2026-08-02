jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  dialog: { showOpenDialog: jest.fn() }
}));

let mockGetCurrentSessionKey;
jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => {
    const data = {};
    return {
      get(key, defaultValue) {
        const parts = key.split('.');
        let node = data;
        for (const part of parts) {
          if (node == null || typeof node !== 'object' || !(part in node)) return defaultValue;
          node = node[part];
        }
        return node;
      },
      set(key, value) {
        const parts = key.split('.');
        let node = data;
        for (let i = 0; i < parts.length - 1; i++) {
          if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
          node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = value;
      }
    };
  });
});
jest.mock('@usebruno/requests', () => ({
  getCurrentSessionKey: (...args) => mockGetCurrentSessionKey(...args)
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('renderer:create-directory / renderer:rename-directory (Improvement.md P1.1 Browse modal create-folder/rename)', () => {
  let tmpRoot;
  let handlers;

  beforeEach(() => {
    jest.resetModules();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-fs-ipc-test-'));
    mockGetCurrentSessionKey = jest.fn(() => undefined);

    const { ipcMain } = require('electron');
    ipcMain.handle.mockClear();

    const registerFilesystemIpc = require('./filesystem');
    registerFilesystemIpc({});

    handlers = new Map();
    for (const [channel, handler] of ipcMain.handle.mock.calls) {
      handlers.set(channel, handler);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('renderer:create-directory', () => {
    const invoke = (...args) => handlers.get('renderer:create-directory')(null, ...args);

    it('creates a new subfolder and returns its path', async () => {
      const result = await invoke(tmpRoot, 'New Folder');
      expect(fs.existsSync(path.join(tmpRoot, 'New Folder'))).toBe(true);
      expect(result).toEqual({
        path: path.join(tmpRoot, 'New Folder'),
        handle: expect.any(String),
        name: 'New Folder',
        parentPath: tmpRoot
      });
    });

    it('accepts an opaque parent handle (from a prior list-directory call) instead of a raw path', async () => {
      const { handle: parentHandle } = await handlers.get('renderer:list-directory')(null, tmpRoot);
      const result = await invoke(parentHandle, 'Via Handle');
      expect(fs.existsSync(path.join(tmpRoot, 'Via Handle'))).toBe(true);
      expect(result.path).toBe(path.join(tmpRoot, 'Via Handle'));
    });

    it('rejects when a folder with the same name already exists (conflict)', async () => {
      fs.mkdirSync(path.join(tmpRoot, 'Existing'));
      await expect(invoke(tmpRoot, 'Existing')).rejects.toThrow(/already exists/);
    });

    it('rejects an invalid folder name (path separator)', async () => {
      await expect(invoke(tmpRoot, 'nested/name')).rejects.toThrow(/not a valid folder name/);
      expect(fs.existsSync(path.join(tmpRoot, 'nested'))).toBe(false);
    });

    it('rejects a non-directory parent path', async () => {
      const filePath = path.join(tmpRoot, 'a-file.txt');
      fs.writeFileSync(filePath, 'x');
      await expect(invoke(filePath, 'New Folder')).rejects.toThrow(/Not a directory/);
    });
  });

  describe('renderer:list-directory', () => {
    const invoke = (...args) => handlers.get('renderer:list-directory')(null, ...args);

    it('lists directories before files, and includes size/mtimeMs for files (Improvement.md P1.1 file picker preview)', async () => {
      fs.mkdirSync(path.join(tmpRoot, 'Sub'));
      fs.writeFileSync(path.join(tmpRoot, 'notes.txt'), 'hello');

      const result = await invoke(tmpRoot);

      expect(result.path).toBe(tmpRoot);
      expect(result.entries.map((e) => e.name)).toEqual(['Sub', 'notes.txt']);

      const dirEntry = result.entries.find((e) => e.name === 'Sub');
      expect(dirEntry.isDirectory).toBe(true);
      expect(dirEntry.size).toBeUndefined();

      const fileEntry = result.entries.find((e) => e.name === 'notes.txt');
      expect(fileEntry.isDirectory).toBe(false);
      expect(fileEntry.size).toBe(5);
      expect(typeof fileEntry.mtimeMs).toBe('number');
    });

    it('rejects a non-directory path', async () => {
      const filePath = path.join(tmpRoot, 'a-file.txt');
      fs.writeFileSync(filePath, 'x');
      await expect(invoke(filePath)).rejects.toThrow(/Not a directory/);
    });

    it('includes an opaque handle per entry and for the listed/parent directory (Improvement.md P1.1 opaque file handle API)', async () => {
      fs.mkdirSync(path.join(tmpRoot, 'Sub'));

      const result = await invoke(tmpRoot);
      expect(typeof result.handle).toBe('string');
      expect(result.handle).toMatch(/^bruno-fh:/);
      expect(typeof result.parentHandle).toBe('string');

      const subEntry = result.entries.find((e) => e.name === 'Sub');
      expect(subEntry.handle).toMatch(/^bruno-fh:/);
    });

    it('reports a null parentHandle at the same point it reports a null parentPath (filesystem root)', async () => {
      const result = await invoke('/');
      expect(result.parentPath).toBeNull();
      expect(result.parentHandle).toBeNull();
    });

    it('accepts an opaque handle as dirPath to navigate without ever sending a raw path', async () => {
      fs.mkdirSync(path.join(tmpRoot, 'Sub'));
      const rootListing = await invoke(tmpRoot);
      const subHandle = rootListing.entries.find((e) => e.name === 'Sub').handle;

      const subListing = await invoke(subHandle);
      expect(subListing.path).toBe(path.join(tmpRoot, 'Sub'));
    });
  });

  describe('renderer:rename-directory', () => {
    const invoke = (...args) => handlers.get('renderer:rename-directory')(null, ...args);

    it('renames a folder in place and returns the new path', async () => {
      const oldPath = path.join(tmpRoot, 'Old Name');
      fs.mkdirSync(oldPath);

      const result = await invoke(oldPath, 'New Name');

      expect(fs.existsSync(oldPath)).toBe(false);
      expect(fs.existsSync(path.join(tmpRoot, 'New Name'))).toBe(true);
      expect(result).toEqual({
        path: path.join(tmpRoot, 'New Name'),
        handle: expect.any(String),
        name: 'New Name',
        parentPath: tmpRoot
      });
    });

    it('accepts an opaque handle (from a prior list-directory call) as the source instead of a raw path', async () => {
      const oldPath = path.join(tmpRoot, 'Old Via Handle');
      fs.mkdirSync(oldPath);
      const { entries } = await handlers.get('renderer:list-directory')(null, tmpRoot);
      const oldHandle = entries.find((e) => e.name === 'Old Via Handle').handle;

      const result = await invoke(oldHandle, 'New Via Handle');
      expect(fs.existsSync(oldPath)).toBe(false);
      expect(result.path).toBe(path.join(tmpRoot, 'New Via Handle'));
    });

    it('rejects when the target name already exists (conflict)', async () => {
      const oldPath = path.join(tmpRoot, 'Source');
      fs.mkdirSync(oldPath);
      fs.mkdirSync(path.join(tmpRoot, 'Taken'));

      await expect(invoke(oldPath, 'Taken')).rejects.toThrow(/already exists/);
      expect(fs.existsSync(oldPath)).toBe(true);
    });

    it('rejects an invalid new name', async () => {
      const oldPath = path.join(tmpRoot, 'Source');
      fs.mkdirSync(oldPath);

      await expect(invoke(oldPath, 'bad/name')).rejects.toThrow(/not a valid folder name/);
      expect(fs.existsSync(oldPath)).toBe(true);
    });

    it('rejects a non-existent source path', async () => {
      await expect(invoke(path.join(tmpRoot, 'nope'), 'New Name')).rejects.toThrow(/Not a directory/);
    });
  });

  describe('Browse modal recent/favorites paths (Improvement.md P1.1)', () => {
    const getBrowsePaths = () => handlers.get('renderer:get-browse-paths')(null);
    const addRecent = (dirPath) => handlers.get('renderer:add-recent-browse-path')(null, dirPath);
    const toggleFavorite = (dirPath) => handlers.get('renderer:toggle-favorite-browse-path')(null, dirPath);

    it('starts empty and records an added recent path', async () => {
      expect(await getBrowsePaths()).toEqual({ recent: [], favorites: [] });

      await addRecent('/a');
      expect(await getBrowsePaths()).toEqual({ recent: ['/a'], favorites: [] });
    });

    it('toggles a path in and out of favorites', async () => {
      await toggleFavorite('/a');
      expect((await getBrowsePaths()).favorites).toEqual(['/a']);

      await toggleFavorite('/a');
      expect((await getBrowsePaths()).favorites).toEqual([]);
    });
  });
});
