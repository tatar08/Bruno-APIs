const { getMaxPayloadBytes, validateArgs, CAPABILITY_MAX_PAYLOAD_BYTES } = require('../channel-policy');

describe('channel-policy', () => {
  describe('getMaxPayloadBytes', () => {
    it('caps small, provably-trivial capabilities (ui/system/notifications)', () => {
      expect(getMaxPayloadBytes('renderer:open-about', 'src/index.js')).toBe(CAPABILITY_MAX_PAYLOAD_BYTES.ui);
      expect(getMaxPayloadBytes('renderer:start-system-monitoring', 'ipc/system-monitor.js')).toBe(
        CAPABILITY_MAX_PAYLOAD_BYTES.system
      );
      expect(getMaxPayloadBytes('renderer:notifications-opened', 'ipc/notifications.js')).toBe(
        CAPABILITY_MAX_PAYLOAD_BYTES.notifications
      );
    });

    it('leaves no additional cap for capabilities that can legitimately carry large payloads', () => {
      expect(getMaxPayloadBytes('renderer:save-file', 'ipc/collection.js')).toBeNull();
      expect(getMaxPayloadBytes('send-http-request', 'network/index.js')).toBeNull();
      expect(getMaxPayloadBytes('renderer:import-collection-zip', 'ipc/collection.js')).toBeNull();
    });
  });

  describe('validateArgs', () => {
    it('rejects non-array args', () => {
      expect(validateArgs('renderer:open-about', { not: 'an array' })).toMatch(/must be an array/);
      expect(validateArgs('renderer:open-about', 'nope')).toMatch(/must be an array/);
      expect(validateArgs('renderer:open-about', undefined)).toMatch(/must be an array/);
    });

    it('passes channels with no registered schema through unchanged, as long as args is an array', () => {
      expect(validateArgs('renderer:save-file', [])).toBeNull();
      expect(validateArgs('renderer:save-file', [{ path: '/x', content: 'y' }])).toBeNull();
    });

    it('validates renderer:clone-git-repository against its schema', () => {
      expect(validateArgs('renderer:clone-git-repository', [{ url: 'https://x', path: '/y', processUid: '1' }])).toBeNull();
      expect(validateArgs('renderer:clone-git-repository', [])).toMatch(/expects 1 argument/);
      expect(validateArgs('renderer:clone-git-repository', ['not-an-object'])).toMatch(/argument 0 must be of type object/);
    });

    it('validates renderer:connect-collection-to-git against its schema', () => {
      expect(validateArgs('renderer:connect-collection-to-git', ['/workspace', '/collection', 'https://remote'])).toBeNull();
      expect(validateArgs('renderer:connect-collection-to-git', ['/workspace', '/collection'])).toMatch(
        /expects 3 argument/
      );
      expect(validateArgs('renderer:connect-collection-to-git', ['/workspace', '/collection', 123])).toMatch(
        /argument 2 must be of type string, got number/
      );
    });

    it('validates renderer:disconnect-collection-from-git against its schema', () => {
      expect(validateArgs('renderer:disconnect-collection-from-git', ['/workspace', '/collection'])).toBeNull();
      expect(validateArgs('renderer:disconnect-collection-from-git', ['/workspace'])).toMatch(/expects 2 argument/);
    });

    it('validates terminal:create (0 or 1 optional object arg)', () => {
      expect(validateArgs('terminal:create', [])).toBeNull();
      expect(validateArgs('terminal:create', [{ cwd: '/x' }])).toBeNull();
      expect(validateArgs('terminal:create', [{}, {}])).toMatch(/expects 0-1 argument/);
      expect(validateArgs('terminal:create', ['not-an-object'])).toMatch(/argument 0 must be of type object/);
    });

    it('validates terminal:input, terminal:resize, terminal:kill, terminal:list-sessions', () => {
      expect(validateArgs('terminal:input', ['session-1', 'ls\n'])).toBeNull();
      expect(validateArgs('terminal:input', ['session-1'])).toMatch(/expects 2 argument/);

      expect(validateArgs('terminal:resize', ['session-1', { cols: 80, rows: 24 }])).toBeNull();
      expect(validateArgs('terminal:resize', ['session-1', 'not-an-object'])).toMatch(
        /argument 1 must be of type object/
      );

      expect(validateArgs('terminal:kill', ['session-1'])).toBeNull();
      expect(validateArgs('terminal:kill', [])).toMatch(/expects 1 argument/);

      expect(validateArgs('terminal:list-sessions', [])).toBeNull();
      expect(validateArgs('terminal:list-sessions', ['unexpected'])).toMatch(/expects 0 argument/);
    });

    it('validates renderer:delete-item (pathname, type, collectionPathname)', () => {
      expect(validateArgs('renderer:delete-item', ['/c/req.bru', 'http-request', '/c'])).toBeNull();
      expect(validateArgs('renderer:delete-item', ['/c/req.bru', 'http-request'])).toMatch(/expects 3 argument/);
      expect(validateArgs('renderer:delete-item', ['/c/req.bru', 123, '/c'])).toMatch(
        /argument 1 must be of type string, got number/
      );
    });

    it('validates renderer:delete-environment (collectionPathname, environmentName)', () => {
      expect(validateArgs('renderer:delete-environment', ['/c', 'Production'])).toBeNull();
      expect(validateArgs('renderer:delete-environment', ['/c'])).toMatch(/expects 2 argument/);
    });

    it('validates renderer:delete-dotenv-file (collectionPathname, optional filename)', () => {
      expect(validateArgs('renderer:delete-dotenv-file', ['/c'])).toBeNull();
      expect(validateArgs('renderer:delete-dotenv-file', ['/c', '.env.local'])).toBeNull();
      expect(validateArgs('renderer:delete-dotenv-file', [])).toMatch(/expects 1-2 argument/);
      expect(validateArgs('renderer:delete-dotenv-file', ['/c', 123])).toMatch(
        /argument 1 must be of type string, got number/
      );
    });

    it('validates renderer:delete-transient-requests (filePaths[], tempDirectory)', () => {
      expect(validateArgs('renderer:delete-transient-requests', [['/tmp/a.bru'], '/tmp/bruno-tmp'])).toBeNull();
      expect(validateArgs('renderer:delete-transient-requests', [['/tmp/a.bru']])).toMatch(/expects 2 argument/);
      expect(validateArgs('renderer:delete-transient-requests', ['/tmp/a.bru', '/tmp/bruno-tmp'])).toMatch(
        /argument 0 must be of type array, got string/
      );
    });

    it('validates renderer:remove-collection (collectionPath, collectionUid, workspacePath)', () => {
      expect(validateArgs('renderer:remove-collection', ['/c', 'uid-1', 'ws-1'])).toBeNull();
      expect(validateArgs('renderer:remove-collection', ['/c', 'uid-1'])).toMatch(/expects 3 argument/);
    });

    it('validates renderer:delete-cookies-for-domain (domain)', () => {
      expect(validateArgs('renderer:delete-cookies-for-domain', ['example.com'])).toBeNull();
      expect(validateArgs('renderer:delete-cookies-for-domain', [])).toMatch(/expects 1 argument/);
    });

    it('validates renderer:delete-cookie (domain, path, cookieKey)', () => {
      expect(validateArgs('renderer:delete-cookie', ['example.com', '/', 'session'])).toBeNull();
      expect(validateArgs('renderer:delete-cookie', ['example.com', '/'])).toMatch(/expects 3 argument/);
    });
  });
});
