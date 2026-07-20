/**
 * Window Shim — creates a fake BrowserWindow object that routes
 * webContents.send() calls through the EventBridge WebSocket.
 *
 * This lets existing Electron IPC handlers work unmodified —
 * they call mainWindow.webContents.send(), which gets forwarded
 * to browser clients via WebSocket.
 */

class WindowShim {
  constructor(eventBridge) {
    this._eventBridge = eventBridge;
    this._destroyed = false;

    this.webContents = {
      send: (channel, ...args) => {
        if (this._destroyed) return;
        this._eventBridge.broadcast(channel, ...args);
      },
      on: () => {},
      once: () => {},
      removeListener: () => {},
      isDestroyed: () => this._destroyed,
      openDevTools: () => {},
      closeDevTools: () => {},
      isDevToolsOpened: () => false,
      setZoomLevel: () => {},
      getZoomLevel: () => 0,
      setWindowOpenHandler: () => {},
      // Some handlers check the sender, provide a minimal shim
      id: 1
    };
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    this._destroyed = true;
  }

  // BrowserWindow methods that handlers might check
  isMaximized() { return false; }
  isMinimized() { return false; }
  isFullScreen() { return false; }
  minimize() {}
  maximize() {}
  unmaximize() {}
  close() {}
  setFullScreen() {}
  show() {}
  focus() {}
}

/**
 * Creates a fake `event` object that some ipcMain.handle callbacks receive.
 * The event.sender is typically used to get BrowserWindow.fromWebContents.
 */
const createFakeEvent = (windowShim) => ({
  sender: windowShim.webContents,
  // Minimal shim for BrowserWindow.fromWebContents to work if needed
  _window: windowShim
});

module.exports = { WindowShim, createFakeEvent };
