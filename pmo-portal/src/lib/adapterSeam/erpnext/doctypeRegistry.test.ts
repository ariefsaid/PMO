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
import { DOCTYPE_REGISTRY } from './doctypeRegistry.ts';

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
      // P3c — Budget (ADR-0059 Posture B). ⚑ The ONLY kind with NO anchor at all AND neverReissue.
      budget: { doctype: 'Budget', submittable: true, submitOnCreate: true, anchorField: null, neverReissue: true },
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
      neverReissue: true,
    });
  });

  it('AC-BUD-022 anchor-less ⇒ neverReissue ⇒ reissueOnInconclusiveAbsence is FALSE (held, never reissued)', () => {
    const entry = DOCTYPE_REGISTRY.budget;
    // Today `anchorField: null` alone means "skip the probe → fresh claim+POST" = REISSUE-CAPABLE.
    // For a Posture-B budget that is a silently DUPLICATED ERP object — and ERP's own duplicate guard
    // fires only at the (company, dimension, fiscal_year, account) grain, so a reissue after a genuine
    // in-flight timeout lands as a 417 the adapter cannot distinguish from a real conflict.
    // ADR-0059 §4's corollary closes it: the dispatch computes
    //   reissueOnInconclusiveAbsence = !(anchorMutable || neverReissue)
    expect(entry.anchorField).toBeNull();
    expect(entry.neverReissue).toBe(true);
    expect(!(entry.anchorMutable || entry.neverReissue)).toBe(false);
  });

  it('AC-BUD-022 `neverReissue` is additive + default-absent — every shipped kind keeps its reissue behaviour byte-for-byte', () => {
    for (const kind of ['purchase-request', 'rfq', 'quotation', 'purchase-order', 'goods-receipt', 'purchase-invoice', 'payment', 'supplier', 'customer', 'sales-invoice', 'incoming-payment', 'timesheet', 'employee'] as const) {
      expect(DOCTYPE_REGISTRY[kind].neverReissue, `${kind} must not gain neverReissue`).toBeUndefined();
    }
    // still reissue-capable (immutable/absent anchor)
    const pi = DOCTYPE_REGISTRY['purchase-invoice'];
    expect(!(pi.anchorMutable || pi.neverReissue)).toBe(true);
    // still HELD (C-1, mutable anchor)
    const pe = DOCTYPE_REGISTRY.payment;
    expect(!(pe.anchorMutable || pe.neverReissue)).toBe(false);
  });

  it('AC-BUD-022 budget is the ONLY kind that is both anchor-less and never-reissued (the rule is not blanket)', () => {
    const anchorlessHeld = Object.entries(DOCTYPE_REGISTRY)
      .filter(([, e]) => e.anchorField === null && e.neverReissue === true)
      .map(([kind]) => kind);
    expect(anchorlessHeld).toEqual(['budget']);
  });
});
