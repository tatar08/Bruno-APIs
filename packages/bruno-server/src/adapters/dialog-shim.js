/**
 * Dialog Shim — browser-compatible replacements for Electron's dialog module.
 *
 * In Electron, dialog.showOpenDialog() opens a native file picker.
 * In browser mode, the frontend will use <input type="file"> and send
 * the file data to the server. This shim handles the server-side.
 */

const os = require('os');

/**
 * Returns a default browse directory path (user's home or a configured path)
 */
const getDefaultBrowsePath = () => {
  return process.env.BRUNO_DEFAULT_PATH || os.homedir();
};

/**
 * Shim for dialog.showOpenDialog — returns a mock result
 * In browser mode, file selection is handled client-side.
 * The server provides directory browsing capabilities.
 */
const showOpenDialog = async (options = {}) => {
  // In browser mode, the actual file selection happens client-side
  // This is a placeholder that the handler-registry will intercept
  return { canceled: true, filePaths: [] };
};

/**
 * Shim for dialog.showSaveDialog
 */
const showSaveDialog = async (options = {}) => {
  return { canceled: true, filePath: undefined };
};

module.exports = {
  showOpenDialog,
  showSaveDialog,
  getDefaultBrowsePath
};
