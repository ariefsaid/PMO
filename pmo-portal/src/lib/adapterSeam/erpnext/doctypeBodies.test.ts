/**
 * FR-ENA-014 — erpnext/doctypeBodies.ts (task 4.3): wires the R9-frozen `toBody`/`fromDoc` pairs
 * (task 2.7's `bodies/*.ts`) into the `DOCTYPE_BODIES` side table `erpnext/adapter.ts`/
 * `dispatchFactory.ts` consume (`ErpAdapterDeps.doctypeBodies`). Slice 4 wires the first three
 * submittable kinds this side table ever carries — `purchase-request`/`rfq`/`quotation` — proving
 * `commitCreate`'s "no DOCTYPE_BODIES entry" throw (adapter.test.ts, task 2.12) is now satisfied for
 * these kinds specifically, end to end through the composed table (not just the individual body-fns
 * unit-tested in `bodies/bodies.test.ts`). Slices 3/5/6 append their own kinds to this SAME table
 * (supplier/customer; purchase-order/goods-receipt; purchase-invoice/payment) — additive only, this
 * file never removes/edits another slice's entry.
 */
import { describe, expect, it } from 'vitest';
import { createErpAdapter } from './adapter.ts';
import { DOCTYPE_BODIES } from './doctypeBodies.ts';
import { mrToBody, mrFromDoc } from './bodies/materialRequest.ts';
import { rfqToBody, rfqFromDoc } from './bodies/rfq.ts';
import { supplierQuotationToBody, supplierQuotationFromDoc } from './bodies/supplierQuotation.ts';

describe('erpnext/doctypeBodies — DOCTYPE_BODIES composition (task 4.3)', () => {
  it('wires purchase-request to the R9-frozen materialRequest toBody/fromDoc (byte-identical function refs)', () => {
    expect(DOCTYPE_BODIES['purchase-request']?.toBody).toBe(mrToBody);
    expect(DOCTYPE_BODIES['purchase-request']?.fromDoc).toBe(mrFromDoc);
  });

  it('wires rfq to the rfq.ts toBody/fromDoc', () => {
    expect(DOCTYPE_BODIES.rfq?.toBody).toBe(rfqToBody);
    expect(DOCTYPE_BODIES.rfq?.fromDoc).toBe(rfqFromDoc);
  });

  it('wires quotation to the supplierQuotation.ts toBody/fromDoc', () => {
    expect(DOCTYPE_BODIES.quotation?.toBody).toBe(supplierQuotationToBody);
    expect(DOCTYPE_BODIES.quotation?.fromDoc).toBe(supplierQuotationFromDoc);
  });

  it('does not claim slices 3/5/6 kinds (supplier/purchase-order/purchase-invoice) — additive only', () => {
    expect(DOCTYPE_BODIES.supplier).toBeUndefined();
    expect(DOCTYPE_BODIES['purchase-order']).toBeUndefined();
    expect(DOCTYPE_BODIES['purchase-invoice']).toBeUndefined();
  });

  it('end to end: an adapter built with DOCTYPE_BODIES commits a purchase-request create (no "not yet wired" throw)', async () => {
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ name: 'MAT-REQ-2026-00099' }), { status: 200 });
      }
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({ name: 'MAT-REQ-2026-00099', docstatus: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: 'MAT-REQ-2026-00099', docstatus: 1, modified: '2026-07-11 10:00:00' }), { status: 200 });
    };
    const adapter = createErpAdapter({
      client: { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.com' },
      doctypeBodies: DOCTYPE_BODIES,
      ctx: { refs: {}, config: { company: 'PMO Smoke Co' } },
    });
    const result = await adapter.commit({
      domain: 'procurement',
      operation: 'create',
      record: { id: 'pmo-mr-1', erp_doc_kind: 'purchase-request', items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000, schedule_date: '2026-07-20' }] },
    });
    expect(result.externalRecordId).toBe('MAT-REQ-2026-00099');
    expect(result.canonical).toMatchObject({ id: 'pmo-mr-1', pr_number: 'MAT-REQ-2026-00099', erp_docstatus: 1 });
  });
});
