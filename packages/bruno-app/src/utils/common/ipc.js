import { transport } from './ipc-transport';

/**
 * Wrapper for IPC invoke that handles error cases.
 * Works in both Electron (via ipcRenderer) and Browser (via bridge server).
 * @param {string} channel - The IPC channel name
 * @param {...any} args - Arguments to pass to the channel
 * @returns {Promise} - Resolves with the result or rejects with error
 */
export const callIpc = (channel, ...args) => {
  return transport.invoke(channel, ...args);
};
