/**
 * Sales Invoice `toBody`/`fromDoc` — R9-P3a spike §1 frozen
 * (docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md). `toBody` sends exactly
 * `{customer, items:[{item_code,qty,rate}], project?}`; ERPNext SERVER-DERIVES `debit_to`
 * (← default_receivable_account), `items[].income_account` (← default_income_account), `company`,
 * `posting_date`/`due_date`, currency, cost_center, warehouse, and all totals — the adapter sends
 * NEITHER account (OQ-SAR-1 #1). `project` (NOT cost_center) is the ERP dimension that realizes
 * revenue-per-project and propagates to BOTH GL legs on submit (OQ-SAR-1 #5, FR-SAR-101).
 * `fromDoc` mirrors `grand_total`/`outstanding_amount` as the money ORACLE (ADR-0048).
 */
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';
import { mirrorMoney } from '../moneyShape.ts';
import { requireItems } from './shared.ts';

export function siToBody(rec: PmoRecord, ctx: ErpCtx): unknown {
  const items = requireItems(rec, 'Sales Invoice'); // empty-items 500 TypeError guard (OQ-SAR-1 #7)
  const body: Record<string, unknown> = {
    customer: ctx.refs.customer,
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, rate: i.rate })),
  };
  // FR-SAR-101: the dispatch resolves the ERP project name (via project_name search → ERP name, from the
  // binding's ERP-project→PMO map) and supplies it in ctx.refs.project. Header `project` suffices (it
  // propagates to both GL legs on submit). Omitted when no project (gate OFF / inbound-adopted).
  if (ctx.refs.project) body.project = ctx.refs.project;
  return body;
}

export function siFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    id: String(d.name),
    si_number: String(d.name),
    // Luna BLOCK A3: the ERP customer name — the inbound feed's mint path (erpnextFeedDeps.ts)
    // resolves this to the PMO customer_id via external_refs. Omitting it left every inbound-adopted
    // native SI with customer_id = NULL (a money row with no party).
    customer: (d.customer as string | null) ?? null,
    invoice_date: (d.posting_date as string | null) ?? null,
    reference_number: (d.po_no as string | null) ?? null, // customer PO/bill ref (AR-aging row, #6)
    amount: mirrorMoney(d.grand_total),
    erp_outstanding_amount: mirrorMoney(d.outstanding_amount),
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}