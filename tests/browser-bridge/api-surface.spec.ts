import { test, expect } from '@playwright/test';

const BRIDGE_URL = 'http://localhost:4000';

/**
 * Exercises packages/bruno-server's HTTP surface directly (no page needed) —
 * a fast regression guard for the IPC proxy path itself, independent of the
 * frontend UI.
 */
test.describe('Bridge server API surface', () => {
  test('GET /api/health reports ok with registered handlers', async ({ request }) => {
    const res = await request.get(`${BRIDGE_URL}/api/health`);
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.channels).toBeGreaterThan(0);
  });

  test('GET /api/ipc/channels lists registered channels', async ({ request }) => {
    const res = await request.get(`${BRIDGE_URL}/api/ipc/channels`);
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(Array.isArray(body.channels)).toBe(true);
    expect(body.channels.length).toBeGreaterThan(0);
  });

  test('POST /api/ipc/:channel round-trips a real IPC handler call', async ({ request }) => {
    const res = await request.post(`${BRIDGE_URL}/api/ipc/renderer:open-about`, {
      data: { args: [] }
    });
    expect(res.ok()).toBe(true);

    const body = await res.json();
    expect(body.data).toEqual({ version: '2.0.0' });
  });

  test('POST /api/ipc/:unknown-channel returns 404 with a channel list', async ({ request }) => {
    const res = await request.post(`${BRIDGE_URL}/api/ipc/renderer:not-a-real-channel`, {
      data: { args: [] }
    });
    expect(res.status()).toBe(404);
  });
});
