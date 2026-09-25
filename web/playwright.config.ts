import { defineConfig, devices } from '@playwright/test'

// End-to-end UI tests against a running k8s-firewall-ui server backed by a
// real cluster with the sample app (hack/e2e). See hack/e2e/run-ui-tests.sh.
//   FWUI_URL           server URL (default http://localhost:8080)
//   FWUI_TOKEN         token of a user who may edit policies (token auth mode)
//   FWUI_VIEWER_TOKEN  token of a read-only user (optional)
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.e2e\.ts/,
  outputDir: './e2e-results',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  use: {
    baseURL: process.env.FWUI_URL ?? 'http://localhost:8080',
    storageState: 'e2e-auth/editor.json',
    viewport: { width: 1440, height: 900 },
    video: 'on',
    screenshot: 'on',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
