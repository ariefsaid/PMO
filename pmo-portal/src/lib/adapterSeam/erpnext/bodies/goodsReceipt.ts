/**
 * Purchase Receipt (Goods Receipt) `toBody`/`fromDoc` — R9 §4 frozen. `purchase_order` +
 * `purchase_order_item` (the PO item CHILD-ROW `name`, resolved by the multi-domain ref resolver,
 * slice 5) drive PO fulfilment linkage (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md §4).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { requireItems } from './shared.ts';

export function grToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Purchase Receipt');
  return {
    supplier: ctx.refs.supplier,
    items: items.map((i) => ({
      item_code: i.item_code,
      qty: i.qty,
      rate: i.rate,
      purchase_order: ctx.refs.po,
      purchase_order_item: i.po_item_child_name,
    })),
  };
}

export function grFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  const items = Array.isArray(d.items) ? (d.items as Array<Record<string, unknown>>) : [];
  return {
    id: String(d.name),
    gr_number: String(d.name),
    po_id: (items[0]?.purchase_order as string | undefined) ?? null,
    reference_number: (d.supplier_delivery_note as string | null) ?? null,
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
  };
}

/**
 * The list-endpoint fields `grFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
export const GR_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'supplier_delivery_note'] as const;
