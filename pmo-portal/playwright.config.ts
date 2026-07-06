import { defineConfig, devices } from '@playwright/test';

// Acceptance (BDD) layer. Each spec maps 1:1 to an AC-### from docs/specs/*.spec.md.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // CI runs serially (one worker): every spec does a REAL password sign-in, and the
  // local single-instance GoTrue/Postgres saturates under many concurrent bcrypt
  // verifications on a CI runner — surfacing as intermittent "Invalid login
  // credentials" (a valid password mis-rejected under load, NOT a rate-limit 429).
  // Serial e2e is the repo's standing lesson; ~68 specs fit well inside the 30-min
  // job. Locally, workers stays unset (parallel) for speed.
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Pin the browser clock to UTC so the UI's "current week" (derived from the browser's local
    // time) matches the seed's UTC `date_trunc('week', current_date)` week on ANY host timezone.
    // Without this, a host ahead of UTC (e.g. GMT+7, late-UTC-Sunday = local-Monday) computes a
    // different current week than the UTC-seeded data, breaking the timesheet journeys (AC-911,
    // AC-TSE-021). CI is UTC end-to-end so this is a no-op there.
    timezoneId: 'UTC',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
