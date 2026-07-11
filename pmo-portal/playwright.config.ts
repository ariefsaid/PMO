import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// Acceptance (BDD) layer. Each spec maps 1:1 to an AC-### from docs/specs/*.spec.md.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // #306: session-injection removes the per-spec bcrypt that forced workers:1. If CI surfaces
  // shared-DB DATA-race flakes (not auth), revert to `process.env.CI ? 1` — the auth-reuse win
  // stands regardless; DB data isolation is a separate follow-up.
  workers: process.env.CI ? 4 : undefined,
  reporter: 'html',
  // Write ephemeral artifacts (traces, screenshots, error-context) OUTSIDE the worktree. Two reasons:
  //   1. They are gitignored throwaway output — `/tmp` is the honest home for them.
  //   2. Locally, `supabase functions serve` runs an in-process edge runtime with a project file
  //      watcher. When Playwright wrote `test-results/…` into the worktree mid-run, that watcher
  //      RESTARTED the edge runtime — which returned a transient 503 (cold-start) or, worse,
  //      interrupted `admin-invite-user` mid-invite and surfaced a 502. Moving the artifacts out of
  //      the watched tree stops the restart churn and stabilizes AC-INV-001 (and every other spec).
  outputDir: path.join(os.tmpdir(), 'pmo-portal-test-results'),
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
  projects: [
    // #306: real form-login happens once here (per seed role), before the chromium project.
    // Captures each role's storageState to e2e/.auth/<email>.json for e2e/helpers.ts signIn().
    // fullyParallel:false pins the 9 role logins (all in auth.setup.ts) to serial: they do REAL
    // bcrypt sign-ins, and running them ~4-concurrent under the global workers:4 would reintroduce
    // the GoTrue-saturation flake this issue removes — with an outsized blast radius, since
    // `dependencies: ['setup']` means one failed login would block every spec.
    { name: 'setup', testMatch: /auth\.setup\.ts/, fullyParallel: false },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      // Exclude the setup file AND the serial lane — the serial project owns e2e/serial/**.
      testIgnore: [/auth\.setup\.ts/, /e2e[\/]serial[\/]/],
    },
    {
      // @e2e-isolation: serial lane — org-global specs. Run in a SECOND invocation at --workers=1
      // (see the `e2e` npm script) so these never overlap the parallel batch or each other.
      name: 'serial',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: /e2e[\/]serial[\/].*\.spec\.ts/,
      fullyParallel: false,
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
