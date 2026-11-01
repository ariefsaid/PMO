/**
 * invoice.push and receipt.read (v1). A revenue push may only point at records its own tenant owns, and refuses
 * before any ERP call otherwise (an invoice or receipt for another tenant's record would be orphan money). A
 * payment the ERP reports is routed by the direction it states, never guessed.
 */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

export function invoicePushSuite(h: ErpHarness): void {
  describe(`invoice.push (${h.tier})`, () => {
    it('Luna B2 an invoice for another tenant\'s customer is refused before any ERP call', async () => {
      expect(await h.pushRevenue({ doc: 'sales-invoice', caller: 'A', customer: 'B', project: 'A' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('Luna B2 an invoice on another tenant\'s project is refused before any ERP call', async () => {
      expect(await h.pushRevenue({ doc: 'sales-invoice', caller: 'A', customer: 'A', project: 'B' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('Luna B2 a receipt against another tenant\'s invoice is refused before any ERP call (the orphan-receipt case)', async () => {
      expect(await h.pushRevenue({ doc: 'receipt', caller: 'A', customer: 'A', salesInvoice: 'B' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('Luna B2 a customer that does not exist is refused: fail closed, never a silent null link', async () => {
      expect(await h.pushRevenue({ doc: 'sales-invoice', caller: 'A', customer: 'nobody', project: 'A' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('Luna B2 a receipt against the caller\'s own customer and invoice is accepted', async () => {
      expect(await h.pushRevenue({ doc: 'receipt', caller: 'A', customer: 'A', salesInvoice: 'A' })).toMatchObject({ outcome: 'accepted' });
    });

    it('Luna B2 the same customer is accepted for the tenant that owns it (ownership is checked on the record)', async () => {
      expect(await h.pushRevenue({ doc: 'sales-invoice', caller: 'B', customer: 'B' })).toMatchObject({ outcome: 'accepted' });
    });
  });
}

export function receiptReadSuite(h: ErpHarness): void {
  describe(`receipt.read (${h.tier})`, () => {
    it('AC-SAR-060 a payment the ERP states as received is a customer receipt in the revenue domain', () => {
      expect(h.classifyPayment('received')).toEqual({ kind: 'receipt', domain: 'revenue', table: 'incoming_payments' });
    });

    it('AC-SAR-060 a payment the ERP states as paid is a vendor payment in the procurement domain, not a receipt', () => {
      expect(h.classifyPayment('paid')).toEqual({ kind: 'vendor-payment', domain: 'procurement', table: 'payments' });
    });

    it('AC-SAR-060 a payment with an unrecognised, blank or absent direction is skipped, never guessed', () => {
      for (const direction of ['unrecognised', 'blank', 'absent'] as const) expect(h.classifyPayment(direction), direction).toEqual({ kind: 'skipped' });
    });
  });
}
