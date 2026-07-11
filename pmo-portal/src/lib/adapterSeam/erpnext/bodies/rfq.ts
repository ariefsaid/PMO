/**
 * Request for Quotation `toBody`/`fromDoc` — FR-ENA-111. Not R9-frozen (the R9 spike proved PI/PE/PO/GR
 * only); minimal supplier + item rows, matching stock Frappe's `suppliers` child-table shape. No
 * invented fields beyond the doctype's mandatory `suppliers`/`items`.
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { requireItems } from './shared.ts';

export function rfqToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Request for Quotation');
  return {
    suppliers: ctx.refs.supplier ? [{ supplier: ctx.refs.supplier }] : [],
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, schedule_date: i.schedule_date })),
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
