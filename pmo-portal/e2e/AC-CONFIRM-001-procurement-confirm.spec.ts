// @e2e-isolation: self-isolated — creates its own namespaced Draft procurement (service-role) and removes it afterwards, so it passes on a reused database.
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { createProcurementFixture, type ProcurementFixture } from './procurement-fixture';

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
// Fixture: a Draft procurement created for this run (requested_by = pm@acme.test) and removed
// afterwards (#1882) — the old shared seed row was already Requested on any database a previous
// run had touched. pm submits it (routine single click → Requested).

// The Reject confirm-before-write half moved to pages/ProcurementDetails.test.tsx (AC-CONFIRM-001);
// this keeps the real routine Draft → Requested submit.
test.describe.serial('AC-CONFIRM-001 ordered journey', () => {
let fixture: ProcurementFixture;
test.beforeAll(async () => {
  fixture = await createProcurementFixture({ status: 'Draft', title: 'AC-CONFIRM-001' });
});
test.afterAll(async () => {
  await fixture?.cleanup();
});
test('Supporting proof: pm@ submits the Draft as a routine single-click step (no dialog)', async ({ page }) => {
  // ── Arrange: pm@ submits the Draft (routine forward step → single click, no dialog) ──
  await login(page, 'pm@acme.test');
  await page.goto(fixture.url);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Draft', {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', {
    timeout: 15_000,
  });
});
});
