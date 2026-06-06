import { test, expect } from '@playwright/test';
import { login } from './helpers';
// NOTE (IA-3 re-skin): the visible status pill now shows the human stage label
// (e.g. "Purchase Request"); the raw lifecycle enum is asserted via the badge's
// stable `data-status` attribute so this oracle survives the presentation change.

// AC-816 — full procure-to-pay happy path: Draft→Requested→Approved→Ordered→Received→
// Vendor Invoiced→Paid with minted PR#/PO#/GR#/VI# trail.
//
// Uses PROC-2026-003 (60000000-0000-0000-0000-000000000004) — seeded as Draft,
// requested_by = pm@acme.test (a2).  SoD strategy:
//   • pm@acme.test submits (Draft→Requested)
//   • admin@acme.test approves (Admin break-glass, exempt from SoD-a), orders, confirms receipt, creates GR
//   • finance@acme.test marks Vendor Invoiced, creates VI, marks Paid (finance ≠ admin/approver → SoD-b passes)
//
// (FR-PROC-002/005/006/008/009/010/011, NFR-PROC-UI-001)

const PROC_ID = '60000000-0000-0000-0000-000000000004';
const PROC_URL = `/procurement/${PROC_ID}`;

test('AC-816 full procure-to-pay happy path: Draft→Requested→Approved→Ordered→Received→Vendor Invoiced→Paid with PR/PO/GR/VI trail', async ({ page }) => {

  // ── Step 1: pm@acme.test submits (Draft → Requested) ─────────────────────
  await login(page, 'pm@acme.test');
  await page.goto(PROC_URL);

  // Wait for page to fully load (not in loading skeleton)
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Draft', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Submit Request' }).click();

  // Wait for status to advance to Requested and PR# to appear
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', { timeout: 15_000 });
  await expect(page.getByText(/^PR-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });

  // ── Step 2: admin approves (Requested → Approved) ────────────────────────
  await login(page, 'admin@acme.test');
  await page.goto(PROC_URL);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Requested', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });

  // ── Step 3: admin generates PO (Approved → Ordered) ──────────────────────
  await page.getByRole('button', { name: 'Generate Purchase Order' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
  await expect(page.getByText(/^PO-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });

  // ── Step 4: admin confirms receipt (Ordered → Received) ──────────────────
  await page.getByRole('button', { name: 'Confirm Receipt' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Received', { timeout: 15_000 });

  // ── Step 5: admin creates GR (Complete) ──────────────────────────────────
  await page.getByTestId('btn-create-gr').click();
  await expect(page.getByTestId('form-create-gr')).toBeVisible({ timeout: 5_000 });

  // Select Complete status
  await page.getByTestId('gr-status-select').selectOption('Complete');
  await page.getByTestId('btn-save-gr').click();

  // GR# should appear in the document trail (rendered in both trail panel and receipts section)
  await expect(page.getByText(/^GR-\d{10}$/).first()).toBeVisible({ timeout: 15_000 });

  // ── Step 6: finance marks Vendor Invoiced (Received → Vendor Invoiced) ───
  await login(page, 'finance@acme.test');
  await page.goto(PROC_URL);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Received', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Mark Vendor Invoiced' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Vendor Invoiced', { timeout: 15_000 });

  // ── Step 7: finance creates VI (status Paid) ─────────────────────────────
  await page.getByTestId('btn-create-vi').click();
  await expect(page.getByTestId('form-create-vi')).toBeVisible({ timeout: 5_000 });

  // Select Paid status
  await page.getByTestId('vi-status-select').selectOption('Paid');
  await page.getByTestId('btn-save-vi').click();

  // VI# should appear in the document trail (rendered in both trail panel and invoices section)
  await expect(page.getByText(/^VI-\d{10}$/).first()).toBeVisible({ timeout: 15_000 });

  // ── Step 8: finance marks Paid (Vendor Invoiced → Paid) ──────────────────
  // SoD-b: admin approved (step 2), finance pays — distinct users → allowed.
  await page.getByRole('button', { name: 'Mark as Paid' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Paid', { timeout: 15_000 });

  // ── Final assertions: full document trail PR/PO/GR/VI all visible ─────────
  // Numbers may appear in both the doc-trail panel and the detail sections — use .first()
  await expect(page.getByText(/^PR-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^PO-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^GR-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^VI-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
});
