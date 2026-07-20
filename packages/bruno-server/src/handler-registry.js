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
      },
      on: (channel, handler) => {
        if (!self._eventHandlers.has(channel)) {
          self._eventHandlers.set(channel, new Set());
        }
        self._eventHandlers.get(channel).add(handler);
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
  }

  registerEvent(channel, handler) {
    if (!this._eventHandlers.has(channel)) {
      this._eventHandlers.set(channel, new Set());
    }
    this._eventHandlers.get(channel).add(handler);
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
