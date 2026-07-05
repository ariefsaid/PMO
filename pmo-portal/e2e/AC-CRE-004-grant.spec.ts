import { test, expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-CRE-004  Administration › Credits › Operator grant — real cross-stack journey
 * (ops-admin-surface S7 capstone, ADR-0010). Covers FR-CRE-005.
 *
 * Given the platform Operator on /administration › Credits, when they grant 500 credits (with a
 * unique note marker), then:
 *   1. the org-pool balance readout updates to reflect the grant (the `org_credit_balance` RPC
 *      recomputes grants − usage), AND
 *   2. an org Admin — in a SEPARATE session — subsequently sees the SAME balance read-only
 *      (the grant persists across sessions; single-tenant seed ⇒ Operator's home org IS the
 *      Admin's org, so the Admin sees the granted amount).
 *
 * Goal oracle: the grant persists across sessions (Operator grants → Admin sees it). The balance
 * readout (data-testid="org-credit-balance") is the real oracle; a unique note
 * (`AC-CRE-004 {timestamp}`) is recorded against the grant as a marker but is not the assertion.
 *
 * NOTE: the credits table is append-only and the seeded DB persists across runs, so the balance
 * only grows. The spec reads the starting balance, grants 500, and asserts the new balance is
 * ≥ start + 500 — deterministic regardless of prior runs.
 */

test.setTimeout(120_000);

/** Read the numeric org-credit-balance shown in the Credits section. */
async function readBalance(page: Page): Promise<number> {
  const cell = page.getByTestId('org-credit-balance');
  await expect(cell).toBeVisible({ timeout: 20_000 });
  const text = (await cell.textContent()) ?? '';
  const n = Number(text.replace(/[, ]/g, ''));
  expect(Number.isFinite(n), `balance readout "${text}" was not numeric`).toBeTruthy();
  return n;
}

/** Sign the current session out via the ContextBar "Sign out" button, then wait for /login. */
async function signOut(page: Page) {
  await page.getByRole('button', { name: /^sign out$/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
}

test(
  'AC-CRE-004: the Operator grants credits and an org Admin subsequently sees the updated balance read-only — goal oracle: the grant persists across sessions',
  async ({ page }) => {
    const note = `AC-CRE-004 ${Date.now()}`;
    const GRANT = 500;

    // ── Given: the Operator on /administration ──
    await signIn(page, 'arief.said@gmail.com');
    await page.goto('/administration');
    // Wait for the Users directory + sections to settle (the Credits section is composed on the page).
    await expect(page.getByRole('heading', { name: /^Credits$/ })).toBeVisible({ timeout: 20_000 });

    // Read the starting balance BEFORE granting (deterministic across re-runs — balance only grows).
    const startBalance = await readBalance(page);

    // ── When: they grant 500 credits with a note ──
    // The "Grant credits" affordance is Operator-only (FR-CRE-005, ADR-0049 — the RPC re-asserts
    // Operator authority server-side; this is the UX projection).
    await page.getByRole('button', { name: /grant credits/i }).click();
    const grantDialog = page.getByRole('dialog');
    await expect(grantDialog).toBeVisible({ timeout: 8_000 });
    await expect(grantDialog.getByText(/add credits to the org pool/i)).toBeVisible();

    await grantDialog.getByLabel(/amount/i).fill(String(GRANT));
    await grantDialog.getByLabel(/note/i).fill(note);
    await grantDialog.getByRole('button', { name: /grant credits/i }).click();

    // ── Then 1: the balance readout updates to reflect the grant (≥ start + GRANT) ──
    await expect.poll(async () => readBalance(page), { timeout: 30_000, intervals: [1_000] }).toBeGreaterThanOrEqual(
      startBalance + GRANT,
    );

    // ── Then 2: an org Admin in a SEPARATE session sees the SAME balance read-only ──
    await signOut(page);
    await signIn(page, 'admin@acme.test');
    await page.goto('/administration');
    await expect(page.getByRole('heading', { name: /^Credits$/ })).toBeVisible({ timeout: 20_000 });

    // GOAL ORACLE: the grant persists — the Admin's balance readout reflects the Operator's grant.
    // The Admin has NO "Grant credits" affordance (Operator-only); the balance is read-only here.
    const adminBalance = await readBalance(page);
    expect(adminBalance).toBeGreaterThanOrEqual(startBalance + GRANT);
    await expect(page.getByRole('button', { name: /grant credits/i })).not.toBeVisible();
  },
);
