/**
 * Purchase Invoice `toBody`/`fromDoc` — R9 §1 frozen. `toBody` sends exactly `{supplier, items:
 * [{item_code, qty, rate}]}`; ERPNext server-defaults `credit_to`, `posting_date`/`due_date`, and all
 * totals (docs/spikes/2026-07-11-erpnext-pe-mandatory-fields.md §1). `fromDoc` mirrors the header
 * `grand_total`/`outstanding_amount` as the money ORACLE (ADR-0048) — never a Σ of the lines.
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';
import { requireItems } from './shared.ts';

export function piToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Purchase Invoice');
  return {
    supplier: ctx.refs.supplier,
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, rate: i.rate })),
  };
}

export function piFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    vi_number: String(d.name),
    invoice_date: (d.posting_date as string | null) ?? null,
    reference_number: (d.bill_no as string | null) ?? null,
    amount: mirrorMoney(d.grand_total),
    erp_outstanding_amount: mirrorMoney(d.outstanding_amount),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}

/**
 * The list-endpoint fields `piFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
export const PI_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'posting_date', 'bill_no', 'grand_total', 'outstanding_amount'] as const;
