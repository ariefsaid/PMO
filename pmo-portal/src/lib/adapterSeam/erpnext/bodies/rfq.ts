/**
 * Request for Quotation `toBody`/`fromDoc` — FR-ENA-111. Not R9-frozen (the R9 spike proved PI/PE/PO/GR
 * only); minimal supplier + item rows, matching stock Frappe's `suppliers` child-table shape. No
 * invented fields beyond the doctype's mandatory `suppliers`/`items`/`warehouse`.
 *
 * `warehouse` (task 6.4 fix-round, live-bench-discovered 2026-07-12): unlike Material Request/Purchase
 * Order, RFQ does NOT server-default a warehouse on its item row — a stock item with no `warehouse`
 * raises `Row #1: Warehouse is mandatory for stock Item <item>` on create. The org binding's
 * `config.default_warehouse` (OQ-6, `external_org_bindings.config`) supplies it, matching the same
 * "the adapter/binding config supplies everything ERPNext itself won't default" discipline the
 * R9-frozen bodies (PI/PE/PO/GR) already follow.
 *
 * `conversion_factor` (task 6.4 fix-round, same live-bench pass): `Request for Quotation Item.
 * conversion_factor` is a REQUIRED field Frappe does NOT default (`Row 1: Conversion Factor is
 * mandatory`) — a technical uom<->stock_uom ratio, not an org business default, so `1` (the safe,
 * universal 1:1 ratio for PMO's simple item model) is hardcoded, not read from config.
 *
 * `message_for_supplier` (task 6.4 fix-round, same live-bench pass): the RFQ HEADER field is
 * REQUIRED (`Value missing for Request for Quotation: Message for Supplier`) — boilerplate supplier
 * email copy, not a PMO business value; a fixed minimal message is hardcoded (never invented
 * per-case content this adapter has no source for).
 *
 * `uom` (task 6.4 fix-round, same live-bench pass): `Request for Quotation Item.uom` is REQUIRED and,
 * unlike Material Request, NOT auto-populated from the Item master (`Row #1: Value missing for: UOM`).
 * Sourced from the org binding's `config.default_uom` (same "adapter/binding supplies what ERPNext
 * itself won't default" discipline as `warehouse` above) — PMO's current item model carries no
 * per-item UOM of its own to send instead.
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { requireItems } from './shared.ts';

export function rfqToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Request for Quotation');
  const warehouse = ctx.config.default_warehouse as string | undefined;
  const uom = ctx.config.default_uom as string | undefined;
  return {
    suppliers: ctx.refs.supplier ? [{ supplier: ctx.refs.supplier }] : [],
    message_for_supplier: 'Please submit your quotation.',
    items: items.map((i) => ({
      item_code: i.item_code,
      qty: i.qty,
      schedule_date: i.schedule_date,
      conversion_factor: 1,
      ...(warehouse ? { warehouse } : {}),
      ...(uom ? { uom } : {}),
    })),
  };
}

export function rfqFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    rfq_number: String(d.name),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}
