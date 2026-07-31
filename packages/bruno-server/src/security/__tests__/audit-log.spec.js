const { logSandboxDenial, logOauth2Callback } = require('../audit-log');

describe('audit-log (Improvement.md P0.3 — filesystem sandbox audit events)', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs the channel and denied path', () => {
    logSandboxDenial({ channel: 'renderer:save-file', path: '/etc/passwd' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [line] = warnSpy.mock.calls[0];
    expect(line).toContain('[FilesystemSandbox] Denied');
    expect(line).toContain('channel="renderer:save-file"');
    expect(line).toContain('path="/etc/passwd"');
  });

  it('includes session and requestId when provided', () => {
    logSandboxDenial({ channel: 'renderer:save-file', path: '/etc/passwd', sessionId: 'sess-1', requestId: 'req-1' });

    const [line] = warnSpy.mock.calls[0];
    expect(line).toContain('session=sess-1');
    expect(line).toContain('requestId=req-1');
  });

  it('omits session and requestId when absent, without leaving stray tokens', () => {
    logSandboxDenial({ channel: 'renderer:save-file', path: '/etc/passwd' });

    const [line] = warnSpy.mock.calls[0];
    expect(line).not.toContain('session=');
    expect(line).not.toContain('requestId=');
  });
});

describe('logOauth2Callback (Improvement.md P1.5 — OAuth2 loopback callback)', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs the state and outcome, never a code/token value', () => {
    logOauth2Callback({ state: 'abc123', outcome: 'resolved' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [line] = warnSpy.mock.calls[0];
    expect(line).toContain('[OAuth2Callback] resolved');
    expect(line).toContain('state="abc123"');
  });

  it('logs rejection outcomes distinctly from resolution', () => {
    logOauth2Callback({ state: 'xyz789', outcome: 'rejected: no matching pending request' });

    const [line] = warnSpy.mock.calls[0];
    expect(line).toContain('rejected: no matching pending request');
    expect(line).toContain('state="xyz789"');
  });
});
