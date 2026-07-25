/**
 * FR-ENA-014 — erpnext/doctypeBodies.ts (task 4.3): wires the R9-frozen `toBody`/`fromDoc` pairs
 * (task 2.7's `bodies/*.ts`) into the `DOCTYPE_BODIES` side table `erpnext/adapter.ts`/
 * `dispatchFactory.ts` consume (`ErpAdapterDeps.doctypeBodies`). Slice 4 wires the first three
 * submittable kinds this side table ever carries — `purchase-request`/`rfq`/`quotation` — proving
 * `commitCreate`'s "no DOCTYPE_BODIES entry" throw (adapter.test.ts, task 2.12) is now satisfied for
 * these kinds specifically, end to end through the composed table (not just the individual body-fns
 * unit-tested in `bodies/bodies.test.ts`). Slice 5 (task 5.2) appends `purchase-order`/`goods-receipt`
 * to this SAME table (see the `Slice 5 entries` describe block below). Slice 6 appends
 * `purchase-invoice`/`payment`; slice 3 appends `supplier`/`customer` — additive only, this file never
 * removes/edits another slice's entry.
 */
import { describe, expect, it } from 'vitest';
import { createErpAdapter } from './adapter.ts';
import type { ErpCtx } from './doctypeRegistry.ts';
import { DOCTYPE_BODIES } from './doctypeBodies.ts';
import { mrToBody, mrFromDoc } from './bodies/materialRequest.ts';
import { rfqToBody, rfqFromDoc } from './bodies/rfq.ts';
import { supplierQuotationToBody, supplierQuotationFromDoc } from './bodies/supplierQuotation.ts';
import { supplierToBody, supplierFromDoc } from './bodies/supplier.ts';
import { customerToBody, customerFromDoc } from './bodies/customer.ts';
import { piToBody, piFromDoc } from './bodies/purchaseInvoice.ts';
import { peToBody, peFromDoc } from './bodies/paymentEntry.ts';
import { tsToBody, tsFromDoc } from './bodies/timesheet.ts';
import { employeeToBody, employeeFromDoc } from './bodies/employee.ts';
import { budgetToBody, budgetFromDoc } from './bodies/budget.ts';

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

  it('wires supplier to the supplier.ts toBody/fromDoc (slice 3, FR-ENA-090/092)', () => {
    expect(DOCTYPE_BODIES.supplier?.toBody).toBe(supplierToBody);
    expect(DOCTYPE_BODIES.supplier?.fromDoc).toBe(supplierFromDoc);
  });

  it('wires customer to the customer.ts toBody/fromDoc (slice 3, FR-ENA-090/092)', () => {
    expect(DOCTYPE_BODIES.customer?.toBody).toBe(customerToBody);
    expect(DOCTYPE_BODIES.customer?.fromDoc).toBe(customerFromDoc);
  });

  it('wires purchase-invoice to the R9 §1 purchaseInvoice.ts toBody/fromDoc (slice 6, FR-ENA-115)', () => {
    expect(DOCTYPE_BODIES['purchase-invoice']?.toBody).toBe(piToBody);
    expect(DOCTYPE_BODIES['purchase-invoice']?.fromDoc).toBe(piFromDoc);
  });

  it('wires payment to the R9 §2 paymentEntry.ts toBody/fromDoc (slice 6, FR-ENA-116)', () => {
    expect(DOCTYPE_BODIES.payment?.toBody).toBe(peToBody);
    expect(DOCTYPE_BODIES.payment?.fromDoc).toBe(peFromDoc);
  });

  it('AC-TSP-032 wires timesheet to the spike-frozen timesheet.ts toBody/fromDoc (P3b)', () => {
    expect(DOCTYPE_BODIES.timesheet?.toBody).toBe(tsToBody);
    expect(DOCTYPE_BODIES.timesheet?.fromDoc).toBe(tsFromDoc);
  });

  it('AC-TSP-093 wires employee to the READ-ONLY employee.ts toBody/fromDoc pair (P3b, toBody throws)', () => {
    expect(DOCTYPE_BODIES.employee?.toBody).toBe(employeeToBody);
    expect(DOCTYPE_BODIES.employee?.fromDoc).toBe(employeeFromDoc);
  });

  it('AC-BUD-012 wires budget to the spike-frozen budget.ts toBody/fromDoc (P3c)', () => {
    expect(DOCTYPE_BODIES.budget?.toBody).toBe(budgetToBody);
    expect(DOCTYPE_BODIES.budget?.fromDoc).toBe(budgetFromDoc);
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

const CTX: ErpCtx = { refs: { supplier: 'Spike Supplier', po: 'PUR-ORD-2026-00001' }, config: {} };

describe('erpnext/doctypeBodies — Slice 5 entries (purchase-order, goods-receipt)', () => {
  it('purchase-order is wired to the R9 §3 poToBody/poFromDoc pair', () => {
    const entry = DOCTYPE_BODIES['purchase-order'];
    expect(entry).toBeDefined();
    const body = entry!.toBody({ id: 'pmo-1', items: [{ item_code: 'X', qty: 1, rate: 1, schedule_date: '2026-07-18' }] }, CTX);
    expect(body).toEqual({
      supplier: 'Spike Supplier',
      items: [{ item_code: 'X', qty: 1, rate: 1, schedule_date: '2026-07-18' }],
    });
    const canonical = entry!.fromDoc({ name: 'PUR-ORD-2026-00001', grand_total: 100, docstatus: 1, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'PUR-ORD-2026-00001', po_number: 'PUR-ORD-2026-00001', amount: '100.00' });
  });

  it('goods-receipt is wired to the R9 §4 grToBody/grFromDoc pair', () => {
    const entry = DOCTYPE_BODIES['goods-receipt'];
    expect(entry).toBeDefined();
    const body = entry!.toBody(
      { id: 'pmo-1', items: [{ item_code: 'X', qty: 1, rate: 1, po_item_child_name: 'i7d62dicpp' }] },
      CTX,
    );
    expect(body).toEqual({
      supplier: 'Spike Supplier',
      items: [{ item_code: 'X', qty: 1, rate: 1, purchase_order: 'PUR-ORD-2026-00001', purchase_order_item: 'i7d62dicpp' }],
    });
    const canonical = entry!.fromDoc({ name: 'MAT-PRE-2026-00001', items: [{ purchase_order: 'PUR-ORD-2026-00001' }], docstatus: 1, modified: '2026-07-11 10:00:00.000000' });
    expect(canonical).toMatchObject({ id: 'MAT-PRE-2026-00001', gr_number: 'MAT-PRE-2026-00001' });
  });

  it('purchase-invoice + payment are wired by slice 6 (the R9 §1/§2 money-doc bodies)', () => {
    expect(DOCTYPE_BODIES['purchase-invoice']).toBeDefined();
    expect(DOCTYPE_BODIES.payment).toBeDefined();
  });
});
