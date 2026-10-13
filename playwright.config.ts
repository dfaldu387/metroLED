import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests.
 *
 * These run against a real server with the demo dataset, which exercises the
 * whole stack - session, access scope, analytics, rendering - without needing
 * live provider credentials.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // The whole suite runs against a single Next.js process. Letting Playwright
  // use every core saturates that one server and turns ordinary server round
  // trips into timeouts, which looks like flakiness but is just load.
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  // Each assertion may be waiting on a server render, not a client update.
  expect: { timeout: 15_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['iPad (gen 7)'] } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],

  /*
    The suite runs against the labelled demo dataset, so it needs no provider
    credentials and no seeded database. That means it must NOT depend on the
    developer's own .env: `ALLOW_DEMO_DATA` is forced on for this server only,
    and it builds into its own directory so a `next dev` running from the same
    checkout cannot overwrite the build underneath it.

    Set E2E_BASE_URL to run against a server you started yourself - in which
    case you own those two settings.
  */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: `${BASE_URL}/sign-in`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { ALLOW_DEMO_DATA: 'true', APP_ENV: 'development', NEXT_DIST_DIR: '.next-e2e' },
      },
})
