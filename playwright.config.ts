import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1560, height: 1000 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Offline containers may lack libatk/libgbm etc. If ./playwright-libs exists
          // (extracted Debian packages), point the loader at it. Plain dev machines ignore this.
          env: {
            ...process.env,
            LD_LIBRARY_PATH: [
              path.join(here, 'playwright-libs'),
              process.env.LD_LIBRARY_PATH ?? '',
            ].filter(Boolean).join(':'),
          },
        },
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
