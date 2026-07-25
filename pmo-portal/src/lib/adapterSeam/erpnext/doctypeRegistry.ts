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
  | 'customer'
  | 'sales-invoice'
  | 'incoming-payment'
  | 'timesheet'
  | 'employee'
  | 'budget';

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
  /** Whether a `create` command auto-submits the doc (the R9 two-step insert→submit). Default TRUE
   *  for every submittable kind. `false` ONLY for `sales-invoice` (OD-SAR-DRAFT-SUBMIT): a revenue SI
   *  create leaves an ERP DRAFT (docstatus 0) so the SEPARATE SoD-gated `verb:'submit'` transition —
   *  performed by a different approver — is the real commit. Without this the author submits their
   *  own invoice at create and the signed-off SoD (approver≠author) is bypassed. */
  submitOnCreate?: boolean;
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
  /** ADR-0059 §4 corollary (P3c): `true` when this kind must NEVER be auto-reissued on an inconclusive
   *  post-window recovery even though it has NO anchor at all. A `null` anchor otherwise means "skip the
   *  probe -> fresh claim+POST", i.e. reissue-capable — which for a Posture-B document whose doctype
   *  offers no anchor field to probe with (ERP `Budget`) is a silently DUPLICATED external record.
   *  Additive + DEFAULT-ABSENT, so every shipped kind stays byte-for-byte:
   *    `reissueOnInconclusiveAbsence = !(entry.anchorMutable || entry.neverReissue)`. */
  neverReissue?: boolean;
  /** FR-BUD-121 (P3c): `true` when ERP ITSELF enforces at most one live document per this kind's
   *  natural grain, so a `create` for a grain that is already occupied must UPSERT the existing
   *  document instead of minting a second one. ERP `Budget` is the case: its
   *  (company, fiscal_year, project|cost_center, account) uniqueness is a hard, ATOMIC server-side
   *  reject (budget-write spike §8), so a revision dispatched as a plain create is REFUSED — and ERP
   *  then keeps enforcing the SUPERSEDED figure while PMO shows the revision. The upsert TARGET is
   *  resolved by the dispatch factory into `ctx.refs.self` (never guessed by the adapter); with no
   *  target resolved, the create stays a plain create. Additive + DEFAULT-ABSENT ⇒ every other kind is
   *  byte-for-byte. */
  upsertOnGrain?: boolean;
  /** Assigned per entry by 2.7 (money doc bodies) + slice 3 (party bodies) via `DOCTYPE_BODIES`. */
  toBody: (rec: PmoRecord, ctx: ErpCtx) => unknown;
  /** Assigned per entry by 2.7 + slice 3 via `DOCTYPE_BODIES`. */
  fromDoc: (doc: unknown) => PmoRecord;
}

/** The static registry — Frappe doctype names confined HERE. `submittable` drives the adapter's
 *  two-step create->submit (FR-ENA-044); `readOnly` marks a kind PMO never writes (e.g. Customer, OQ-4);
 *  `anchorField` names the per-doctype recovery-probe anchor (ADR-0058 §3, task 6.4 — `null` ⇒ skip the
 *  probe; 'remarks' for PI/PR; 'reference_no' for PE per the DIRECTOR RULING, see test docstring). */
export const DOCTYPE_REGISTRY: Record<ErpDocKind, Pick<DoctypeEntry, 'doctype' | 'submittable' | 'submitOnCreate' | 'readOnly' | 'anchorField' | 'anchorMutable' | 'neverReissue' | 'upsertOnGrain'>> = {
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
  // P3a Slice 1 — Revenue domain (FR-SAR-011, OQ-SAR-1/R9-P3a spike frozen):
  // SI — anchor 'remarks', IMMUTABLE (OQ-SAR-4, R9-P3a spike #2: remarks survives validate+submit+refetch
  // verbatim — the PI twin, reissue-capable). ERP server-derives debit_to + items[].income_account.
  'sales-invoice': { doctype: 'Sales Invoice', submittable: true, submitOnCreate: false, anchorField: 'remarks', anchorMutable: false },
  // PE-receive — anchor 'reference_no', MUTABLE (OQ-SAR-3, R9-P3a spike #4: remarks is clobbered by PE
  // validate; reference_no survives. C-1 applies verbatim: composite probe + held-on-inconclusive, NEVER
  // auto-reissued — the double-receive guard). Same doctype as 'payment', payment_type='Receive'.
  'incoming-payment': { doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true },
  // P3b — Timesheets domain (ADR-0059 Posture B; FR-TSP-060/061; anchor triple frozen by
  // docs/spikes/2026-07-20-erpnext-timesheet-fields.md §2/§9).
  // anchor `note`: survives validate + submit + re-fetch VERBATIM and is REST-filterable (§2), and a
  // post-submit PUT is refused `UpdateAfterSubmitError` ⇒ anchorMutable:false (the PI/SI twin — a probe
  // miss IS conclusive absence, so recovery may reissue). Not anchor-less ⇒ ADR-0059 §4's fail-closed
  // `neverReissue` branch does NOT fire for this kind.
  // ⚑ submitOnCreate is INTENTIONALLY TRUE — the DELIBERATE OPPOSITE of 'sales-invoice'. Do NOT "fix"
  // this to match the SI. OD-SAR-DRAFT-SUBMIT exists because an SI's ONLY approval gate WAS the ERP
  // submit, so create+submit let the author approve their own invoice. A timesheet's gate is
  // `transition_timesheet`'s SoD — approver≠author, ALREADY PASSED, in PMO, by a DIFFERENT actor (0007
  // A4: "even an Admin can never approve their own timesheet"). The ERP submit is the mechanical
  // CONSEQUENCE of that approval, not a second gate; an ERP draft would mean approved hours never reach
  // costing, which is the entire point of P3b. Submit posts NO GL entry (§5) — it commits HOURS.
  timesheet: { doctype: 'Timesheet', submittable: true, submitOnCreate: true, anchorField: 'note', anchorMutable: false },
  // P3b — the Employee MASTER (OQ-TSP-3 ruling, spike §8b/§9, FR-TSP-090..095). readOnly: PMO NEVER
  // writes an ERP Employee — this kind exists ONLY for the inbound adopt (ADR-0059 §5's master-data
  // exception: the never-adopt rule governs this domain's PROCESS documents — Timesheet — not the
  // masters they reference). No anchor: a master is never recovery-probed like a money doc; not
  // submittable: Employee is not a submittable doctype (`is_submittable: 0`, spike §8b).
  employee: { doctype: 'Employee', submittable: false, readOnly: true, anchorField: null },
  // P3c — Budget (ADR-0055 §6 + ADR-0059 Posture B; contract frozen by
  // docs/spikes/2026-07-16-erpnext-budget-fields.md).
  // ⚑ anchorField: null is NOT the usual "we didn't find a good one" — the spike read the doctype META
  // and established there is NO free-text field of any type on `Budget` OR on its `Budget Account` child
  // (§1/§7, exhaustive). There is nowhere to stamp a PMO idempotency key, so the ADR-0058 §3 recovery
  // probe cannot exist for this kind at all.
  // ⚑ CONSEQUENCE — the recovery probe for this kind is the ERP-ENFORCED GRAIN, not an anchor
  // (`upsertOnGrain` below; see `reissueOnInconclusiveAbsence`). The kind originally carried
  // `neverReissue: true` (ADR-0059 §4 corollary, FR-BUD-143) because with no probe an inconclusive
  // post-window recovery could not tell "the POST never landed" from "the POST landed and we lost the
  // response". ⚑ HIGH-1 (money-safety audit round 5) retired that flag for this kind, because holding was
  // strictly WORSE than reissuing once the upsert existed: the upsert is cancel(old) → create(new), so a
  // failed create leaves the grain with NO live Budget — every overspend control off — and a HELD row
  // made that state permanent (nothing un-held it, HIGH-2). The reissue is not blind: the dispatch
  // factory's server-derived grain read (`resolveBudgetRefs`, `docstatus < 2` — every document ERP's own
  // duplicate guard counts) is conclusive, and each of its three answers has a safe action (live occupant
  // ⇒ upsert onto it; DRAFT occupant ⇒ named refusal with zero writes; empty ⇒ the create did not land).
  // submittable/submitOnCreate: `Budget` is submittable (§6) and a DRAFT budget enforces nothing — the
  // native overspend controls are the entire point of this push, so the create must submit. Money fields
  // are locked post-submit (§6): a revision is cancel+amend, never a PUT — which is exactly what
  // `upsertOnGrain` routes a create onto once the dispatch factory resolves the grain's existing live
  // Budget into `ctx.refs.self` (FR-BUD-121 / AC-BUD-031).
  budget: { doctype: 'Budget', submittable: true, submitOnCreate: true, anchorField: null, upsertOnGrain: true },
};

/**
 * May a post-window recovery that found NOTHING safely REISSUE (mint a new ERP document) under the same
 * idempotency key — or must the row be HELD for an operator (ADR-0058 §4 / the C-1 DIRECTOR RULING)?
 *
 * ONE definition, consumed by both served functions (`adapter-dispatch`, `erpnext-sweep`) and by the
 * registry's own tests, so the two dispatch paths can never disagree about whether a money command may
 * be re-minted. The question is always the same: IS ABSENCE CONCLUSIVE?
 *
 *  • `anchorMutable` (Payment Entry `reference_no`, editable by an accountant post-commit) ⇒ NEVER.
 *    A probe miss cannot distinguish "no document" from "a landed document whose anchor was edited", and
 *    a blind reissue is a double-pay. No amount of other evidence changes that.
 *  • `upsertOnGrain` (ERP `Budget`) ⇒ YES. This kind has no anchor at all, but ERP itself enforces at most
 *    one document per its natural grain, so the dispatch factory's server-derived grain read IS a
 *    conclusive probe (⚑ HIGH-1: it reads `docstatus < 2`, i.e. drafts too, so a create that landed but
 *    failed to submit is seen and refused by name rather than mistaken for absence). Holding instead was
 *    strictly more dangerous: the upsert's cancel-then-create window can leave the grain UNENFORCED, and
 *    a held row made that permanent.
 *  • `neverReissue` with no grain ⇒ NEVER (no probe of any kind exists).
 *  • otherwise (immutable or absent anchor, e.g. Purchase Invoice `remarks`) ⇒ YES, as shipped.
 */
export function reissueOnInconclusiveAbsence(
  entry: Pick<DoctypeEntry, 'anchorMutable' | 'neverReissue' | 'upsertOnGrain'>,
): boolean {
  if (entry.anchorMutable) return false;
  if (entry.upsertOnGrain) return true;
  return !entry.neverReissue;
}

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
