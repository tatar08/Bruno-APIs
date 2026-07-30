import { defineConfig } from '@playwright/test';

const reporter: any[] = [['list'], ['html'], ['json', { outputFile: 'playwright-report/results.json' }]];

if (process.env.CI) {
  reporter.push(['github']);
}

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: undefined,
  reporter,

  use: {
    trace: process.env.CI ? 'on-first-retry' : 'on'
  },

  projects: [
    {
      name: 'default',
      testDir: './tests',
      testIgnore: [
        'ssl/**', // custom CA certificate tests require separate server setup and certificate generation
        'auth/**', // auth tests have their own project
        'benchmarks/**',
        'proxy/system-pac/**' // shares ports with proxy/pac — runs in its own project after default
      ]
    },
    {
      name: 'auth',
      testDir: './tests/auth'
    },
    {
      name: 'ssl',
      testDir: './tests/ssl'
    },
    {
      // system-pac and pac specs share the same PAC/proxy/target ports.
      name: 'system-pac',
      testDir: './tests/proxy/system-pac',
    },
    {
      // Runs the app in a real browser against packages/bruno-server (no
      // Electron), exercising the Browser Bridge IPC-over-HTTP/WS path —
      // see Improvement.md P0.6 / #7.
      name: 'browser-bridge',
      testDir: './tests/browser-bridge',
      use: { baseURL: 'http://localhost:3000' }
    }
  ],

  webServer: [
    {
      command: 'npm run dev:web',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 10 * 60 * 1000
    },
    {
      command: 'npm start --workspace=packages/bruno-tests',
      url: 'http://localhost:8081/ping',
      reuseExistingServer: !process.env.CI,
      timeout: 10 * 60 * 1000
    },
    {
      // Only exercised by the browser-bridge project; harmless idle process
      // for every other project since Electron mode never talks to it.
      command: 'npm run dev:server',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 10 * 60 * 1000
    }
  ]
});
