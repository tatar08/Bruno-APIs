/**
 * Confirmation Policy (Improvement.md P0.2) — requires an explicit
 * `confirm: true` flag in the request body for the handful of channels that
 * are irreversible data loss with no undo (delete an item/environment/
 * collection, wipe cookies, etc.) before ipc-proxy.js will dispatch them.
 *
 * Opt-in via BRUNO_SERVER_REQUIRE_CONFIRMATION=true, off by default — this
 * item was previously deferred as a "breaking UX change that should ask the
 * user first"; making it opt-in resolves that concern without blocking on a
 * design conversation; existing clients/tests see zero behavior change
 * unless an operator explicitly turns it on. Channel list is the same
 * "destructive collection-delete" group already called out in the P0.2
 * schema-coverage work, plus the workspace/global-environment delete
 * channels that fit the same "no undo" criteria but weren't in that
 * original list. Deliberately narrow: this is not a generic "high risk"
 * policy for every mutation (rename/move/save are all reversible via
 * version control or re-editing) — only true, unrecoverable deletes.
 *
 * This is the server-side half only. A confirm-dialog in the UI that sets
 * `confirm: true` after the user clicks through is a separate frontend
 * follow-up (same backend/UI split already used for P1.5's OAuth popup
 * work), not implemented here.
 */

const { CHANNELS } = require('@usebruno/rpc-contract');

const CONFIRMATION_REQUIRED_CHANNELS = new Set([
  CHANNELS.RENDERER_DELETE_ITEM,
  CHANNELS.RENDERER_DELETE_ENVIRONMENT,
  CHANNELS.RENDERER_DELETE_GLOBAL_ENVIRONMENT,
  CHANNELS.RENDERER_DELETE_DOTENV_FILE,
  CHANNELS.RENDERER_DELETE_WORKSPACE_DOTENV_FILE,
  CHANNELS.RENDERER_DELETE_WORKSPACE_ENVIRONMENT,
  CHANNELS.RENDERER_DELETE_TRANSIENT_REQUESTS,
  CHANNELS.RENDERER_DELETE_COOKIE,
  CHANNELS.RENDERER_DELETE_COOKIES_FOR_DOMAIN,
  CHANNELS.RENDERER_REMOVE_COLLECTION,
  CHANNELS.RENDERER_REMOVE_COLLECTION_FROM_WORKSPACE
]);

const CONFIRMATION_REQUIRED = process.env.BRUNO_SERVER_REQUIRE_CONFIRMATION === 'true';

const needsConfirmation = (channel) => CONFIRMATION_REQUIRED && CONFIRMATION_REQUIRED_CHANNELS.has(channel);

module.exports = { needsConfirmation, CONFIRMATION_REQUIRED_CHANNELS, CONFIRMATION_REQUIRED };
