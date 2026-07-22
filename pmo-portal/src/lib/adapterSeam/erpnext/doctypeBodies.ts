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
import { supplierToBody, supplierFromDoc } from './bodies/supplier.ts';
import { customerToBody, customerFromDoc } from './bodies/customer.ts';
import { piToBody, piFromDoc } from './bodies/purchaseInvoice.ts';
import { peToBody, peFromDoc } from './bodies/paymentEntry.ts';
import { siToBody, siFromDoc } from './bodies/salesInvoice.ts';
import { peReceiveToBody, peReceiveFromDoc } from './bodies/incomingPayment.ts';
import { tsToBody, tsFromDoc } from './bodies/timesheet.ts';
import { employeeToBody, employeeFromDoc } from './bodies/employee.ts';
import { budgetToBody, budgetFromDoc } from './bodies/budget.ts';

export const DOCTYPE_BODIES: Partial<Record<ErpDocKind, DoctypeBodyFns>> = {
  supplier: { toBody: supplierToBody, fromDoc: supplierFromDoc },
  customer: { toBody: customerToBody, fromDoc: customerFromDoc },
  'purchase-request': { toBody: mrToBody, fromDoc: mrFromDoc },
  rfq: { toBody: rfqToBody, fromDoc: rfqFromDoc },
  quotation: { toBody: supplierQuotationToBody, fromDoc: supplierQuotationFromDoc },
  'purchase-order': { toBody: poToBody, fromDoc: poFromDoc },
  'goods-receipt': { toBody: grToBody, fromDoc: grFromDoc },
  // Slice 6 (task 6.2) — the R9 §1/§2 money-doc bodies (Purchase Invoice + Payment Entry).
  'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc },
  payment: { toBody: peToBody, fromDoc: peFromDoc },
  // P3a Slice 1 — Revenue domain spike-frozen bodies (FR-SAR-100/103, FR-SAR-120, OQ-SAR-1 #1-#4).
  'sales-invoice': { toBody: siToBody, fromDoc: siFromDoc },
  'incoming-payment': { toBody: peReceiveToBody, fromDoc: peReceiveFromDoc },
  // P3b Slice 2 — Timesheets domain (ADR-0059 Posture B), spike-frozen body (FR-TSP-064).
  timesheet: { toBody: tsToBody, fromDoc: tsFromDoc },
  // P3b Slice 3 — the Employee MASTER (OQ-TSP-3 ruling), READ-ONLY (FR-TSP-093): `toBody` throws;
  // `fromDoc` is the ONLY function ever invoked, by the inbound adopt (`erpnextFeedDeps.mintMirrorRow`).
  employee: { toBody: employeeToBody, fromDoc: employeeFromDoc },
  // P3c — the budget push (ADR-0055 §6 + ADR-0059 Posture B). `fromDoc` is LIFECYCLE-ONLY: an ERP-side
  // budget_amount has no route back into PMO, which is the SoT for the figure (FR-BUD-140/152).
  budget: { toBody: budgetToBody, fromDoc: budgetFromDoc },
};
