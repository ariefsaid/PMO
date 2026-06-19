/**
 * AC-PR-019 — One page shows pipeline + history + both IDs + inline capture.
 *
 * Given a procurement admin on /procurement/:id (showcase case SP2401-001:
 * "PV Modules — Meridian 4.2 MW", id 61000000-0000-0000-0000-000000000001, status Paid),
 * which has seeded purchase_requests, rfqs, purchase_orders, payments with both system
 * numbers (PR-…/RFQ-…/PO-…/PAY-…) and external references, plus 8 procurement_status_events,
 *
 * When the page loads,
 *
 * Then they see ON ONE PAGE (no navigation):
 *   1. The full lifecycle stepper (Procurement lifecycle aria-label).
 *   2. The progression-history list (ol[aria-label="Progression history"]) with ≥1 item.
 *   3. At least one record showing BOTH a system number (matching /PR-\d+|PO-\d+|PAY-\d+|RFQ-\d+/)
 *      AND its external reference number (matching /REQ-|SVX-|TT-|VEI-/).
 *   4. An inline capture affordance (trigger button "Add Purchase Request" etc.) adjacent to
 *      a phase — without navigating away.
 *
 * Note: the case is at "Paid" status so the admin sees no transition actions but does see
 * the capture triggers (canWrite = true for Admin).
 *
 * AC-PR-022 (no dead affordances) is partially satisfied here: the capture trigger is visible.
 * The full honest-doorway exercise (trigger → form → save) lives in AC-PR-020.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// SP2401-001: "PV Modules — Meridian 4.2 MW" — Paid, rich seed (PR+RFQ+PO+PAY records + 8 events)
const CASE_ID = '61000000-0000-0000-0000-000000000001';
const CASE_URL = `/procurement/${CASE_ID}`;

test('AC-PR-019 one page shows pipeline, history, both IDs, and inline capture without navigating', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto(CASE_URL);

  // Wait for the page to finish loading (not in loading skeleton)
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });

  // 1. Lifecycle stepper is present (aria-label="Procurement lifecycle")
  await expect(
    page.getByRole('list', { name: /procurement lifecycle/i }),
  ).toBeVisible({ timeout: 10_000 });

  // 2. Progression-history list with at least one item
  const historyList = page.getByRole('list', { name: 'Progression history' });
  await expect(historyList).toBeVisible({ timeout: 10_000 });
  // The showcase case has 8 seeded status events + several record-creation events → ≥1 li
  const historyItems = historyList.locator('li');
  await expect(historyItems.first()).toBeVisible({ timeout: 10_000 });

  // 3. At least one record showing BOTH a system number AND an external reference.
  //    Seed: PR-2509100001 + REQ-2025-0142, PO-2509200001 + PO-SV-2509-0142, etc.
  //    The RecordCard renders "System #" + "Ref #" labels. We assert both IDs are visible.
  //    Use the "System #" label text to scope — pick any visible record.
  const systemNumLabels = page.getByText('System #');
  await expect(systemNumLabels.first()).toBeVisible({ timeout: 10_000 });
  // There should be a ref label too (for the same records)
  const refLabels = page.getByText('Ref #');
  await expect(refLabels.first()).toBeVisible({ timeout: 10_000 });

  // Verify the system number pattern appears (PR- or PO- or PAY- or RFQ-)
  const hasSystemNumber =
    (await page.getByText(/^(PR|RFQ|PO|PAY)-\d{10}$/).count()) > 0;
  expect(hasSystemNumber, 'Expected at least one minted system number (PR/RFQ/PO/PAY-YYYYMMDD####) to be visible').toBe(true);

  // Verify an external reference appears (seeded refs use REQ- / SVX- / PO-SV- / TT-SV- / VEI-)
  const hasExternalRef =
    (await page.getByText(/REQ-|SVX-|PO-SV-|TT-SV-|VEI-|RMS-/).count()) > 0;
  expect(hasExternalRef, 'Expected at least one external reference number to be visible on a record card').toBe(true);

  // 4. An inline capture affordance (trigger button) is visible — "Add Purchase Request"
  //    "Add RFQ", "Add Purchase Order", or "Add Payment" — the RecordCaptureTrigger.
  //    canWrite is true for Admin.
  const captureTrigger = page.getByRole('button', {
    name: /^Add (Purchase Request|RFQ|Purchase Order|Payment)$/,
  });
  await expect(captureTrigger.first()).toBeVisible({ timeout: 10_000 });

  // Confirm we are still on the SAME page — no navigation occurred.
  await expect(page).toHaveURL(new RegExp(CASE_ID));
});
