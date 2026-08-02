/**
 * WebSocket/IPC event-shape documentation (Improvement.md P0.5 "event schemas").
 *
 * Distinct from REQUEST_SCHEMAS/RESPONSE_SHAPES: those document the
 * request/response `ipcMain.handle()`/`POST /api/ipc/:channel` surface.
 * This file documents the *other* half of the IPC surface — one-way,
 * server-initiated events pushed to the renderer via
 * `webContents.send(channel, ...args)` (Electron) or, in Browser/Bridge
 * mode, the equivalent `EventBridge.broadcast()`/`sendToSession()` WS push
 * (see bruno-server/src/adapters/window-shim.js and
 * bruno-server/src/ws/event-bridge.js) — subscribed to on the client via
 * `transport.on(channel, handler)` in bruno-app/src/utils/common/ipc-transport.js.
 *
 * Like RESPONSE_SHAPES, this is documentation only — no runtime enforcement,
 * for the same reason (the emitter's actual payload is authoritative; a
 * mis-recorded shape here would just be stale docs, not something worth
 * rejecting at runtime).
 *
 * Coverage and a key difference from RESPONSE_SHAPES: request/response
 * channels are registered through one central API (`ipcMain.handle`),
 * which is how `fixtures/real-channel-sources.json` mechanically dumps
 * every real channel for the drift-detection test both REQUEST_SCHEMAS and
 * RESPONSE_SHAPES rely on. Events have no equivalent single registration
 * point — they're plain `.send()` calls scattered across bruno-electron and
 * bruno-requests — so there is no automated "is this event name still
 * real" parity fixture yet; building a static extractor for that is future
 * work (comparable in spirit to REQUEST_SCHEMAS' extension to the
 * remaining channels, or RESPONSE_SHAPES' remaining ~137 channels). This
 * slice was populated by manually grepping every `.send(`-style call site
 * across bruno-electron and bruno-requests as of this writing (~79 distinct
 * event names/patterns) — verified against real call sites, not a fixture.
 *
 * EventBridge forwards the emitter's variadic args as an array
 * (`webContents.send(channel, a, b, c)` -> `data: [a, b, c]` over the wire,
 * redelivered to the client handler as `handler(a, b, c)`), so unlike
 * RESPONSE_SHAPES (mostly single return values), many entries below
 * document a positional tuple rather than one object.
 *
 * Two client-side listeners exist with **no live emitter found anywhere**
 * in bruno-electron/bruno-requests as of this writing — `main:process-env-update`
 * and `main:workspace-dotenv-update` (subscribed to in
 * bruno-app/src/hooks/useIpcEvents.js) — deliberately left out of the table
 * below rather than documented with a fabricated shape; noted here so a
 * future reader searching for either name isn't left wondering if it was
 * simply missed.
 */

const EVENT_SHAPES = {
  // -- App/window lifecycle (bruno-electron/src/index.js) --
  'main:load-preferences': '(preferences: object)',
  'main:window-maximized': '() (no payload)',
  'main:window-unmaximized': '() (no payload)',
  'main:enter-full-screen': '() (no payload)',
  'main:leave-full-screen': '() (no payload)',
  'main:start-quit-flow': '() (no payload)',
  'main:cookies-update': '(cookies: array<{ domain: string, cookies: array }>)',
  'main:app-loaded': '({ isRunningInRosetta: boolean })',

  // -- Preferences/notifications (ipc/preferences.js, ipc/notifications.js) --
  'main:load-global-environments': '({ globalEnvironments: array, activeGlobalEnvironmentUid: string })',
  'main:git-version': '(version: string)',
  'main:open-preferences': '() (no payload)',
  'main:load-notifications': '(notifications: array)',

  // -- Collections (ipc/collection.js) --
  'main:collection-opened': '(dirPath: string, uid: string, brunoConfig: object)',
  'main:collection-renamed': '({ collectionPathname: string, newName: string })',
  'main:collection-import-started': '(uid: string)',
  'main:collection-import-ended': '(uid: string)',
  'main:collection-import-failed': '(uid: string, { message: string })',
  'main:all-collections-import-ended':
    '({ message: string, status: { total: number, succeeded: number, failed: number } })',
  'main:collection-tree-updated':
    "(eventType: 'addFile'|'addDir'|'change'|'unlink'|'unlinkDir'|'addEnvironmentFile'|'unlinkEnvironmentFile', fileOrDir: object)",
  // Inconsistent across call sites — some send { message }, some send a raw string.
  'main:display-error': '({ message: string }) | (message: string)',

  // -- Collection watcher (app/collection-watcher.js) --
  'main:bruno-config-update': '({ collectionUid: string, brunoConfig: object })',
  'main:collection-loading-state-updated': '({ collectionUid: string, isLoading: boolean })',
  'main:hydrate-app-with-ui-state-snapshot':
    'null | { pathname: string, workspacePathname: string, environmentPath: string, selectedEnvironment: object }',

  // -- Mount v2 (ipc/mount.js) --
  'main:collection-tree-loaded': '({ collectionUid: string, tree: object })',
  'main:collection-loading-state-updated-v2': '({ collectionUid: string, isLoading: boolean })',
  'main:bruno-config-update-v2': '({ collectionUid: string, brunoConfig: object })',

  // -- Workspace (ipc/workspace.js, app/workspace-watcher.js, app/apiSpecs.js) --
  'main:workspace-opened': '(dirPath: string, workspaceUid: string, configForClient: object)',
  'main:workspace-config-updated': '(workspacePath: string, workspaceUid: string, configForClient: object)',
  'main:workspaces-ready': '() (no payload)',
  'main:workspace-environment-added': '(workspaceUid: string, file: object)',
  'main:workspace-environment-changed': '(workspaceUid: string, file: object)',
  'main:workspace-environment-deleted': '(workspaceUid: string, environmentUid: string)',

  // -- API specs (app/apiSpecsWatcher.js, app/apiSpecs.js) --
  'main:apispec-tree-updated':
    "(eventType: 'addFile'|'changeFile', file: { pathname: string, uid: string, raw: string, name: string, filename: string, json: object })",

  // -- Dotenv (app/dotenv-watcher.js) --
  'main:dotenv-file-update':
    '({ type: string, uid?: string, filename: string, variables: array, exists: boolean, processEnvVariables: object, path?: string })',

  // -- System monitor (app/system-monitor.js) --
  'main:filesync-system-resources': '(systemResources: object)',

  // -- AI chat (ipc/ai/chat.js, ipc/ai/index.js) --
  'main:ai-chat-error': '({ requestId: string, error: string })',
  'main:ai-chat-complete': '({ requestId: string, message: string, code?: string, contentType?: string, writes?: array })',
  'main:ai-chat-chunk': '({ requestId: string, chunk: string, fullText: string })',
  'main:ai-chat-tool-activity': '({ requestId: string, toolName: string, toolArgs: object, label: string })',
  'main:ai-chat-tool-done': '({ requestId: string, toolName: string })',
  'main:ai-chat-stopped': '({ requestId: string, message: string })',
  'main:ai-status-changed': '(status: object) (opaque status payload)',
  'main:ai-stream-chunk': '({ streamId: string, chunk: string })',
  'main:ai-stream-stopped': '({ streamId: string })',
  'main:ai-stream-complete': '({ streamId: string, fullText: string })',
  'main:ai-stream-error': '({ streamId: string, error: string })',

  // -- Network / request runner (ipc/network/index.js) --
  'main:console-log': '({ type: string, args: array })',
  // Polymorphic by `type` — fired from ~20+ call sites across a single
  // request run's lifecycle (request-queued, request-sent, response-received,
  // script/test events, error, etc.); always carries at least
  // { type: string, collectionUid: string, itemUid: string, requestUid: string, ... }
  // with additional fields specific to `type`. Cataloguing every sub-shape
  // is out of scope for this pass — see call sites in ipc/network/index.js
  // if a specific `type`'s exact fields are needed.
  'main:run-request-event': "({ type: string, collectionUid: string, itemUid: string, requestUid: string, ... } — polymorphic by 'type')",
  'main:run-folder-event': "({ type: string, collectionUid: string, itemUid: string, requestUid: string, ... } — polymorphic by 'type', folder-run-scoped variant of main:run-request-event)",
  'main:runtime-variables-update': '({ runtimeVariables: object, requestUid: string, collectionUid: string })',
  'main:script-environment-update': '({ envVariables: object, requestUid: string, collectionUid: string })',
  'main:global-environment-variables-update': '({ globalEnvironmentVariables: object, requestUid: string, collectionUid: string })',
  'main:collection-variables-update': '({ collectionVariables: object, requestUid: string, collectionUid: string })',
  'main:credentials-clear': '({ collectionUid: string, credentialsId: string })',
  'main:credentials-update':
    '({ credentials: object, url: string, collectionUid: string, credentialsId: string, folderUid?: string, itemUid?: string, debugInfo?: object, executionMode?: string })',
  'main:http-stream-new-data': '({ collectionUid: string, itemUid: string, seq: number, timestamp: number, data: any })',
  'main:http-stream-end': '({ collectionUid: string, itemUid: string, seq: number, timestamp: number })',

  // -- Git (utils/git.js) --
  'main:update-git-operation-progress': '({ uid: string (processUid), data: string })',

  // -- OAuth2 (ipc/network/authorize-user-in-system-browser.js) --
  'oauth2:authorization-required': '({ authorizeUrl: string, expectedState: string })',

  // -- WebSocket requests (bruno-requests/src/ws/ws-client.js via ipc/network/ws-event-handlers.js) --
  'main:ws:connecting': '(requestId: string, collectionUid: string)',
  'main:ws:open': '(requestId: string, collectionUid: string, { timestamp: number, url: string, seq: number })',
  'main:ws:redirect': '(requestId: string, collectionUid: string, { message: string, type: string, timestamp: number, headers: object, seq: number })',
  'main:ws:upgrade': '(requestId: string, collectionUid: string, { type: string, timestamp: number, seq: number, headers: object })',
  'main:ws:message': "(requestId: string, collectionUid: string, { message: any, messageHexdump: string, type: 'incoming'|'outgoing', seq: number, timestamp: number })",
  'main:ws:close': '(requestId: string, collectionUid: string, { code: number, reason: string, seq: number, timestamp: number })',
  'main:ws:error': '(requestId: string, collectionUid: string, { error: string, seq?: number, timestamp?: number })',
  'main:ws:connections-changed': "({ type: 'added'|'removed'|'cleared', requestId?: string, seq?: number, activeConnectionIds: array<string> })",
  'main:ws:request': '(requestId: string, collectionUid: string, requestSent: object)',

  // -- gRPC (bruno-requests/src/grpc/grpc-client.js via ipc/network/grpc-event-handlers.js) --
  'grpc:request': '(requestId: string, collectionUid: string, requestSent: object)',
  'grpc:response': '(requestId: string, collectionUid: string, { error: string|null, res: object|null })',
  'grpc:status': '(requestId: string, collectionUid: string, { status: object (metadata), res: object|null })',
  'grpc:error': '(requestId: string, collectionUid: string, { error: string })',
  'grpc:metadata': '(requestId: string, collectionUid: string, { metadata: object })',
  'grpc:server-end-stream': '(requestId: string, collectionUid: string, { res: object })',
  'grpc:server-cancel-stream': '(requestId: string, collectionUid: string, { res: object })',
  "grpc:connections-changed": "({ activeConnectionIds: array<string> }) | ({ type: 'cleared', activeConnectionIds: [] })",
  'grpc:message': '(requestId: string, collectionUid: string, message: object)',

  // -- Terminal (ipc/terminal.js) --
  // Dynamic per-session channel names, not literal channels — the key below
  // documents the template pattern, not a real static channel string.
  'terminal:data:<sessionId>': '(chunk: string) (raw PTY output)',
  'terminal:exit:<sessionId>': '({ exitCode: number, signal: string|null })'
};

module.exports = { EVENT_SHAPES };
