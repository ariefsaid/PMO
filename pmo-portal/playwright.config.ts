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
    // Retained only on failure so local/CI runs stay light; these are the CI diagnostics that let
    // `npx playwright show-trace`/the report reconstruct a failing spec's DOM without re-running it.
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Pin the browser clock to UTC so the UI's "current week" (derived from the browser's local
    // time) matches the seed's UTC `date_trunc('week', current_date)` week on ANY host timezone.
    // Without this, a host ahead of UTC (e.g. GMT+7, late-UTC-Sunday = local-Monday) computes a
    // different current week than the UTC-seeded data, breaking the timesheet journeys (AC-911,
    // AC-TSE-021). CI is UTC end-to-end so this is a no-op there.
    timezoneId: 'UTC',
    // AC-L10N-061: pin the browser locale too. `timezoneId` alone left the locale inherited from
    // the host — en-US on the dev Mac and on CI — so every money/date assertion in the e2e suite
    // was certifying a locale nobody chose, and would have silently kept passing on a host that
    // defaults elsewhere. The language-switch journey (AC-L10N-060) changes the IN-APP locale via
    // the profile, which is independent of this browser-level pin.
    locale: 'en-US',
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
      // AC-CON-003-*/AC-CON-012-*/AC-VISUAL-CHECKBOX-001-* specs run against their own dev
      // server (port 3100, see webServer below) and are excluded here too so they are never
      // also picked up against port 3000.
      testIgnore: [/auth\.setup\.ts/, /e2e\/serial\//, /AC-CON-003-/, /AC-CON-012-/, /AC-VISUAL-CHECKBOX-001-/],
    },
    {
      // @e2e-isolation: serial lane — org-global specs. Run in a SECOND invocation at --workers=1
      // (see the `e2e` npm script) so these never overlap the parallel batch or each other.
      name: 'serial',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: /e2e\/serial\/.*\.spec\.ts/,
      fullyParallel: false,
    },
    {
      // AC-CON-003/AC-CON-012 run against a SECOND dev server with analytics actually ENABLED.
      // Without it the specs are vacuous: getAnalyticsConfig() disables analytics whenever
      // VITE_POSTHOG_KEY is not a valid phc_ key, which it never is in e2e — so "no request to
      // the PostHog host" / "no third-party request" would pass before any of this work existed.
      // See docs/plans/2026-07-25-observability-analytics.md D6.
      name: 'consent',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100' },
      testMatch: /AC-CON-(003|012)-.*\.spec\.ts|AC-VISUAL-CHECKBOX-001-.*\.spec\.ts/,
      fullyParallel: false,
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      // The authoritative CI/local-promotion lane must serve this checkout, never
      // silently attach to port 3000 from another worktree.
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Analytics-ENABLED lane for AC-CON-003 only. The key is a syntactically valid throwaway (it
      // must satisfy isValidPosthogKey); the host is unroutable on purpose, so every PostHog request
      // is trivially identifiable and is intercepted by the spec rather than actually leaving.
      command: 'npm run dev -- --port 3100 --strictPort',
      url: 'http://localhost:3100',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_ANALYTICS_ENABLED: 'true',
        VITE_POSTHOG_KEY: 'phc_e2econsentlanefakekey00000',
        VITE_POSTHOG_HOST: 'https://ph-e2e.invalid',
      },
    },
  ],
});
