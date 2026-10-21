import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT || 3001);
const webPort = Number(process.env.WEB_PORT || 5173);
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  // Keep artifacts out of the default `test-results/` root: Playwright wipes
  // outputDir on start, and the test DB lives under test-results/ too.
  outputDir: 'test-results/playwright',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    video: 'on',
    screenshot: 'on',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'web-mock', testMatch: 'web-mock/**/*.spec.ts' },
    { name: 'fullstack', testMatch: 'fullstack/**/*.spec.ts' },
    { name: 'visual', testMatch: 'visual/**/*.spec.ts' },
  ],
  webServer: [
    {
      command: 'npm run start -w @cac/server',
      url: `http://127.0.0.1:${port}/api/health`,
      reuseExistingServer,
      timeout: 60_000,
      env: {
        PORT: String(port),
        APP_ENV: 'test',
        DB_PATH: `test-results/e2e-${port}.db`,
        BULK_ISSUE_DELAY_MS: '0',
      },
    },
    {
      command: 'npm run dev -w @cac/web',
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer,
      timeout: 60_000,
      env: { WEB_PORT: String(webPort), PORT: String(port) },
    },
  ],
});
