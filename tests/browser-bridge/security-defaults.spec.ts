import { test, expect } from '@playwright/test';

const BRIDGE_URL = 'http://localhost:4000';

/**
 * Regression guard for the Browser Bridge security defaults from
 * Improvement.md (origin allowlist, privileged-channel gating, opt-in
 * auth/filesystem sandbox). These all default to their safest/most
 * permissive-but-loopback-only setting when the corresponding env var is
 * unset, which is how the dev webServer in this Playwright run starts the
 * bridge — so this test documents "what a fresh install actually does"
 * rather than a specially-configured one.
 */
test.describe('Bridge server security defaults', () => {
  test('reflects an allowed loopback Origin but not a disallowed one', async ({ request }) => {
    const allowed = await request.get(`${BRIDGE_URL}/api/health`, {
      headers: { Origin: 'http://localhost:3000' }
    });
    expect(allowed.headers()['access-control-allow-origin']).toBe('http://localhost:3000');

    const disallowed = await request.get(`${BRIDGE_URL}/api/health`, {
      headers: { Origin: 'http://evil.example.com' }
    });
    expect(disallowed.headers()['access-control-allow-origin']).toBeUndefined();
  });

  test('blocks privileged channels (terminal/git-write) by default', async ({ request }) => {
    const res = await request.post(`${BRIDGE_URL}/api/ipc/terminal:create`, {
      data: { args: [] }
    });
    expect(res.status()).toBe(403);

    const body = await res.json();
    expect(body.error).toContain('disabled by default');
  });

  test('auth is not required by default — IPC calls need no session/CSRF', async ({ request }) => {
    const status = await request.get(`${BRIDGE_URL}/api/auth/status`);
    expect((await status.json())).toEqual({ authRequired: false, authenticated: true });

    const call = await request.post(`${BRIDGE_URL}/api/ipc/renderer:open-about`, {
      data: { args: [] }
    });
    expect(call.ok()).toBe(true);
  });

  test('filesystem sandbox is disabled by default — no path is rejected', async ({ request }) => {
    // renderer:is-directory is unauthenticated-safe to call with a bogus
    // absolute path; what we're checking is that it isn't short-circuited
    // with a 403 from the (disabled) allowed-roots guard.
    const res = await request.post(`${BRIDGE_URL}/api/ipc/renderer:is-directory`, {
      data: { args: ['/definitely/outside/any/hypothetical/sandbox'] }
    });
    expect(res.status()).not.toBe(403);
  });
});
