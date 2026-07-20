import { transport } from './common/ipc-transport';

/**
 * Filesystem utilities for the renderer process
 * These functions communicate with the main process via IPC or bridge server
 */

/**
 * Check if a file exists
 * @param {string} filePath - The file path to check
 * @returns {Promise<boolean>} - True if file exists, false otherwise
 */
export const existsSync = async (filePath) => {
  return await transport.invoke('renderer:exists-sync', filePath);
};

/**
 * Resolve a relative path against a base path
 * @param {string} relativePath - The relative path to resolve
 * @param {string} basePath - The base path to resolve against
 * @returns {Promise<string>} - The resolved absolute path
 */
export const resolvePath = async (relativePath, basePath) => {
  return await transport.invoke('renderer:resolve-path', relativePath, basePath);
};

export const browseDirectory = async (pathname) => {
  return await transport.invoke('renderer:browse-directory', pathname);
};

/**
 * Check if a path is a directory
 * @param {string} dirPath - The directory path to check
 * @returns {Promise<boolean>} - True if path is a directory, false otherwise
 */
export const isDirectory = async (dirPath) => {
  return await transport.invoke('renderer:is-directory', dirPath);
};

