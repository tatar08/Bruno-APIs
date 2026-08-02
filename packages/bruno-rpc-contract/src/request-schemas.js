/**
 * Channel request-argument schemas (Improvement.md P0.2, relocated here as
 * the canonical copy under P0.5 so the schemas are shared between the
 * Electron IPC surface and the Browser Bridge instead of being owned solely
 * by bruno-server).
 *
 * This intentionally does NOT attempt argument schemas for all 203+
 * registered channels — authoring and testing that many schemas by hand in
 * one pass is far more likely to introduce false-positive 400s on real
 * handler signatures than to catch anything meaningful. REQUEST_SCHEMAS is
 * an extension point (same pattern as allowed-roots.js's
 * CHANNEL_PATH_EXTRACTORS in bruno-server) populated for the channels where
 * getting the shape wrong has outsized consequences: the already-privileged
 * git-mutate channels, the terminal channels, the destructive
 * collection-delete channels, the rename/move/save/import-export collection
 * channels, and the save-* file-overwrite channels (spanning
 * ipc/collection.js, ipc/global-environments.js, ipc/openapi-sync.js,
 * ipc/preferences.js and ipc/workspace.js), the workspace-level
 * mutation/destructive channels (ipc/workspace.js), the remaining
 * environments-capability mutation channels (ipc/global-environments.js),
 * and the one file-overwrite channel in the network capability
 * (ipc/network/index.js). Everything else is fail-open (no schema
 * registered → no additional validation beyond "args is an array").
 *
 * Only request (argument) shapes are covered here — response schemas are a
 * separate, much larger undertaking (enumerating real handler return shapes
 * across ~203 handlers) and are not part of this slice.
 */

const REQUEST_SCHEMAS = {
  // Browser clients upload dataset contents. Accepting the Electron-only
  // string-path form here would let a remote caller read arbitrary JSON/CSV
  // files from the Bridge host (B8).
  'renderer:load-runner-dataset': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:clone-git-repository': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:connect-collection-to-git': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:disconnect-collection-from-git': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'terminal:create': { minArgs: 0, maxArgs: 1, argTypes: ['object'] },
  'terminal:input': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'terminal:resize': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'object'] },
  'terminal:kill': { minArgs: 1, maxArgs: 1, argTypes: ['string'] },
  'terminal:list-sessions': { minArgs: 0, maxArgs: 0, argTypes: [] },

  // Irreversible deletion channels (ipc/collection.js) — same "outsized
  // consequences" criterion as the git/terminal schemas above. Signatures
  // verified against both the ipcMain.handle() destructuring in
  // bruno-electron/src/ipc/collection.js and the actual ipcRenderer.invoke()
  // call sites in bruno-app (ReduxStore/slices/{app,collections}/actions.js).
  'renderer:delete-item': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:delete-environment': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:delete-dotenv-file': { minArgs: 1, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:delete-transient-requests': { minArgs: 2, maxArgs: 2, argTypes: ['array', 'string'] },
  'renderer:remove-collection': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:delete-cookies-for-domain': { minArgs: 1, maxArgs: 1, argTypes: ['string'] },
  'renderer:delete-cookie': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },

  // Rename/move/save/import-export channels (ipc/collection.js) — same
  // "outsized consequences" criterion: a wrong argument shape here can
  // silently overwrite a file (save-file has no collision guard once the
  // target exists), remove a source path without checking it exists first
  // (move-item), or drop content at the wrong destination path (export/
  // import zip). Signatures re-verified directly against both the
  // ipcMain.handle() destructuring in bruno-electron/src/ipc/collection.js
  // and the real ipcRenderer.invoke() call sites in bruno-app
  // (ReduxStore/slices/{collections,workspaces}/actions.js,
  // components/ShareCollection, components/.../MigrateToYmlModal).
  // renderer:export-collection-zip's destinationPath is optional on direct
  // Electron IPC calls (defaults to null) but is always supplied when routed
  // through the Browser Bridge transport (ipc-transport.js appends it via a
  // prompt) — hence maxArgs 3 with argTypes only covering the required 2.
  'renderer:rename-collection': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:save-file': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:rename-environment': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:rename-item-name': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:rename-item-filename': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:move-item': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:move-item-cross-format': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:move-file-item': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:move-folder-item': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:clone-folder': { minArgs: 3, maxArgs: 3, argTypes: ['object', 'string', 'string'] },
  'renderer:import-collection': { minArgs: 2, maxArgs: 3, argTypes: [['object', 'array'], 'string', 'object'] },
  'renderer:export-collection-zip': { minArgs: 2, maxArgs: 3, argTypes: ['string', 'string'] },
  'renderer:import-collection-zip': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },

  // save-* siblings of renderer:save-file (ipc/collection.js, ipc/apiSpec.js)
  // — same criterion again: every one of these does an unconditional
  // writeFile() with no collision guard, so a wrong argument shape can
  // overwrite the wrong file with attacker-controlled content. Signatures
  // verified the same way as the group above (handler destructuring +
  // real ipcRenderer.invoke() call sites in bruno-app).
  'renderer:save-folder-root': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-collection-root': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'object', 'object'] },
  'renderer:save-request': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'object', 'string'] },
  'renderer:save-dotenv-variables': { minArgs: 2, maxArgs: 3, argTypes: ['string', 'array', 'string'] },
  'renderer:save-dotenv-raw': { minArgs: 2, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:save-api-spec': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },

  // Wider save-* group (ipc/global-environments.js, ipc/openapi-sync.js,
  // ipc/preferences.js, ipc/collection.js, ipc/workspace.js) — same
  // unconditional-writeFile-no-collision-guard criterion as the group
  // above, just spanning more source files. save-scratch-request has no
  // call site anywhere in bruno-app but is still schema'd since it's
  // routable directly through the bridge server regardless.
  'renderer:save-global-environment': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-workspace-dotenv-variables': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-workspace-dotenv-raw': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-openapi-spec': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-preferences': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-collection-security-config': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'object'] },
  'renderer:save-transient-request': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-multiple-requests': { minArgs: 1, maxArgs: 1, argTypes: ['array'] },
  'renderer:save-environment': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'object'] },
  'renderer:save-scratch-request': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:save-workspace-docs': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },

  // Workspace-level mutation/destructive channels (ipc/workspace.js) — the
  // workspace-scoped counterparts of the collection-level rename/move/
  // delete/import-export group above. renderer:remove-collection-from-workspace
  // is the highest-risk of this group: with options.deleteFiles true it does
  // an unconditional fsExtra.remove(collectionPath) recursive delete, so a
  // wrong argument shape (e.g. options landing in the wrong position) could
  // delete the wrong directory outright.
  'renderer:create-workspace': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:rename-workspace': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:close-workspace': { minArgs: 1, maxArgs: 1, argTypes: ['string'] },
  'renderer:export-workspace': { minArgs: 2, maxArgs: 3, argTypes: ['string', 'string'] },
  'renderer:import-workspace': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:delete-workspace-environment': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:import-workspace-environment': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'object'] },
  'renderer:update-workspace-environment': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'object'] },
  'renderer:rename-workspace-environment': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:copy-workspace-environment': { minArgs: 3, maxArgs: 3, argTypes: ['string', 'string', 'string'] },
  'renderer:add-collection-to-workspace': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'object'] },
  'renderer:remove-collection-from-workspace': { minArgs: 3, maxArgs: 4, argTypes: ['string', 'string', 'string', 'object'] },

  // Remaining environments-capability mutation channels (ipc/global-environments.js)
  // not already covered by the save-* group above. delete-global-environment and
  // delete-workspace-dotenv-file are the destructive members (data loss on a
  // wrong/missing environmentUid or filename); the rest (create/rename/select/
  // recolor) are additive or cosmetic but schema'd for consistency since they
  // share the same single-object-argument call shape. renderer:get-global-environments
  // is intentionally left unschema'd — it's read-only.
  'renderer:create-global-environment': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:rename-global-environment': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:delete-global-environment': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:select-global-environment': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:update-global-environment-color': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:create-workspace-dotenv-file': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },
  'renderer:delete-workspace-dotenv-file': { minArgs: 1, maxArgs: 1, argTypes: ['object'] },

  // network capability (ipc/network/index.js) — of the ~20 channels in this
  // file, renderer:save-response-to-file is the only one that does an
  // unconditional writeFile() (arbitrary file overwrite at `destinationPath ||
  // chooseFileToSave(...)`), matching the same criterion as the save-*
  // groups above. Everything else in network/ai (send-http-request,
  // ws/grpc connection channels, ai chat/autocomplete/api-key channels) is
  // either transient in-memory state (cancelled/cleared, not lost data) or
  // already has provider/shape guards inside the handler itself
  // (assertKnownProvider), so it doesn't meet the "outsized consequences"
  // bar — deliberately left unschema'd. destinationPath is optional on
  // direct Electron IPC (defaults to null) but always supplied through the
  // Browser Bridge transport (ipc-transport.js appends it via a prompt,
  // same pattern as export-collection-zip/export-workspace above) — hence
  // maxArgs 4 with argTypes only covering the required 3.
  'renderer:save-response-to-file': { minArgs: 3, maxArgs: 4, argTypes: ['object', 'string', 'string'] },

  // Browse modal create-folder/rename (ipc/filesystem.js, Improvement.md
  // P1.1) — the generic-filesystem counterparts of the rename/save group
  // above: a wrong argument shape here would mkdir/rename at an
  // unintended path. Both take a plain leaf name (never a path) as their
  // second argument, so allowed-roots.js's generic recursive path scanner
  // already covers containment via the first (absolute-path) argument
  // alone — the leaf name can't itself carry a traversal segment past
  // validateName()'s rejection of `/`/`\`/control characters.
  'renderer:create-directory': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] },
  'renderer:rename-directory': { minArgs: 2, maxArgs: 2, argTypes: ['string', 'string'] }
};

/**
 * Returns a human-readable validation error, or null if args are valid
 * (including the common case of no schema being registered for `channel`).
 */
function validateRequestArgs(channel, args) {
  if (!Array.isArray(args)) {
    return '"args" must be an array';
  }

  const schema = REQUEST_SCHEMAS[channel];
  if (!schema) return null;

  if (args.length < schema.minArgs || args.length > schema.maxArgs) {
    const expected = schema.minArgs === schema.maxArgs ? `${schema.minArgs}` : `${schema.minArgs}-${schema.maxArgs}`;
    return `Channel "${channel}" expects ${expected} argument(s), got ${args.length}`;
  }

  for (let i = 0; i < schema.argTypes.length; i++) {
    const expectedType = schema.argTypes[i];
    const value = args[i];
    if (value === undefined) continue; // covered by minArgs above when required

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    const allowedTypes = Array.isArray(expectedType) ? expectedType : [expectedType];
    if (!allowedTypes.includes(actualType)) {
      return `Channel "${channel}" argument ${i} must be of type ${allowedTypes.join('|')}, got ${actualType}`;
    }
  }

  return null;
}

module.exports = { REQUEST_SCHEMAS, validateRequestArgs };
