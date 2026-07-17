/**
 * Material Request (the PMO Purchase Request) `toBody`/`fromDoc` — R9 §0 + spec FR-ENA-110.
 * `material_request_type: 'Purchase'` + `company` (from the binding config) are required; ERPNext has
 * no `grand_total` on this doctype (it is a request, not a valued doc) — `amount` mirrors `d.total`
 * when ERPNext computes it, else stays `NULL` (never a PMO-side Σ of lines, ADR-0048).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';
import { requireItems } from './shared.ts';

export function mrToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Material Request');
  return {
    material_request_type: 'Purchase',
    company: ctx.config.company,
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, rate: i.rate, schedule_date: i.schedule_date })),
  };
}

export function mrFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    pr_number: String(d.name),
    amount: mirrorMoney(d.total),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}
