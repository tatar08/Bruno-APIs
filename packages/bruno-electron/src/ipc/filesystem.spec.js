jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  dialog: { showOpenDialog: jest.fn() }
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
        name: 'New Folder',
        parentPath: tmpRoot
      });
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
        name: 'New Name',
        parentPath: tmpRoot
      });
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
});
