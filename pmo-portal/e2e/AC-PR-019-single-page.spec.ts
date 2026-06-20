/**
 * AC-PR-019 — One page shows pipeline + history + both IDs + inline capture.
 *
 * GOAL (unchanged): "operate the whole case on one page, see records with both
 * IDs + history without leaving the page."
 *
 * The page is now a TABBED record shell (`/procurement/:id/:tab`):
 *   - Overview tab  → lifecycle stepper + Progression history timeline
 *   - Documents tab → case ledger (System # · External ref per row) + capture affordance
 *
 * Journey update (tabbed UX):
 *   1. Load the Paid showcase case (SP2401-001 — richest seed: PR/RFQ/PO/PAY + 8 events).
 *      Default tab = Overview.
 *   2. Overview: assert the stepper + the Progression history timeline (ol aria-label).
 *   3. Navigate to Documents tab via the tab bar.
 *   4. Documents: assert "System #" and "External ref" column headers are visible
 *      (the ledger shows both identities per row — AC-PR-024 dual-ID display).
 *   5. Assert specific system-number and external-reference values from the seed
 *      (PR-2509100001 / REQ-2025-0142; PO-2509200001 / PO-SV-2509-0142).
 *      Scoped to the ledger to avoid strict-mode conflict with the stepper's ref display.
 *   6. For the capture affordance: navigate to a non-terminal case (SP2401-004 Approved)
 *      where the Documents-tab ledger shows the LedgerCaptureRow. Assert the row's
 *      "Capture <type>" open button is visible. (Paid is terminal — no capture row is
 *      the correct honest-doorway behavior, not a bug.)
 *   7. All assertions happen without navigating away from /procurement/...
 *
 * AC-PR-022 partial cover: capture trigger is visible on the non-terminal case.
 * Full honest-doorway exercise (trigger → form → save) lives in AC-PR-020.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

// SP2401-001: "PV Modules — Meridian 4.2 MW" — Paid, richest seed (PR+RFQ+PO+PAY + 8 events)
const PAID_CASE_ID = '61000000-0000-0000-0000-000000000001';
// SP2401-004: "DC/AC Cabling & Balance of System" — Approved (non-terminal, has capture row)
const APPROVED_CASE_ID = '61000000-0000-0000-0000-000000000004';

test('AC-PR-019 one page shows pipeline, history, both IDs, and inline capture without navigating', async ({ page }) => {
  // ── Part 1: Paid showcase case — Overview tab + Documents tab (dual-ID ledger) ──
  await signIn(page, 'admin@acme.test');
  await page.goto(`/procurement/${PAID_CASE_ID}`);

  // Wait for the page to finish loading (not in loading skeleton)
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });

  // ── OVERVIEW TAB (default) ──

  // 1. Lifecycle stepper is present (aria-label="Procurement lifecycle")
  await expect(
    page.getByRole('list', { name: /procurement lifecycle/i }),
  ).toBeVisible({ timeout: 10_000 });

  // 2. Progression-history timeline is present on the Overview tab
  //    (ol[aria-label="Progression history"], with ≥1 event)
  const historyList = page.getByRole('list', { name: 'Progression history' });
  await expect(historyList).toBeVisible({ timeout: 10_000 });
  const historyItems = historyList.locator('li');
  await expect(historyItems.first()).toBeVisible({ timeout: 10_000 });

  // ── DOCUMENTS TAB — dual-ID ledger ──

  // Navigate to the Documents tab
  const documentsTab = page.getByRole('tab', { name: /Documents/i });
  await expect(documentsTab).toBeVisible({ timeout: 5_000 });
  await documentsTab.click();

  // Wait for the ledger to render
  const ledger = page.getByTestId('procurement-ledger');
  await expect(ledger).toBeVisible({ timeout: 10_000 });

  // 3. Both column headers are visible — dual identity on the ledger
  await expect(ledger.getByText('System #')).toBeVisible({ timeout: 5_000 });
  await expect(ledger.getByText('External ref')).toBeVisible({ timeout: 5_000 });

  // 4. Specific seed values: PR row — system number + external ref.
  //    Scoped to the ledger to avoid strict-mode conflict with the stepper's ref display
  //    (the stepper also shows the PR number as a doc-ref annotation).
  await expect(ledger.getByText('PR-2509100001').first()).toBeVisible({ timeout: 10_000 });
  await expect(ledger.getByText('REQ-2025-0142')).toBeVisible({ timeout: 5_000 });

  // 5. PO row — system number + external ref
  await expect(ledger.getByText('PO-2509200001').first()).toBeVisible({ timeout: 5_000 });
  await expect(ledger.getByText('PO-SV-2509-0142')).toBeVisible({ timeout: 5_000 });

  // Still on the SAME page — no navigation occurred.
  await expect(page).toHaveURL(new RegExp(PAID_CASE_ID));
});

test('AC-PR-019b capture affordance visible on non-terminal case Documents tab (honest doorway)', async ({ page }) => {
  // The Paid case is terminal — LedgerCaptureRow is correctly hidden (no dead affordance).
  // Test the capture trigger on an Approved (non-terminal) case where capture IS available.
  await signIn(page, 'admin@acme.test');
  await page.goto(`/procurement/${APPROVED_CASE_ID}/documents`);

  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-ledger')).toBeVisible({ timeout: 10_000 });

  // LedgerCaptureRow is present (non-terminal, canWrite=true for Admin).
  // The case status may vary after repeated runs (could be Approved or Vendor Quoted
  // depending on DB state), but in both cases nextExpectedType returns 'rfq' (non-null)
  // and canWrite=true for Admin — so the ledger-capture-row should be shown.
  const captureRow = page.getByTestId('ledger-capture-row');
  await expect(captureRow).toBeVisible({ timeout: 10_000 });

  // The capture open button is visible — honest doorway (AC-PR-022 partial)
  const captureOpenBtn = page.getByTestId('ledger-capture-open');
  await expect(captureOpenBtn).toBeVisible({ timeout: 5_000 });

  // Still on the SAME page — no navigation occurred.
  await expect(page).toHaveURL(new RegExp(APPROVED_CASE_ID));
});
