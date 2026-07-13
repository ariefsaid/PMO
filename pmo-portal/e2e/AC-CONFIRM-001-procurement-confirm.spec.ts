// @e2e-isolation: dedicated-row — owns PROC-2026-006 (60000000-...-006); dedicated Draft procurement fixture; no other spec targets it.
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-CONFIRM-001 — confirm-before-mutate gate on a CONSEQUENTIAL procurement transition
// (OD-UX-1, supersedes the old "confirm before every write"). The gate now applies to the
// consequential/destructive set {Approve, Reject, Cancel, Mark-as-Paid}; routine reversible
// forward steps are single-click (see AC-IXD-WP-001). This spec proves the kept gate's
// goal-oracle is intact: a confirm appears before the write, and dismissing it preserves state
// (no write occurred).
//
// Given/When/Then:
//   Given: a Requested procurement (PROC-2026-006, requested by pm@) that a non-requester
//          approver (finance@) is viewing.
//   When:  they click "Reject" — a consequential/destructive action.
//   Then:  a destructive confirm (role="alertdialog") appears; the status badge still reads
//          "Requested" (no write fired on the single click).
//   And:   when they dismiss the confirm, the dialog closes and status is still "Requested"
//          (no write occurred — the confirm-before-consequential-write rule is upheld).
//
// Uses PROC-2026-006 (…006) — a DEDICATED Draft fixture, requested_by = pm@acme.test (a2).
// pm submits it (routine single click → Requested); finance@ (non-requester) then exercises the
// kept Reject confirm. Distinct from the AC-816 / AC-IXD-WP fixtures so the specs are
// ordering-independent in a parallel run.

const PROC_ID = '60000000-0000-0000-0000-000000000006';
const PROC_URL = `/procurement/${PROC_ID}`;

test('AC-CONFIRM-001: a consequential procurement transition (Reject) requires a confirm before status changes — dismiss preserves state', async ({ page }) => {
  // ── Arrange: pm@ submits the Draft (routine forward step → single click, no dialog) ──
  await login(page, 'pm@acme.test');
  await page.goto(PROC_URL);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Draft', {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Submit Request' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', {
    timeout: 15_000,
  });

  // ── Arrange: finance@ (a non-requester approver) opens the Requested PR ──
  await login(page, 'finance@acme.test');
  await page.goto(PROC_URL);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', {
    timeout: 10_000,
  });

  // ── Act: click "Reject" — a consequential write must NOT fire on a single click ──
  const rejectBtn = page.getByRole('button', { name: 'Reject', exact: true });
  await expect(rejectBtn).toBeVisible({ timeout: 5_000 });
  await rejectBtn.click();

  // ── Assert 1: a destructive confirm appears (the confirm-before-mutate gate) ──
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const confirmBtn = dialog.getByRole('button', { name: 'Reject', exact: true });
  await expect(confirmBtn).toBeVisible();

  // ── Assert 2: status badge has NOT changed — no write fired on the single click ──
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested');

  // ── Act: dismiss the confirm — the PR must remain Requested ──
  const cancelBtn = dialog.getByRole('button', { name: /cancel/i });
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();

  // ── Assert 3: dialog is gone and status is still Requested (no-write confirmed) ──
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested');
});
