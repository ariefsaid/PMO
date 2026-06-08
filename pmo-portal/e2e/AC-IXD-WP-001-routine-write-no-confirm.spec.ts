import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-IXD-WP-001 — routine reversible procurement forward steps are single-click + a toast
// (OD-UX-1, plan task 9; supersedes the "confirm before every write" rule for routine writes).
//
// Natural journey / Given-When-Then:
//   Given: an Approved PR (PROC-2026-007) that a sourcing user (finance@acme.test, a
//          non-requester) can move forward to Vendor Quoted.
//   When:  the user clicks "Request Vendor Quotes" — a routine, reversible forward step.
//   Then:  NO confirm dialog appears, the state advances on the SINGLE click, and a quiet
//          success toast confirms it.
//   Invariant: routine reversible writes are single-click + feedback, never a modal.
//
// Uses PROC-2026-007 (…007) — a dedicated Approved fixture (requested_by = pm@acme.test,
// approved_by = exec@acme.test) so a Finance sourcing user is SoD-clean and the row never
// collides with the AC-816 / AC-CONFIRM-001 fixtures in a parallel run.

const PROC_ID = '60000000-0000-0000-0000-000000000007';
const PROC_URL = `/procurement/${PROC_ID}`;

test('AC-IXD-WP-001: a routine procurement forward step (Request Vendor Quotes) is single-click with NO confirm dialog + a success toast', async ({ page }) => {
  // ── Arrange: sign in as the Finance sourcing user and open the Approved PR ──
  await login(page, 'finance@acme.test');
  await page.goto(PROC_URL);

  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Approved',
    { timeout: 10_000 },
  );

  // ── Act: click the routine forward step ──────────────────────────────────
  const requestQuotes = page.getByRole('button', { name: 'Request Vendor Quotes' });
  await expect(requestQuotes).toBeVisible({ timeout: 5_000 });
  await requestQuotes.click();

  // ── Assert 1: NO confirm dialog is staged (routine reversible write) ───────
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 1_000 });
  await expect(page.getByRole('alertdialog')).not.toBeVisible({ timeout: 1_000 });

  // ── Assert 2: the state advanced on the single click ──────────────────────
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Vendor Quoted',
    { timeout: 15_000 },
  );

  // ── Assert 3: a quiet success toast confirmed it ──────────────────────────
  await expect(page.getByRole('status').filter({ hasText: /Vendor Quoted/i })).toBeVisible({
    timeout: 10_000,
  });
});
