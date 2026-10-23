import { describe, expect, it } from 'vitest';
import { erpLinkReasonText } from './erpLinkReasons';

const t = (_k: string, fallback: string) => fallback;

describe('erpLinkReasonText', () => {
  it('FR-PFE-023: every refusal code reads as a sentence', () => {
    for (const code of ['erp_name_missing', 'invalid_id', 'document_not_found', 'document_ambiguous', 'document_cancelled',
      'document_recorded_by_pmo', 'document_linked_to_another_purchase', 'purchase_not_found', 'purchase_closed', 'project_not_found',
      'supplier_mismatch', 'project_mismatch', 'currency_mismatch', 'gate_request_before_order', 'gate_approval_before_order',
      'gate_receipt_before_invoice', 'gate_approval_before_payment']) {
      const text = erpLinkReasonText(code, t);
      expect(text).not.toBe(code);
      expect(text).toMatch(/^[A-Z].*\.$/);
    }
  });

  it('passes server sentences (e.g. the SoD refusal) through unchanged', () => {
    expect(erpLinkReasonText('separation of duties: approver cannot pay own procurement', t))
      .toBe('separation of duties: approver cannot pay own procurement');
  });

  it('a missing reason reads as a generic refusal, never blank', () => {
    expect(erpLinkReasonText(null, t)).toBe('This document could not be linked.');
  });
});

describe('erpDoctypeLabel', () => {
  it('FR-PFE-040: names all four ERPNext purchase document types; an unknown type shows as-is', async () => {
    const { erpDoctypeLabel } = await import('./erpLinkReasons');
    expect(['Purchase Order', 'Purchase Receipt', 'Purchase Invoice', 'Payment Entry', 'Journal Entry'].map((d) => erpDoctypeLabel(t, d)))
      .toEqual(['Purchase order', 'Goods receipt', 'Supplier invoice', 'Supplier payment', 'Journal Entry']);
  });
});
