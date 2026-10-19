import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['sharding.fixture.ts'],
  fullyParallel: true,
  retries: 0,
  timeout: 5000,
  reporter: 'json',
  projects: [
    {
      name: 'chromium',
      metadata: {
        emulation: {
          browserName: 'chromium',
          viewport: { width: 800, height: 600 },
        },
      },
      use: {
        browserName: 'chromium',
        viewport: { width: 800, height: 600 },
      },
    },
  ],
});
