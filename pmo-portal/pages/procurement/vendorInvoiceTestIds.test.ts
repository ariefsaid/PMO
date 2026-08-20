/**
 * vendorInvoiceTestIds — single-source contract (refactor: vi-capture-dedup).
 *
 * The `vi-*` field testids are consumed by BOTH vendor-invoice capture
 * entry points (the transition-coupled `VIInlineCapture` in
 * ProcurementDecisionZone.tsx AND the ledger `RecordCaptureForm kind="vendor_invoice"`).
 * They were previously duplicated string-literals in each file (a drift trap: a
 * field change had to be made twice with matching ids). This locks them to ONE
 * exported constant so both paths can never silently diverge.
 */
import { describe, it, expect } from 'vitest';
import { VI_FIELD_TEST_IDS } from './vendorInvoiceTestIds';

describe('VI_FIELD_TEST_IDS — single-sourced vendor-invoice field testids', () => {
  it('exposes the exact preserved testid strings the unit + e2e BDD layer keys off', () => {
    expect(VI_FIELD_TEST_IDS).toEqual({
      ref: 'vi-ref-input',
      amount: 'vi-amount-input',
      status: 'vi-status-select',
      date: 'vi-date-input',
      // #505 (0196): the two REQUIRED tax fields, rendered by both entry points.
      taxTreatment: 'vi-tax-treatment-select',
      taxAmount: 'vi-tax-amount-input',
      // #505 code-quality follow-up: the shared "why is submit blocked" hint testid.
      taxRequiredHint: 'vi-tax-required-hint',
    });
  });
});
