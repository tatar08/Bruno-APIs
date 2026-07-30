/**
 * Channel → Capability taxonomy (Improvement.md P0.2, relocated here as the
 * canonical copy under P0.5 so bruno-server isn't the sole owner of a
 * contract that's really shared between the Electron and Browser surfaces).
 *
 * The channel→capability mapping is keyed off which bruno-electron ipc/*.js
 * file actually called ipcMain.handle()/on() for a given channel — captured
 * mechanically in bruno-server's HandlerRegistry via a call-stack walk (see
 * bruno-server/src/handler-registry.js#_captureSourceFile), not hand-guessed
 * from channel name prefixes. A hand-guessed list drifts silently as
 * handlers move between files; this one is verified against the live
 * registry by __tests__/capabilities.spec.js, which fails if any channel in
 * fixtures/real-channel-sources.json maps to 'unknown'.
 *
 * A small number of channels live in a file whose capability doesn't match
 * their own (e.g. the git-connect/disconnect channels are registered from
 * ipc/workspace.js, not ipc/git.js) — CHANNEL_CAPABILITY_OVERRIDES corrects
 * those specific cases.
 */

const SOURCE_TO_CAPABILITY = {
  'ipc/collection.js': 'collections',
  'ipc/workspace.js': 'workspace',
  'ipc/global-environments.js': 'environments',
  'ipc/git.js': 'git',
  'ipc/filesystem.js': 'filesystem',
  'ipc/preferences.js': 'preferences',
  'ipc/snapshot.js': 'workspace',
  'ipc/system-monitor.js': 'system',
  'ipc/notifications.js': 'notifications',
  'ipc/apiSpec.js': 'apispec',
  'ipc/openapi-sync.js': 'apispec',
  'ipc/terminal.js': 'terminal',
  'ipc/mount.js': 'workspace',
  'network/index.js': 'network',
  'network/grpc-event-handlers.js': 'network',
  'network/ws-event-handlers.js': 'network',
  'ai/index.js': 'ai',
  'ai/chat.js': 'ai',
  'ai/autocomplete.js': 'ai',
  'electron-store/index.js': 'preferences',
  'app/onboarding.js': 'workspace',
  'src/index.js': 'ui', // registered inline in bruno-server's own index.js, not bruno-electron
  inline: 'ui'
};

const CHANNEL_CAPABILITY_OVERRIDES = {
  'renderer:connect-collection-to-git': 'git',
  'renderer:disconnect-collection-from-git': 'git'
};

const ALL_CAPABILITIES = Object.freeze([
  'collections', 'workspace', 'environments', 'git', 'filesystem', 'preferences',
  'system', 'notifications', 'apispec', 'terminal', 'network', 'ai', 'ui'
]);

function getCapability(channel, sourceFile) {
  if (CHANNEL_CAPABILITY_OVERRIDES[channel]) return CHANNEL_CAPABILITY_OVERRIDES[channel];
  return SOURCE_TO_CAPABILITY[sourceFile] || 'unknown';
}

module.exports = { getCapability, ALL_CAPABILITIES, SOURCE_TO_CAPABILITY, CHANNEL_CAPABILITY_OVERRIDES };
