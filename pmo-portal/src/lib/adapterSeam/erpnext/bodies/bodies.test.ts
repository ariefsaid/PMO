/**
 * FR-ENA-014/041 (R9-frozen `toBody`/`fromDoc`) — the exact minimal request bodies the R9 spike
 * (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md) proved succeed against a live v15 bench, and
 * their inverse `fromDoc` canonical mapping. No invented fields — every `toBody` sends exactly what R9
 * proved necessary; the adapter/binding config supplies everything ERPNext itself won't default.
 */
import { describe, expect, it } from 'vitest';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { piToBody, piFromDoc } from './purchaseInvoice.ts';
import { peToBody, peFromDoc } from './paymentEntry.ts';
import { poToBody, poFromDoc } from './purchaseOrder.ts';
import { grToBody, grFromDoc } from './goodsReceipt.ts';
import { mrToBody, mrFromDoc } from './materialRequest.ts';
import { rfqToBody, rfqFromDoc } from './rfq.ts';
import { supplierQuotationToBody, supplierQuotationFromDoc } from './supplierQuotation.ts';

const CTX: ErpCtx = {
  refs: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001' },
  config: {
    company: 'PMO Smoke Co',
    default_cash_account: 'Cash - PSC',
    default_bank_account: null,
    default_payable_account: 'Creditors - PSC',
    default_warehouse: 'Stores - PSC',
    default_uom: 'Nos',
  },
};

function rec(fields: Record<string, unknown>): PmoRecord {
  return { id: 'pmo-1', ...fields };
}

describe('erpnext/bodies — R9-frozen toBody', () => {
  it('R9 §1 purchaseInvoice.ts: {supplier, items:[{item_code,qty,rate}]}', () => {
    const body = piToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 150000 }] }), CTX);
    expect(body).toEqual({ supplier: 'Spike Supplier', items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 150000 }] });
  });

  it('purchaseInvoice.ts rejects empty items (FR-ENA-042, the 500-TypeError guard)', () => {
    expect(() => piToBody(rec({ items: [] }), CTX)).toThrow(/at least one line item/);
  });

  it('R9 §2 paymentEntry.ts (frozen core): adapter supplies paid_from/paid_to from binding config', () => {
    const body = peToBody(
      rec({ paid_amount: 150000, references: [{ reference_doctype: 'Purchase Invoice', reference_name: 'ACC-PINV-2026-00002', allocated_amount: 150000 }] }),
      CTX,
    );
    expect(body).toEqual({
      payment_type: 'Pay',
      party_type: 'Supplier',
      party: 'Spike Supplier',
      paid_amount: 150000,
      received_amount: 150000, // defaults to paid_amount when absent (R9 §2)
      paid_from: 'Cash - PSC',
      paid_to: 'Creditors - PSC',
      references: [{ reference_doctype: 'Purchase Invoice', reference_name: 'ACC-PINV-2026-00002', allocated_amount: 150000 }],
    });
  });

  it('paymentEntry.ts falls back paid_from to default_bank_account when no cash account is configured', () => {
    const ctx: ErpCtx = { ...CTX, config: { ...CTX.config, default_cash_account: null, default_bank_account: 'Bank - PSC' } };
    const body = peToBody(rec({ paid_amount: 100 }), ctx) as Record<string, unknown>;
    expect(body.paid_from).toBe('Bank - PSC');
  });

  it('paymentEntry.ts unreferenced payment submits fine with references defaulting to []', () => {
    const body = peToBody(rec({ paid_amount: 50000 }), CTX) as Record<string, unknown>;
    expect(body.references).toEqual([]);
  });

  it('R9 §3 purchaseOrder.ts: schedule_date on the item row is mandatory', () => {
    const body = poToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000, schedule_date: '2026-07-18' }] }), CTX);
    expect(body).toEqual({
      supplier: 'Spike Supplier',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000, schedule_date: '2026-07-18' }],
    });
  });

  it('R9 §4 goodsReceipt.ts: purchase_order + purchase_order_item (the PO item child-row name) per row', () => {
    const body = grToBody(
      rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000, po_item_child_name: 'i7d62dicpp' }] }),
      CTX,
    );
    expect(body).toEqual({
      supplier: 'Spike Supplier',
      items: [
        { item_code: 'SPIKE-ITEM-1', qty: 2, rate: 100000, purchase_order: 'PUR-ORD-2026-00001', purchase_order_item: 'i7d62dicpp' },
      ],
    });
  });

  it('R9 §0 + FR-ENA-110 materialRequest.ts: material_request_type=Purchase, company from binding', () => {
    const body = mrToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 3, rate: 50000, schedule_date: '2026-07-20' }] }), CTX);
    expect(body).toEqual({
      material_request_type: 'Purchase',
      company: 'PMO Smoke Co',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 3, rate: 50000, schedule_date: '2026-07-20' }],
    });
  });

  it('FR-ENA-111 rfq.ts: supplier + item rows, with the binding config default_warehouse/default_uom + a hardcoded conversion_factor:1 per item + a hardcoded message_for_supplier (live-bench finding, task 6.4 fix-round: RFQ, unlike MR, does not server-default a warehouse — "Warehouse is mandatory for stock Item" — nor conversion_factor — "Conversion Factor is mandatory" — nor uom — "Value missing for: UOM" — nor message_for_supplier — "Value missing for Request for Quotation: Message for Supplier" — otherwise)', () => {
    const body = rfqToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 5, schedule_date: '2026-07-25' }] }), CTX);
    expect(body).toEqual({
      suppliers: [{ supplier: 'Spike Supplier' }],
      message_for_supplier: 'Please submit your quotation.',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 5, schedule_date: '2026-07-25', conversion_factor: 1, warehouse: 'Stores - PSC', uom: 'Nos' }],
    });
  });

  it('FR-ENA-112 supplierQuotation.ts: supplier + item rows', () => {
    const body = supplierQuotationToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 5, rate: 42000 }] }), CTX);
    expect(body).toEqual({
      supplier: 'Spike Supplier',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 5, rate: 42000 }],
    });
  });
});

describe('erpnext/bodies — fromDoc canonical mapping (decimal-string money, header total is the oracle)', () => {
  it('piFromDoc maps grand_total/outstanding_amount/docstatus (never sums lines)', () => {
    const canonical = piFromDoc({
      name: 'ACC-PINV-2026-00002',
      posting_date: '2026-07-11',
      bill_no: null,
      grand_total: 150000,
      outstanding_amount: 0,
      docstatus: 1,
      modified: '2026-07-11 10:00:00.000000',
      amended_from: null,
    });
    expect(canonical).toMatchObject({
      id: 'ACC-PINV-2026-00002',
      vi_number: 'ACC-PINV-2026-00002',
      amount: '150000.00',
      erp_outstanding_amount: '0.00',
      erp_docstatus: 1,
    });
  });

  it('peFromDoc maps paid_amount -> amount exactly; absent optional -> null', () => {
    const canonical = peFromDoc({ name: 'ACC-PAY-2026-00001', paid_amount: 150000, reference_no: null, docstatus: 1, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'ACC-PAY-2026-00001', pay_number: 'ACC-PAY-2026-00001', amount: '150000.00', reference_number: null });
  });

  it('poFromDoc maps grand_total -> amount (the oracle)', () => {
    const canonical = poFromDoc({ name: 'PUR-ORD-2026-00001', grand_total: 200000, docstatus: 1, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'PUR-ORD-2026-00001', po_number: 'PUR-ORD-2026-00001', amount: '200000.00' });
  });

  it('grFromDoc maps the PO link + docstatus', () => {
    const canonical = grFromDoc({ name: 'MAT-PRE-2026-00001', items: [{ purchase_order: 'PUR-ORD-2026-00001' }], docstatus: 1, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'MAT-PRE-2026-00001', gr_number: 'MAT-PRE-2026-00001' });
  });

  it('mrFromDoc maps the pr_number + docstatus', () => {
    const canonical = mrFromDoc({ name: 'MAT-REQ-2026-00001', docstatus: 0, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'MAT-REQ-2026-00001', pr_number: 'MAT-REQ-2026-00001', erp_docstatus: 0 });
  });

  it('rfqFromDoc maps the rfq_number + docstatus', () => {
    const canonical = rfqFromDoc({ name: 'PUR-RFQ-2026-00001', docstatus: 1, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'PUR-RFQ-2026-00001', rfq_number: 'PUR-RFQ-2026-00001' });
  });

  it('supplierQuotationFromDoc maps grand_total->total_amount (oracle) + valid_till->valid_until; is_selected is PMO-only', () => {
    const canonical = supplierQuotationFromDoc({ name: 'PUR-SQTN-2026-00001', grand_total: 42000, valid_till: '2026-08-01', docstatus: 1, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'PUR-SQTN-2026-00001', vq_number: 'PUR-SQTN-2026-00001', total_amount: '42000.00', valid_until: '2026-08-01' });
    expect(canonical).not.toHaveProperty('is_selected');
  });
});
