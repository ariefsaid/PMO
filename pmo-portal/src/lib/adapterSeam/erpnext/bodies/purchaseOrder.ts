/**
 * Purchase Order `toBody`/`fromDoc` — R9 §3 frozen. `schedule_date` on the item row is the ONLY delta
 * vs. the PI item shape and is genuinely mandatory (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md §3).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';
import { requireItems } from './shared.ts';

export function poToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Purchase Order');
  return {
    supplier: ctx.refs.supplier,
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, rate: i.rate, schedule_date: i.schedule_date })),
  };
}

export function poFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    po_number: String(d.name),
    amount: mirrorMoney(d.grand_total),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}
