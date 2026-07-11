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
}

export interface DoctypeEntry {
  doctype: string;
  submittable: boolean;
  readOnly?: boolean;
  /** Assigned per entry by 2.7 (money doc bodies) + slice 3 (party bodies) via `DOCTYPE_BODIES`. */
  toBody: (rec: PmoRecord, ctx: ErpCtx) => unknown;
  /** Assigned per entry by 2.7 + slice 3 via `DOCTYPE_BODIES`. */
  fromDoc: (doc: unknown) => PmoRecord;
}

/** The static registry — Frappe doctype names confined HERE. `submittable` drives the adapter's
 *  two-step create->submit (FR-ENA-044); `readOnly` marks a kind PMO never writes (e.g. Customer, OQ-4). */
export const DOCTYPE_REGISTRY: Record<ErpDocKind, Pick<DoctypeEntry, 'doctype' | 'submittable' | 'readOnly'>> = {
  'purchase-request': { doctype: 'Material Request', submittable: true },
  rfq: { doctype: 'Request for Quotation', submittable: true },
  quotation: { doctype: 'Supplier Quotation', submittable: true },
  'purchase-order': { doctype: 'Purchase Order', submittable: true },
  'goods-receipt': { doctype: 'Purchase Receipt', submittable: true },
  'purchase-invoice': { doctype: 'Purchase Invoice', submittable: true },
  payment: { doctype: 'Payment Entry', submittable: true },
  supplier: { doctype: 'Supplier', submittable: false },
  customer: { doctype: 'Customer', submittable: false }, // write scope settled in slice 3 (OQ-4)
};
