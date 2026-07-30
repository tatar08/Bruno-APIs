import { test, expect } from '@playwright/test';

/**
 * Boots the real frontend (packages/bruno-app) in a plain Chromium page —
 * no Electron, no preload script — so it falls back to BrowserTransport
 * and talks to packages/bruno-server over HTTP + WebSocket. This is the
 * "Browser Bridge" path from Improvement.md; the electron-based projects
 * never exercise it.
 */
test('loads the app in Browser Mode via the bridge server', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-app-state="loaded"]').waitFor({ timeout: 30000 });

  await expect(page.locator('.workspace-name-container')).toBeVisible();

  // BrowserTransport monkey-patches this on in getTransport() only when it
  // picks the browser path (i.e. no Electron preload was present).
  const usedBrowserTransport = await page.evaluate(() => {
    return typeof (window as any).ipcRenderer?.isElectron === 'boolean'
      ? (window as any).ipcRenderer.isElectron === false
      : false;
  });
  expect(usedBrowserTransport).toBe(true);
});
