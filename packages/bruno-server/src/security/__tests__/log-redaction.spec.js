const { redactSecrets } = require('../log-redaction');

describe('redactSecrets', () => {
  it('passes through non-string/empty input unchanged', () => {
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('')).toBe('');
    expect(redactSecrets(42)).toBe(42);
  });

  it('passes through messages with no secret-shaped content unchanged', () => {
    expect(redactSecrets('ENOENT: no such file or directory')).toBe('ENOENT: no such file or directory');
    expect(redactSecrets('Invalid token format')).toBe('Invalid token format');
    expect(redactSecrets('Please enter your password to continue')).toBe('Please enter your password to continue');
    expect(redactSecrets('ENOTFOUND api.example.com')).toBe('ENOTFOUND api.example.com');
  });

  it('redacts credentials embedded in a URL userinfo', () => {
    expect(redactSecrets('fetch failed: https://user:s3cr3t@example.com/api')).toBe(
      'fetch failed: https://[REDACTED]@example.com/api'
    );
    expect(redactSecrets('remote error for git+ssh://git:ghp_abc123@github.com/x/y.git')).toBe(
      'remote error for git+ssh://[REDACTED]@github.com/x/y.git'
    );
  });

  it('redacts Bearer/Basic authorization tokens', () => {
    expect(redactSecrets('Authorization: Bearer abcDEF123.456-token~ok')).toBe('Authorization: Bearer [REDACTED]');
    expect(redactSecrets('got 401 with Basic dXNlcjpwYXNz==')).toBe('got 401 with Basic [REDACTED]');
  });

  it('redacts key=value / key:"value" secret-shaped assignments', () => {
    expect(redactSecrets('upstream said token=abc123')).toBe('upstream said token=[REDACTED]');
    expect(redactSecrets('{"password":"hunter2"}')).toBe('{"password":"[REDACTED]"}');
    expect(redactSecrets('client_secret=xyz&other=1')).toBe('client_secret=[REDACTED]&other=1');
    expect(redactSecrets('api_key: sk-live-abcdef')).toBe('api_key: [REDACTED]');
  });

  it('redacts multiple distinct secrets in the same message', () => {
    const message = 'failed for https://u:p@host.example and token=abc123';
    expect(redactSecrets(message)).toBe('failed for https://[REDACTED]@host.example and token=[REDACTED]');
  });
});
