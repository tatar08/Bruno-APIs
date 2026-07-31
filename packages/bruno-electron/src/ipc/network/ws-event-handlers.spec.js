jest.mock('./interpolate-string', () => ({
  interpolateString: (str) => str
}));

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn(), on: jest.fn() },
  app: { on: jest.fn(), getPath: () => '/tmp', getVersion: () => '0.0.0' }
}));

const mockClearAllConnections = jest.fn();
jest.mock('@usebruno/requests', () => ({
  ...jest.requireActual('@usebruno/requests'),
  WsClient: jest.fn().mockImplementation(() => ({ clearAllConnections: mockClearAllConnections }))
}));

describe('closeAllConnections (Improvement.md P1.3 graceful shutdown)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockClearAllConnections.mockClear();
  });

  it('is a safe no-op before any window has registered handlers (wsClient never created)', () => {
    const { closeAllConnections } = require('./ws-event-handlers');
    expect(() => closeAllConnections()).not.toThrow();
  });

  it('clears connections on the wsClient created by registerWsEventHandlers, read via closure', () => {
    const { registerWsEventHandlers, closeAllConnections } = require('./ws-event-handlers');
    const window = { isDestroyed: () => false, webContents: { send: jest.fn(), isDestroyed: () => false } };

    registerWsEventHandlers(window);
    closeAllConnections();

    expect(mockClearAllConnections).toHaveBeenCalledTimes(1);
  });

  it('tolerates clearAllConnections throwing', () => {
    mockClearAllConnections.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const { registerWsEventHandlers, closeAllConnections } = require('./ws-event-handlers');
    const window = { isDestroyed: () => false, webContents: { send: jest.fn(), isDestroyed: () => false } };

    registerWsEventHandlers(window);
    expect(() => closeAllConnections()).not.toThrow();
  });
});
