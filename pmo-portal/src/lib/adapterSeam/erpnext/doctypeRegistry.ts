/**
 * The internal `(domain, kind, operation) -> doctype` map (FR-ENA-014). This is the ONE place Frappe
 * doctype names live (confinement, FR-ENA-013/NFR-ENA-CONTRACT-001) — no module above the adapter
 * contract ever sees a doctype name. `erp_doc_kind` is the PMO-side verb that crosses the contract
 * (never a Frappe doctype name).
 *
 * `DOCTYPE_REGISTRY` ships the complete STATIC table (doctype name + submittable/readOnly flags)
 * here; `toBody`/`fromDoc` are attached per-kind via the separate `DOCTYPE_BODIES` side table
 * (2.7 wires the money-doc bodies, slice 3 wires supplier/customer) so this file stays the single,
 * append-only source of Frappe names — no per-slice edits to this table.
 */
import { AdapterError } from '../contract.ts';
import type { PmoRecord } from '../contract.ts';

export type ErpDocKind =
  | 'purchase-request'
  | 'rfq'
  | 'quotation'
  | 'purchase-order'
  | 'goods-receipt'
  | 'purchase-invoice'
  | 'payment'
  | 'supplier'
  | 'customer';

/** Per-command context injected into `toBody` (resolved refs + the org's binding config defaults). */
export interface ErpCtx {
  refs: Record<string, string | null>;
  config: Record<string, unknown>;
  /** Slice 5 addition (FR-ENA-103): server-resolved line items (e.g. from `procurement_items`, the
   *  case's item list) — a fallback the adapter substitutes ONLY when the command's own `record.items`
   *  is absent/empty. `undefined` (every pre-Slice-5 caller) ⇒ byte-for-byte, no substitution. */
  resolvedItems?: unknown[];
}

export interface DoctypeEntry {
  doctype: string;
  submittable: boolean;
  readOnly?: boolean;
  /** ADR-0057 §3 recovery-probe eligibility (task 6.4, live-bench-verified 2026-07-12): `true` only
   *  for a doctype that actually carries a filterable stock `remarks` field (Purchase Invoice/Payment
   *  Entry/Purchase Receipt) — every other kind lacks the field entirely on this ERPNext v15 bench, so
   *  the probe MUST be skipped for them (never issue the erroring filtered GET); see
   *  `doctypeRegistry.test.ts`'s docstring for the full finding. */
  remarksQueryable: boolean;
  /** Assigned per entry by 2.7 (money doc bodies) + slice 3 (party bodies) via `DOCTYPE_BODIES`. */
  toBody: (rec: PmoRecord, ctx: ErpCtx) => unknown;
  /** Assigned per entry by 2.7 + slice 3 via `DOCTYPE_BODIES`. */
  fromDoc: (doc: unknown) => PmoRecord;
}

/** The static registry — Frappe doctype names confined HERE. `submittable` drives the adapter's
 *  two-step create->submit (FR-ENA-044); `readOnly` marks a kind PMO never writes (e.g. Customer, OQ-4);
 *  `remarksQueryable` gates the ADR-0057 §3 recovery probe (task 6.4). */
export const DOCTYPE_REGISTRY: Record<ErpDocKind, Pick<DoctypeEntry, 'doctype' | 'submittable' | 'readOnly' | 'remarksQueryable'>> = {
  'purchase-request': { doctype: 'Material Request', submittable: true, remarksQueryable: false },
  rfq: { doctype: 'Request for Quotation', submittable: true, remarksQueryable: false },
  quotation: { doctype: 'Supplier Quotation', submittable: true, remarksQueryable: false },
  'purchase-order': { doctype: 'Purchase Order', submittable: true, remarksQueryable: false },
  'goods-receipt': { doctype: 'Purchase Receipt', submittable: true, remarksQueryable: true },
  'purchase-invoice': { doctype: 'Purchase Invoice', submittable: true, remarksQueryable: true },
  payment: { doctype: 'Payment Entry', submittable: true, remarksQueryable: true },
  supplier: { doctype: 'Supplier', submittable: false, remarksQueryable: false },
  customer: { doctype: 'Customer', submittable: false, remarksQueryable: false }, // write scope settled in slice 3 (OQ-4)
};

/** The generic 3-value ERP docstatus label (task 4.10, FR-ENA-110/111/117). Frappe's `docstatus`
 *  domain is exactly `0|1|2` (R9 §5) — this stays TABLE-AGNOSTIC on purpose: a record-table mirror
 *  writer adapts the returned label into its own `status` CHECK domain (e.g. `rfqs.status` has no
 *  'Submitted' value; the writer maps 'Submitted'->'Issued' for that table). `null`/absent (never
 *  observed post-create, but never silently mis-mapped either) defaults to 'Draft'. */
export type ErpDocstatusStatus = 'Draft' | 'Submitted' | 'Cancelled';

export function mapErpDocstatus(docstatus: number | null): ErpDocstatusStatus {
  if (docstatus === null || docstatus === 0) return 'Draft';
  if (docstatus === 1) return 'Submitted';
  if (docstatus === 2) return 'Cancelled';
  throw new AdapterError('commit-rejected', `unexpected erp docstatus value: ${docstatus}`);
}
