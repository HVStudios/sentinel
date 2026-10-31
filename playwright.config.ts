import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the same specs against both ways SENTINEL is served:
 * - live: the API server with the seeded database and the built web app;
 * - static: the GitHub Pages build (snapshot mode) under /sentinel/.
 * Run `npm run e2e` (which seeds and builds first via e2e/prepare.mjs).
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'live', use: { baseURL: 'http://127.0.0.1:8788/' } },
    { name: 'static', use: { baseURL: 'http://127.0.0.1:4174/sentinel/' } },
  ],
  webServer: [
    {
      command: 'node --disable-warning=ExperimentalWarning server/src/main.ts',
      url: 'http://127.0.0.1:8788/api/health',
      env: { PORT: '8788', HOST: '127.0.0.1', SENTINEL_DB: 'e2e/.data/seed.db' },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm exec -w web -- vite preview --outDir ../e2e/.data/static --port 4174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4174/sentinel/',
      env: { VITE_BASE: '/sentinel/' },
      reuseExistingServer: !process.env.CI,
    },
  ],
});
