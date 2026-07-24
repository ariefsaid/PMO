import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { SEED_PASSWORD, AUTH_DIR } from './helpers';

/**
 * #306 — auth setup project.
 *
 * For each seed role, drive ONE real browser form sign-in and capture the resulting
 * `storageState` (localStorage, which is where the Supabase browser client persists its
 * session — see src/lib/supabase/client.ts `persistSession: true`) to `.auth/<email>.json`.
 *
 * This runs once per test run (as the `setup` Playwright project — see playwright.config.ts),
 * BEFORE the `chromium` project (which depends on it). `e2e/helpers.ts` `signIn()` then
 * injects the captured session directly, so specs land authenticated without paying a real
 * bcrypt verification per spec (the change that let CI move off `workers: 1`).
 *
 * A transient login failure is intentionally left visible to Playwright. CI
 * retries at the runner level and `--fail-on-flaky-tests` turns a retry-masked
 * recovery into a red gate instead of silently accepting an unstable setup.
 */

const SEED_EMAILS = [
  'exec@acme.test',
  'pm@acme.test',
  'finance@acme.test',
  'engineer@acme.test',
  'admin@acme.test',
  'ts-approve-eng@acme.test',
  'ts-approve-mgr@acme.test',
  'ts-colocated-eng@acme.test',
  // Dedicated engineer for AC-TSE-021's isolated timesheet journey (supabase/seed.sql §D).
  'tse-021-eng@acme.test',
  // Seeded Platform Operator (supabase/seed.sql §U, ADR-0049) — used by AC-ENT-005 / AC-CRE-004.
  'operator@pmo.test',
] as const;

for (const email of SEED_EMAILS) {
  setup(`authenticate ${email}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(SEED_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

    await page.context().storageState({ path: path.join(AUTH_DIR, `${email}.json`) });
  });
}
