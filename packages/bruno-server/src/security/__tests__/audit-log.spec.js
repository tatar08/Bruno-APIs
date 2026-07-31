const { logSandboxDenial } = require('../audit-log');

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
