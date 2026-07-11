import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_PASSWORD } from './helpers';

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
 * A small retry is kept around the form login for the documented transient GoTrue flake
 * (see helpers.ts history / git blame) — but the final assertion is always the hard
 * goal-oracle `toHaveURL(/\/$/)`, never softened.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AUTH_DIR = path.join(__dirname, '.auth');

const SEED_EMAILS = [
  'exec@acme.test',
  'pm@acme.test',
  'finance@acme.test',
  'engineer@acme.test',
  'admin@acme.test',
  'ts-approve-eng@acme.test',
  'ts-approve-mgr@acme.test',
  'ts-colocated-eng@acme.test',
  // Seeded Platform Operator (supabase/seed.sql §U, ADR-0049) — used by AC-ENT-005 / AC-CRE-004.
  'operator@pmo.test',
] as const;

const SIGN_IN_ATTEMPTS = 3;
const SIGN_IN_BACKOFF_MS = [750, 1500];

for (const email of SEED_EMAILS) {
  setup(`authenticate ${email}`, async ({ page }) => {
    let signedIn = false;

    for (let attempt = 0; attempt < SIGN_IN_ATTEMPTS && !signedIn; attempt++) {
      await page.goto('/login');
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(SEED_PASSWORD);
      await page.getByRole('button', { name: /sign in/i }).click();

      signedIn = await Promise.race([
        expect(page)
          .toHaveURL(/\/$/, { timeout: 5_000 })
          .then(() => true)
          .catch(() => false),
        page
          .getByText(/invalid login credentials/i)
          .waitFor({ state: 'visible', timeout: 5_000 })
          .then(() => false)
          .catch(() => false),
      ]);

      if (!signedIn && attempt < SIGN_IN_ATTEMPTS - 1) {
        await page.waitForTimeout(SIGN_IN_BACKOFF_MS[Math.min(attempt, SIGN_IN_BACKOFF_MS.length - 1)]);
      }
    }

    // Final, unguarded goal-oracle: a genuinely-stuck sign-in still fails loudly here.
    await expect(page).toHaveURL(/\/$/);

    await page.context().storageState({ path: path.join(AUTH_DIR, `${email}.json`) });
  });
}
