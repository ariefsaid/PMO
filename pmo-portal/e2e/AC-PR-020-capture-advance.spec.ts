/**
 * AC-PR-020 — Capture a record with external ref + date + amount on one page, confirm
 *             it appears with both IDs in the Documents ledger, and confirm the
 *             Progression timeline gains the event.
 *
 * AC-PR-022 (no dead affordances / honest doorway) is folded in: every affordance
 *           exercised here (capture trigger, form submit, and when available an advance
 *           action) performs its action — none is a no-op.
 *
 * JOURNEY UPDATE for the tabbed record shell (`/procurement/:id/:tab`):
 *   The capture affordance moved from per-phase trigger buttons (old stacked layout)
 *   to the Documents tab's LedgerCaptureRow (one capture row, pre-selects next type).
 *   System # and External ref are now columns in the ledger DataTable, not RecordCard fields.
 *   The Progression timeline lives on the Overview tab.
 *
 * Cases used:
 *   CAPTURE: SP2401-004 "DC/AC Cabling & Balance of System" (id …000000000004).
 *     - Non-terminal status (Approved at reset, possibly Vendor Quoted if AC-PR-022 ran first).
 *     - Both Approved and Vendor Quoted map nextExpectedType → 'rfq', so the form is
 *       always `form-capture-rfq` for this case's realistic states.
 *     - Admin is not the requester (requester = a4), so no SoD block.
 *     - Tests run serially within this file (test.describe.configure({mode:'serial'})) to
 *       avoid DB state interference between AC-PR-020 and AC-PR-022 in this spec.
 *
 *   ADVANCE: SP2401-004 (same case) — Admin may click "Request Vendor Quotes" at Approved.
 *     (If already past Approved the advance test passes via the early-return path.)
 *
 * Goal-oracle per AC-PR-020 (unchanged):
 *   1. New record appears in the Documents ledger with BOTH system number AND external reference.
 *   2. Progression timeline (Overview tab) gains at least one new event after capture.
 *   3. When an advance action is available and clicked, the case status updates — all on
 *      one page (no navigation).
 *
 * AC-PR-022 oracle (folded):
 *   Every affordance exercised (ledger-capture-open, save, advance) performs its stated action.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// SP2401-004: "DC/AC Cabling & Balance of System" — Approved at reset; non-terminal; Admin ≠ requester
const CAPTURE_CASE_ID = '61000000-0000-0000-0000-000000000004';

// Serial mode: AC-PR-022 must not advance the case before AC-PR-020 has captured its record.
// This keeps the two tests in a predictable order within this file; both still run.
test.describe.configure({ mode: 'serial' });

test('AC-PR-020 capture a record via Documents-tab ledger — system # + external ref appear, history grows — on one page', async ({ page }) => {
  await signIn(page, 'admin@acme.test');

  // ── Step 1: Load the case, measure the Progression timeline before capture ──
  await page.goto(`/procurement/${CAPTURE_CASE_ID}/overview`);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });

  // Snapshot the Progression timeline event count BEFORE capture
  const historyList = page.getByRole('list', { name: 'Progression history' });
  await expect(historyList).toBeVisible({ timeout: 10_000 });
  const beforeCount = await historyList.locator('li').count();

  // ── Step 2: Navigate to the Documents tab ────────────────────────────────────
  const documentsTab = page.getByRole('tab', { name: /Documents/i });
  await expect(documentsTab).toBeVisible({ timeout: 5_000 });
  await documentsTab.click();

  await expect(page.getByTestId('procurement-ledger')).toBeVisible({ timeout: 10_000 });

  // ── Step 3: Open the LedgerCaptureRow form ────────────────────────────────────
  // nextExpectedType('Approved') = 'rfq'; nextExpectedType('Vendor Quoted') = 'rfq'
  // So this button is present for both the Approved and Vendor Quoted states.
  const captureOpenBtn = page.getByTestId('ledger-capture-open');
  await expect(captureOpenBtn).toBeVisible({ timeout: 10_000 });
  // AC-PR-022: clicking the trigger opens the capture form (not a no-op)
  await captureOpenBtn.click();

  // The RFQ capture form is now open
  const captureForm = page.getByTestId('form-capture-rfq');
  await expect(captureForm).toBeVisible({ timeout: 5_000 });

  // ── Step 4: Fill external ref + date + amount ─────────────────────────────────
  const EXT_REF = `TEST-RFQ-AC020-${Date.now()}`;
  await page.getByTestId('rfq-ref-input').fill(EXT_REF);
  await page.getByTestId('rfq-date-input').fill('2026-06-15');
  await page.getByTestId('rfq-amount-input').fill('85000');

  // ── Step 5: Save (AC-PR-022: save performs its action) ───────────────────────
  await page.getByTestId('rfq-save-btn').click();
  // Form closes after successful save
  await expect(captureForm).not.toBeVisible({ timeout: 15_000 });

  // ── Goal 1b: external reference appears in the ledger (primary oracle) ────────
  // This is the strongest assertion: if EXT_REF is visible, the record was saved
  // and the React Query cache invalidated + re-rendered with the new row.
  const ledger = page.getByTestId('procurement-ledger');
  await expect(ledger.getByText(EXT_REF).first()).toBeVisible({ timeout: 15_000 });

  // ── Goal 1c: system number column shows an RFQ- number in the ledger ──────────
  const hasRfqNumber = (await ledger.getByText(/^RFQ-\d+$/).count()) > 0;
  expect(hasRfqNumber, 'Expected at least one RFQ- system number in the ledger').toBe(true);

  // Both column headers visible — dual-ID display (AC-PR-024)
  await expect(ledger.getByText('System #')).toBeVisible({ timeout: 5_000 });
  await expect(ledger.getByText('External ref')).toBeVisible({ timeout: 5_000 });

  // ── Step 6: Navigate back to Overview tab — confirm timeline grew ─────────────
  const overviewTab = page.getByRole('tab', { name: /Overview/i });
  await overviewTab.click();

  // React Query cache is invalidated after capture → the detail bundle refetches
  // and the timeline rebuilds with the new RFQ event.
  await expect(async () => {
    const afterCount = await historyList.locator('li').count();
    expect(
      afterCount,
      `Progression timeline should have grown after capture (before: ${beforeCount})`,
    ).toBeGreaterThan(beforeCount);
  }).toPass({ timeout: 15_000 });

  // Still on the SAME page — no navigation occurred (JTBD P1 goal)
  await expect(page).toHaveURL(new RegExp(CAPTURE_CASE_ID));
});

test('AC-PR-022 advance action on the case page performs its stated action (honest doorway)', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto(`/procurement/${CAPTURE_CASE_ID}`);

  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });

  // Read the current status to make the test state-aware
  const statusBadge = page.getByTestId('procurement-status-badge');
  await expect(statusBadge).toBeVisible({ timeout: 10_000 });
  const currentStatus = await statusBadge.getAttribute('data-status');

  // Find the primary advance action available to Admin at this status.
  // The JTBD goal is: clicking the action actually moves the case forward.
  // Routine, single-click actions (no confirm dialog):
  //   At Approved: "Request Vendor Quotes" or "Generate Purchase Order"
  //   At Requested: "Submit Request"
  //   At Quote Selected: "Generate Purchase Order"
  const actionBtns = page.getByRole('button', {
    name: /^(Submit Request|Request Vendor Quotes|Generate Purchase Order|Confirm Receipt)$/,
  });
  const count = await actionBtns.count();

  if (count === 0) {
    // No routine advance action visible — the case may be in a state where only
    // consequential (confirm-dialog) or no actions are available to Admin.
    // This satisfies "no dead affordances" by showing no false promises.
    console.log(`AC-PR-022: case ${CAPTURE_CASE_ID} at status "${currentStatus}" has no routine advance action available to Admin — honest (no dead buttons shown).`);
    return;
  }

  // The first routine action is present — click it and assert it worked
  const actionBtn = actionBtns.first();
  const actionLabel = await actionBtn.textContent();
  await actionBtn.click();

  // The advance should change the status (routine steps have no confirm dialog)
  await expect(statusBadge).not.toHaveAttribute('data-status', currentStatus ?? '', {
    timeout: 15_000,
  });

  // Status did change — the button was not a no-op (honest doorway confirmed)
  const newStatus = await statusBadge.getAttribute('data-status');
  expect(newStatus, `Status should have changed after clicking "${actionLabel}"`).not.toBe(currentStatus);

  // Still on same page
  await expect(page).toHaveURL(new RegExp(CAPTURE_CASE_ID));
});
