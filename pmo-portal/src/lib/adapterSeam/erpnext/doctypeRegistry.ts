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
  /** ADR-0058 §3 recovery-probe anchor (task 6.4 + Slice-6 completion, live-bench-verified
   *  2026-07-12): the stock text field the adapter stamps the idempotency key into AND the recovery
   *  probe filters by (`GET .../<DocType>?filters=[[<anchorField>,"like","%<key>%"], ...]`). `null`
   *  means this doctype has NO queryable anchor that survives ERPNext's `validate` — the probe is
   *  SKIPPED entirely (never issue the erroring filtered GET) and the row always falls through to a
   *  fresh claim+POST. R1 (the DB-enforced atomic claim) is unaffected by the anchor; the anchor only
   *  enables R3 orphan-adoption for a `pending`/`failed`-state crash. See `doctypeRegistry.test.ts`'s
   *  docstring for the per-doctype empirical rationale (PI/PR → `remarks`; PE → `reference_no`). */
  anchorField: string | null;
  /** C-1 DIRECTOR RULING (ADR-0058 §4): `true` when the `anchorField` is ERP-side MUTABLE, so a probe
   *  miss is NOT conclusive absence. Payment Entry's `reference_no` can be edited by an accountant after
   *  commit — a post-window recovery that finds no doc could still have a landed (renamed) PE, so it is
   *  HELD not reissued (a blind reissue risks a double-pay). Omitted/`false` ⇒ immutable anchor (Purchase
   *  Invoice `remarks`) or no anchor ⇒ reissue-capable (conclusive absence). */
  anchorMutable?: boolean;
  /** Assigned per entry by 2.7 (money doc bodies) + slice 3 (party bodies) via `DOCTYPE_BODIES`. */
  toBody: (rec: PmoRecord, ctx: ErpCtx) => unknown;
  /** Assigned per entry by 2.7 + slice 3 via `DOCTYPE_BODIES`. */
  fromDoc: (doc: unknown) => PmoRecord;
}

/** The static registry — Frappe doctype names confined HERE. `submittable` drives the adapter's
 *  two-step create->submit (FR-ENA-044); `readOnly` marks a kind PMO never writes (e.g. Customer, OQ-4);
 *  `anchorField` names the per-doctype recovery-probe anchor (ADR-0058 §3, task 6.4 — `null` ⇒ skip the
 *  probe; 'remarks' for PI/PR; 'reference_no' for PE per the DIRECTOR RULING, see test docstring). */
export const DOCTYPE_REGISTRY: Record<ErpDocKind, Pick<DoctypeEntry, 'doctype' | 'submittable' | 'readOnly' | 'anchorField' | 'anchorMutable'>> = {
  'purchase-request': { doctype: 'Material Request', submittable: true, anchorField: null },
  rfq: { doctype: 'Request for Quotation', submittable: true, anchorField: null },
  quotation: { doctype: 'Supplier Quotation', submittable: true, anchorField: null },
  'purchase-order': { doctype: 'Purchase Order', submittable: true, anchorField: null },
  'goods-receipt': { doctype: 'Purchase Receipt', submittable: true, anchorField: 'remarks' },
  'purchase-invoice': { doctype: 'Purchase Invoice', submittable: true, anchorField: 'remarks' },
  // DIRECTOR RULING (Slice-6 completion, 2026-07-12, live-bench-verified): Payment Entry's own
  // `validate` hook OVERWRITES `remarks` with an auto-generated "Amount X to Y..." description on
  // every save — a key stamped into `remarks` is silently clobbered, so R3's probe can never find it.
  // `reference_no` is a native, REST-filterable field that PMO owns for PMO-originated PEs (peToBody
  // never sends it) AND it SURVIVES validate+submit+refetch carrying the key verbatim — so PE anchors
  // on `reference_no` instead. The anchor matters only during the recovery window; ERP-side edits to
  // reference_no afterward are acceptable. See ADR-0058 §3 (amended) + doctypeRegistry.test.ts docstring.
  // anchorMutable (C-1): `reference_no` is ERP-side editable, so a probe miss is NOT conclusive → a
  // post-window recovery with no composite-probe hit is HELD, never auto-reissued (double-pay guard).
  payment: { doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true },
  supplier: { doctype: 'Supplier', submittable: false, anchorField: null },
  customer: { doctype: 'Customer', submittable: false, anchorField: null }, // write scope settled in slice 3 (OQ-4)
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
