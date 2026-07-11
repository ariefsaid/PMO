/**
 * erpnext/doctypeBodies.ts (Slice 5, task 5.2) — the runtime `(ErpDocKind) -> {toBody,fromDoc}` side
 * table `doctypeRegistry.ts`'s docstring promises (2.7 built the pure per-doctype functions in
 * `erpnext/bodies/*`; this file is the single place they're assembled for the dispatch factory to
 * inject into `ErpAdapterDeps.doctypeBodies`). ADDITIVE across slices — each slice wires only the
 * kinds it owns; an entry absent here is `commit-rejected` at commit time (adapter.ts's
 * `requireBodyFns`), never a silent no-op. This slice wires `purchase-order` + `goods-receipt` only.
 */
import type { DoctypeBodyFns } from './adapter.ts';
import type { ErpDocKind } from './doctypeRegistry.ts';
import { poToBody, poFromDoc } from './bodies/purchaseOrder.ts';
import { grToBody, grFromDoc } from './bodies/goodsReceipt.ts';

export const DOCTYPE_BODIES: Partial<Record<ErpDocKind, DoctypeBodyFns>> = {
  'purchase-order': { toBody: poToBody, fromDoc: poFromDoc },
  'goods-receipt': { toBody: grToBody, fromDoc: grFromDoc },
};
