/**
 * confirmation-policy.js reads BRUNO_SERVER_REQUIRE_CONFIRMATION once at
 * module-require time (same reason as ipc-limits.spec.js), so each scenario
 * re-requires the module via jest.isolateModules() instead of relying on
 * the process-wide default.
 */
const loadModule = (env) => {
  const original = process.env.BRUNO_SERVER_REQUIRE_CONFIRMATION;
  if (env.BRUNO_SERVER_REQUIRE_CONFIRMATION === undefined) {
    delete process.env.BRUNO_SERVER_REQUIRE_CONFIRMATION;
  } else {
    process.env.BRUNO_SERVER_REQUIRE_CONFIRMATION = env.BRUNO_SERVER_REQUIRE_CONFIRMATION;
  }

  let mod;
  jest.isolateModules(() => {
    mod = require('../confirmation-policy');
  });

  if (original === undefined) delete process.env.BRUNO_SERVER_REQUIRE_CONFIRMATION;
  else process.env.BRUNO_SERVER_REQUIRE_CONFIRMATION = original;

  return mod;
};

describe('confirmation-policy', () => {
  describe('when BRUNO_SERVER_REQUIRE_CONFIRMATION is unset (default)', () => {
    it('never requires confirmation, even for destructive channels', () => {
      const { needsConfirmation, CONFIRMATION_REQUIRED } = loadModule({});
      expect(CONFIRMATION_REQUIRED).toBe(false);
      expect(needsConfirmation('renderer:delete-item')).toBe(false);
      expect(needsConfirmation('renderer:remove-collection')).toBe(false);
    });
  });

  describe('when BRUNO_SERVER_REQUIRE_CONFIRMATION=true', () => {
    it('requires confirmation for every channel in CONFIRMATION_REQUIRED_CHANNELS', () => {
      const { needsConfirmation, CONFIRMATION_REQUIRED_CHANNELS } = loadModule({ BRUNO_SERVER_REQUIRE_CONFIRMATION: 'true' });
      CONFIRMATION_REQUIRED_CHANNELS.forEach((channel) => {
        expect(needsConfirmation(channel)).toBe(true);
      });
    });

    it('does not require confirmation for unrelated, non-destructive channels', () => {
      const { needsConfirmation } = loadModule({ BRUNO_SERVER_REQUIRE_CONFIRMATION: 'true' });
      expect(needsConfirmation('renderer:save-file')).toBe(false);
      expect(needsConfirmation('renderer:rename-item-name')).toBe(false);
      expect(needsConfirmation('send-http-request')).toBe(false);
    });
  });

  it('treats any value other than the literal string "true" as disabled', () => {
    const { needsConfirmation } = loadModule({ BRUNO_SERVER_REQUIRE_CONFIRMATION: '1' });
    expect(needsConfirmation('renderer:delete-item')).toBe(false);
  });

  it('exposes the exact curated set of irreversible-delete channels', () => {
    const { CONFIRMATION_REQUIRED_CHANNELS } = loadModule({});
    expect([...CONFIRMATION_REQUIRED_CHANNELS].sort()).toEqual(
      [
        'renderer:delete-cookie',
        'renderer:delete-cookies-for-domain',
        'renderer:delete-dotenv-file',
        'renderer:delete-environment',
        'renderer:delete-global-environment',
        'renderer:delete-item',
        'renderer:delete-transient-requests',
        'renderer:delete-workspace-dotenv-file',
        'renderer:delete-workspace-environment',
        'renderer:remove-collection',
        'renderer:remove-collection-from-workspace'
      ].sort()
    );
  });
});
