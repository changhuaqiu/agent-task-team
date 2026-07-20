import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3327';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'autonomous-delivery-full-loop.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-autonomous' }]],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], channel: 'chrome' },
  }],
});
