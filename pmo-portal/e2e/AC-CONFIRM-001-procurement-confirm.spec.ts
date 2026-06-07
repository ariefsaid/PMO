import { test, expect } from '@playwright/test';
import { login } from './helpers';

// AC-CONFIRM-001 — confirm-before-mutate gate on a procurement transition.
//
// Given/When/Then (from the confirm-before-mutate owner rule):
//   Given: pm@acme.test is on the detail page for a Draft procurement (PROC-2026-006).
//   When:  they click the primary "Submit Request" action button.
//   Then:  a confirmation dialog appears (role="dialog") with the title
//          "Move request to Requested?" and a labelled confirm button "Submit Request".
//          No status change has occurred yet (status badge still reads "Draft").
//   And:   when they click "Cancel" the dialog closes and status is still "Draft"
//          (no write occurred — the no-single-click-write owner rule is upheld).
//
// Uses PROC-2026-006 (60000000-0000-0000-0000-000000000006) — a DEDICATED Draft
// fixture, requested_by = pm@acme.test (a2). Distinct from PROC-003 (…004, which
// AC-816 mutates Draft→Paid) so the two specs are ordering-independent in a parallel run.
//
// (owner rule: confirm-before-mutate; plan stage 5; feat/ui-polish)

const PROC_ID = '60000000-0000-0000-0000-000000000006';
const PROC_URL = `/procurement/${PROC_ID}`;

test('AC-CONFIRM-001: procurement transition requires a confirm dialog before status changes — cancel preserves Draft state', async ({ page }) => {
  // ── Arrange: sign in as pm@acme.test and navigate to the Draft procurement ──
  await login(page, 'pm@acme.test');
  await page.goto(PROC_URL);

  // Wait for the detail page to fully load (not in loading skeleton).
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });

  // Confirm the record is in Draft — the primary action button should be visible.
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Draft',
    { timeout: 10_000 },
  );

  // ── Act: click "Submit Request" — no write should happen on a single click ──
  const submitBtn = page.getByRole('button', { name: 'Submit Request' });
  await expect(submitBtn).toBeVisible({ timeout: 5_000 });
  await submitBtn.click();

  // ── Assert 1: a confirmation dialog appears (the no-single-click-write gate) ──
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // The dialog title must convey the destination stage (Given/When/Then: title).
  await expect(dialog.getByText(/Move request to Requested\?/i)).toBeVisible();

  // The confirm button label must match the action label so the user knows what fires.
  const confirmBtn = dialog.getByRole('button', { name: 'Submit Request' });
  await expect(confirmBtn).toBeVisible();

  // ── Assert 2: status badge has NOT changed — no write fired on the single click ──
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Draft',
  );

  // ── Act: cancel the dialog — the seed row must remain at Draft ──
  const cancelBtn = dialog.getByRole('button', { name: /cancel/i });
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();

  // ── Assert 3: dialog is gone and status is still Draft (no-write confirmed) ──
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute(
    'data-status',
    'Draft',
  );
});
