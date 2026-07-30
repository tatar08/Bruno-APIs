const { WindowShim, createFakeEvent } = require('../window-shim');
const { runWithSession } = require('../../session-context');

function makeMockEventBridge() {
  return { broadcast: jest.fn(), sendToSession: jest.fn() };
}

describe('WindowShim', () => {
  it('falls back to broadcast() outside of any session context', () => {
    const eventBridge = makeMockEventBridge();
    const shim = new WindowShim(eventBridge);

    shim.webContents.send('main:app-loaded', { ok: true });

    expect(eventBridge.broadcast).toHaveBeenCalledWith('main:app-loaded', { ok: true });
    expect(eventBridge.sendToSession).not.toHaveBeenCalled();
  });

  it('routes through sendToSession() inside a session context', () => {
    const eventBridge = makeMockEventBridge();
    const shim = new WindowShim(eventBridge);

    runWithSession('session-a', () => {
      shim.webContents.send('terminal:data', 'session-1', 'hello');
    });

    expect(eventBridge.sendToSession).toHaveBeenCalledWith('session-a', 'terminal:data', 'session-1', 'hello');
    expect(eventBridge.broadcast).not.toHaveBeenCalled();
  });

  it('does nothing once destroyed, in or out of a session context', () => {
    const eventBridge = makeMockEventBridge();
    const shim = new WindowShim(eventBridge);
    shim.destroy();

    shim.webContents.send('main:app-loaded');
    runWithSession('session-a', () => shim.webContents.send('terminal:data'));

    expect(eventBridge.broadcast).not.toHaveBeenCalled();
    expect(eventBridge.sendToSession).not.toHaveBeenCalled();
  });

  it('createFakeEvent exposes the shim as event.sender and event._window', () => {
    const eventBridge = makeMockEventBridge();
    const shim = new WindowShim(eventBridge);
    const fakeEvent = createFakeEvent(shim);

    expect(fakeEvent.sender).toBe(shim.webContents);
    expect(fakeEvent._window).toBe(shim);
  });
});
