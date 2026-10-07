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
 * Both render the SAME VI fields (ref, amount, status, date, and — since #505 — tax treatment +
 * tax amount)
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
  // #505 (0196): the two REQUIRED tax fields. `taxTreatment` deliberately has NO pre-selected
  // option — a default would write a plausible-looking wrong marker that no later inference can
  // distinguish from a deliberate one, which is the defect the issue exists to remove.
  taxTreatment: 'vi-tax-treatment-select',
  taxAmount: 'vi-tax-amount-input',
  // #505 code-quality follow-up: the "why is submit blocked" hint shown by both entry points when
  // the tax facts are incomplete. Was a duplicated string literal in each file (a "⚠ KEEP IN SYNC"
  // comment, not an enforced contract) — single-sourced here for the same reason as the fields above.
  taxRequiredHint: 'vi-tax-required-hint',
} as const;

/** #876 (DD-VWH-6): the withholding breakdown under a vendor invoice's amount in the procurement ledger. */
export const VI_WITHHOLDING_TEST_IDS = {
  breakdown: 'vi-withholding-breakdown',
  vat: 'vi-withholding-vat',
  withheld: 'vi-withholding-withheld',
  net: 'vi-withholding-net',
} as const;

/** #876 slice 2 (OD-VWH-1): the vendor-bill tax inputs shared by both entry points (VendorBillTaxFields.tsx). */
export const VI_VENDOR_TAX_TEST_IDS = {
  nativeWithheld: 'vi-withheld-input',
  erpFields: 'vi-erp-tax-fields',
  erpVat: 'vi-erp-vat-input',
  pphType: 'vi-pph-type-select',
  erpWithheld: 'vi-erp-withheld-input',
  itemsNet: 'vi-items-net',
  suggestedFrom: 'vi-tax-suggested-from',
  erpRequiredHint: 'vi-erp-tax-required-hint',
} as const;
