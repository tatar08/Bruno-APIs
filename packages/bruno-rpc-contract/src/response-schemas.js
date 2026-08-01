/**
 * Channel response-shape documentation (Improvement.md P0.5).
 *
 * Unlike REQUEST_SCHEMAS (request-schemas.js), this is documentation only —
 * there is no validateResponseShape() and nothing here is enforced at
 * runtime. Request schemas are safe to enforce because a caller sending a
 * malformed request is genuinely abnormal; a handler's *actual* return value
 * is authoritative by definition; if this file mis-recorded a shape,
 * runtime enforcement would reject a legitimate response, not catch a bug.
 * So this stays a drift-detection reference for the ~203 IPC handlers'
 * response shapes, populated incrementally (this slice covers the same 66
 * channels REQUEST_SCHEMAS already covers, since those handler bodies were
 * already located and read carefully for that work).
 *
 * Each entry is a short human-readable description of what the handler
 * literally returns, in JSDoc-ish shorthand: `undefined`, a primitive type,
 * or `{ key: type, ... }` for objects. Where a handler has more than one
 * return path (success vs. cancel vs. no-op), all paths are listed. Errors
 * are not documented here — every one of these handlers signals failure by
 * throwing/rejecting, never by returning an error-shaped value, so the
 * error channel is already covered by ERROR_CODES/createErrorEnvelope()
 * (see error-envelope.js) rather than duplicated per-channel here.
 */

const RESPONSE_SHAPES = {
  'renderer:load-runner-dataset':
    'null (dialog cancelled) | { ...parsed dataset fields, fileName: string, filePath: string }',
  'renderer:clone-git-repository': "string (literal 'Repository cloned successfully')",
  'renderer:connect-collection-to-git': 'boolean (true)',
  'renderer:disconnect-collection-from-git': 'boolean (true)',
  'terminal:create': 'string (sessionId) | null (on internal error)',
  // input/resize/kill are ipcMain.on() listeners, not .handle() — no return
  // value is ever delivered back to the caller regardless of handler body.
  'terminal:input': 'undefined (fire-and-forget event, not invokable)',
  'terminal:resize': 'undefined (fire-and-forget event, not invokable)',
  'terminal:kill': 'undefined (fire-and-forget event, not invokable)',
  'terminal:list-sessions': 'array<{ sessionId: string, cwd: string, pid: number }> ([] on internal error)',

  'renderer:delete-item': 'undefined',
  'renderer:delete-environment': 'undefined',
  'renderer:delete-dotenv-file': '{ success: boolean }',
  'renderer:delete-transient-requests':
    '{ deleted: array<string>, skipped: array<{ path: string, reason: string }>, errors: array<{ path: string, error: string }> }',
  'renderer:remove-collection': 'undefined',
  'renderer:delete-cookies-for-domain': 'undefined',
  'renderer:delete-cookie': 'undefined',

  'renderer:rename-collection': 'undefined',
  'renderer:save-file': 'undefined',
  'renderer:rename-environment': 'undefined',
  'renderer:rename-item-name': 'undefined',
  'renderer:rename-item-filename': 'string (newPath)',
  'renderer:move-item': 'undefined',
  'renderer:move-item-cross-format': '{ newPathname: string }',
  'renderer:move-file-item': 'undefined',
  'renderer:move-folder-item': 'undefined',
  'renderer:clone-folder': 'undefined',
  'renderer:import-collection': '{ success: { count: number, items: array<{ path: string, name: string }> } }',
  'renderer:export-collection-zip': '{ success: false, canceled: true } | { success: true, filePath: string }',
  'renderer:import-collection-zip': 'string (finalCollectionPath)',

  'renderer:save-folder-root': 'undefined',
  'renderer:save-collection-root': 'undefined',
  'renderer:save-request': 'undefined',
  'renderer:save-dotenv-variables': '{ success: boolean }',
  'renderer:save-dotenv-raw': '{ success: boolean }',
  'renderer:save-api-spec': 'undefined',

  'renderer:save-global-environment': 'boolean (true, workspace-scoped) | undefined (legacy global store path)',
  'renderer:save-workspace-dotenv-variables': '{ success: boolean }',
  'renderer:save-workspace-dotenv-raw': '{ success: boolean }',
  'renderer:save-openapi-spec': '{ success: boolean }',
  'renderer:save-preferences': 'undefined',
  'renderer:save-collection-security-config': 'undefined',
  'renderer:save-transient-request': '{ newPathname: string }',
  'renderer:save-multiple-requests': 'undefined',
  'renderer:save-environment': 'undefined',
  'renderer:save-scratch-request': '{ newPathname: string }',
  'renderer:save-workspace-docs': 'string (echoes the docs argument passed in)',

  'renderer:create-workspace': '{ workspaceConfig: object, workspaceUid: string, workspacePath: string }',
  'renderer:rename-workspace': '{ success: boolean }',
  'renderer:close-workspace': '{ success: boolean }',
  'renderer:export-workspace': '{ success: false, canceled: true } | { success: true, filePath: string }',
  'renderer:import-workspace':
    '{ success: boolean, workspaceConfig: object, workspaceUid: string, workspacePath: string }',
  'renderer:delete-workspace-environment': 'boolean (true)',
  'renderer:import-workspace-environment': '{ uid: string, name: string, variables: array, color: string|undefined }',
  'renderer:update-workspace-environment': 'boolean (true)',
  'renderer:rename-workspace-environment': '{ uid: string, name: string }',
  'renderer:copy-workspace-environment': '{ uid: string, name: string, variables: array, color: string|undefined }',
  'renderer:add-collection-to-workspace': 'array<{ name: string, path: string, remote: string|undefined }>',
  'renderer:remove-collection-from-workspace': 'boolean (true)',

  'renderer:create-global-environment':
    '{ uid: string, name: string, variables: array|undefined, color: string|undefined } (workspace-scoped) | { name: string, color: string|undefined } (legacy global store path)',
  'renderer:rename-global-environment': '{ uid: string, name: string } (workspace-scoped) | undefined (legacy global store path)',
  'renderer:delete-global-environment': 'undefined',
  'renderer:select-global-environment': 'undefined',
  'renderer:update-global-environment-color': 'boolean (true, workspace-scoped) | undefined (legacy global store path)',
  'renderer:create-workspace-dotenv-file': '{ success: boolean }',
  'renderer:delete-workspace-dotenv-file': '{ success: boolean }',

  'renderer:save-response-to-file':
    '{ success: true, filePath: string } | { success: false, cancelled: true }'
};

module.exports = { RESPONSE_SHAPES };
