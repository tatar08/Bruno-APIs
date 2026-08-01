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
  isDirectory
} = require('../utils/filesystem');
const { findUniqueFolderName } = require('../utils/collection-import');
const { parseRunnerDataset } = require('@usebruno/common').utils;

const MAX_RUNNER_DATASET_BYTES = 10 * 1024 * 1024;

const registerFilesystemIpc = (mainWindow) => {
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
  ipcMain.handle('renderer:list-directory', async (_, dirPath = null) => {
    const targetPath = dirPath ? normalizeAndResolvePath(dirPath) : os.homedir();
    if (!isDirectory(targetPath)) {
      throw new Error(`Not a directory: ${targetPath}`);
    }

    const dirents = await fs.readdir(targetPath, { withFileTypes: true });
    const entries = dirents
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => ({
        name: entry.name,
        path: path.join(targetPath, entry.name),
        isDirectory: entry.isDirectory()
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const parentPath = path.dirname(targetPath);
    return {
      path: targetPath,
      parentPath: parentPath === targetPath ? null : parentPath,
      entries
    };
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
