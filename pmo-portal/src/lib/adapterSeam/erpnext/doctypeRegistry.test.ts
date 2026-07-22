/**
 * FR-ENA-014 — erpnext/doctypeRegistry.ts: the internal (domain,kind,op)->doctype map. This is the
 * ONE place Frappe doctype names live (confinement, FR-ENA-013/NFR-ENA-CONTRACT-001). A pure static
 * table + `submittable` flag (drives the two-step create->submit); `toBody`/`fromDoc` are attached
 * per-kind by later tasks (2.7 + slice 3) via a separate side table, kept out of this registry.
 *
 * `anchorField` (task 6.4 + Slice-6 completion, ADR-0058 §3 — live-bench-verified 2026-07-12): the
 * recovery-probe anchor `GET .../<DocType>?filters=[[<anchorField>,...]]` requires a stock text field
 * that (a) exists on the doctype, (b) is REST-filterable, AND (c) SURVIVES ERPNext's own `validate`
 * hook through save+submit+re-fetch carrying the stamped idempotency key. The per-doctype override:
 *  - Purchase Invoice / Purchase Receipt → `'remarks'` (live-bench-confirmed: the key survives
 *    validate+submit+refetch verbatim AND the `remarks` filter returns the doc).
 *  - Payment Entry → `'reference_no'` (the DIRECTOR RULING, live-bench-verified 2026-07-12: PE's own
 *    `validate` hook OVERWRITES `remarks` with an auto-generated "Amount X to Y..." description on
 *    every save — the stamped key is silently clobbered — BUT `reference_no` is a native, queryable
 *    field that PMO owns for PMO-originated PEs and it SURVIVES validate+submit+refetch carrying the
 *    key verbatim; the anchor matters only during the recovery window, so ERP-side edits afterward
 *    are acceptable. `peToBody` never sends `reference_no`, so the stamp is the sole writer.)
 *  - every other kind → `null` (no queryable anchor: Material Request/RFQ/Supplier Quotation/Purchase
 *    Order/Supplier/Customer lack a filterable stock text field — Frappe rejects the filtered GET with
 *    `DataError: Field not permitted in query`. A `null` anchor skips the probe entirely and always
 *    falls through to a fresh claim+POST, which stays R1-safe — the DB claim is the actual
 *    concurrent-duplicate guard, unaffected — but forgoes R3 orphan-adoption for those kinds).
 *
 * The ADR's own Consequences section anticipates this exact per-doctype case ("If a future doctype
 * lacks remarks, that doctype's toBody chooses another stable stock text field") — `anchorField` is
 * that mechanism realized: the field NAME lives here (confined), and `stampAnchor`/`probeErpByAnchorKey`
 * consume it generically.
 */
import { describe, expect, it } from 'vitest';
import { DOCTYPE_REGISTRY, reissueOnInconclusiveAbsence } from './doctypeRegistry.ts';

describe('erpnext/doctypeRegistry', () => {
  it('FR-ENA-014 maps every PMO erp_doc_kind to its exact Frappe doctype name + submittable + anchorField', () => {
    expect(DOCTYPE_REGISTRY).toEqual({
      'purchase-request': { doctype: 'Material Request', submittable: true, anchorField: null },
      rfq: { doctype: 'Request for Quotation', submittable: true, anchorField: null },
      quotation: { doctype: 'Supplier Quotation', submittable: true, anchorField: null },
      'purchase-order': { doctype: 'Purchase Order', submittable: true, anchorField: null },
      'goods-receipt': { doctype: 'Purchase Receipt', submittable: true, anchorField: 'remarks' },
      'purchase-invoice': { doctype: 'Purchase Invoice', submittable: true, anchorField: 'remarks' },
      // DIRECTOR RULING (Slice-6 completion, 2026-07-12): PE anchors on `reference_no`, not `remarks`
      // — live-bench-verified: `remarks` is overwritten by ERPNext's `validate` hook, `reference_no`
      // survives. See the file docstring + ADR-0058 §3. C-1: `reference_no` is ERP-side MUTABLE
      // (anchorMutable) → a recovery probe miss is inconclusive → the PE is held, never reissued.
      payment: { doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true },
      supplier: { doctype: 'Supplier', submittable: false, anchorField: null },
      customer: { doctype: 'Customer', submittable: false, anchorField: null },
      // P3a Slice 1 — Revenue domain (FR-SAR-011, OQ-SAR-1/R9-P3a spike frozen):
      // SI — anchor 'remarks', IMMUTABLE (OQ-SAR-4, R9-P3a spike #2: remarks survives validate+submit+refetch
      // verbatim — the PI twin, reissue-capable). ERP server-derives debit_to + items[].income_account.
      'sales-invoice': { doctype: 'Sales Invoice', submittable: true, submitOnCreate: false, anchorField: 'remarks', anchorMutable: false },
      // PE-receive — anchor 'reference_no', MUTABLE (OQ-SAR-3, R9-P3a spike #4: remarks is clobbered by PE
      // validate; reference_no survives. C-1 applies verbatim: composite probe + held-on-inconclusive, NEVER
      // auto-reissued — the double-receive guard). Same doctype as 'payment', payment_type='Receive'.
      'incoming-payment': { doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true },
      // P3b — Timesheets domain (ADR-0059 Posture B). Anchor `note`, IMMUTABLE (spike §2: `note`
      // survives validate+submit+refetch verbatim, is REST-filterable, and a post-submit PUT is
      // rejected `UpdateAfterSubmitError` — the PI/SI twin, reissue-capable).
      timesheet: { doctype: 'Timesheet', submittable: true, submitOnCreate: true, anchorField: 'note', anchorMutable: false },
      // P3c — Budget (ADR-0059 Posture B). ⚑ The ONLY kind with NO anchor at all; its conclusive probe
      // is the ERP-enforced GRAIN instead (upsertOnGrain, HIGH-1).
      budget: { doctype: 'Budget', submittable: true, submitOnCreate: true, anchorField: null, upsertOnGrain: true },
      // P3b — the Employee MASTER (OQ-TSP-3 ruling, spike §8b/§9). readOnly:true — PMO NEVER writes an
      // ERP Employee; this kind exists ONLY for the inbound adopt (ADR-0059 §5's master-data exception).
      // No anchor (masters are never recovery-probed the way a money doc is) and not submittable
      // (Employee is not a submittable doctype, spike §8b).
      employee: { doctype: 'Employee', submittable: false, readOnly: true, anchorField: null },
    });
  });

  it('FR-ENA-013 no Frappe doctype name appears twice (each ERP doc kind is unambiguous), except Payment Entry which maps to two PMO kinds (payment/incoming-payment) disambiguated by payment_type', () => {
    const doctypes = Object.values(DOCTYPE_REGISTRY).map((entry) => entry.doctype);
    // One expected duplicate: payment + incoming-payment both map to 'Payment Entry'
    const uniqueDoctypes = new Set(doctypes);
    expect(uniqueDoctypes.size).toBe(doctypes.length - 1);
  });

  it('every anchored kind (anchorField != null) is submittable (the money-doc recovery surface)', () => {
    for (const [kind, entry] of Object.entries(DOCTYPE_REGISTRY)) {
      if (entry.anchorField !== null) {
        expect(entry.submittable, `${kind} has an anchor but is not submittable`).toBe(true);
      }
    }
  });

  it('P3a Slice 1: sales-invoice registry entry matches spike (R9-P3a-1, R9-P3a-2)', () => {
    const entry = DOCTYPE_REGISTRY['sales-invoice'];
    expect(entry).toEqual({ doctype: 'Sales Invoice', submittable: true, submitOnCreate: false, anchorField: 'remarks', anchorMutable: false });
  });

  it('P3a Slice 1: incoming-payment registry entry matches spike (R9-P3a-3, R9-P3a-4)', () => {
    const entry = DOCTYPE_REGISTRY['incoming-payment'];
    expect(entry).toEqual({ doctype: 'Payment Entry', submittable: true, anchorField: 'reference_no', anchorMutable: true });
  });

  it('AC-TSP-021 P3b: the timesheet entry is the spike-frozen triple — anchor `note`, immutable, submit-on-create', () => {
    const entry = DOCTYPE_REGISTRY.timesheet;
    expect(entry).toEqual({ doctype: 'Timesheet', submittable: true, submitOnCreate: true, anchorField: 'note', anchorMutable: false });
  });

  it('AC-TSP-021 P3b: submitOnCreate is TRUE — the deliberate OPPOSITE of sales-invoice (OD-SAR-DRAFT-SUBMIT does NOT apply)', () => {
    // A timesheet's approval gate is `transition_timesheet`'s SoD (approver≠author), ALREADY passed in
    // PMO by a DIFFERENT actor. An ERP draft would mean approved hours never reach costing.
    expect(DOCTYPE_REGISTRY.timesheet.submitOnCreate).toBe(true);
    expect(DOCTYPE_REGISTRY['sales-invoice'].submitOnCreate).toBe(false);
  });

  it('AC-TSP-093 P3b: the employee entry is READ-ONLY, not submittable, with no recovery anchor (spike §8b/§9)', () => {
    const entry = DOCTYPE_REGISTRY.employee;
    expect(entry).toEqual({ doctype: 'Employee', submittable: false, readOnly: true, anchorField: null });
  });

  it('AC-TSP-093 P3b: employee is the ONLY OTHER read-only party besides supplier/customer, and it alone sets readOnly:true', () => {
    // supplier/customer are also PMO-never-writes-beyond-party-create-in-practice (OQ-4), but neither
    // entry actually SETS readOnly:true today (unconsumed field, pre-existing gap) — employee is the
    // first kind to set it, matching FR-TSP-093's explicit "PMO never writes an ERP Employee" contract.
    const readOnlyKinds = Object.entries(DOCTYPE_REGISTRY)
      .filter(([, e]) => e.readOnly === true)
      .map(([kind]) => kind);
    expect(readOnlyKinds).toEqual(['employee']);
  });

  // ── P3c — the budget kind (ADR-0055 §6 + ADR-0059 Posture B) ──────────────────────────────────
  // The budget-write spike (docs/spikes/2026-07-16-erpnext-budget-fields.md §7) established, from the
  // doctype META rather than a guess, that `Budget` and its `Budget Account` child carry NO free-text
  // field of ANY kind — no remarks, title, note or reference_no. So there is NOWHERE to stamp a PMO
  // idempotency key, and the P3a anchor idiom has no home here.
  it('AC-BUD-022 the budget kind is the spike-frozen entry: doctype Budget, submittable, submit-on-create, NO anchor', () => {
    const entry = DOCTYPE_REGISTRY.budget;
    expect(entry).toEqual({
      doctype: 'Budget',
      submittable: true,
      submitOnCreate: true,
      anchorField: null,
      // FR-BUD-121: ERP itself enforces one live Budget per (company, fiscal_year, project, account),
      // so a create against an occupied grain UPSERTS the document that is already there (cancel +
      // create-with-`amended_from`, spike §6) instead of being atomically rejected as a duplicate.
      upsertOnGrain: true,
    });
  });

  // ⚑ HIGH-1 (money-safety audit round 5) — `neverReissue` WAS the right answer while the budget push
  // had no probe of any kind. It is the WRONG answer for the state the FR-BUD-121 upsert can leave
  // behind. The upsert is `cancel(old) → create(new) → submit(new)`, and if the create fails after the
  // cancel, ERPNext holds NO live Budget for the grain — every overspend control silently off. Under
  // `neverReissue` the post-window recovery went straight to `markOutboxHeld`, and (HIGH-2) nothing ever
  // un-held it: the destructive state was PERMANENT.
  //
  // The reissue is not blind, and that is the whole justification. An `upsertOnGrain` kind HAS a
  // conclusive probe — the dispatch factory's server-derived grain read (`resolveBudgetRefs`), which now
  // reads `docstatus < 2`, i.e. every document ERP's own duplicate guard counts. It answers "did our
  // create land?" three ways, each with a safe action: a live occupant ⇒ upsert onto it; a DRAFT
  // occupant ⇒ named refusal with zero writes; nothing at all ⇒ the create demonstrably did not land, so
  // re-create. A Budget also posts no GL entry — it installs a control — so an extra revision is not an
  // extra payment. `anchorMutable` (Payment Entry) is untouched: no grain makes a double-PAY safe.
  it('AC-BUD-022 an `upsertOnGrain` kind is REISSUE-CAPABLE — its server-derived grain read IS the conclusive probe (HIGH-1)', () => {
    const entry = DOCTYPE_REGISTRY.budget;
    expect(entry.anchorField, 'still no anchor field — the grain read replaces it, it does not add one').toBeNull();
    expect(entry.upsertOnGrain).toBe(true);
    expect(reissueOnInconclusiveAbsence(entry)).toBe(true);
  });

  it('AC-BUD-022 the reissue rule is NOT blanket: a mutable-anchor money doc is still HELD, and an anchor-less kind with no ERP-enforced grain is still HELD', () => {
    // Payment Entry — a double-pay can never be made safe by any amount of probing.
    expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY.payment)).toBe(false);
    expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY['incoming-payment'])).toBe(false);
    // A hypothetical anchor-less kind WITHOUT an ERP-enforced grain has no probe at all ⇒ still held.
    expect(reissueOnInconclusiveAbsence({ neverReissue: true })).toBe(false);
    // Immutable anchor (Purchase Invoice `remarks`) — unchanged, reissue-capable.
    expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY['purchase-invoice'])).toBe(true);
  });

  it('AC-BUD-022 every OTHER shipped kind keeps its reissue behaviour byte-for-byte (additive + default-absent)', () => {
    for (const kind of ['purchase-request', 'rfq', 'quotation', 'purchase-order', 'goods-receipt', 'purchase-invoice', 'payment', 'supplier', 'customer', 'sales-invoice', 'incoming-payment', 'timesheet', 'employee'] as const) {
      expect(DOCTYPE_REGISTRY[kind].upsertOnGrain, `${kind} must not gain upsertOnGrain`).toBeUndefined();
      expect(DOCTYPE_REGISTRY[kind].neverReissue, `${kind} must not gain neverReissue`).toBeUndefined();
      expect(reissueOnInconclusiveAbsence(DOCTYPE_REGISTRY[kind])).toBe(!DOCTYPE_REGISTRY[kind].anchorMutable);
    }
  });

  it('AC-BUD-022 budget is the ONLY kind whose grain ERP itself enforces (so the upsert+reissue rule cannot leak to another doctype)', () => {
    const grainEnforced = Object.entries(DOCTYPE_REGISTRY)
      .filter(([, e]) => e.upsertOnGrain === true)
      .map(([kind]) => kind);
    expect(grainEnforced).toEqual(['budget']);
  });
});
