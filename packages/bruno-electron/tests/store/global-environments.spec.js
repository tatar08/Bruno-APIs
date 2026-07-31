const { globalEnvironmentsStore } = require('../../src/store/global-environments');
const { encryptStringSafe } = require('../../src/utils/encryption');
const { runWithSessionKey } = require('@usebruno/requests');

// Previously, a bug caused environment variables to be saved without a type.
// Since that issue is now fixed, this code ensures that anyone who imported
// data before the fix will have the missing types added retroactively.
describe('global environment variable type backward compatibility', () => {
  beforeEach(() => {
    globalEnvironmentsStore.store.clear();
  });

  it('should add type field for existing global environments without type', () => {
    // Mock global environments without type field
    const mockGlobalEnvironments = [
      {
        uid: 'yDlwWe3qgimPG20G7AbF7',
        name: 'Test Environment',
        variables: [
          {
            uid: 'b6BIHGaCrm4m97YA2dIdx',
            name: 'regular_var',
            value: 'regular_value',
            enabled: true,
            secret: false
            // Missing: type field
          },
          {
            uid: 'yQTqanPoMdRjKnHyIOZNc',
            name: 'secret_var',
            value: 'secret_value',
            enabled: true,
            secret: true
            // Missing: type field
          }
        ]
      }
    ];

    globalEnvironmentsStore.store.set('environments', mockGlobalEnvironments);

    const processedEnvironments = globalEnvironmentsStore.getGlobalEnvironments();

    expect(processedEnvironments).toHaveLength(1);
    expect(processedEnvironments[0].variables).toHaveLength(2);

    const regularVar = processedEnvironments[0].variables.find((v) => v.name === 'regular_var');
    const secretVar = processedEnvironments[0].variables.find((v) => v.name === 'secret_var');

    expect(regularVar.name).toBe('regular_var');
    expect(regularVar.type).toBe('text');

    expect(secretVar.name).toBe('secret_var');
    expect(secretVar.type).toBe('text');
  });
});

describe('global environment variable read-time dataType parsing', () => {
  beforeEach(() => {
    globalEnvironmentsStore.store.clear();
  });

  const storedAs = (dataType, value) => ({
    uid: 'yDlwWe3qgimPG20G7AbF7',
    name: 'Test Environment',
    variables: [
      {
        uid: 'b6BIHGaCrm4m97YA2dIdx',
        name: 'v',
        value,
        dataType,
        type: 'text',
        enabled: true,
        secret: false
      }
    ]
  });

  const readVar = () => globalEnvironmentsStore.getGlobalEnvironments()[0].variables[0];

  it('parses @number string values into JS numbers', () => {
    globalEnvironmentsStore.store.set('environments', [storedAs('number', '42')]);
    expect(readVar().value).toBe(42);
  });

  it('parses @boolean string values into JS booleans', () => {
    globalEnvironmentsStore.store.set('environments', [storedAs('boolean', 'false')]);
    expect(readVar().value).toBe(false);
  });

  it('parses @object string values via JSON.parse', () => {
    globalEnvironmentsStore.store.set('environments', [storedAs('object', '{"a":1}')]);
    expect(readVar().value).toEqual({ a: 1 });
  });

  it('passes string-typed values through unchanged', () => {
    globalEnvironmentsStore.store.set('environments', [storedAs('string', 'hello')]);
    expect(readVar().value).toBe('hello');
  });

  it('is idempotent — already-coerced values stay put', () => {
    globalEnvironmentsStore.store.set('environments', [storedAs('number', 42)]);
    expect(readVar().value).toBe(42);
  });

  it('parses secret variables by their dataType after decryption', () => {
    // Encrypt so the decryption round-trip yields '42', which is then coerced.
    const encrypted = encryptStringSafe('42').value;
    const env = {
      uid: 'yDlwWe3qgimPG20G7AbF7',
      name: 'Test Environment',
      variables: [
        {
          uid: 'b6BIHGaCrm4m97YA2dIdx',
          name: 'sec',
          value: encrypted,
          dataType: 'number',
          type: 'text',
          enabled: true,
          secret: true
        }
      ]
    };
    globalEnvironmentsStore.store.set('environments', [env]);
    expect(readVar().value).toBe(42);
  });
});

describe('active global environment uid — session isolation (Improvement.md P0.4)', () => {
  beforeEach(() => {
    globalEnvironmentsStore.store.clear();
  });

  it('falls back to the single legacy field when there is no session context (desktop mode)', () => {
    expect(globalEnvironmentsStore.getActiveGlobalEnvironmentUid()).toBeNull();
    globalEnvironmentsStore.setActiveGlobalEnvironmentUid('env-desktop');
    expect(globalEnvironmentsStore.getActiveGlobalEnvironmentUid()).toBe('env-desktop');
    expect(globalEnvironmentsStore.store.get('activeGlobalEnvironmentUid')).toBe('env-desktop');
  });

  it('scopes the active uid per Browser Bridge session and does not leak across sessions', () => {
    runWithSessionKey('session-A', () => {
      globalEnvironmentsStore.setActiveGlobalEnvironmentUid('env-A');
    });
    runWithSessionKey('session-B', () => {
      globalEnvironmentsStore.setActiveGlobalEnvironmentUid('env-B');
    });

    runWithSessionKey('session-A', () => {
      expect(globalEnvironmentsStore.getActiveGlobalEnvironmentUid()).toBe('env-A');
    });
    runWithSessionKey('session-B', () => {
      expect(globalEnvironmentsStore.getActiveGlobalEnvironmentUid()).toBe('env-B');
    });

    // the legacy flat field (desktop path) is untouched by session-scoped writes
    expect(globalEnvironmentsStore.store.get('activeGlobalEnvironmentUid', null)).toBeNull();
  });

  it('a new session with no prior selection sees null, not another session\'s value', () => {
    runWithSessionKey('session-A', () => {
      globalEnvironmentsStore.setActiveGlobalEnvironmentUid('env-A');
    });

    runWithSessionKey('session-C', () => {
      expect(globalEnvironmentsStore.getActiveGlobalEnvironmentUid()).toBeNull();
    });
  });

  it('deleteGlobalEnvironment only clears the calling session\'s own active selection', () => {
    globalEnvironmentsStore.addGlobalEnvironment({ uid: 'env-A', name: 'A', variables: [] });

    runWithSessionKey('session-A', () => {
      globalEnvironmentsStore.setActiveGlobalEnvironmentUid('env-A');
    });
    runWithSessionKey('session-B', () => {
      globalEnvironmentsStore.setActiveGlobalEnvironmentUid('env-A');
    });

    runWithSessionKey('session-A', () => {
      globalEnvironmentsStore.deleteGlobalEnvironment({ environmentUid: 'env-A' });
      expect(globalEnvironmentsStore.getActiveGlobalEnvironmentUid()).toBeNull();
    });
    runWithSessionKey('session-B', () => {
      expect(globalEnvironmentsStore.getActiveGlobalEnvironmentUid()).toBe('env-A');
    });
  });
});
