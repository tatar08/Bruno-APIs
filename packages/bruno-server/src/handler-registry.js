/**
 * Handler Registry — maps IPC channel names to handler functions.
 *
 * This module imports handler logic from bruno-electron's IPC modules
 * and makes them available to the bridge server's REST API.
 *
 * Instead of refactoring all of bruno-electron's handlers immediately,
 * we use a "lazy adapter" approach: we intercept ipcMain.handle() calls
 * during registration, capturing the handler functions into a registry map.
 */

const path = require('path');

class HandlerRegistry {
  constructor() {
    this._handlers = new Map();
    this._eventHandlers = new Map(); // channel -> Set<handler>, like EventEmitter
    this._channelSource = new Map(); // channel -> originating ipc/*.js file (or 'inline' for index.js-registered channels)
  }

  /**
   * Identifies which bruno-electron ipc/*.js file called ipcMain.handle()/on()
   * by walking the call stack past this file's own frames. This lets the
   * capability policy (security/channel-capabilities.js) derive a real,
   * mechanically-verified channel→module mapping instead of a hand-maintained
   * list that can silently drift out of sync with the actual handler set.
   */
  _captureSourceFile() {
    const stack = new Error().stack || '';
    const frames = stack.split('\n').slice(1);
    const thisFile = __filename;

    for (const frame of frames) {
      const match = frame.match(/\(?([^():]+):\d+:\d+\)?$/);
      if (match && match[1] !== thisFile && !match[1].startsWith('node:')) {
        // basename alone collides across directories (e.g. ipc/network/index.js
        // vs bruno-server's own src/index.js both basename to "index.js"), so
        // keep one parent directory segment to disambiguate.
        const parts = match[1].split(path.sep);
        return parts.slice(-2).join('/');
      }
    }
    return 'inline';
  }

  /**
   * Creates a fake ipcMain object that captures handler registrations.
   * When bruno-electron code calls ipcMain.handle(channel, handler),
   * we store the handler in our registry instead.
   */
  createIpcMainShim() {
    const self = this;

    return {
      handle: (channel, handler) => {
        self._handlers.set(channel, handler);
        self._channelSource.set(channel, self._captureSourceFile());
      },
      on: (channel, handler) => {
        if (!self._eventHandlers.has(channel)) {
          self._eventHandlers.set(channel, new Set());
        }
        self._eventHandlers.get(channel).add(handler);
        self._channelSource.set(channel, self._captureSourceFile());
      },
      emit: (channel, ...args) => {
        const handlers = self._eventHandlers.get(channel);
        if (handlers) {
          handlers.forEach((handler) => {
            try {
              const result = handler(...args);
              result?.catch?.((error) => {
                console.error('[HandlerRegistry] Event "' + channel + '" failed:', error);
              });
            } catch (error) {
              console.error('[HandlerRegistry] Event "' + channel + '" failed:', error);
            }
          });
        }
      },
      removeHandler: (channel) => {
        self._handlers.delete(channel);
      },
      removeAllListeners: (channel) => {
        if (channel) {
          self._eventHandlers.delete(channel);
        }
      }
    };
  }

  /**
   * Register a handler for a channel
   */
  register(channel, handler) {
    this._handlers.set(channel, handler);
    if (!this._channelSource.has(channel)) this._channelSource.set(channel, this._captureSourceFile());
  }

  registerEvent(channel, handler) {
    if (!this._eventHandlers.has(channel)) {
      this._eventHandlers.set(channel, new Set());
    }
    this._eventHandlers.get(channel).add(handler);
    if (!this._channelSource.has(channel)) this._channelSource.set(channel, this._captureSourceFile());
  }

  /**
   * Originating ipc/*.js filename for a channel (e.g. 'git.js'), or 'inline'
   * for channels registered directly in index.js rather than bruno-electron.
   */
  getChannelSource(channel) {
    return this._channelSource.get(channel) || 'inline';
  }

  /**
   * Get a handler for a channel
   */
  get(channel) {
    return this._handlers.get(channel);
  }

  /**
   * Check if a handler exists for a channel
   */
  has(channel) {
    return this._handlers.has(channel);
  }

  hasEvent(channel) {
    return this._eventHandlers.has(channel);
  }

  /**
   * Get all registered channel names
   */
  getChannels() {
    return Array.from(this._handlers.keys());
  }

  getEventChannels() {
    return Array.from(this._eventHandlers.keys());
  }

  /**
   * Invoke a handler with the given arguments
   */
  async invoke(channel, fakeEvent, ...args) {
    const handler = this._handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`);
    }
    return await handler(fakeEvent, ...args);
  }

  async emit(channel, fakeEvent, ...args) {
    const handlers = this._eventHandlers.get(channel);
    if (!handlers?.size) {
      throw new Error(`No event handler registered for channel: ` + channel);
    }
    const results = await Promise.all(
      Array.from(handlers, (handler) => handler(fakeEvent, ...args))
    );
    return results.at(-1);
  }
}

module.exports = { HandlerRegistry };
