/**
 * erpnext/doctypeBodies.ts (Slice 5, task 5.2) — the runtime `DOCTYPE_BODIES` side table
 * `adapter.ts`'s docstring promises (2.7 wired the money-doc `toBody`/`fromDoc` FUNCTIONS;
 * this is the single place they're assembled into the `ErpDocKind -> DoctypeBodyFns` map the
 * dispatch factory injects into `ErpAdapterDeps.doctypeBodies`). This slice fills ONLY the
 * kinds it owns (purchase-order, goods-receipt) — additive; slices 3/4/6 add their own entries.
 */
import { describe, expect, it } from 'vitest';
import type { ErpCtx } from './doctypeRegistry.ts';
import { DOCTYPE_BODIES } from './doctypeBodies.ts';

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

  it('does NOT declare entries slice 5 does not own (additive, no invented wiring)', () => {
    expect(DOCTYPE_BODIES['purchase-invoice']).toBeUndefined();
    expect(DOCTYPE_BODIES.supplier).toBeUndefined();
  });
});
