/**
 * Supplier Quotation `toBody`/`fromDoc` — FR-ENA-112. `grand_total` -> `total_amount` is the money
 * ORACLE (ADR-0048); `valid_till` -> `valid_until`; `is_selected` is a PMO-only enhancement column —
 * it is NEVER sent to ERP (the one-selected invariant is purely PMO-side, task 4.7).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';
import { requireItems } from './shared.ts';

export function supplierQuotationToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Supplier Quotation');
  return {
    supplier: ctx.refs.supplier,
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, rate: i.rate })),
  };
}

export function supplierQuotationFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    vq_number: String(d.name),
    total_amount: mirrorMoney(d.grand_total),
    valid_until: (d.valid_till as string | null) ?? null,
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    // is_selected is intentionally omitted — PMO-only, never sourced from ERP.
  };
}

/**
 * The list-endpoint fields `sqFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
export const SQ_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'grand_total', 'valid_till'] as const;
