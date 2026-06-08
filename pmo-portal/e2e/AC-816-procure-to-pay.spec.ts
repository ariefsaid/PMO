import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';
// NOTE (IA-3 re-skin): the visible status pill now shows the human stage label
// (e.g. "Purchase Request"); the raw lifecycle enum is asserted via the badge's
// stable `data-status` attribute so this oracle survives the presentation change.
//
// NOTE (OD-UX-1 write policy, supersedes the old confirm-every-write gate): a
// ConfirmDialog is shown IFF the write is consequential/financial — the set
// {Approve, Reject, Cancel, Mark-as-Paid}. The ROUTINE reversible forward steps
// (Submit Request, Request Vendor Quotes, Generate Purchase Order, Confirm Receipt,
// Mark Vendor Invoiced) are SINGLE-CLICK + a toast (no modal). GR/VI record-creation
// forms keep their confirm. The goal-oracle is unchanged: the full PR/PO/GR/VI trail
// is minted as the deal walks Draft→Paid; only the per-step interaction changed.

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

/** Click the named button inside the open ConfirmDialog (role="dialog"). */
async function confirmVia(page: Page, confirmLabel: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const confirmBtn = dialog.getByRole('button', { name: confirmLabel, exact: true });
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();
}

test('AC-816 full procure-to-pay happy path: Draft→Requested→Approved→Ordered→Received→Vendor Invoiced→Paid with PR/PO/GR/VI trail', async ({ page }) => {

  // ── Step 1: pm@acme.test submits (Draft → Requested) ─────────────────────
  await login(page, 'pm@acme.test');
  await page.goto(PROC_URL);

  // Wait for page to fully load (not in loading skeleton)
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Draft', { timeout: 10_000 });

  // Submit Request is a ROUTINE forward step (OD-UX-1) → single click, no dialog.
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
  await confirmVia(page, 'Approve');
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Approved', { timeout: 15_000 });

  // ── Step 3: admin generates PO (Approved → Ordered) — routine, single click ─
  await page.getByRole('button', { name: 'Generate Purchase Order' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Ordered', { timeout: 15_000 });
  await expect(page.getByText(/^PO-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });

  // ── Step 4: admin confirms receipt (Ordered → Received) — routine, single click ─
  await page.getByRole('button', { name: 'Confirm Receipt' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Received', { timeout: 15_000 });

  // ── Step 5: admin creates GR (Complete) ──────────────────────────────────
  await page.getByTestId('btn-create-gr').click();
  await expect(page.getByTestId('form-create-gr')).toBeVisible({ timeout: 5_000 });

  // Select Complete status
  await page.getByTestId('gr-status-select').selectOption('Complete');
  // Click Save GR in the form — this stages the GR for confirmation (no single-click write)
  await page.getByTestId('btn-save-gr').click();
  // Confirm inside the dialog that appears (confirmLabel = "Save GR" per confirmCopy.createGR)
  await confirmVia(page, 'Save GR');

  // GR# should appear in the document trail (rendered in both trail panel and receipts section)
  await expect(page.getByText(/^GR-\d{10}$/).first()).toBeVisible({ timeout: 15_000 });

  // ── Step 6: finance marks Vendor Invoiced (Received → Vendor Invoiced) ───
  await login(page, 'finance@acme.test');
  await page.goto(PROC_URL);
  await expect(page.getByTestId('procurement-loading')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Received', { timeout: 10_000 });

  // Mark Vendor Invoiced is a ROUTINE forward step (OD-UX-1) → single click, no dialog.
  await page.getByRole('button', { name: 'Mark Vendor Invoiced' }).click();
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Vendor Invoiced', { timeout: 15_000 });

  // ── Step 7: finance creates VI (status Paid) ─────────────────────────────
  await page.getByTestId('btn-create-vi').click();
  await expect(page.getByTestId('form-create-vi')).toBeVisible({ timeout: 5_000 });

  // Select Paid status
  await page.getByTestId('vi-status-select').selectOption('Paid');
  // Click Save VI in the form — this stages the VI for confirmation (no single-click write)
  await page.getByTestId('btn-save-vi').click();
  // Confirm inside the dialog that appears (confirmLabel = "Save VI" per confirmCopy.createVI)
  await confirmVia(page, 'Save VI');

  // VI# should appear in the document trail (rendered in both trail panel and invoices section)
  await expect(page.getByText(/^VI-\d{10}$/).first()).toBeVisible({ timeout: 15_000 });

  // ── Step 8: finance marks Paid (Vendor Invoiced → Paid) ──────────────────
  // SoD-b: admin approved (step 2), finance pays — distinct users → allowed.
  await page.getByRole('button', { name: 'Mark as Paid' }).click();
  await confirmVia(page, 'Mark as Paid');
  await expect(page.getByTestId('procurement-status-badge')).toHaveAttribute('data-status', 'Paid', { timeout: 15_000 });

  // ── Final assertions: full document trail PR/PO/GR/VI all visible ─────────
  // Numbers may appear in both the doc-trail panel and the detail sections — use .first()
  await expect(page.getByText(/^PR-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^PO-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^GR-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/^VI-\d{10}$/).first()).toBeVisible({ timeout: 10_000 });
});
