// @e2e-isolation: self-isolated — the company POST is intercepted and never reaches the DB, so
// no row is created and no seed data is touched. Route interception is per-page (per-worker).
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * AC-A11Y-MODAL-001 / AC-ERR-001 — a REJECTED save inside a dialog.
 *
 * Graduated from the 2026-07-28 rendered Discover pass, which drove a 403 `42501` at
 * `POST /rest/v1/companies` and found:
 *   - the only failure feedback was a toast ~700px away that self-dismissed after ~8s,
 *     after which the modal was indistinguishable from a pristine form with data in it;
 *   - `document.activeElement` was `BODY`, and Tab from there walked BEHIND the dialog
 *     ("Skip to main content" → "Dashboard" → "Sales Pipeline" → …) because the background
 *     was neither `inert` nor `aria-hidden` despite `aria-modal="true"`.
 *
 * Goal oracle: after the rejected save the user can still SEE what happened (a persistent
 * in-dialog error) and their keyboard is still inside the dialog (Tab cannot reach the app
 * behind it).
 */

test.setTimeout(120_000);

test(
  'AC-A11Y-MODAL-001 + AC-ERR-001: a rejected company save keeps a persistent in-dialog error and keeps focus inside the dialog — goal oracle: error still visible, Tab never reaches the background',
  async ({ page }) => {
    await signIn(page, 'admin@acme.test');

    // Reject the write the way Postgres RLS does.
    await page.route('**/rest/v1/companies*', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: '42501',
          message: 'new row violates row-level security policy for table "companies"',
        }),
      });
    });

    await page.goto('/companies');
    await expect(page.getByTestId('liststate-loading')).not.toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: /New company/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.getByLabel(/^Company name/).fill('E2E-RLS-Denied-Co');
    await page.getByRole('button', { name: 'Create company' }).click();

    // 1. Persistent in-dialog evidence — inside the dialog, not a corner toast.
    const saveError = page.getByTestId('entity-modal-save-error');
    await expect(saveError).toBeVisible();
    await expect(saveError).toContainText(/permission/i);
    // …and it says NOTHING about tables or row-level security (AC-ERR-002).
    await expect(saveError).not.toContainText(/row-level security|table "/i);

    // 2. It OUTLIVES the toast (which auto-dismisses at 4s).
    await page.waitForTimeout(6_000);
    await expect(saveError).toBeVisible();
    await expect(dialog).toBeVisible();
    // The typed value is still there — nothing was lost.
    await expect(page.getByLabel(/^Company name/)).toHaveValue('E2E-RLS-Denied-Co');

    // 3. Focus was returned INTO the dialog, not left on <body>.
    expect(
      await page.evaluate(() => {
        const el = document.activeElement;
        return !!el && el !== document.body && !!el.closest('[role="dialog"]');
      }),
    ).toBe(true);

    // 4. The background is inert, so Tab can never walk behind the dialog.
    expect(
      await page.evaluate(() => document.querySelector('[data-app-shell="root"]')?.hasAttribute('inert')),
    ).toBe(true);

    const outside: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press('Tab');
      const escaped = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        if (el.closest('[role="dialog"]')) return null;
        return el.tagName + ':' + (el.textContent ?? '').trim().slice(0, 40);
      });
      if (escaped) outside.push(escaped);
    }
    expect(outside, `Tab escaped the dialog to: ${outside.join(', ')}`).toEqual([]);

    // 5. The dialog is still dismissible by keyboard (the modal is not itself a trap).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible(); // dirty → discard confirm
    await page.getByRole('button', { name: /^Discard$/ }).click();
    await expect(dialog).not.toBeVisible();
  },
);
