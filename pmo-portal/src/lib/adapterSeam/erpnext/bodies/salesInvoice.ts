/**
 * Sales Invoice `toBody`/`fromDoc` — R9-P3a spike §1 frozen
 * (docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md). `toBody` sends exactly
 * `{customer, items:[{item_code,qty,rate,description?}], project?, po_no?, po_date?}`; ERPNext SERVER-DERIVES `debit_to`
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
    items: items.map((i) => ({ item_code: i.item_code, qty: i.qty, rate: i.rate, ...(i.description ? { description: i.description } : {}) })),
  };
  // FR-SAR-101: the dispatch resolves the ERP project name (via project_name search → ERP name, from the
  // binding's ERP-project→PMO map) and supplies it in ctx.refs.project. Header `project` suffices (it
  // propagates to both GL legs on submit). Omitted when no project (gate OFF / inbound-adopted).
  if (ctx.refs.project) body.project = ctx.refs.project;
  // #858: a billing claim states its own currency (the dispatch sets it from the claim row); other invoices leave it to ERP.
  if (typeof rec.currency === 'string' && rec.currency) body.currency = rec.currency;
  // #766 (DD-PBL-12b): a billing claim's invoice carries its tax rows explicitly (the dispatch resolves them from the
  // company's default template); every other invoice sends none, as before.
  if (Array.isArray(rec.taxes) && rec.taxes.length > 0) body.taxes = rec.taxes;
  // The dispatch factory resolves the invoice/work-order/project fallback before outbox hashing.
  const reference = typeof rec.reference_number === 'string' ? rec.reference_number.trim() : '';
  if (reference) {
    body.po_no = reference;
    if (typeof rec.po_date === 'string' && rec.po_date.trim()) body.po_date = rec.po_date.trim();
  }
  // #767 (AC-DUE-003): the client's receipt date, into the site custom field the onboarding ensures
  // (`erpCustomFields.ts`). `due_date` is never sent — ERP keeps server-deriving it from its own
  // payment terms (see `resolveSalesInvoicePo` for why).
  const received = typeof rec.received_date === 'string' ? rec.received_date.trim() : '';
  if (received) body.custom_received_date = received;
  return body;
}

export function siFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  return {
    // #767: ERP's due_date + our custom receipt field, mapped back. Keys are present only when the doc
    // carries them, so a doc without the custom field leaves the mirrored value untouched.
    ...(d.due_date ? { erp_due_date: String(d.due_date) } : {}),
    ...(d.custom_received_date ? { received_date: String(d.custom_received_date) } : {}),
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
    // #478 / OD-CR-5: read-backs PRESERVE the source doc's currency — never the ERPNext company
    // default and never a PMO constant.
    currency: (d.currency as string | null) ?? null,
    // #478 / DD-XING-4: the header tax facts. `total_taxes_and_charges` is ERP's own total tax and is
    // mirrored VERBATIM (ADR-0048 — PMO reads money, never recomputes it); `taxes_and_charges` is the
    // Sales Taxes and Charges TEMPLATE name. The per-rate breakdown lives on the `taxes` CHILD table,
    // which the list endpoint cannot return, so `tax_rate` is deliberately NOT derived here — a
    // computed rate would be a PMO-invented figure that rounds differently from the authored one.
    tax_amount: mirrorMoney(d.total_taxes_and_charges),
    tax_template: (d.taxes_and_charges as string | null) ?? null,
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}

/**
 * The list-endpoint fields `siFromDoc` actually READS (Luna BLOCK 6). The modified-poll sweep builds its
 * `fields=[…]` request from this, so an adopted/updated mirror row is never written with NULLs for
 * data the ERP doc carries. Co-located with the mapper so the two cannot drift apart.
 */
// `custom_received_date` is deliberately NOT listed: it is a site-level custom field, and a list query that
// names an unknown column fails the WHOLE sweep. `siFromDoc` still maps it from any full-document read-back.
export const SI_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'customer', 'posting_date', 'po_no', 'grand_total', 'outstanding_amount', 'currency', 'total_taxes_and_charges', 'taxes_and_charges', 'due_date'] as const;
