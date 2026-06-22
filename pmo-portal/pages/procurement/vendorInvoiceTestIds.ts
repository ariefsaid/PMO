/**
 * vendorInvoiceTestIds — single-source for the four `vi-*` vendor-invoice field
 * testids (refactor: vi-capture-dedup).
 *
 * Vendor-invoice capture has TWO distinct entry points with DISTINCT layouts and
 * submit semantics that intentionally stay separate:
 *   • the transition-coupled `VIInlineCapture` (ProcurementDecisionZone.tsx) — the
 *     O3 "Mark Vendor Invoiced" path; fires transition → createInvoice as a
 *     sequenced pair via a "Confirm & Mark Invoiced" success button.
 *   • the ledger `RecordCaptureForm kind="vendor_invoice"` (RecordCaptureForm.tsx)
 *     — the "Record vendor invoice" card; uses the onStage/onCreate form-submit path.
 *
 * Both render the SAME four optional/required VI fields (ref, amount, status, date)
 * and historically duplicated these testid string-literals — a drift trap (a field
 * change had to be made in both places with matching ids). Single-sourcing them here
 * removes that trap while each caller keeps its own DOM shell + submit behavior.
 *
 * ⚠ These exact strings are keyed off by the unit tests
 * (ProcurementDetails.test.tsx, ProcurementDetails.wave3.test.tsx,
 * RecordCaptureForm.grvi.test.tsx) and the e2e BDD layer (AC-816-procure-to-pay) —
 * changing a value breaks that layer.
 */
export const VI_FIELD_TEST_IDS = {
  ref: 'vi-ref-input',
  amount: 'vi-amount-input',
  status: 'vi-status-select',
  date: 'vi-date-input',
} as const;
