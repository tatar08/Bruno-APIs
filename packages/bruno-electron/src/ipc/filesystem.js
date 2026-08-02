const { ipcMain, dialog } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const fs = require('fs-extra');

const {
  browseDirectory,
  browseFiles,
  normalizeAndResolvePath,
  isFile,
  isDirectory,
  createDirectory,
  validateName,
  safeToRename
} = require('../utils/filesystem');
const { findUniqueFolderName } = require('../utils/collection-import');
const { parseRunnerDataset } = require('@usebruno/common').utils;
const RecentBrowsePaths = require('../store/recent-browse-paths');
const { encodeFileHandle, resolvePathOrHandle } = require('../utils/file-handles');

const MAX_RUNNER_DATASET_BYTES = 10 * 1024 * 1024;

const registerFilesystemIpc = (mainWindow) => {
  const recentBrowsePaths = new RecentBrowsePaths();
  ipcMain.handle('renderer:browse-directory', async (event, pathname, request) => {
    try {
      return await browseDirectory(mainWindow);
    } catch (error) {
      return Promise.reject(error);
    }
  });

  ipcMain.handle('renderer:browse-files', async (_, filters, properties) => {
    try {
      return await browseFiles(mainWindow, filters, properties);
    } catch (error) {
      throw error;
    }
  });

  // Backs the Browser Bridge browse modal (Improvement.md P1.1): lists a
  // directory's immediate children so the modal can offer point-and-click
  // navigation instead of window.prompt(). Read-only — never touches disk
  // beyond readdir/stat, so it's safe to add to READ_ONLY_SAFE_CHANNELS.
  // dirPath accepts either a raw path or an opaque handle minted by a
  // previous call to this same handler (see utils/file-handles.js).
  ipcMain.handle('renderer:list-directory', async (_, dirPath = null) => {
    const targetPath = dirPath ? normalizeAndResolvePath(resolvePathOrHandle(dirPath)) : os.homedir();
    if (!isDirectory(targetPath)) {
      throw new Error(`Not a directory: ${targetPath}`);
    }

    const dirents = await fs.readdir(targetPath, { withFileTypes: true });
    const entries = await Promise.all(
      dirents
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map(async (entry) => {
          const entryPath = path.join(targetPath, entry.name);
          const base = {
            name: entry.name,
            path: entryPath,
            handle: encodeFileHandle(entryPath),
            isDirectory: entry.isDirectory()
          };
          if (base.isDirectory) return base;
          // Preview info (Improvement.md P1.1 file picker) — best-effort only,
          // a stat failure (e.g. broken symlink) shouldn't hide the entry.
          try {
            const stats = await fs.stat(entryPath);
            return { ...base, size: stats.size, mtimeMs: stats.mtimeMs };
          } catch (error) {
            return base;
          }
        })
    );
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parentPath = path.dirname(targetPath);
    const atRoot = parentPath === targetPath;
    return {
      path: targetPath,
      handle: encodeFileHandle(targetPath),
      parentPath: atRoot ? null : parentPath,
      parentHandle: atRoot ? null : encodeFileHandle(parentPath),
      entries
    };
  });

  // Creates a subfolder inside dirPath for the Browse modal (Improvement.md
  // P1.1). Reuses validateName()/createDirectory() from utils/filesystem.js
  // — the same conflict/reserved-name rules already applied to Bruno
  // collection folders elsewhere in this file — rather than inventing a
  // second set of naming rules just for this modal.
  // dirPath accepts either a raw path or an opaque handle (see
  // utils/file-handles.js) — e.g. the `handle`/`parentHandle` a prior
  // renderer:list-directory call returned for this same folder.
  ipcMain.handle('renderer:create-directory', async (_, dirPath, name) => {
    const targetParent = normalizeAndResolvePath(resolvePathOrHandle(dirPath));
    if (!isDirectory(targetParent)) {
      throw new Error(`Not a directory: ${targetParent}`);
    }
    if (typeof name !== 'string' || !validateName(name)) {
      throw new Error(`"${name}" is not a valid folder name`);
    }

    const targetPath = path.join(targetParent, name);
    await createDirectory(targetPath);
    return { path: targetPath, handle: encodeFileHandle(targetPath), name, parentPath: targetParent };
  });

  // Renames a folder in place (same parent directory) for the Browse modal.
  // safeToRename() is the same collision guard used by
  // renderer:rename-item-filename — it also allows case-only renames on
  // case-insensitive filesystems by comparing inode/birthtime rather than
  // just existsSync().
  // dirPath accepts either a raw path or an opaque handle (see
  // utils/file-handles.js).
  ipcMain.handle('renderer:rename-directory', async (_, dirPath, newName) => {
    const oldPath = normalizeAndResolvePath(resolvePathOrHandle(dirPath));
    if (!isDirectory(oldPath)) {
      throw new Error(`Not a directory: ${oldPath}`);
    }
    if (typeof newName !== 'string' || !validateName(newName)) {
      throw new Error(`"${newName}" is not a valid folder name`);
    }

    const newPath = path.join(path.dirname(oldPath), newName);
    if (!safeToRename(oldPath, newPath)) {
      throw new Error(`"${newName}" already exists`);
    }

    await fs.rename(oldPath, newPath);
    return { path: newPath, handle: encodeFileHandle(newPath), name: newName, parentPath: path.dirname(newPath) };
  });

  // Recent/Favorites lists for the Browse modal (Improvement.md P1.1). Backed
  // by RecentBrowsePaths, which session-scopes in Browser Bridge mode the
  // same way LastOpenedWorkspaces does, so one browser session's history
  // doesn't leak into another's.
  ipcMain.handle('renderer:get-browse-paths', async () => {
    return { recent: recentBrowsePaths.getRecent(), favorites: recentBrowsePaths.getFavorites() };
  });

  ipcMain.handle('renderer:add-recent-browse-path', async (_, dirPath) => {
    return recentBrowsePaths.addRecent(dirPath);
  });

  ipcMain.handle('renderer:toggle-favorite-browse-path', async (_, dirPath) => {
    return recentBrowsePaths.toggleFavorite(dirPath);
  });

  ipcMain.handle('renderer:browse-pac-file', async (_, selectedPath = null) => {
    let filePath = selectedPath;
    if (!filePath) {
      const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'PAC Files', extensions: ['pac', 'js'] }]
      });
      filePath = filePaths?.[0];
    }
    if (!filePath || !isFile(filePath)) return null;
    return pathToFileURL(filePath).href;
  });

  ipcMain.handle('renderer:load-runner-dataset', async (_, selectedPath = null) => {
    if (selectedPath && typeof selectedPath === 'object') {
      const fileName = path.basename(String(selectedPath.fileName || ''));
      const content = typeof selectedPath.content === 'string' ? selectedPath.content : null;
      if (!fileName || content === null) throw new Error('Invalid dataset upload');
      if (Buffer.byteLength(content, 'utf8') > MAX_RUNNER_DATASET_BYTES) {
        throw new Error('Dataset file cannot be larger than 10 MB');
      }

      const parsed = parseRunnerDataset(content, fileName);
      return { ...parsed, fileName, filePath: fileName };
    }

    let filePath = selectedPath;
    if (!filePath) {
      const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Runner Dataset', extensions: ['json', 'csv'] }]
      });
      filePath = filePaths?.[0];
    }
    if (!filePath) return null;

    const normalizedPath = normalizeAndResolvePath(filePath);
    if (!isFile(normalizedPath)) throw new Error('Dataset file does not exist');
    const stats = await fs.stat(normalizedPath);
    if (stats.size > MAX_RUNNER_DATASET_BYTES) throw new Error('Dataset file cannot be larger than 10 MB');

    const parsed = parseRunnerDataset(await fs.readFile(normalizedPath, 'utf8'), normalizedPath);
    return { ...parsed, fileName: path.basename(normalizedPath), filePath: normalizedPath };
  });

  ipcMain.handle('renderer:exists-sync', async (_, filePath) => {
    try {
      const normalizedPath = normalizeAndResolvePath(filePath);
      return isFile(normalizedPath);
    } catch (error) {
      return false;
    }
  });

  ipcMain.handle('renderer:resolve-path', async (_, relativePath, basePath) => {
    try {
      const resolvedPath = path.resolve(basePath, relativePath);
      return normalizeAndResolvePath(resolvedPath);
    } catch (error) {
      return relativePath;
    }
  });

  ipcMain.handle('renderer:is-directory', async (_, pathname) => {
    return isDirectory(pathname);
  });

  ipcMain.handle('renderer:find-unique-folder-name', async (_, baseName, location) => {
    try {
      return await findUniqueFolderName(baseName, location);
    } catch (error) {
      throw error;
    }
  });
};

module.exports = registerFilesystemIpc;
