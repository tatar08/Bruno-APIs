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
      expect(validateArgs('renderer:open-about', [])).toBeNull();
      expect(validateArgs('renderer:open-about', [{ path: '/x', content: 'y' }])).toBeNull();
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

    it('validates renderer:rename-collection (newName, collectionPathname)', () => {
      expect(validateArgs('renderer:rename-collection', ['New Name', '/c'])).toBeNull();
      expect(validateArgs('renderer:rename-collection', ['New Name'])).toMatch(/expects 2 argument/);
    });

    it('validates renderer:save-file (pathname, content)', () => {
      expect(validateArgs('renderer:save-file', ['/c/req.bru', 'meta { name: req }'])).toBeNull();
      expect(validateArgs('renderer:save-file', ['/c/req.bru'])).toMatch(/expects 2 argument/);
      expect(validateArgs('renderer:save-file', ['/c/req.bru', { not: 'a string' }])).toMatch(
        /argument 1 must be of type string, got object/
      );
    });

    it('validates renderer:rename-environment (collectionPathname, environmentName, newName)', () => {
      expect(validateArgs('renderer:rename-environment', ['/c', 'Old', 'New'])).toBeNull();
      expect(validateArgs('renderer:rename-environment', ['/c', 'Old'])).toMatch(/expects 3 argument/);
    });

    it('validates renderer:rename-item-name and renderer:rename-item-filename (single object arg)', () => {
      expect(validateArgs('renderer:rename-item-name', [{ itemPath: '/c/a.bru', newName: 'b', collectionPathname: '/c' }])).toBeNull();
      expect(validateArgs('renderer:rename-item-name', [])).toMatch(/expects 1 argument/);
      expect(validateArgs('renderer:rename-item-name', ['not-an-object'])).toMatch(/argument 0 must be of type object/);

      expect(
        validateArgs('renderer:rename-item-filename', [
          { oldPath: '/c/a.bru', newPath: '/c/b.bru', newName: 'b', newFilename: 'b.bru', collectionPathname: '/c' }
        ])
      ).toBeNull();
      expect(validateArgs('renderer:rename-item-filename', ['not-an-object'])).toMatch(/argument 0 must be of type object/);
    });

    it('validates renderer:move-item and renderer:move-item-cross-format (single object arg)', () => {
      expect(validateArgs('renderer:move-item', [{ targetDirname: '/c/dst', sourcePathname: '/c/src' }])).toBeNull();
      expect(validateArgs('renderer:move-item', ['not-an-object'])).toMatch(/argument 0 must be of type object/);

      expect(
        validateArgs('renderer:move-item-cross-format', [
          { targetDirname: '/c/dst', sourcePathname: '/c/src', sourceFormat: 'bru', targetFormat: 'yml' }
        ])
      ).toBeNull();
      expect(validateArgs('renderer:move-item-cross-format', [])).toMatch(/expects 1 argument/);
    });

    it('validates renderer:move-file-item and renderer:move-folder-item (itemPath/folderPath, destinationPath)', () => {
      expect(validateArgs('renderer:move-file-item', ['/c/a.bru', '/c/dst/a.bru'])).toBeNull();
      expect(validateArgs('renderer:move-file-item', ['/c/a.bru'])).toMatch(/expects 2 argument/);

      expect(validateArgs('renderer:move-folder-item', ['/c/folder', '/c/dst/folder'])).toBeNull();
      expect(validateArgs('renderer:move-folder-item', ['/c/folder'])).toMatch(/expects 2 argument/);
    });

    it('validates renderer:clone-folder (itemFolder object, collectionPath, collectionPathname)', () => {
      expect(validateArgs('renderer:clone-folder', [{ items: [] }, '/c/new-folder', '/c'])).toBeNull();
      expect(validateArgs('renderer:clone-folder', ['not-an-object', '/c/new-folder', '/c'])).toMatch(
        /argument 0 must be of type object, got string/
      );
      expect(validateArgs('renderer:clone-folder', [{ items: [] }, '/c/new-folder'])).toMatch(/expects 3 argument/);
    });

    it('validates renderer:import-collection (collection object|array, collectionLocation, optional options)', () => {
      expect(validateArgs('renderer:import-collection', [{ name: 'c' }, '/dest'])).toBeNull();
      expect(validateArgs('renderer:import-collection', [[{ name: 'c1' }, { name: 'c2' }], '/dest'])).toBeNull();
      expect(validateArgs('renderer:import-collection', [{ name: 'c' }, '/dest', { format: 'yml' }])).toBeNull();
      expect(validateArgs('renderer:import-collection', ['not-object-or-array', '/dest'])).toMatch(
        /argument 0 must be of type object\|array, got string/
      );
      expect(validateArgs('renderer:import-collection', [{ name: 'c' }])).toMatch(/expects 2-3 argument/);
    });

    it('validates renderer:export-collection-zip (collectionPath, collectionName, optional destinationPath)', () => {
      expect(validateArgs('renderer:export-collection-zip', ['/c', 'My Collection'])).toBeNull();
      expect(validateArgs('renderer:export-collection-zip', ['/c', 'My Collection', '/tmp/out.zip'])).toBeNull();
      expect(validateArgs('renderer:export-collection-zip', ['/c'])).toMatch(/expects 2-3 argument/);
    });

    it('validates renderer:import-collection-zip (zipFilePath, collectionLocation)', () => {
      expect(validateArgs('renderer:import-collection-zip', ['/tmp/in.zip', '/dest'])).toBeNull();
      expect(validateArgs('renderer:import-collection-zip', ['/tmp/in.zip'])).toMatch(/expects 2 argument/);
    });
  });
});
