/**
 * purchase.push, bill.push, vendor-payment.push, purchase.link-existing (v1) — a procurement push may only point at
 * records its own tenant owns, and refuses before any ERP call otherwise (B10: the write would stamp the caller's
 * tenant beside another tenant's foreign key). ERP-native purchase documents are mirrored once each.
 */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

export function purchasePushSuite(h: ErpHarness): void {
  describe(`purchase.push (${h.tier})`, () => {
    it('B10 a purchase order for another tenant\'s case is refused before any ERP call', async () => {
      expect(await h.pushProcurement({ doc: 'purchase-order', caller: 'A', procurement: 'B' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('B10 a quotation naming another tenant\'s vendor is refused before any ERP call', async () => {
      expect(await h.pushProcurement({ doc: 'quotation', caller: 'A', procurement: 'A', vendor: 'B' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('B10 a purchase order for the caller\'s own case is accepted, so the refusals above are about ownership', async () => {
      expect(await h.pushProcurement({ doc: 'purchase-order', caller: 'A', procurement: 'A' })).toMatchObject({ outcome: 'accepted' });
    });

    it('B10 a command carrying no procurement links at all is untouched', async () => {
      expect(await h.pushProcurement({ doc: 'supplier', caller: 'A' })).toMatchObject({ outcome: 'accepted' });
    });
  });
}

export function billPushSuite(h: ErpHarness): void {
  describe(`bill.push (${h.tier})`, () => {
    it('B10 a bill for another tenant\'s case is refused before any ERP call', async () => {
      expect(await h.pushProcurement({ doc: 'bill', caller: 'A', procurement: 'B' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('B10 a case that does not exist is refused: fail closed, never a silent pass', async () => {
      expect(await h.pushProcurement({ doc: 'bill', caller: 'A', procurement: 'nobody' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('B10 the same case is accepted for the tenant that owns it (ownership is checked on the record)', async () => {
      expect(await h.pushProcurement({ doc: 'bill', caller: 'B', procurement: 'B' })).toMatchObject({ outcome: 'accepted' });
    });
  });
}

export function vendorPaymentPushSuite(h: ErpHarness): void {
  describe(`vendor-payment.push (${h.tier})`, () => {
    it('B10 a payment settling another tenant\'s bill is refused before any ERP call', async () => {
      expect(await h.pushProcurement({ doc: 'vendor-payment', caller: 'A', procurement: 'A', invoice: 'B' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('B10 a payment settling the caller\'s own bill is accepted', async () => {
      expect(await h.pushProcurement({ doc: 'vendor-payment', caller: 'A', procurement: 'A', invoice: 'A' })).toMatchObject({ outcome: 'accepted' });
    });
  });
}

export function purchaseLinkExistingSuite(h: ErpHarness): void {
  describe(`purchase.link-existing (${h.tier})`, () => {
    const order = { kind: 'purchase-order', reference: 'PUR-ORD-1', supplier: 'Acme', total: 900000, modifiedAt: '2026-01-05 09:00:00' } as const;
    const bill = { kind: 'bill', reference: 'ACC-PINV-1', supplier: 'Acme', total: 500000, modifiedAt: '2026-02-01 10:00:00' } as const;

    it('AC-EPR-001 an ERP-native order and bill are each mirrored with the ERP\'s own total', async () => {
      const rows = await h.mirrorPurchases([order, bill]);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(expect.arrayContaining([
        { kind: 'purchase-order', reference: 'PUR-ORD-1', total: '900000' },
        { kind: 'bill', reference: 'ACC-PINV-1', total: '500000' },
      ]));
    });

    it('a document the ERP lists twice is mirrored once, at its newest figures (no double counting)', async () => {
      const rows = await h.mirrorPurchases([bill, { ...bill, total: 450000, modifiedAt: '2026-02-03 00:00:00' }, { ...bill, total: 1, modifiedAt: '2026-01-01 00:00:00' }]);
      expect(rows).toEqual([{ kind: 'bill', reference: 'ACC-PINV-1', total: '450000' }]);
    });
  });
}
