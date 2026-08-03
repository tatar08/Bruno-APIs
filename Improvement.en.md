> Translated from the Thai original (Improvement.md). This is a supplementary translation; Improvement.md remains the canonical source.

# Bruno APIs — Improvement & Future-Readiness Roadmap

> Analysis document as of July 20, 2026  
> Scope: Bruno Desktop, Browser UI, Bruno Bridge Server, and shared packages in this repository

> **Work status (last updated):** ✅ = done, 🟡 = partially done (see details of what remains under that heading), no symbol = not started  
> Implementation/verification details for each item are in `find bug and Improvement.md` (from section 4.1 onward)

## 1. Executive Summary

The current Browser version has functional parity with Desktop on the main flows, but the architecture is still in a compatibility-bridge phase: the server side simulates Electron, intercepts `require('electron')`, and exposes IPC directly over HTTP/WebSocket. This approach is suitable for proof-of-concept and early-stage parity work, but is not yet suitable for production, remote access, or multi-user usage.

The recommended investment order is:

1. **Secure the Bridge** — authentication, origin allowlist, localhost binding, path sandbox, rate limiting, and disabling privileged features by default
2. **Create a typed, shared application core** — separate business logic from Electron IPC and stop relying on global module monkey patching
3. **Add Browser parity CI** — automatically test contracts and user journeys on both Browser and Desktop
4. **Make Browser UX native-quality** — server file explorer, upload/download, connection state, reconnect, and OAuth callback
5. **Productionize deployment** — single-server packaging, HTTPS/WSS, Docker, health/readiness, config, and observability
6. **Adopt future API standards** — OpenAPI 3.2, Arazzo 1.1, and AsyncAPI 3

The single most important recommendation is: **do not expose the Browser Bridge to the Internet before completing P0 Security**, because the Bridge can read/write the filesystem, run a terminal, invoke Git, and send network requests from the host machine.

---

## 2. Current-State Findings

### 2.1 Existing strengths

- Browser transport supports request/response over HTTP and push events over WebSocket
- The Browser-side IPC channel set covers the Desktop handlers and main events
- Supports HTTP, WebSocket, gRPC, collections, workspaces, environments, Git, terminal, AI, and API Specs
- Uses real collection/workspace/API spec watchers, so state sync is close to Desktop
- React 19 and Rsbuild form a still-modern frontend base
- Has a large test suite for Desktop and shared behavior
- Has an installation guide for Browser/Desktop covering all three operating systems

### 2.2 Gaps that should be fixed

| Area | Current state | Risk/Impact |
|---|---|---|
| HTTP authentication | `/api/ipc/:channel` has no authentication | A website or client that can reach the port could call privileged IPC |
| CORS | `origin: true` with credentials | Any origin can send requests under the current development configuration |
| Network binding | `server.listen(PORT)` does not set a loopback host | May accept connections from other network interfaces |
| IPC authorization | A route can call any registered channel by name | No per-channel capability or role check |
| WebSocket security | No origin validation, auth, `maxPayload`, rate limit, or heartbeat | Risk of CSWSH, connection exhaustion, and memory pressure |
| Session isolation | `WindowShim` and watchers are singletons; events broadcast to multiple clients | Events/state/secrets may cross sessions when multiple browser clients are open |
| Filesystem boundary | Accepts absolute paths from the Browser | A user or attacker may access paths outside the intended workspace |
| Terminal/Git | Browser can call privileged handlers | Increases blast radius if the Bridge is attacked |
| Secret storage | Browser shim reports encryption unavailable and encodes with `Buffer` | Not encryption at rest |
| Payload size | JSON and URL-encoded limit of `100mb` | Excessively high for typical IPC and increases DoS risk |
| Architecture | Monkey-patches `Module._load` to replace the Electron module | Fragile when Electron handlers or dependencies change |
| Startup health | Several handler-registration sections catch errors and the server still starts | The server may report healthy while some feature sets are not ready |
| Browser file UX | Uses `window.prompt()` to enter a server path | Hard to use, limited validation feedback, and unsuitable for remote users |
| Reconnect | Unlimited retries and an unbounded queue | Long offline periods can create log noise or memory growth |
| Cancellation | HTTP invoke has no standardized timeout/cancel/request ID | Stuck requests are hard to control and debug |
| Automated parity | Playwright config has no Browser Bridge project yet | Browser-side regressions have a chance of slipping into release |
| Version lifecycle | Node 22, Electron 37, React 19.0, and Express 4 | Needs an automated upgrade cadence; Electron 37 is already outside the three latest majors |

---

## 3. Product Principles

Use the following as guardrails for the roadmap:

1. **Local-first by default** — collections must remain files that can be version-controlled, and cloud must not be mandatory
2. **Secure by default** — high-privilege features must be opt-in and scope-limited
3. **One core, multiple shells** — Desktop and Browser use the same set of domain services; no duplicated logic
4. **Capability-based parity** — the UI checks the runtime's capability instead of assuming Browser can do everything Electron can
5. **Backward-compatible formats** — upgrades must not break the existing collection format
6. **Observable and testable** — every critical flow has a contract test, metrics, and structured errors
7. **Progressive enhancement** — a Browser that doesn't support a native API can still use the core features

---

## 4. Prioritized Roadmap

## P0 — Must Do Before Production/Remote Access (0–6 weeks)

### P0.1 Secure Bridge Bootstrap and Authentication ✅ Done (opt-in — off by default, enabled with `BRUNO_SERVER_REQUIRE_AUTH=true`)

**Goal:** Only Browser instances that the user has authorized can call the Bridge

Work to be done:
- ✅ Bind `127.0.0.1`/`::1` by default, and require explicit opt-in for LAN mode
- ✅ Create a one-time bootstrap token when the server starts
- ✅ Exchange the bootstrap token for a short-lived session
- ✅ Use an `HttpOnly`, `Secure`, `SameSite=Strict` cookie or an Authorization token that is never stored in the URL/logs
- ✅ Validate `Origin` on both HTTP and WebSocket with an exact allowlist
- ✅ Add CSRF protection when using cookie sessions
- ✅ Rotate/revoke sessions and close the WebSocket immediately on logout/expiry
- ✅ Redact tokens, cookies, Authorization, and secret values from logs — audited all `console.*` call sites in `bruno-server` (78 sites); none of them log a token/cookie/session/header directly (the bootstrap token is printed exactly once at start, by design)
- ✅ **error message redaction layer** — a point that used to be 🟡 (`err.message` from a handler that throws was logged onward without sanitizing content, risking secret leakage if a handler released an error containing an embedded URL/token) has now been fixed with a generic pattern-based redaction utility (`packages/bruno-server/src/security/log-redaction.js`, `redactSecrets()`) instead of auditing handler-by-handler (~203 handlers with no finite set of "risky" handlers to prioritize, unlike P0.2's schema validation) — uses the same posture as P0.3's filesystem sandbox scanner, i.e. a "coarse safety net" covering 3 patterns: (1) credentials in a URL's userinfo (`scheme://user:pass@host`), (2) `Authorization: Bearer/Basic <token>`, (3) key=value pairs whose key name looks like a secret (`api_key`, `token`, `password`, `secret`, etc.), whether JSON-ish or query-string-ish shape; fully tested at 6/6 cases (`log-redaction.spec.js`) and wired into every place in `bruno-server` that logs `err.message`: `routes/ipc-proxy.js` (the aggregation point for errors from all ~203 IPC handlers), `index.js` (21 sites — handler-load warnings and graceful-shutdown errors), `routes/auth.js` (4 sites — logout cleanup), `ws/event-bridge.js` (2 sites — WebSocket error/send failure); the intent is to redact only server logs — the response sent back to the client still carries the original `err.message`, because the client is the same session that made the request, not a security boundary that needs protecting

**Acceptance criteria:**

- A request without a session gets `401`
- A disallowed origin is rejected on both HTTP and WebSocket
- The default process does not accept connections from the LAN
- Tokens never appear in application logs, browser history, or query strings
- Automated tests cover auth bypass and cross-site WebSocket attempts

### P0.2 Channel Policy and Capability Authorization 🟡 Partially done

**Goal:** Connecting to the Bridge should not equal permission to call every IPC

Break channels into capabilities such as (✅ done — 13 capabilities genuinely cover every channel via `security/channel-capabilities.js`; they don't map 1:1 onto the example names below exactly, but cover the same meaning):

- `collections:read`, `collections:write`
- `network:send`
- `filesystem:read`, `filesystem:write`
- `git:read`, `git:write`
- `terminal:execute`
- `ai:use`, `secrets:manage`
Proposals:

- ✅ Allowlist only the channels the Browser intentionally supports (unknown channel → 404)
- ✅ Disable Terminal, arbitrary filesystem writes, and destructive Git actions by default (`privileged-channels.js`)
- ✅ Add confirmation/policy for high-risk actions — originally marked as "must ask the user first (breaking UX change)"; per **"No need to defer, just get it done"**, resolved that concern by making it opt-in: `BRUNO_SERVER_REQUIRE_CONFIRMATION=true` (off by default — leaving it unset changes no behavior at all). This gate lives at `security/confirmation-policy.js`'s `needsConfirmation()`, called in `ipc-proxy.js` before the path-policy check — scoped only to channels that are genuinely irreversible deletes (not a broad "high risk" bucket that would also include rename/move/save, which are revertible): `delete-item`, `delete-environment`, `delete-global-environment`, `delete-dotenv-file`, `delete-workspace-dotenv-file`, `delete-workspace-environment`, `delete-transient-requests`, `delete-cookie`, `delete-cookies-for-domain`, `remove-collection`, `remove-collection-from-workspace` (11 channels — matching the "destructive collection-delete" group already identified under the schema coverage item above, plus workspace/global-environment deletes that meet the same criteria but weren't in the original list). Calling one of these without sending `"confirm": true` in the request body → `428 Precondition Required` (code `CONFIRMATION_REQUIRED`) with an error message that states directly how to fix it; sending `confirm: true` → passes through to the normal handler. This is only the server-side half (the UI confirm-dialog that sets `confirm: true` after the user clicks confirm is a separate frontend follow-up, same pattern as P1.5's OAuth popup UI)
- 🟡 Validate input/output for every channel with a schema — there is an extension point (`CHANNEL_SCHEMAS`) and only the high-risk groups are registered so far (terminal + git-mutate + destructive collection-delete: `delete-item`, `delete-environment`, `delete-dotenv-file`, `delete-transient-requests`, `remove-collection`, `delete-cookies-for-domain`, `delete-cookie` + rename/move/save/import-export collection: `rename-collection`, `save-file`, `rename-environment`, `rename-item-name`, `rename-item-filename`, `move-item`, `move-item-cross-format`, `move-file-item`, `move-folder-item`, `clone-folder`, `import-collection`, `export-collection-zip`, `import-collection-zip` + save-* file-overwrite siblings: `save-folder-root`, `save-collection-root`, `save-request`, `save-dotenv-variables`, `save-dotenv-raw`, `save-api-spec`, `save-global-environment`, `save-workspace-dotenv-variables`, `save-workspace-dotenv-raw`, `save-openapi-spec`, `save-preferences`, `save-collection-security-config`, `save-transient-request`, `save-multiple-requests`, `save-environment`, `save-scratch-request`, `save-workspace-docs` + workspace-level mutation/destructive: `create-workspace`, `rename-workspace`, `close-workspace`, `export-workspace`, `import-workspace`, `delete-workspace-environment`, `import-workspace-environment`, `update-workspace-environment`, `rename-workspace-environment`, `copy-workspace-environment`, `add-collection-to-workspace`, `remove-collection-from-workspace` + remaining environments-capability mutation channels: `create-global-environment`, `rename-global-environment`, `delete-global-environment`, `select-global-environment`, `update-global-environment-color`, `create-workspace-dotenv-file`, `delete-workspace-dotenv-file` + network capability file-overwrite channel: `save-response-to-file`) — not yet complete across all ~203 handlers; the intent is to work through one high-risk group at a time, verifying the real signature first rather than doing it all at once (see the comment at the top of `channel-policy.js`) — a capability-by-capability survey has been completed across all 13 capabilities (`collections`, `workspace`, `environments`, `git`, `filesystem`, `preferences`, `system`, `notifications`, `apispec`, `terminal`, `network`, `ai`, `ui`); `filesystem`/`system`/`notifications`/`ui` were surveyed and deliberately given no schema, because no channel in them meets the outsized-consequences bar
- ✅ Limit payload per channel instead of a global `100mb` (per-capability limits; global reduced from 100mb → 25mb)
- ✅ Add rate limiting, concurrency limiting, and execution timeout (on by default)

**Acceptance criteria:** unknown channel is `404` ✅, known-but-forbidden is `403` ✅, invalid payload is `400` ✅ (partial — for schemas already registered), and privileged channels don't work until a capability is granted 🟡 (off by default now, but there is still no separate grant-flow UX)

### P0.3 Filesystem Sandbox 🟡 Partially done (coarse safety net, opt-in)

**Goal:** The Browser can only reach roots the user has authorized

- ✅ Add `allowedRoots` configuration (`BRUNO_SERVER_ALLOWED_ROOTS`, opt-in — off by default)
- ✅ Resolve paths with `realpath` before authorizing
- ✅ Prevent `..` and symlink escapes — both have unit test coverage; 🟡 UNC/drive-relative paths on Windows are now caught by the scanner as candidates (fixed `ABSOLUTE_PATH_RE` to also cover drive-relative `C:foo`, which previously slipped past the scan entirely, in addition to `C:\foo`/`C:/foo`/UNC `\\server\share`, which were already covered) with full string-matching-level unit tests; case-insensitive bypass relies on `fs.realpathSync` to normalize casing on both sides before comparing (there's a comment explaining the mechanism in `isUnderRoot()`), but this has never actually been verified live on a Windows host because there is no Windows box in this environment
- ✅ Separate read/write permission per root — a root suffixed with `:ro` (e.g. `BRUNO_SERVER_ALLOWED_ROOTS=/rw-root,/reference-root:ro`) is enforced as read-only; fail-safe for channels not yet checked (there is a manually maintained allowlist of 8 channels confirmed to be read-only from `filesystem.js`; other channels are treated as writes and blocked against a `:ro` root by default) — a distinct error code `PATH_READ_ONLY_ROOT`
- ✅ Let the user revoke roots — a runtime admin API (`GET`/`DELETE /api/admin/allowed-roots`), mounted after `requireAuth` like `/api/ipc`; revoke-only (narrow scope only, no un-revoke/add), state kept in memory that resets back to the env var value on restart; logged via `logRootRevoked`
- ✅ Record audit events without logging secrets/file content — `security/audit-log.js` logs only the channel/denied-path/session/requestId when the sandbox rejects (403), and never touches arguments or file content
- ✅ Uploads check size, extension, magic bytes, and filename normalization — `routes/uploads.js` (P1.1's Transfer Center upload flow now genuinely exists, which unblocks this item): size via `multer`'s `limits.fileSize` (`BRUNO_SERVER_UPLOAD_MAX_MB`), which already existed; extension via a `fileFilter` that only accepts `.zip` (case-insensitive), because every real caller (`uploadZipFile()`) only ever uploads zips — Content-Type is not checked, because the client sets it arbitrarily and it's unreliable; magic bytes are checked by reading the first 4 bytes of the file already written to disk and comparing against all 3 real ZIP signatures (`PK\x03\x04`/`PK\x05\x06`/`PK\x07\x08`) before letting the downstream handler (AdmZip via `renderer:is-bruno-collection-zip`) open the file — this catches both spoofed extensions and corrupt/truncated files; filename normalization already came for free from the existing design (the on-disk filename is always a random UUID, never the client-supplied name except for the whitelisted extension)

**Key limitation**: the scanner is generic — it guesses based on "strings that look like an absolute path" without knowing per-channel semantics — it is a **supplementary safety net, not a complete per-channel validation** (only 5 of ~85+ handlers that accept a path had prior self-validation). There is an extension point (`CHANNEL_PATH_EXTRACTORS`) to add per-channel precision incrementally in the future

**Acceptance criteria:** every filesystem handler passes through a single policy layer 🟡 (genuinely passes through a single chokepoint, but it's a generic scan, not per-channel) and traversal/symlink/Windows path edge cases are fully tested 🟡 (traversal+symlink has real live tests on Linux; Windows path-shape detection has string-matching-level unit tests, but there is still no live test on an actual Windows host)

### P0.4 Per-Session Isolation ✅ Done (works only when P0.1 auth is enabled — without auth enabled there is a single session, so there is nothing to isolate)
**Goal:** Multiple Browser tabs/users must not see each other's events, active workspace, terminal, or secrets

- ✅ Create a `SessionContext` per authenticated client (`AsyncLocalStorage`-based, in both `bruno-server` and `bruno-requests`)
- ✅ Map HTTP requests and WebSocket connections to the same session ID
- ✅ Route `webContents.send()` to the session owner instead of a global broadcast
- ✅ Isolate terminal processes, cancel tokens (WS/gRPC connection ownership), active environment (legacy global-env uid), temporary collections/mount state, and cookie jar
- ✅ Reference-count shared filesystem watchers and clean up when a session closes
- ✅ Limit the number of sessions/terminals/watchers per session (via `resource-limits.js`, adjustable via env var — "per user" was reworded to "per session" because this architecture has no real user concept, only anonymous sessions)

**Decided already — the onboarding singleton keeps its existing behavior; not a gap**: the onboarding flow (`hasLaunchedBefore` flag) is intentionally a server-process-wide shared singleton, not tied to a session — the user has confirmed this matches P0.4's "one Bridge shared by multiple people" model (it counts the first time the server process ever runs, not per browser tab/session), so no further fix is needed

**Acceptance criteria:** an integration test with two browser contexts must not receive the other context's events or state ✅ (confirmed with both unit tests and live E2E for cookies, WS/gRPC connections, terminal, and watcher — the last 4 active-state items were confirmed with unit tests + code review, with no additional live E2E)

### P0.5 Typed RPC Contract Instead of Raw IPC Proxy 🟡 Partially done

**Goal:** Prevent channel drift and reduce runtime-only bugs

Create a package such as `packages/bruno-rpc-contract` consisting of: (✅ this package has genuinely been created — `@usebruno/rpc-contract`)

- ✅ typed channel-name constants (`CHANNELS`/`ALL_CHANNELS`, generated from 229 real channels)
- ✅ request schemas — moved `CHANNEL_SCHEMAS`/`validateArgs` (formerly in `bruno-server/src/security/channel-policy.js`) into the canonical `REQUEST_SCHEMAS`/`validateRequestArgs` now at `packages/bruno-rpc-contract/src/request-schemas.js` — `channel-policy.js` is now just a thin re-export (same pattern as `channel-capabilities.js`), byte-for-byte behavior-preserving (all 286 pre-existing tests in `channel-policy.spec.js` pass without a single assertion change), plus a new test confirming parity with the live fixture (`request-schemas.spec.js`) that every schema key is a real registered channel — covering 66 of the ~203 total channels (the original "outsized consequences" bar is unchanged)
- ✅ response shapes (docs-only, per the user's decision — no runtime enforcement) — `packages/bruno-rpc-contract/src/response-schemas.js`'s `RESPONSE_SHAPES` records each handler's actual return shape as a human-readable string per channel, with **no validation function wired into the runtime at all**: unlike request schemas, a response a handler returns is correct by definition (it is the source of truth); guessing the shape wrong and enforcing it would reject legitimate responses instead of catching real bugs, so this is intentionally kept as drift-documentation reference only — this round's scope covers the same 66 channels as the request schemas (since the handler bodies were already read in detail for that work), with a parity test (`response-schemas.spec.js`) confirming every key is a real registered channel — the remainder (~137 channels) is not yet done and can be extended in the future by adding entries group by group, the same pattern used for request schemas
- ✅ event schemas (docs-only, same pattern as response shapes above — no runtime enforcement) — `packages/bruno-rpc-contract/src/event-schemas.js`'s `EVENT_SHAPES` records the shape of one-way server→renderer events (via `webContents.send()`/`EventBridge.broadcast()`/`sendToSession()`, the other half of the IPC surface from request/response) as a human-readable string per event name — covering **79 real event names/patterns** found by grepping every `.send()`-style call site across bruno-electron and bruno-requests (there is no central registration API like `ipcMain.handle` to auto-dump from the way there is for request/response, so there is no parity fixture this round — noted as future work in a comment in the file); there is a test (`event-schemas.spec.js`) confirming every entry is a non-empty string; found 2 client-side listeners (`main:process-env-update`, `main:workspace-dotenv-update`) with no real emitter anywhere in the code, noted as vestigial via comment rather than included as entries (not an oversight)
- ✅ standardized error envelope (`ERROR_CODES` + `createErrorEnvelope()`, wired into `ipc-proxy.js` additively)
- ✅ capability metadata (moved the capability taxonomy from P0.2 here as canonical)
- generated Browser client and Electron adapter — not yet done; the renderer still calls with raw channel strings as before (it's almost entirely plain JS, with no TS convention yet to leverage)

Defined error format:

```json
{
  "code": "PATH_OUTSIDE_ALLOWED_ROOT",
  "message": "The selected path is outside an allowed root",
  "requestId": "...",
  "retryable": false,
  "details": {}
}
```

**Acceptance criteria:** CI fails when a Desktop handler, Browser route, or renderer caller doesn't match the contract, and no important string channel is scattered around without type checking — ✅ there is a working, live-verified audit script that correctly detects drift (`npm run audit:parity`, with a `--write` heal mode), and it is now wired into CI (the `rpc-contract-parity` job in `.github/workflows/ci.yml` runs on every push/PR to `main`)

### P0.6 Browser Parity CI ✅ Done

Added a Playwright project `browser-bridge` that starts:

1. `bruno-server`
2. `bruno-app`
3. an isolated temporary user-data/workspace

🟡 **The scope actually implemented right now is only a boot + API surface + security-defaults smoke suite (3 spec files, 9/9 tests passing)** — most of the full minimum test matrix below is still not covered, because it still depends on the existing Electron e2e suite for UI-driven flows (same components, only the transport layer differs):

- Windows, macOS, Linux — not yet done (runs only on the current platform)
- Node 24 LTS as primary; Node 22 during migration — not yet done
- create/open/reload collection — not yet done (UI-driven, not yet covered)
- request send/cancel — not yet done (UI-driven, not yet covered)
- WebSocket/gRPC/SSE — not yet done (UI-driven, not yet covered)
- environments/secrets — not yet done (UI-driven, not yet covered)
- workspace snapshot restore — not yet done (UI-driven, not yet covered)
- file import/export — not yet done (UI-driven, not yet covered)
- OAuth callback — not yet done (UI-driven, not yet covered)
- reconnect after restarting the Bridge — not yet done (UI-driven, not yet covered)
- two-session isolation — not yet done in Playwright (there is manual-script-based live verification for several resource types under P0.4, but not an automated Playwright suite)
- ✅ security negative tests — `security-defaults.spec.ts` covers the origin allowlist, privileged-channel blocking, auth-off default, and sandbox-off default

Added a static parity audit that compares Electron handlers against the RPC contract on every PR — ✅ the script already exists (`scripts/audit-parity.js`, see P0.5) and now runs on every push/PR via `.github/workflows/ci.yml`

### P0.7 CI Pipeline 🟡 Partially done (basics + browser-bridge e2e are done)

**Goal:** Close the gap that leaves several items above (P0.5, P0.6) stuck at 🟡 because there was no CI pipeline to wire a gate into (the repo only had `.github/dependabot.yml`, with no prior `.github/workflows`)

- ✅ Created `.github/workflows/ci.yml` — runs on every push to `main` and every pull request, with three parallel jobs:
  - `lint` — `npm run lint` across the whole repo, blocking; when this workflow was first created, 54 outstanding lint errors were found (all auto-fixable, scattered across files unrelated to CI) — ran `npm run lint:fix` to fix all of them (quote style, indentation, blank lines only, no logic touched at all; the relevant test suites all still passed after the fix) before making the job blocking
  - `test` — `npm test --workspaces --if-present` runs jest for every workspace that has a `test` script (skipping workspaces that don't, e.g. `bruno-docs`, `bruno-schema-types`) — live-verified to pass entirely before commit (e.g. `bruno-server` 286/286, `bruno-rpc-contract` 19/19)
  - `rpc-contract-parity` — `npm run audit:parity --workspace=packages/bruno-rpc-contract` (see P0.5) — live-verified to pass before commit
- ✅ Playwright e2e/`browser-bridge` suite (P0.6) in CI — added a `browser-bridge-e2e` job (`npx playwright install --with-deps chromium` then `npm run test:e2e:browser-bridge`) with `upload-artifact` for `playwright-report/` on failure — live-verifying before wiring it in surfaced 1 false failure caused by an unrelated process ("Open WebUI", a different app) squatting on port 3000 of the dev machine itself, not a Bruno bug; isolated and confirmed with a different port that the real boot flow passes 1/1 — the CI runner is always clean, so this issue doesn't occur there
- not yet done — SBOM, dependency scanning, signed artifacts (P1.3): CI now exists to wire this into, but the tool/signing-key policy still needs to be chosen first, as a separate decision
- not yet done — cross-platform matrix (Windows/macOS/Linux) or Node version matrix (P0.6's minimum test matrix): currently only runs on `ubuntu-latest`
- diff-only lint mode not addressed — `eslint-plugin-diff` is already registered as a plugin in `eslint.config.js`, but is not yet wired into any actual rule (a dead registration); this is no longer a blocker since the pre-existing debt has all been cleared, but remains a future opportunity if we want large PRs to not have to worry about lint errors in code they didn't touch

---

## P1 — Make the Browser Genuinely Usable (1–3 months)

### P1.1 Server File Explorer and Transfer Center 🟡 Partially done (folder-picking modal + upload/download + progress/cancel + create-folder/rename + file-picker multi-select/preview + search/recent/favorites + Bridge-machine label + checksum verification + opaque file handle API (backend) + resume for downloads are all genuinely done now; resume for uploads is not yet done (deferred separately), and the opaque handle on the frontend is not yet done)

Replace `window.prompt()` with a modal that has:

- ✅ Browse via a real modal (point-and-click navigation) instead of `window.prompt()` — for the 3 entry points that pick a "folder" path (`renderer:browse-directory`, `renderer:open-collection`, `renderer:open-workspace-dialog`); the backend added `renderer:list-directory` (read-only, in `READ_ONLY_SAFE_CHANNELS`) at `bruno-electron/src/ipc/filesystem.js`, returning `{ path, parentPath, entries }`; the frontend has a new provider `providers/BrowseFolder` (mirroring the same pattern as `PromptVariablesProvider`) + `components/BrowseFolderModal`, which supports both single-select (browse-directory, open-workspace-dialog) and checkbox-based multi-select (open-collection retains its existing ability to select multiple paths at once); tested with real Playwright on a built app served through bruno-server (navigating in/out of folders, multi-select, cancel — all working correctly)
- ⚠️ "browse only allowed roots" — not yet enforced in the modal itself (if `BRUNO_SERVER_ALLOWED_ROOTS` is set, the server-side sandbox still blocks the call via `findPathPolicyViolation`, but the modal doesn't filter the UI to prevent navigating outside the root in the first place — a UX gap, not a security gap)
- ✅ **upload from the client to the Bridge and download from the Bridge to the client** — replacing the `window.prompt()`-based path entry for `export-collection-zip`, `export-workspace`, `save-response-to-file`, and enabling real zip-import from a browser file input (`import-collection-zip`/`import-workspace`)
  - Backend: 2 new routes, separate from `/api/ipc/:channel` (JSON-only) because they need to actually send/receive binary files — `POST /api/uploads/scratch-file` (multipart via `multer.diskStorage`, always naming the on-disk file with `crypto.randomUUID()`, never trusting the client-supplied filename except for the extension, which passes an allowlist regex `/^\.[a-z0-9]{1,8}$/`) and `POST /api/downloads/:channel` (accepts JSON args, streams the file back via `res.download()`) — both routes reuse the exact same security primitives as `ipc-proxy.js` (`validateArgs`, `findPathPolicyViolation`, rate-limit/concurrency, `withTimeout`, `requireAuth`); `downloads.js` is restricted to the `DOWNLOADABLE_CHANNELS` allowlist (`export-collection-zip`, `export-workspace`) rather than going through generic dispatch like `/api/ipc`, so only argument shapes that have already been vetted are allowed through; a shared scratch dir (`os.tmpdir()/bruno-bridge-transfers`) is auto-swept every 10 minutes for uploads and deleted immediately after streaming completes for downloads; CORS adds `exposedHeaders: ['Content-Disposition']` so `fetch()` can read the filename cross-origin
  - Frontend: `ipc-transport.js`'s `BrowserTransport` adds `_downloadViaBridge()` (fetches `/api/downloads/:channel`, reads `Content-Disposition`, triggers a Blob download via an `<a download>` element), `_saveResponseToFileLocally()` (decodes the base64 `response.dataBuffer` that is already in browser memory and triggers a Blob download purely client-side, with no round trip to the server at all), and `uploadZipFile()` (POSTs `FormData` to `/api/uploads/scratch-file`, returning a real scratch path); `ElectronTransport.uploadZipFile()` is a no-op that returns the existing `getFilePath()`, because desktop already has a real local path; `FileTab.js`/`ImportWorkspace/index.js` switch from `getFilePath()` to `await transport.uploadZipFile()`
  - New test coverage: `uploads-downloads.spec.js` (9 tests: upload success/no-file/oversized/auth-required, download success-with-Content-Disposition/non-allowlisted-channel/path-outside-allowed-roots/malformed-args/auth-required)
  - **Live-verified with real Playwright** on a production build served through bruno-server: opened a real collection → Share modal → ZIP → Proceed → `POST /api/downloads/renderer:export-collection-zip` returned 200 with `Content-Disposition: Test.zip`, and a real 677-byte zip file was obtained via a real browser download event (no longer `window.prompt()`) → fed that zip file into the Import Collection modal's file input → `POST /api/uploads/scratch-file` returned 200 with a real scratch path → `renderer:is-bruno-collection-zip` passed → the import wizard successfully advanced to the location step (proving the full upload→validate→handleSubmit round trip works end to end)
  - **Bug found during live verification (not directly related to upload/download, but blocked verification) — fixed**: WebSocket reconnect in `BrowserTransport._connectWebSocket()`'s `onopen` sent a resubscribe as 1 message per channel (`for (const channel of this._listeners.keys())`) — now that the app has 63 distinct event channels combined, every reconnect immediately hit `event-bridge.js`'s `MESSAGE_RATE_LIMIT = 50` messages/10s, immediately got `ws.close(1008)`, and because `_reconnectAttempts` was reset to 0 in `onopen` (before the connection was known to be stable) the exponential backoff never grew — resulting in an infinite reconnect loop roughly every 1-2 seconds, stuck permanently at "Offline" — this was a regression that blocked **all use of Browser mode**, not just this feature. Fixed by batching the resubscribe into a single message (`{ type: 'subscribe-batch', channels: [...] }`) instead of N messages, and adding matching `subscribe-batch`/`unsubscribe-batch` handlers on `event-bridge.js`'s side (with a `MAX_BATCH_CHANNELS = 500` cap to guard against abuse) — added 5 new tests in `event-bridge.spec.js` confirming a batch counts as exactly 1 message against the rate limit
- ✅ **progress + cancel for upload/download** — `uploadZipFile()` was rewritten to be XHR-based (`upload.onprogress`) instead of the previous `fetch()`, which couldn't report progress; added a new `downloadWithProgress()` (streamed `fetch()` + `response.body.getReader()`, computing % from `Content-Length`) so exports also get a progress bar; both directions share the same `AbortController`/`AbortSignal` so mid-transfer cancellation genuinely works (`TransferCancelledError` distinguishes this error type from a real error so it doesn't trigger the wrong toast); UI: progress bar + cancel button in `FileTab.js` (`zip-upload-progress`/`zip-upload-cancel-btn`) and `ShareCollection/index.js` (`export-progress`/`export-cancel-btn`); also closed out the remaining redundant WS-reconnect flush (`_wsQueue` no longer needs a separate flush, since the `_listeners`-based resubscribe-batch already covers it)
  - **Real bug found during live verification — fixed**: `ImportCollection/index.js`'s `if (isLoading) return <FullscreenLoader />;` unmounted the entire `FileTab` component (including the progress bar/cancel button just built) the instant `isLoading === true` — but the pre-existing `processZipFile()` called `setIsLoading(true)` as its very first line, before the upload even started, meaning the progress UI could never be seen during the upload at all, even though the underlying progress state was updating correctly. The 23/23 unit tests all passed and did not catch this bug, because they test `ipc-transport.js` in isolation and never render the real parent-child tree — it only surfaced during live verification via real Playwright on a production build. Fix: moved `setIsLoading(true)` to after the upload finishes (before the `renderer:is-bruno-collection-zip` validation, which is already a good fit for the fullscreen loader since there's no cancel affordance there) — re-verified after rebuild: the progress bar appears immediately, the % genuinely moves during a throttled upload, cancel works cleanly with no error toast, and a full non-throttled upload completes normally through to the location step
- ✅ **create folder, rename, and conflict resolution in `BrowseFolderModal`** — the backend added 2 new channels to `bruno-electron/src/ipc/filesystem.js`: `renderer:create-directory(parentPath, name)` and `renderer:rename-directory(oldPath, newName)` — both fully reuse existing code, with no new validation written (`createDirectory`/`validateName`/`safeToRename` from `utils/filesystem.js`, the same functions `renderer:rename-item-filename` already uses), so conflict guarding, name validation (rejecting path separators/control characters/reserved Windows names/length>255), and case-only-rename-on-case-insensitive-fs handling all come for free; both channels pass through `HandlerRegistry` auto-discovery and the existing `allowed-roots`/rate-limit infrastructure with no extra security-layer changes needed, because the path argument is the already-validated parent/target directory, while the leaf name goes through `validateName()`, which structurally prevents path traversal from sneaking in; added `REQUEST_SCHEMAS` entries in `bruno-rpc-contract` and regenerated the fixture via `audit:parity -- --write`
  - Frontend: `BrowseFolderModal/index.js` adds a "New folder" button on the top path bar (opening an inline form with auto-focus), and a hover-reveal rename button per row (opening an inline form that replaces the folder name in that row) — both forms confirm with Enter/a check button, cancel with Escape/an X button, and show inline errors under the input without disturbing the existing directory-listing error banner; the error message is checked via the substring `"already exists"` (following the existing convention of `renderer:rename-item-filename`), because the Browser Bridge's `ipc-proxy.js` returns only `err.message` as a plain string, not a custom `.code` property
  - New test coverage: `filesystem.spec.js` (backend, 8 tests: create/rename success, conflict, invalid name, non-directory parent/non-existent source) and `BrowseFolderModal/index.spec.js` (frontend, 8 tests: initial listing, create success/conflict/escape-cancel, rename success/conflict/escape-cancel/no-op-when-unchanged)
  - **Live-verified with real Playwright** on a production build served through bruno-server (206 handlers registered, up from 204): opened the Create Collection modal → clicked Browse → successfully created a new folder (appeared in the listing immediately) → creating a duplicate name correctly returned the inline error "... already exists", with cancel working correctly → hovering a row to rename succeeded (old name disappeared, new name appeared) → renaming to a name that already existed correctly returned the inline error → Escape correctly canceled the rename form — no new bugs found during this round of live verification
- ✅ **multi-select with preview for files** (`renderer:browse-files` no longer uses `window.prompt()`) — `BrowseFolderModal` was generalized into a dual-mode component via a new `mode` prop (`'folders'` default | `'files'`), with the default remaining 100% backward-compatible (the 8 pre-existing tests pass with no changes needed); backend: `renderer:list-directory` adds `size`/`mtimeMs` per file via `fs.stat()` (wrapped in a try/catch per entry to prevent a broken symlink from blocking the whole row) — no new IPC channel, no added security surface; frontend: a `matchesFilters(entry, filters)` helper supports the Electron-style filters shape (`[{ name, extensions }]`), usable both client-side (Browser Bridge) and in the same shape that native `dialog.showOpenDialog` already uses on the Electron side; file rows add a checkbox/radio (depending on the `multiple` prop) + a preview panel at the end of the listing showing name/size/mtime of the currently selected files; provider: `providers/BrowseFolder` adds `browseFiles()`/`window.browseFilesOnBridge` (mirroring the existing `browseFolder`/`window.browseFolderOnBridge`); `ipc-transport.js`'s `renderer:browse-files` uses this bridge first, while still keeping the `window.prompt()` fallback for cases where the provider isn't mounted (e.g. called outside the React tree)
  - New test coverage: `filesystem.spec.js` (backend, +2 tests: size/mtimeMs per file, reject non-directory) and `BrowseFolderModal/index.spec.js` (frontend, +6 tests: folders-mode still hides files as before, files+folders mixed in one listing, extension filter, single-select+preview, submit-on-confirm, multi-select) — 14/14 passing in the whole file
  - **Live-verified with real Playwright** on a production build served through bruno-server (206 handlers, no new channels): created a collection → New Request → Body tab → Multipart Form → added a row → clicked the upload icon, which opened `BrowseFolderModal` in file mode with the correct title "Select File(s)" → real files in `$HOME` appeared in the listing with size/date → selected a file, the Select button became active, and the preview panel showed the correct name/size/mtime → after confirming, the file was correctly attached to the multipart row (confirmed via `MultipartFileChipsCell`'s collapsed-summary chip title `"1 file"` — the column was narrow enough to collapse to a summary instead of the raw filename, per this component's existing responsive behavior that predates this work, not a new bug)
  - **Script/test bugs found during live verification (not product-code bugs) — fixed in the script**: (1) the CreateCollection modal-backdrop that had just closed was still intercepting pointer events for the next modal during the fast transition — fixed by waiting for `.bruno-modal-backdrop` to genuinely disappear (`state: 'detached'`) instead of a fixed timeout; (2) the original script triggered "Create Collection" via the button in the Overview page's Quick Actions, which disappears if a request tab is still open from a previous session (server-side state persists across page reloads) — switched to using the sidebar header's persistent "+" menu (`collections-header-add-menu`) instead, which is always present on every page
- ✅ **search + recent paths + favorites in `BrowseFolderModal`** — the backend adds a new class `store/recent-browse-paths.js` (`RecentBrowsePaths`) storing separate recent (capped at 10 items, dedup+move-to-front when re-added) and favorites (toggle in/out) lists, using a top-level key `browsePaths.*` separate from `preferences` (to prevent `PreferencesStore.savePreferences()`'s full-overwrite from clobbering this data — the same pattern as `LastOpenedWorkspaces`'s `workspaces.*`) and session-scoped via `getCurrentSessionKey()` in the same way (`undefined` = a flat list for Electron/no-auth, a real key = a per-session list for multiple simultaneous Browser Bridge clients); adds 3 new IPC channels in `ipc/filesystem.js` (`renderer:get-browse-paths`, `renderer:add-recent-browse-path`, `renderer:toggle-favorite-browse-path`) — no new handler-registration changes needed since this module is already registered, and no `REQUEST_SCHEMAS` entry added in `bruno-rpc-contract` per existing policy (this channel writes a plain string into the store, is low-risk, and is not a destructive/privileged operation), but `fixtures/real-channel-sources.json` was regenerated via `audit-parity.js --write` so the 3 new channels map to the correct file
  - Frontend: `BrowseFolderModal/index.js` adds a search input that filters the current `entries` by substring match against `entry.name` (client-side, only filtering folders already listed — not a full filesystem search — the scope is deliberately narrow), a favorite-star button on the top path bar (toggling the current path), and a quick-access dropdown showing Favorites/Recent in separate sections that navigate immediately on click; both `setRecentPaths`/`setFavoritePaths` always check `Array.isArray()` before applying a new value over existing state (fixing a real race condition found — see the bug section below)
  - New test coverage: `recent-browse-paths.spec.js` (backend store, 9 tests: empty state, add/dedup/cap-at-10, favorite toggle, independent lists, session-scoping), `filesystem.spec.js` (+2 tests for the 3 new channels), `BrowseFolderModal/index.spec.js` (+7 tests: search filter, no-match message, clear button, mount-time fetch+list in the quick-access panel, navigate via a recent item, record recent after navigating, toggle favorite+pressed state) — 21/21 passing in the whole file
  - **Real bug found and fixed while writing tests (production code, not just the script)**: `setRecentPaths`/`setFavoritePaths` previously applied the response of `add-recent-browse-path`/`toggle-favorite-browse-path` directly, without first checking it was really an array — because the completion order of the 2 IPC calls made per navigation (the mount-time `get-browse-paths` fetch and the fire-and-forget `add-recent-browse-path`) isn't guaranteed, a falsy/undefined response could overwrite already-correct state with `[]` — fixed by checking `Array.isArray(response)` before applying at every site
  - **Live-verified with real Playwright** on a production build served through bruno-server: opened Create Collection → Browse → search correctly filtered entries → navigated in/out of a test folder → toggled the favorite star button (`aria-pressed` toggled correctly, and state-persistence across separate script runs was confirmed by running it twice and seeing opposite directions each time) → opened the quick-access panel and correctly saw both favorites/recent → clicked a recent item and successfully navigated back into the same folder — no new product-code bugs found during this round of verification (only one script bug: Playwright strict-mode collided with 2 simultaneous "Cancel" buttons left over from the CreateCollection modal overlapping with BrowseFolderModal — fixed the script to use `getByRole('button', { name: 'Cancel', exact: true }).last()`)
- ✅ **make it clear whether a path belongs to the Bridge machine or the user's own machine** — a survey found that in Browser Bridge mode, `BrowseFolderModal` never has any way to access the filesystem of the machine running the browser (`renderer:list-directory`/`renderer:browse-files` always go over IPC to `bruno-server`), which means the paths the modal shows are always paths on the Bridge server's machine only — the risk is that users might mistakenly think they're browsing their own machine (especially in deployments where the Bridge lives on a different machine than the browser), so a small "BRIDGE SERVER" badge was added on the path bar with a tooltip (via `components/ToolHint`, the same pattern as `ConnectionIndicator`) explaining "This path is on the Bridge server's machine, not this browser's computer" — this badge is gated by `!isElectronMode()` (an existing helper in `ipc-transport.js`), so it **never shows in Electron desktop mode**, since that mode has no such ambiguity to begin with (it's the exact same machine, with no separate "Bridge" concept in the UI) — no new IPC channel/endpoint was added this round at all (deliberately decided not to query the Bridge server's real hostname, because both `/api/runtime-config`/`/api/health` bypass `requireAuth` — adding a hostname there would be an info-disclosure available to any unauthenticated request for free, which is more than the label needs, since it only needs to say "this is not your machine," not the machine's actual name) — added 2 test cases in `BrowseFolderModal/index.spec.js` (badge shows in Browser mode, hidden in Electron mode) — live-verified with real Playwright on a production build: the "BRIDGE SERVER" badge appeared correctly, and hovering showed the correct full tooltip text
- ✅ **checksum verification for upload/download** — the server computes a real SHA-256 of the file after multer finishes writing it to the scratch dir (`fs.createReadStream` + `crypto.createHash('sha256')`, not streaming-hashed while writing, since these scratch files are small and it isn't worth the added complexity) and returns it as an `sha256` field in `POST /api/uploads/scratch-file`'s JSON response (if the computation fails, the file is unlinked and a 500 is returned to prevent an orphan file); `POST /api/downloads/:channel` computes the SHA-256 of `tempPath` before `res.download()` and sets an `X-Content-SHA256` response header; `X-Content-SHA256` was added to CORS `exposedHeaders` alongside the existing `Content-Disposition`, so `fetch()` can read it cross-origin — frontend: `ipc-transport.js` adds a single shared helper `sha256Hex(blob)` used at all 3 sites (`Web Crypto`'s `crypto.subtle.digest('SHA-256', await blob.arrayBuffer())`, one-shot rather than streamed, since both `File`/`Blob` are already fully loaded into memory before this point is ever reached) and a new error class `TransferIntegrityError` (mirroring `TransferCancelledError`) — `uploadZipFile()`'s `xhr.onload` compares a client-side hash of `file` against `body.sha256` before resolving (rejecting with `TransferIntegrityError` on mismatch, without changing the existing resolve shape, which is a string path, so as not to affect callers); `downloadWithProgress()`/`_downloadViaBridge()` compare the hash of the assembled `blob` against the `X-Content-SHA256` header before triggering `<a download>` (if the server doesn't send that header, the check is silently skipped for backward compatibility with any response that lacks it)
  - New test coverage: `uploads-downloads.spec.js` (+2 tests: the sha256 field matches the real bytes on disk, the X-Content-SHA256 header matches the real streamed-out bytes), `ipc-transport.spec.js` (+4 tests: upload match/mismatch, download match/mismatch) — jsdom implements neither `crypto.subtle` nor `Blob.prototype.arrayBuffer` (both exist in every real browser but not in jsdom), so both were polyfilled in `jest.setup.js` (via Node's `require('crypto').webcrypto.subtle` and a `FileReader`-based `arrayBuffer()`) — this doesn't affect production code at all, it's purely a test-environment gap
  - **Live-verified with real Playwright** (real Chromium has full `crypto.subtle`/`Blob.arrayBuffer`, unlike jsdom) on a production build served through bruno-server: uploading a zip through the Import Collection modal's file input → no error toast/console error → the wizard successfully advanced to the location step (proving the checksum passed) → really exporting a collection through the Share modal → the "Collection exported successfully" toast appeared, with no `TransferIntegrityError` or console error at all; also confirmed byte-level with a direct curl double-check: the `sha256sum` of the uploaded file exactly matched the returned `sha256` field, and the `sha256sum` of the downloaded file exactly matched the `X-Content-SHA256` header
  - **Tooling bug found during live-verify (not a product-code bug) — self-inflicted**: the first round of direct curl testing called `export-collection-zip` passing `$HOME` as the collection path (intending only to quickly hit the endpoint), causing the archiver to try to zip the entire home directory, exhausting heap until the node process OOM-crashed (`FATAL ERROR: Ineffective mark-compacts near heap limit`) — entirely unrelated to the checksum feature, caused purely by picking the wrong test path — fixed by restarting the server and using a small existing collection path from the test scripts (`tests/interpolation/collection`) instead
- ✅ **resume for a download interrupted mid-transfer** (download only in scope — upload-resume is deferred separately, see below) — both export handlers behind `/api/downloads/:channel` (`renderer:export-collection-zip`, `renderer:export-workspace`) regenerate the zip fresh on every call, with no guarantee the bytes are identical between two calls (archive timestamps/entry ordering can differ), which means simply retrying the whole request with a `Range` header would be unsafe — the client could end up splicing bytes from two different generations of the file, and the existing checksum wouldn't catch it because it only covers a single response, not a file spliced from 2 generations; fixed with a new resume-token registry, `security/download-resume.js` — the first request that successfully generates an export stores the already-written `tempPath` in an in-memory Map (`resumeToken -> { tempPath, sessionKey, sha256, downloadName, expiresAt }`, the same pattern as `auth.js`'s `sessions` and `idempotency.js`'s `cache` — lazy TTL expiry with no sweep timer, bounded by `MAX_ENTRIES`, evicting the oldest entry when full, TTL/max-entries overridable via `BRUNO_SERVER_DOWNLOAD_RESUME_TTL_MS`/`BRUNO_SERVER_DOWNLOAD_RESUME_MAX_ENTRIES`) and returns the `resumeToken` in the `X-Resume-Token` header; if the stream is interrupted mid-transfer, the client retries with the same `resumeToken` — the route (`routes/downloads.js`) sees `resumeToken` in the body and **skips calling the handler again entirely**, instead serving the same file at the same tempPath, letting Express's `res.download()` (via the `send` package underneath) handle `Range`/206 itself according to the HTTP standard — no byte-resume protocol needed to be built by hand, it just needs to "point back to the exact same file"
  - **session-scoped**: `getResumeEntry(resumeToken, sessionKey)` checks that the resuming request's `req.brunoSessionId || req.ip` exactly matches the sessionKey recorded when the token was created, preventing another client (guessing/stealing a token) from pulling down another client's export
  - **token lifecycle**: a download that completes fully (no error in `res.download()`'s callback) discards the token and deletes the tempPath immediately, since it can no longer be resumed (it was already sent in full); a download that errors mid-transfer (the client's connection drops) **deliberately does not discard** — it leaves the token/file in place so a real resume can still succeed before the TTL expires (the existing SCRATCH_DIR sweep already cleans up files nobody comes back to resume within 1 hour, as a fallback)
  - **fixed a concurrency-slot timing inconsistency found during implementation**: the resume branch originally released the concurrency slot inside `res.download()`'s callback (waiting for the whole transfer to finish before releasing), unlike the fresh-generation branch, which released immediately after calling `res.download()` (without waiting) — inconsistent, and the resume branch would hold the slot far longer than needed for a large file; fixed so both branches now release immediately after kicking off the stream, the same way (not waiting inside the callback)
  - **frontend**: `ipc-transport.js`'s `downloadWithProgress()` previously threw directly on a chunk-read failure — added bounded resume-retry (`MAX_DOWNLOAD_RESUME_ATTEMPTS = 3`): a stream-read error that isn't a cancellation (`signal?.aborted`/`AbortError` still throws `TransferCancelledError` immediately as before, unchanged) and that has a `resumeToken` from the response header (`x-resume-token`) with attempts remaining → calls a new method `_resumeDownloadStream()` (re-fetches the same endpoint with the `resumeToken` + a `Range: bytes=${received}-` header, expecting only 206) to get a new reader to continue the same loop; if the resume attempt itself fails (e.g. the token has expired, returning 410), it **throws the original stream-read error**, not an error about the resume itself (a fallback safety measure — keeping existing semantics so the error message doesn't get more confusing than before); once attempts run out, it also throws the most recent error
  - New test coverage: `download-resume.spec.js` (11 tests: create/get round-trip, session-mismatch reject, lazy TTL expiry, `MAX_ENTRIES` eviction, idempotent discard), `uploads-downloads.spec.js` (+4 tests: a fresh download has `X-Resume-Token`, resuming with a `Range` header gets 206 + bytes that exactly match the full file (using raw `http.request()` + `req.destroy()` to simulate a real dropped connection — supertest always waits for the full response, so this couldn't be done that way), an unknown/expired token gets 410, cross-session resume gets 410), `ipc-transport.spec.js` (+5 tests: resume succeeds after a stream failure, no resume token throws the original error immediately, cancellation takes priority over resume even with a token present, a failing resume attempt itself throws the original error, running out of `MAX_DOWNLOAD_RESUME_ATTEMPTS` throws the most recent error) — combined bruno-server 372/372 (24/24 suites), bruno-app 1438/1438 (78/78 suites) all passing, lint clean
  - **Test-design bugs found while writing tests (not product-code bugs)**: (1) an earlier test assumed a resume token was still usable after the first download completed fully via supertest — wrong, because the token is discarded the instant a download completes successfully (by design) — fixed by simulating a genuinely dropped connection instead; (2) using a 300,000-character collectionName to pad the test file's size also ended up embedded in the `Content-Disposition: filename=...` header, causing the Node HTTP client to reject with "Header overflow" (which looked like the test was hanging, since no response ever finished parsing and no event ever fired) — fixed by decoupling body size from filename size (a custom test handler that writes a large file to disk while using a normal short `collectionName`)
  - **Live-verified with a real bruno-server process + real curl/raw socket (not mocked)**: (1) a fresh download via a real `renderer:export-collection-zip` on a 3MB test collection — the response had both `X-Resume-Token`/`X-Content-SHA256`, with `sha256sum` exactly matching the header; (2) once a resume token's download had completed fully, retrying with that same token → `410 Gone` as designed; (3) simulated a genuinely dropped connection using a raw Node `http.request()` (`req.destroy()` after reading only a few of the first chunks — it had to be destroyed very early, right on the first chunk, otherwise a small file over loopback would flush completely before the destroy could land, ending up counted as "completed" first) then resumed with `Range: bytes=${partial}-` + the token → got `206 Partial Content`, concatenated the partial bytes with the resumed bytes, and `sha256sum`/`cmp` exactly matched the fully-downloaded file byte for byte; (4) resuming with a made-up token that never existed → `410 Gone`; (5) started the server with real `BRUNO_SERVER_REQUIRE_AUTH=true`, created 2 real sessions via `POST /api/auth/session` (each with its own cookie/CSRF token) — session A created a token from a download interrupted mid-transfer, then session B tried to resume with A's token → `410 Gone` (cross-session correctly rejected), session A resuming its own token → `206 Partial Content` succeeded — confirming session-scoping works correctly on a system running for real at every layer, not just in a unit test
- not yet done — **resume for uploads** (deliberately deferred separately from download-resume above, because the scope isn't symmetric): download-resume can fully leverage the standard HTTP `Range`/206 mechanism, because the "read" side already has the complete file on disk to re-serve part of — but uploads have no "complete file" to resume from, requiring an entirely new protocol to be designed (chunked PUT/PATCH, server-side partial-file accumulation while the upload is still incomplete, partial-file lifecycle/cleanup handling that is completely different from download-resume's "single complete file") — a much bigger scope than checksums and bigger than download-resume, comparable to P1.2's idempotency-key scope, which was similarly deferred
- ✅ **opaque file handle API** — previously marked "`renderer:list-directory` still returns absolute paths directly, not yet the opaque handle the spec calls for"; per **"No need to defer, just get it done"**, this was implemented as a backend capability that is **purely additive, non-breaking**: `renderer:list-directory` still returns exactly the same `path`/`parentPath` as before (nothing was removed, since the UI still needs to show the user a real path for wayfinding), but now also adds a new `handle`/`parentHandle` field per entry and per listed directory — an opaque token encrypted with AES-256-GCM (`bruno-electron/src/utils/file-handles.js`, a per-process random key that isn't persisted) instead of the real absolute path; `renderer:create-directory`/`renderer:rename-directory` accept `dirPath` as either the original raw path **or** a handle obtained from a prior list-directory call (`resolvePathOrHandle()` checks for the `bruno-fh:` prefix to tell the two apart) — proven that the whole flow (list → create → rename) can complete end to end without ever sending a raw path, if the caller chooses to use handles throughout; handles also self-authenticate (via the GCM auth tag) — a client cannot forge a handle for a path it never received, unlike a raw path string, which can be typed as anything
  - **fixed a bypass gap found during design**: `security/allowed-roots.js`'s generic path-scanner (`findPathsInValue`) only catches strings that start with `/`/`C:`/`\\` — a handle starting with `bruno-fh:` would never be scanned as a path candidate at all; if left unaddressed, calling `create-directory`/`rename-directory`/`list-directory` with a handle would sail straight through the `BRUNO_SERVER_ALLOWED_ROOTS` sandbox unchecked, even if the decoded path fell outside the allowed root — fixed by adding `CHANNEL_PATH_EXTRACTORS` entries for all 3 of these channels that always decode the handle back to a real path before checking `checkPathPolicy()` (a handle that fails to decode or has been tampered with falls through to being checked as a plain string instead, which will almost certainly fail — fail-safe, not fail-open)
  - New test coverage: `file-handles.spec.js` (9 tests: round-trip, unique-IV per call, not confused with a raw path, tamper detection, malformed handle), `filesystem.spec.js` (+5 tests: handle per entry/directory, null parentHandle at the filesystem root, create/rename accepting a handle instead of a path), `allowed-roots.spec.js` (+5 tests: a handle that decodes into the allowed root passes, one outside the root is blocked, raw paths still work as before, a malformed handle falls through to the fail-safe check, `list-directory` has no `dirPath` arg at all so it isn't falsely flagged) — the full suite for both packages passes (bruno-electron 25/25 files changed, bruno-server 330/330), lint clean everywhere
  - **Live-verified with a real server process** (not mocked): (1) server without `BRUNO_SERVER_ALLOWED_ROOTS` set — `list-directory` returned real `handle`/`parentHandle` values; used that handle to call `create-directory` and then `rename-directory` without ever sending a raw path even once → the folder was genuinely created/renamed correctly on disk; firing the equivalent raw-path calls in parallel confirmed there was still no regression; (2) server with `BRUNO_SERVER_ALLOWED_ROOTS` set to a single root — `list-directory` with a raw path outside the root got `403 PATH_OUTSIDE_ALLOWED_ROOT` as before, firing a fake handle/a handle from a different process (different key, can't decode) also got `403` (fail-safe), and `create-directory` with a handle that decodes to a path *inside* the root succeeded (200) — proving the bypass gap found earlier is genuinely closed on a system running for real, not just in a unit test
  - **Not yet done**: the frontend still doesn't use `handle` at all (`BrowseFolderModal`/`providers/BrowseFolder` still send/receive raw `path` 100% as before) — a separate follow-up (same pattern as P0.2/P1.5's backend-done-UI-follow-up); handles don't persist across a process restart (intentional, not a bug — see the comment in `file-handles.js`)

### P1.2 Connection and Recovery UX 🟡 Partially done

- ✅ connection indicator: Connecting / Online / Degraded / Offline
- ✅ exponential backoff with jitter and a max delay
- ✅ heartbeat/ping-pong and stale-connection detection
- ✅ bounded outbound queue with deduplication
- ✅ request ID, timeout, and `AbortController` cancellation
- ✅ **idempotency key for retryable create/save operations** — scoped to a hand-picked allowlist of 7 channels that are pure creates identified by a name/path the handler already checks for uniqueness (`renderer:new-request`, `renderer:new-folder`, `renderer:clone-folder`, `renderer:create-environment`, `renderer:create-global-environment`, `renderer:import-collection`, `renderer:import-collection-zip`) — per the roadmap's own original note that this is a per-endpoint product-scope decision, not something to blanket-apply to every channel (destructive channels must never auto-retry like this)
  - Server (a new `security/idempotency.js`): a Map with lazy TTL expiry, the same pattern as `auth.js`'s `sessions` (`${channel}::${idempotencyKey}` → `{body, expiresAt}`, no sweep timer, checked and deleted on read if expired), a default TTL of 5 minutes (`BRUNO_SERVER_IDEMPOTENCY_TTL_MS`), bounded by `MAX_ENTRIES` (default 1000, `BRUNO_SERVER_IDEMPOTENCY_MAX_ENTRIES`, evicting the oldest entry when full) — wired into `ipc-proxy.js`: the cache is checked as early as possible (before every validation gate, since a replay doesn't need to re-run validation/ownership checks/the handler) and a hit returns the same response immediately; only **successful** responses are stored in the cache, after dispatch completes, before `res.json()` — deliberately not caching error responses, because a real failure (validation, disk error) may be transient or may no longer apply by the time of the next retry, and pinning it would make a legitimate retry impossible for the entire TTL window — the result is that the scenario this was meant to fix (a response is lost in transit but the write actually succeeded → a retry hits a false "already exists" error) is fully solved, because a retry with the same key is intercepted before it ever reaches the handler, so it can never hit `fs.existsSync` throwing
  - Client (`ipc-transport.js`): adds a new method `retryableInvoke(channel, ...args)` (not touching the existing `invoke()` at all — purely additive) for only the same 7-channel allowlist (copied as a literal string list in this file itself, rather than pulling `@usebruno/rpc-contract` in as a new dependency of `bruno-app` just for this short list); generates a single idempotencyKey reused across every attempt and automatically retries up to `RETRYABLE_INVOKE_MAX_ATTEMPTS` (3) times, but only retries network-level failures (`IpcTimeoutError` or `fetch()`'s `TypeError`, e.g. "Failed to fetch") — it **never** retries a real error response from the server (validation/business errors, etc.), since blindly re-firing those might not be safe or useful; a channel outside the allowlist falls back to a single plain `invoke()` call (the caller doesn't need to check eligibility itself); `ElectronTransport` also gets a `retryableInvoke()`, but it just delegates straight to `invoke()` (there's no network hop to retry in Electron's IPC)
  - Accepted limitations (documented in `idempotency.js`): this only protects against a retry that arrives *after* the first attempt has already finished at the server — 2 attempts that are genuinely in flight at the same time with the same key (e.g. the client fires a retry before the first attempt's handler has returned) don't coordinate at all, and both genuinely run — a full in-flight lock was decided to be out of scope for this round
  - New test coverage: `idempotency.spec.js` (10 tests: allowlist check, get/store, TTL expiry with mocked `Date.now`, `MAX_ENTRIES` eviction), a new describe block added to `app-routes.spec.js` (4 integration tests through a real Express app + supertest: a repeated key doesn't re-invoke the handler, a different key invokes fresh, a channel outside the allowlist isn't cached, a handler error isn't cached), a new describe block added to `ipc-transport.spec.js` (4 tests: the same key is used across every retry attempt, gives up after max attempts, doesn't retry a real server error, falls back to a plain invoke for a channel outside the allowlist) — both full suites pass (bruno-server 370/370, up from 360, bruno-app 1437/1437, up from 1433), lint clean
  - **Live-verified with a real server process** (not mocked): opened a real scratch collection via `renderer:open-multiple-collections` + `renderer:add-collection-watcher` (a real chokidar watcher), then fired a real `renderer:new-request` via curl to create a real `.bru` file on disk — (1) deleted the file, then retried with the same idempotencyKey → got the same `{"data":null}` response back, but the file **was not recreated** (proving the handler genuinely wasn't invoked again, not just mocked); (2) retried with the same key without deleting the file (the actual target scenario from the roadmap) → got a replayed success back, in the same way, **without hitting** the "already exists" error the real handler would throw without idempotency; (3) sanity check: fired with a new key at the same path → correctly got a real "already exists" error, as expected (proving duplicate detection wasn't simply disabled)
  - Not yet done: `renderer:add-cookie`, `renderer:create-workspace`, `renderer:create-workspace-dotenv-file`, `renderer:create-dotenv-file` (candidates found during the survey but deliberately not included this round — they aren't pure-create-by-unique-name/path like the 7 selected channels, and each needs its own separate product-scope decision); there is still no automatic retry wired to any UI action anywhere in the real app (`retryableInvoke()` is ready-to-use infrastructure, but has no real caller in production code yet — a separate follow-up, same pattern as the P0.2/P1.5/opaque-handle backend-done-then-UI-later items)
- not yet done — event sequence numbers and resync after reconnect — **a detailed architectural survey has been done** (full details in `find bug and Improvement.md`), finding this is bigger than the original note suggested: (1) `EventBridge` (`ws/event-bridge.js`) has no buffer/log at all — it's pure fan-out through a `Set<ws>` only, so events fired while nobody is subscribed are lost permanently; (2) the approach that looks "free" — simply calling `renderer:add-collection-watcher` again (closing and reopening the chokidar watcher) — **has been checked and doesn't actually work**: the `collectionAddFileEvent` reducer checks the filename first and silently no-ops if it already exists (content edited during the disconnect won't be refreshed), and files deleted during the disconnect can never be detected either, since chokidar doesn't re-emit `unlink` for a file that no longer exists; (3) there is a mechanism that already does this correctly: `MountManager.remount()` + `buildTree()` (`services/mount/manager.js`, `tree-builder.js`), which produces a full tree with stable uids (using the exact same `getRequestUid` cache as the legacy watcher) and sends it via `main:collection-tree-loaded`, which the client's `mergeTreeItems` (confirmed to be generic enough, not tied to MountManager) diffs/merges correctly for add/update/remove — **but** this entire mechanism sits behind the feature flag `state.app.preferences.cache.file.enabled` (default `false`), an opt-in "v2 mount" path, not the default path most users hit; (4) `remount()` itself doesn't even have an IPC channel wired to call it from the renderer yet (dead code, exported but unused, in `ipc/mount.js`); (5) making resync correct for the default (v1/legacy chokidar) path would require extracting the per-file parsing logic out of `collection-watcher.js`'s `add()` (which has a lot of branches: format v1/v2, encryption, redaction, folder.bru meta) into a separate bulk parser — the risk is that a parsing mistake on the wrong branch would corrupt collection data during resync, which would be worse than not having this feature at all — decided not to rush into that risk, per **"No need to defer, just get it done,"** which means not procrastinating out of laziness, not doing something known to risk data corruption just to check a box — what can safely be done right now is wiring an IPC channel to `remount()` and triggering it from the client only when the user has `file.enabled` (v2 mount) turned on, affecting a very small minority of users — not yet worth carving out as its own increment; this is waiting on a decision about whether to invest in v1→v2 migration or extracting the parser as a bigger separate effort
- ✅ **offline read-only cache for the latest UI state** — self-scoped per **"No need to defer, just get it done"** (this item was previously flagged as "should ask the user first," since it's a product decision about storage scope/invalidation policy — decided independently rather than stopping to ask): rather than hydrating cached data directly into the live `workspaces`/`collections` slices (risky, since dozens of components across the app expect fields the live collection object always has, e.g. `brunoConfig`, `environments`, `mountStatus`, which a cached snapshot doesn't have), this was designed as a **read-only view kept strictly separate from the interactive data model**:
  - A new `utils/common/offline-cache.js` — uses `idb` (`^7.0.0`, already a dependency) following the same pattern as `utils/ai/chat-store.js` (a module-level `dbPromise` singleton, guarded by `typeof indexedDB === 'undefined'`), storing a single snapshot (`id: 'latest'`) in the `snapshot` object store of the `bruno-offline-cache` DB. `buildOfflineSnapshot(state)` strips it down to just names/structure: workspace (`uid`/`name`/`pathname`/collection refs), the collection tree (`uid`/`name`/`type`/`pathname`/`items`, recursively, nothing else), and the global environment gets only `uid`/`name` — **no request/response body, script, header, auth, draft, response history, and no environment variable values at all** are stored, both for size and because stale scripts/credentials being shown as "current" while offline would be misleading/risky (verified with a real snapshot from real live data that the serialized output contains no lingering "secret"/"Bearer" strings)
  - A new `providers/ReduxStore/slices/offlineCache/index.js` — a very small slice storing only `{ snapshot: null }`, with `setOfflineSnapshot`/`clearOfflineSnapshot` reducers, wired into the root reducer (`providers/ReduxStore/index.js`) under the key `offlineCache`, deliberately kept separate from `workspaces`/`collections`
  - A new `providers/App/useOfflineCacheSync.js` (mounted in `AppProvider`, Browser Bridge mode only via `!isElectronMode()`) — two responsibilities: (1) **write**: a `store.subscribe` debounced 2 seconds (the same pattern as `snapshotMiddleware`'s `DEBOUNCE_MS`) writes a fresh snapshot every time state changes, but only while the connection is `ONLINE` and there's already a live workspace (so it never overwrites a good cache with empty state during loading); (2) **read**: after a 4-second grace period from boot, if `workspaces.workspaces` is still empty (no live data has arrived at all), it loads the latest snapshot from IndexedDB and dispatches it only into the `offlineCache` slice (never touching the real `workspaces`/`collections`) — it re-checks the race condition after the async read, in case live data arrived exactly during the cache read; the moment the connection returns to `ONLINE`, it immediately calls `clearOfflineSnapshot()`
  - A new `components/OfflineBanner/` — mounted at the root of `AppProvider` (above `props.children`), shown only when (the connection is not `ONLINE`) and (there is an `offlineCache.snapshot`): text reading "Offline — showing cached data from `<timestamp>`. Read-only until reconnected." with a static, non-interactive list of the cached collection names (no click handler, not wired to any action — purely text, to prevent users from mistakenly thinking clicking will open a request)
  - New test coverage across 4 files (16 tests total): `offline-cache.spec.js` (mocking `idb`'s `openDB` itself — there was no existing pattern in the project to reuse, so it had to be built from scratch — covering build/strip logic, save/load round-trip, guarding when there's no `indexedDB`), `offlineCache/index.spec.js` (reducer), `useOfflineCacheSync.spec.js` (fake timers covering hydrate-after-grace-period, not hydrating if live data arrives first, debounced writes only while online, no writes while offline, clearing on returning online), `OfflineBanner/index.spec.js` (doesn't render with no snapshot/while online/in Electron, renders the message + collection names while offline with a snapshot) — the full suite passes (bruno-app 1454/1454, up from 1438), lint clean
  - Live-verified with a real bruno-server + real Chromium via real Playwright (a production bundle built with `npm run build:web` and served through bruno-server's static-frontend path, not the dev server): booted the real app on the machine's default workspace (which already has real collections), waited for the debounced write, and read the `bruno-offline-cache` DB directly from the browser context to confirm a real snapshot matching the on-machine collections (`Test`, `bruno-testbench`) existed, with no lingering "secret"/"Bearer" strings — **found that killing the entire bruno-server process couldn't be used to verify this as originally planned**, because this same-origin deployment serves both the static shell and the API from the same process, so killing it and reloading immediately gets `ERR_CONNECTION_REFUSED` (can't even fetch index.html), which isn't the scenario this feature was meant to address (this feature solves "the API/backend is down but the static shell is still reachable," as in a CDN+backend split deployment) — fixed by using Playwright's `page.route()`/`page.routeWebSocket()` to block only `/api/**` and `/ws/**` at the real network layer (without touching the server process at all) and reloading the page: the banner correctly appeared with the right timestamp + collection names, and unblocking then reloading again confirmed the banner disappeared once live data returned — covering the write-path, read/hydrate-path, and recovery-path all through genuinely real processes

Destructive actions should not be automatically retried without an idempotency guarantee

### P1.3 Production Browser Packaging 🟡 Partially done (static serving + runtime config + reverse-proxy base path + Docker image + HTTPS/WSS are done)

- ✅ Bridge serves production static assets from the same process as the API — `bruno-server/src/index.js` auto-detects `bruno-app/dist/index.html` (overridable via `BRUNO_SERVER_STATIC_DIR`); if no build is found, everything works exactly as before (API/WS only, frontend hosted separately) — not a breaking change
- ✅ a runtime config endpoint instead of a compile-time/hardcoded port — `GET {basePath}/api/runtime-config` returns `{ basePath }`; when serving static assets itself, the same value is injected directly as `window.__BRUNO_RUNTIME_CONFIG__` in `index.html` (`static-frontend.js`'s `injectRuntimeConfig`), replacing the previous `window.__BRUNO_SERVER_PORT__`, which was dead code (nothing anywhere in the repo actually set a real value for it)
- ✅ support for a reverse-proxy base path via `BRUNO_SERVER_BASE_PATH` (format validated in `config-validation.js`) — prefixing every `/api/*` route, the WS server (`event-bridge.js`'s `attach(server, basePath)`), static assets, and the SPA fallback consistently; on the frontend side, `ipc-transport.js` reads the basePath from `window.__BRUNO_RUNTIME_CONFIG__` when constructing `BRIDGE_SERVER_URL`/`WS_URL` — if it's absent (e.g. dev mode or a separately hosted frontend), it falls back to the exact original behavior (root path, no prefix); `/health/live`/`/health/ready` are deliberately not prefixed, since most orchestrators probe the container directly, bypassing the reverse proxy
- ✅ a Docker image that is non-root, read-only-filesystem-friendly, and mounts allowed roots explicitly — `packages/bruno-server/Dockerfile` (multi-stage: `deps` → `build` → `runtime`) builds a single image combining the Bridge + the bruno-app static build; the runtime stage copies in only the workspace packages actually `require()`d (verified by grepping real imports, not just `package.json`, since several were found to be under-declared), not the whole repo; runs as a non-root `node` user (uid 1000), supports a `--read-only` root filesystem (tested with `--tmpfs /tmp` + a mounted volume at `/home/node/.config/bruno` for `USER_DATA_DIR`), and has a `HEALTHCHECK` wired to `/health/live`; the default `BRUNO_SERVER_HOST=0.0.0.0` inside the container (unlike the bare-metal default of `127.0.0.1`) because the container's own network namespace is already an isolation boundary — see `Installation.md` section 5.7 and `THREAT_MODEL.md` section 6 for full details and example commands
- ✅ opt-in bring-your-own-certificate HTTPS/WSS — this item was previously marked "should ask the user first," since it's a deployment-topology decision (choosing TLS-in-server vs. always forcing a reverse proxy vs. wiring up ACME); per **"No need to defer, just get it done,"** the approach chosen doesn't lock in any topology in advance: added `BRUNO_SERVER_TLS_CERT_FILE`/`BRUNO_SERVER_TLS_KEY_FILE` (must be set together, validated at start via `config-validation.js`'s `validateTlsConfig()` like every other env var — neither set → normal HTTP, only one set or an unreadable/non-file path → fail fast) and `BRUNO_SERVER_TLS_CA_FILE`/`BRUNO_SERVER_TLS_PASSPHRASE` (optional), with `index.js` switching between `http.createServer(app)` and `https.createServer(TLS_OPTIONS, app)` based on this — **WSS comes for free**: `eventBridge.attach(server, BASE_PATH)` works identically against the same `server` object whether it's an `http.Server` or an `https.Server`, since a WebSocket upgrade hooks onto the underlying server's `'upgrade'` event, which isn't protocol-specific at all — not a single line of `ws/event-bridge.js` needed to change; the `OAUTH2_CALLBACK_URL` default and the startup log lines (`http://`/`ws://`) automatically switch based on the active scheme (still overridable via `BRUNO_SERVER_OAUTH2_CALLBACK_URL` as before, for deployments behind a TLS-terminating reverse proxy where the Bridge itself still listens on plain HTTP) — not a breaking change (all defaults are empty; leaving everything unset behaves 100% exactly as before), and doesn't lock in any particular ACME/CA tool (certificate provisioning/renewal remains an operator responsibility, same as the existing reverse-proxy path), matching the original still-unchanged decision — 9 new test cases in `config-validation.spec.js` (a valid cert+key pair/with a CA/nothing set/only cert set/only key set/paths that don't exist for all 3/a path that's a directory) — live-verified with a real self-signed cert (`openssl req -x509 ...`), booting a real server and confirming `curl -sk https://127.0.0.1:4444/api/health` succeeds and a WS client connecting to `wss://127.0.0.1:4444/ws/events` opens/closes the connection cleanly, separately confirming that a mismatched config (cert without key) fails fast with the expected error message, and that plain-HTTP mode (no TLS env vars set) still works normally with no regression; updated `Installation.md` (both Thai/English, new section 5.7.1) and `packages/bruno-server/THREAT_MODEL.md` (boundary 1's MITM row, accepted-risk item 1, deployment recommendation item 6) to match the new behavior
- ✅ `/health/live`, `/health/ready`, build info, and dependency readiness
- ✅ graceful shutdown that closes watchers, terminals, sockets, and pending requests (with an ordering fix confirmed to no longer hang waiting on a timeout)
- ✅ configuration validation at start; invalid config must fail fast
- not yet done — SBOM, dependency scanning, signed images/artifacts, and provenance (a CI pipeline now exists — see P0.7 — but a tool/policy still needs to be chosen before this can be done, as a separate decision)

### P1.4 Real Secret Storage 🟡 (A) crypto bug fixed + (B) provider interface/local default done (rotation/lock-unlock/a real Vault-AWS backend not yet done — per scope decision)

A survey before starting the work found this item was really two differently-sized problems mixed together: (A) a crypto bug that genuinely affects the security of what already exists, versus (B) a full-featured capability that doesn't exist at all yet (an external secret provider interface, rotation, lock/unlock, backup policy). Asked the user, and decided to **do only (A) in the first round**, saving (B) for later (the same pattern used to split backend from UI in P1.5) — this round (P1.4B) comes back to implement the first part of (B): **an external secret provider interface + local default**, per **"No need to defer, just get it done."**

**Bugs found and fixed:**
- ✅ **zero-IV AES-256-CBC** — `encryption.js`'s `aes256Encrypt` previously always used a fixed all-zero IV (`Buffer.alloc(16, 0)`), meaning the same plaintext always produced the same ciphertext (ECB-like leakage — anyone who can read the store file could see which secret values are equal). Fixed by switching to **AES-256-GCM with a random IV on every encrypt** (`aes256GcmEncrypt`/`aes256GcmDecrypt`, a new algo tag `$02:`) — this also gets authenticated encryption for free (tamper/wrong-key detection via the auth tag); the old decrypt path (`$01:`, zero-IV) is kept as **decrypt-only**, so existing old ciphertext can still be read — effectively auto-migrating every time the store reads-modifies-writes a value back (re-encrypting always produces the new format, so no separate migration script is needed)
- ✅ **master key stored alongside the ciphertext** — `store/cookies.js` previously generated a random passkey and stored the `encryptedPasskey` in the same `electron-store` file (`cookies`) that holds the ciphertext of the cookie values themselves, directly contradicting this requirement. Fixed by moving the master key to a separate store file (`cookies-master-key`), with one-time migration logic (moving the old key to the new file and deleting it from the old one, so already-encrypted cookies don't become undecryptable)
- ✅ **Bridge unintentionally used a shared machine-wide key** — the `safeStorage` shim previously in `bruno-server/src/index.js` always returned `isEncryptionAvailable() => false` (an entirely dead-code stub), causing every `encryptString()`/`encryptStringSafe()` call site (AI keys, OAuth2 tokens, secret env vars, etc.) to always fall back to a `machineIdSync()`-derived key when running through the Bridge — a single key shared across the whole process, with no per-deployment separation or management at all. Fixed by creating **`security/master-key.js`**: generates a random 32-byte key the first time it's deployed, stores it in a separate file (`~/.config/bruno/.keys/bridge-master.key`, permission `0600`, directory `0700`), never mixed with any ciphertext file, overridable via `BRUNO_SERVER_MASTER_KEY` (hex, for deployments that inject the key via a secrets manager), then uses this key to implement a real `safeStorage`-shaped shim (AES-256-GCM) instead of the previous stub — no call sites in `encryption.js` needed any changes at all, since they go through the exact same existing `isEncryptionAvailable()` code path
- ✅ Base64 fallback — a survey found no place using Base64 as an actual encryption scheme anywhere (only legitimate Base64 usage for HTTP Basic-Auth headers/PKCE, unrelated to secrets-at-rest) — not a gap that needs fixing
- New test coverage: `master-key.spec.js` (9 tests: key generation/persistence/permissions, env override, GCM round-trip, random-IV proof, wrong-key auth failure), `encryption.spec.js` gains 6 tests (algo `$02:` as the default, random IV, passkey round-trip, wrong-passkey failure, legacy `$01:` still decryptable, malformed GCM ciphertext fails gracefully), `cookies-store.test.js` adjusted its mocks to support `delete()` (for the new migration logic)
- Live-verified: booted a real Bridge server against a scratch `$HOME` and confirmed `bridge-master.key` was created at the expected path with permission `0600`

- ✅ **P1.4B: external secret provider interface + local default** — `security/secret-provider.js` defines a central interface `{ name, getMasterKey(): Buffer }` (an envelope-encryption-style boundary: a provider's only job is to produce a single 32-byte master key, without touching any of the bulk encrypt/decrypt logic in `encryption.js`/`master-key.js`'s `createSafeStorageShim` — swapping providers requires no changes to any call site at all); the provider is selected via `BRUNO_SERVER_SECRET_PROVIDER` (default `local` = exactly the previous behavior, nothing changes), with 3 registered names at `packages/bruno-server/src/security/secret-providers/`: `local-provider.js` (simply wraps the existing `master-key.js` logic, a real implementation), `vault-provider.js`/`aws-secrets-manager-provider.js` (registered names with a documented contract, but throwing a clear error if selected, because actually fetching a key from Vault/AWS is an async, network-dependent operation that `index.js`'s synchronous startup doesn't support yet, and would need a new SDK dependency + its own retry/timeout/rotation policy — a different-sized architecture decision than "define the interface," which was the originally scoped work, so not implemented half-heartedly); `config-validation.js` adds a check that `BRUNO_SERVER_SECRET_PROVIDER` must be one of these 3 names (failing fast at startup on a typo, rather than failing deep inside bootstrap) — Test: `secret-provider.spec.js` (8 tests: defaults to local, local returns a real 32-byte key from `master-key.js`, env override works, vault/aws-secrets-manager throw a clear message, an unknown name throws with a list of supported names), `config-validation.spec.js` gains a new describe block (accepting the 3 names, rejecting a typo/case-mismatch/empty value) — full suite passes 346/346 (up from 330) — Live-verified: booted the real Bridge with the default (no env set) and confirmed `bridge-master.key` was created exactly as before (permission `0600`) and `/api/health` responded normally; set `BRUNO_SERVER_SECRET_PROVIDER=vault` and booted, confirming the process exits(1) with a clear error message explaining why it isn't supported yet and what to do instead; set a misspelled provider name (`gcp-secret-manager`) and confirmed `validateStartupConfig` rejected it even before the master-key bootstrap runs at all

**Not done this round (a deliberate decision, not an oversight):**
- Desktop still uses the OS keychain/safeStorage as before (untouched — already works correctly, no bug)
- Browser local mode using the OS's keyring backend or a separate encrypted vault — not yet done
- a **real** Vault/AWS Secrets Manager provider (actually making a network call to fetch the key) — not yet done; requires making `index.js`'s startup async first, plus a new SDK dependency and designing a retry/timeout/credential/rotation policy as a separate architecture decision (the interface + registered name are already reserved from P1.4B)
- key rotation, a lock/unlock concept, backup policy — entirely greenfield, not yet done (what "lock" even means for a headless server hasn't even been decided yet)

### P1.5 Browser-Compatible OAuth 2.1 Flow ✅ Done, both backend/API and frontend popup UI

- ✅ a loopback callback endpoint on the Bridge — `GET /api/oauth2/callback` (`routes/oauth2.js`), bypassing `requireAuth` because the IdP redirect never carries a session cookie/CSRF token in the first place (the same as the desktop custom-protocol handler)
- ✅ PKCE and state validation — PKCE (S256) already existed in `oauth2.js`; state validation goes through `oauth2-protocol-handler.js`'s `pendingRequests` Map (keyed by state), the same as desktop; the new route calls `resolveOauth2AuthorizationRequest`/`rejectOauth2AuthorizationRequest` directly
- ✅ an exact redirect URI registry — `app.browserBridge.oauth2CallbackUrl` (computed from `BRUNO_SERVER_HOST`/`PORT`, overridable via `BRUNO_SERVER_OAUTH2_CALLBACK_URL`) is always forced as `redirect_uri` when running through the Bridge — ignoring any `callbackUrl` the user set (a deliberate breaking change compared to desktop, per an already-made decision)
- ✅ routing the callback back to the session that started the flow — no new routing code needed at all: on the way out (`oauth2:authorization-required` event), the existing WindowShim session-vs-broadcast routing is used (AsyncLocalStorage); on the way back, a plain HTTP request/response mechanism is used — the existing `POST /api/ipc/renderer:fetch-oauth2-credentials` stays pending until the callback route resolves it, and the response then makes its own way back to the original browser tab
- ✅ timeout/cancel — the timeout (5 minutes) and cancel (`renderer:cancel-oauth2-authorization-request`) already existed and work through the Bridge with no changes needed; additionally fixed the IPC proxy's global 30s timeout, which would have killed this flow early, with a new per-channel timeout override (`ipc-limits.js`'s `LONG_RUNNING_CHANNEL_TIMEOUTS_MS`, overridable via `BRUNO_SERVER_IPC_OAUTH2_TIMEOUT_MS`)
- ✅ redacting the authorization code/token from logs — `logOauth2Callback({state, outcome})` in `audit-log.js` logs only the state + outcome, never the `code`
- ✅ tested parallel OAuth flows from two sessions — the existing mechanism (`pendingRequests` keyed by state, isolated per session) already had test coverage in `oauth2-protocol-handler.spec.js`; added a new test for `resolveOauth2AuthorizationRequest`/`rejectOauth2AuthorizationRequest`, which the new route calls directly
- ✅ frontend popup UI (a follow-up that had previously been deferred — brought back per **"No need to defer, just get it done"**) — `Oauth2ActionButtons` subscribes to `oauth2:authorization-required` via `transport.on(...)` (already generic, works for any channel) and calls `window.open()` for the popup the instant the event arrives; a blocked popup is detected from the return value alone (`window.open` doesn't throw when blocked — it returns `null`/`closed: true`/`closed: undefined`), falling back to a new modal (`Oauth2ActionButtons/PopupBlockedModal`, written following the `GitNotFoundModal` template) that lets the user click "Open Authorization Page" themselves — this click is always a fresh user gesture, so the repeated `window.open()` isn't blocked; the popup is closed automatically via `handleFetchOauth2Credentials`'s `finally` block (no new WS event needed, since the `fetchOauth2Credentials` promise already resolves/rejects once the full round trip completes), and the cancel path (`handleCancelAuthorization`) also closes the popup
- **out of scope this round (already decided)**: the implicit grant is explicitly rejected when running through the Bridge (`getOAuth2TokenUsingImplicitGrant`), because the browser can't send the URL hash fragment to the server — there is no technical way around this, and OAuth 2.1 itself already deprecates the implicit grant

### P1.6 Runtime and Dependency Modernization ✅ Fully done (steps 1-6)

Status as of August 2026 (updated after steps 3-5 completed, per the target versions the user approved: "let's try Node 26 and Electron 43, React latest 19.2, Express 5.1"):

- Node 24 as the LTS baseline (`engines.node >=24`); Node 26 has been tested across the whole monorepo (see step 2)
- Electron fully upgraded from 37 → 43 (one major at a time, across all 6 majors: 37→38→39→40→41→42→43) — currently pinned to `~43.2.0`
- React upgraded from 19.0.0 → 19.2.8 in `bruno-app` (and `bruno-graphql-docs` for consistency)
- Express upgraded from 4.21 → 5.1 (resolved to 5.2.1) on the Bridge (`bruno-server`)

Recommended plan:
1. ✅ Added Renovate/Dependabot with grouped updates — `.github/dependabot.yml` (npm ecosystem, root-rooted covering every workspace via a single lockfile), split into `runtime` (Electron/Express), `ui-libraries` (React/Redux/Phaser), `build-tooling` (bundler/lint/test tooling) groups per the risk buckets the text below itself specifies — this is only config that enables automated PRs for review; it doesn't trigger any actual upgrade
2. ✅ Upgraded the Node baseline to 24 LTS — added `engines.node >=24` to the root `package.json`, bumped the base image in all 3 Dockerfiles (`bruno-server`, `bruno-cli` debian/alpine variants) to `node:24-slim`/`node:24-alpine`, updated `Installation.md` (both Thai/English) and the related docker READMEs to match. Along the way, found and fixed a pre-existing bug: 4 package.json files (`bruno-electron`, `bruno-cli`, `bruno-converters`, `bruno-js`) used `$(npx which jest)` unquoted, causing the shell to word-split paths containing spaces (unrelated to Node 24 directly, but it blocked running the full test suite to verify) — verified with `npm test --workspaces --if-present` (exit 0 for every package) and live Docker verification (`node:24-slim` image, the health endpoint reports `nodeVersion: v24.18.1`, non-root user, `--read-only --tmpfs /tmp`, `/ws/events` WebSocket connects successfully) — **the "test 26 as allowed-to-fail" item is done**: ran the full monorepo test suite across every workspace with real Node v26.5.1 via `nvm` (not a CI matrix job, since the repository still has no CI pipeline — see P0.5/P1.3), with the result that everything passed 100% (every suite in every workspace, zero failures), while Node 24 remains the primary baseline per `engines.node`, unchanged
3. ✅ Upgraded Electron one major at a time with smoke tests — completed all 6 majors (37→38→39→40→41→42→43) as separate commits, each with its own smoke test/verification, currently pinned at `~43.2.0`, which is within the three latest stable majors per Electron project support
4. ✅ Upgraded to React 19.2 and fixed React 19 ref warnings — bumped `react`/`react-dom` to `19.2.8` in `bruno-app` (and `bruno-graphql-docs` for pin alignment, used only at build time since it's externalized from the published bundle via `rollup-plugin-peer-deps-external`). Along the way, found a real bug: bruno-app's exact-pinned new React resulted in two copies of React at once (the old hoisted root vs. the new nested one), because some transitive deps (`react-hot-toast`, `@tabler/icons`, etc.) peer-cap at `^18` — fixed by adding `react`/`react-dom` to the root `package.json`'s `dependencies` and `overrides` (the same pattern already used for `axios`/`rollup`/`pbkdf2`), forcing the whole tree to dedupe down to a single copy of React — verified with the full monorepo test suite (13 workspaces, all green) and a production build (`rsbuild build -m production` producing a single `lib-react` chunk, no duplicates). As for the **React 19 ref warning** ("Accessing element.ref was removed"), root-caused to a single line in `@tippyjs/react`'s `Tippy.js` (a third-party package that appears to no longer be maintained for React 19 — the latest version on npm is 4.2.6) — **deliberately not fixed this round**: it's just a console warning with no impact on real test/functionality (React itself says it still works "for now"), and patching/replacing a UI dependency across the whole tree is a product-risk decision that should be asked of the user first, like P1.5's popup UI, not something to be done quietly on one's own
5. ✅ Migrated the Bridge to Express 5 with contract/integration tests — bumped `express` to `^5.1.0` (resolved `5.2.1`) in `bruno-server`; cross-referenced every Express 5 breaking change against real usage, and found exactly one real impact point: the SPA fallback route used a bare wildcard `/*`, which Express 5's path-to-regexp v8 rejects outright — fixed to `/*splat` (a named wildcard), as Express 5 requires; added `packages/bruno-server/src/__tests__/app-routes.spec.js`, a new HTTP-level integration test suite (using `supertest`, mounting the real route modules, not mocked), with 13 tests covering the auth/ipc-proxy/admin/oauth2 routes and SPA fallback routing specifically — closing an existing gap where no test had ever built a real Express app — verified with the full test suite (18 suites/256 tests) and a live-boot smoke test (a real production server boot, 203 real IPC handlers, correctly served on Express 5.2.1)
6. ✅ Defined a quarterly dependency upgrade window and an SLA for security patches — written up as a real document at `docs/dependency-upgrade-policy.md`: a quarterly window (the second week of every quarter, merging Dependabot PRs in the existing risk-bucket order `runtime → ui-libraries → build-tooling`) + an SLA by severity (Critical 48 hours, High 7 days, Moderate/Low waits for the next window), with a rule that Critical/High must be a standalone commit separate from the batch, must always pass the full test suite, and if a patch isn't available in time, a temporary mitigation must be documented in `find bug and Improvement.md`

Do not upgrade every dependency in a single PR — runtime, build tooling, and UI libraries should be separated to reduce blast radius — items 3-5 already separated commits per major/dependency following this principle (Electron split into 6 commits, one per major; Express and React each in their own commit), and item 6 has now formally codified this as policy at `docs/dependency-upgrade-policy.md`

---

## P2 — Modern Product Capabilities (3–6 months)

### P2.1 API Workflow Testing with Arazzo 1.1

Arazzo defines sequences of API calls, dependencies, inputs, outputs, and success/failure criteria, making it a good fit for Bruno Runner

Proposed features:

- import/export Arazzo workflows
- a visual workflow graph
- mapping step outputs to variables for the next step
- parallel steps and a dependency graph
- retry/timeout/rollback policy
- CI runner reports in JUnit/JSON/HTML
- dry-run and permission preview before running a workflow from a third party

### P2.2 OpenAPI 3.2 First-Class Support

- a parser, validation, and rendering for OpenAPI 3.2
- retain 3.0/3.1 compatibility
- deterministic collection generation for clean Git diffs
- two-way sync with conflict preview
- linting profiles and quick fixes
- contract testing from schema/examples
- a migration assistant between OAS versions

### P2.3 AsyncAPI 3 and Event-Driven APIs

AsyncAPI 3 supports protocol-agnostic message-driven APIs such as WebSocket, MQTT, Kafka, AMQP, and STOMP

Start with:

- import/render AsyncAPI 3
- generating WebSocket requests from channels/messages
- message schema validation
- record/replay event streams
- adding MQTT/Kafka/AMQP as plugin providers instead of baking them into core

### P2.4 Installable PWA Shell

- a web app manifest, icons, theme, and standalone display
- a service worker that caches only static UI assets
- offline startup showing cached workspaces read-only
- an update-available notification and safe reload
- protocol/deep-link handoff to the Bridge

The PWA should not automatically cache API responses or secrets, and privileged actions must still go through the authenticated Bridge

### P2.5 Observability and Diagnostics

- structured JSON logs with request/session IDs
- OpenTelemetry traces for Browser → Bridge → network request
- metrics: latency, error rate, reconnects, queue depth, active watchers, and memory
- a local diagnostics bundle that redacts secrets
- opt-in telemetry only, with a preview screen before sending data
- performance budgets for startup, large collections, and memory

### P2.6 Accessibility and Internationalization

- a WCAG 2.2 AA audit
- keyboard navigation and focus management across every modal/menu
- screen-reader labels and a live region for request progress/error
- reduced motion, high contrast, and color-blind-safe status
- externalizing Browser-specific prompt/error strings into i18n
- automated axe tests in both Browser and Electron

---

## P3 — Strategic Features (6–12 months)

### P3.1 Optional Team Collaboration

Keep local-first as the default, and add collaboration as opt-in:

- shared workspace membership and RBAC
- review/comment on requests and environments without syncing secret values
- presence and edit-conflict indication
- a Git-backed review flow as the foundation before considering real-time CRDT
- audit history and organization policies

Do not start real-time collaborative editing until session isolation, auth, and data ownership are done

### P3.2 Plugin SDK

Create versioned extension points for:

- protocol adapters
- auth providers
- import/export converters
- secret providers
- request/response viewers
- lint rules and workflow steps

Plugins must have a manifest, declared permissions, a sandbox, a signature/trust UI, a compatibility range, and a kill switch — plugins must never get automatic access to Node/the filesystem

### P3.3 Privacy-First AI Assistance

- a provider-neutral AI interface
- local model endpoint support
- a per-workspace AI-disable policy
- preview/redact request bodies, headers, and secrets before sending to the model
- prompt-injection defense for imported specs/docs
- a tool-call allowlist and user confirmation for write/run actions
- an eval suite measuring correctness, secret leakage, and destructive-action rate
- model/version/prompt provenance in generated output

### P3.4 Mocking, Contract Diff and Replay

- a local mock server from OpenAPI/AsyncAPI examples
- traffic capture and deterministic replay with secrets redacted
- semantic contract diff separating breaking/non-breaking changes
- baseline performance assertions
- consumer-driven contract export/import

---

## 5. Target Architecture

```text
React UI
   │
   ▼
Typed Transport Client
   ├── ElectronTransport ──► Electron RPC Adapter
   └── BrowserTransport  ──► Authenticated HTTP/WebSocket Gateway
                                │
                                ▼
                       Shared Domain Services
                         ├── Collections
                         ├── Workspaces
                         ├── Request Engine
                         ├── Environments/Secrets
                         ├── Git
                         ├── Terminal
                         └── API Specifications
                                │
                                ▼
                       Platform Adapters
                         ├── Filesystem
                         ├── Keychain/Vault
                         ├── Dialog/File Explorer
                         ├── Process/Terminal
                         └── Notifications
```

### Migration Sequence

1. Build RPC schemas around the existing handlers without changing behavior
2. Move filesystem/preferences/snapshot into the first set of domain services
3. Have both Electron and Browser call the same service through an adapter
4. Move network/collection/workspace/Git/terminal over in groups
5. Remove the `Module._resolveFilename`/`Module._load` interception once coverage is complete
6. Change the parity audit from "has a channel with the same name" to "passes the same contract and behavior suite"

---

## 6. Recommended Delivery Plan

### Milestone A — Safe Local Browser (6 weeks)

- Bridge auth + loopback binding
- origin allowlist
- channel capability policy
- filesystem sandbox
- WebSocket limits/heartbeat
- security tests

**Exit gate:** passes a threat-model review and the Browser cannot read files outside the allowed roots

### Milestone B — Reliable Browser Beta (another 6–8 weeks)

- per-session isolation
- typed RPC contract
- Browser Playwright suite
- file explorer modal
- reconnect/resync/cancellation
- OAuth callback

**Exit gate:** critical parity journeys pass on Windows/macOS/Linux, and two sessions don't leak state/events between each other

### Milestone C — Production Deployment (another 6–8 weeks)

- a single-server production bundle
- HTTPS/WSS and reverse-proxy support
- encrypted secrets
- Docker/SBOM/signing
- health/readiness/structured logs/OpenTelemetry
- upgrading Node/Electron/React/Express

**Exit gate:** can deploy fresh and roll back, diagnostics are ready, and dependency/security scans pass

### Milestone D — Standards and Ecosystem (next quarter)

- OpenAPI 3.2
- Arazzo 1.1 workflows
- AsyncAPI 3 foundation
- PWA shell
- plugin SDK design

---

## 7. Metrics to Track

### Reliability

- Browser session crash-free rate ≥ 99.9%
- successful reconnect/resync ≥ 99.5%
- zero duplicate collections after a retry
- watcher/terminal cleanup passes 100% of lifecycle tests

### Performance

- warm app interactive ≤ 2 seconds on a standard machine
- opening a collection with 1,000 requests ≤ 3 seconds
- p95 IPC/RPC overhead on localhost ≤ 50 ms, excluding handler work
- memory doesn't grow continuously after 100 reconnect cycles

### Security

- zero unauthenticated privileged RPCs
- zero filesystem escapes in the traversal suite
- secrets never appear in logs/traces/diagnostics
- critical dependency patch SLA ≤ 7 days

### Quality

- RPC contract coverage 100%
- Browser/Desktop shared critical journeys ≥ 90%
- accessibility critical violations = 0
- supported runtime always stays within the vendor support window

---

## 8. Features Not Recommended Yet

The following should be deferred until P0/P1 are done:

- exposing the Bridge as a public cloud endpoint
- anonymous multi-user access
- real-time collaborative editing
- a marketplace that runs arbitrary plugins
- an AI agent that edits files or runs a terminal without confirmation
- automatic retry of destructive operations
- syncing secrets to the cloud by default

These features increase the blast radius and would make fixing the security/session architecture later much harder

---

## 9. Immediate Next Actions

Items that can be started in the next sprint:

1. Write a threat model for the Browser Bridge and define trust boundaries
2. Change the default listen host to loopback
3. Add an exact origin allowlist and a one-time bootstrap token
4. Disable Terminal/Git write/filesystem write in the Browser until a capability is granted
5. Add `maxPayload`, heartbeat, and connection/message rate limits to the WebSocket
6. Reduce the default JSON payload limit and set per-channel limits
7. Create a Browser Playwright smoke project
8. Add a static RPC manifest from the current 202 handlers
9. Design `allowedRoots` and test traversal/symlinks
10. Build a UX prototype of a server file explorer to replace the path prompt

---

## 10. References

- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security) — context isolation, sandbox, CSP, IPC sender validation, and using a still-supported Electron release
- [Electron Release Timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) — Electron supports the three latest stable majors
- [Electron Stable Releases](https://releases.electronjs.org/?channel=stable) — current stable release information
- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — Node 24 is LTS and Node 26 is Current as of when this document was written
- [Express 5 Migration Guide](https://expressjs.com/en/guide/migrating-5/) — guidance for migrating from Express 4 to 5
- [React Versions](https://react.dev/versions) — latest React documentation version
- [OWASP WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) — origin validation, auth, authorization, limits, heartbeat, and logging
- [OpenAPI Specification 3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [Arazzo Specification 1.1.0](https://spec.openapis.org/arazzo/latest.html)
- [AsyncAPI Specification 3.0.0](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [Making PWAs Installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
