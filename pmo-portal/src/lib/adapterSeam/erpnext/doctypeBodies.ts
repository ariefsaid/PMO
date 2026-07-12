/**
 * `DOCTYPE_BODIES` — the (kind)->{toBody,fromDoc} side table `erpnext/adapter.ts` (task 2.12) and
 * `erpnext/dispatchFactory.ts` (task 2.13) consume as `ErpAdapterDeps.doctypeBodies`/
 * `ErpDispatchFactoryDeps.doctypeBodies`. Starts empty in slice 2 by design (no doctype wired yet, so
 * every kind fails loud — `commit-rejected`, never a silent no-op); each slice ADDS its own kinds here,
 * additively, never touching another slice's entries (merge-coordination discipline, plan header).
 *
 * Slice 4 wires the first three: the submittable, non-money procurement sub-doctypes (Material
 * Request/Request for Quotation/Supplier Quotation — R9-frozen bodies from task 2.7's `bodies/*.ts`).
 * Slice 5 (task 5.2) wires `purchase-order`/`goods-receipt` (R9 §3/§4 money docs). Slice 6 appends
 * `purchase-invoice`/`payment`; slice 3 appends `supplier`/`customer`.
 */
import type { DoctypeBodyFns } from './adapter.ts';
import type { ErpDocKind } from './doctypeRegistry.ts';
import { mrToBody, mrFromDoc } from './bodies/materialRequest.ts';
import { rfqToBody, rfqFromDoc } from './bodies/rfq.ts';
import { supplierQuotationToBody, supplierQuotationFromDoc } from './bodies/supplierQuotation.ts';
import { poToBody, poFromDoc } from './bodies/purchaseOrder.ts';
import { grToBody, grFromDoc } from './bodies/goodsReceipt.ts';

export const DOCTYPE_BODIES: Partial<Record<ErpDocKind, DoctypeBodyFns>> = {
  'purchase-request': { toBody: mrToBody, fromDoc: mrFromDoc },
  rfq: { toBody: rfqToBody, fromDoc: rfqFromDoc },
  quotation: { toBody: supplierQuotationToBody, fromDoc: supplierQuotationFromDoc },
  'purchase-order': { toBody: poToBody, fromDoc: poFromDoc },
  'goods-receipt': { toBody: grToBody, fromDoc: grFromDoc },
};
