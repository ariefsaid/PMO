// Luna re-audit BLOCKs 9 + 6 [Deno unit] — the SWEEP's two inbound-adoption defects.
//
//  • BLOCK 9 — the sweep polled EVERY doctype for EVERY activated ERPNext binding, without ever asking
//              whether that org actually assigned the domain to the tier (`external_domain_ownership`).
//              A procurement-only org was therefore handed native Sales Invoice / Receive Payment Entry
//              mirrors and surfaced them in its revenue read model — data it never opted into.
//  • BLOCK 6 — the poll fetched ONLY the lifecycle fields (name/modified/docstatus/amended_from) while
//              `siFromDoc`/`peReceiveFromDoc` consume customer, date, amount, outstanding and the PE's
//              `references` child table. Every sweep-adopted invoice therefore entered the PMO revenue
//              rollup with amount = NULL / outstanding = NULL.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test ownershipAndFields.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepKindsForOrg, sweepFieldsForKind, KINDS_NEEDING_FULL_DOC } = await import('./index.ts');
import { SI_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts';
import { PE_RECEIVE_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/incomingPayment.ts';
import { EMPLOYEE_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/employee.ts';
import { isCompanyScopedKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/companyScope.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── BLOCK 9 ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 9: a procurement-only org sweeps NO revenue doctype (no unowned Sales Invoice / Receive PE adoption)', () => {
  const kinds = sweepKindsForOrg(['procurement', 'companies']).map((k) => k.kind);
  assert(!kinds.includes('sales-invoice'), 'a procurement-only org must never poll Sales Invoice');
  assert(!kinds.includes('incoming-payment'), 'a procurement-only org must never poll Receive Payment Entry');
  assert(kinds.includes('purchase-invoice'), 'the procurement doctypes it DOES own must still be polled');
  assert(kinds.includes('supplier'), 'the companies doctypes it DOES own must still be polled');
});

Deno.test('BLOCK 9: an org owning revenue sweeps the revenue doctypes', () => {
  const kinds = sweepKindsForOrg(['revenue']).map((k) => k.kind);
  assert(kinds.includes('sales-invoice'), 'expected Sales Invoice to be polled for a revenue-owning org');
  assert(kinds.includes('incoming-payment'), 'expected Receive Payment Entry to be polled for a revenue-owning org');
  assert(!kinds.includes('purchase-invoice'), 'expected no procurement poll for a revenue-only org');
});

Deno.test('BLOCK 9: an org owning NO domain sweeps nothing (fail-closed)', () => {
  assert(sweepKindsForOrg([]).length === 0, 'expected an org with no domain ownership to poll nothing at all');
});

// ── BLOCK 6 ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 6: the Sales Invoice poll fetches every field siFromDoc consumes (no NULL money in the rollup)', () => {
  const fields = sweepFieldsForKind('sales-invoice');
  for (const required of ['customer', 'posting_date', 'grand_total', 'outstanding_amount', 'po_no']) {
    assert(fields.includes(required), `expected the SI poll to fetch '${required}', got ${JSON.stringify(fields)}`);
  }
  for (const required of SI_FROM_DOC_FIELDS) {
    assert(fields.includes(required), `the SI poll must fetch every field its mapper reads — missing '${required}'`);
  }
});

Deno.test('BLOCK 6: the Receive-PE poll fetches every field peReceiveFromDoc consumes, and keeps its payment_type discriminator', () => {
  const fields = sweepFieldsForKind('incoming-payment');
  for (const required of ['party', 'posting_date', 'paid_amount', 'reference_no', 'payment_type']) {
    assert(fields.includes(required), `expected the Receive-PE poll to fetch '${required}', got ${JSON.stringify(fields)}`);
  }
  for (const required of PE_RECEIVE_FROM_DOC_FIELDS) {
    assert(fields.includes(required), `the Receive-PE poll must fetch every field its mapper reads — missing '${required}'`);
  }
});

Deno.test('BLOCK 6: every kind still fetches the lifecycle routing fields the lineage apply needs', () => {
  for (const kind of ['sales-invoice', 'incoming-payment', 'purchase-invoice', 'supplier'] as const) {
    const fields = sweepFieldsForKind(kind);
    for (const required of ['name', 'modified', 'docstatus']) {
      assert(fields.includes(required), `kind ${kind} must still fetch '${required}'`);
    }
  }
});

Deno.test("BLOCK 6: the Receive PE is marked as needing a full-doc read (its `references` child table is not a list-endpoint field)", () => {
  assert(
    KINDS_NEEDING_FULL_DOC.includes('incoming-payment'),
    'the SI link lives in the PE `references` CHILD TABLE, which the list endpoint does not return — the poll must hydrate the full doc',
  );
  assert(!KINDS_NEEDING_FULL_DOC.includes('sales-invoice'), 'the SI needs no child table — a list read suffices (no needless N+1)');
});

// ── P3c — the budget kind must NOT be polled yet ───────────────────────────────────────────────────
//
// Registering `budget` in DOCTYPE_REGISTRY automatically enrols it in SWEEP_DOCTYPES (the poll list is
// derived from the registry). The INBOUND half of P3c — ack-and-skip a Desk-created Budget, never adopt
// it, never fight an operator's cancel (FR-BUD-140/142) — is NOT built yet, and the generic feed path
// would instead try to MINT a mirror row for a native ERP Budget that belongs to no PMO version.
// So the outbound push ships first and the poll stays closed until that branch lands.

// P3c slice 5: the never-adopt (FR-BUD-140) and never-fight-the-operator (FR-BUD-142) branches now
// land (`erpnextFeedDeps.ts`'s `mintMirrorRow`/`cancelStatusPatch`/`tombstoneMirror` budget branches),
// so `budget` is REMOVED from `SWEEP_UNPOLLED_KINDS` in the SAME change — an org that owns `budget` now
// DOES poll the ERP `Budget` doctype (lifecycle-only: never-adopt on unmapped, tombstone+reopen on an
// external cancel). This test previously pinned the OLD "not built yet" exclusion; it now pins the
// opposite, per the BDD authoring rule (the app's real, intended behavior changed — the test's steps
// update to match, the goal — "budget-only org's poll list is exactly what it owns" — stays intact).
Deno.test('AC-BUD-040 an org that owns `budget` now polls the Budget doctype (the never-adopt + never-fight-the-operator branches are built)', () => {
  const kinds = sweepKindsForOrg(['budget']).map((k) => k.kind);
  assert(kinds.includes('budget'), 'the sweep must poll ERP Budgets now that the inbound never-adopt/never-fight-the-operator branches exist');
  assert(kinds.length === 1, 'a budget-only org polls exactly the Budget doctype — nothing else');
});

Deno.test('AC-BUD-040 including budget does not disturb any other domain’s poll list', () => {
  const revenue = sweepKindsForOrg(['revenue']).map((k) => k.kind).sort();
  assert(JSON.stringify(revenue) === JSON.stringify(['incoming-payment', 'sales-invoice']), `revenue poll list changed: ${revenue}`);
});

// ── P3b Slice 3 — the Employee sweep cursor, gated on the `timesheets` flip (AC-TSP-003) ────────────
//
// THE REGRESSION GUARD (FR-TSP-094): `companies` is ALREADY FLIPPED for existing orgs. Employee lives
// in the `timesheets` domain, deliberately NOT `companies` — so an org that owns `companies` but has
// NOT flipped `timesheets` must issue ZERO Employee doctype calls, and its `companies` sweep behavior
// (supplier/customer) must stay byte-for-byte. An org that DOES own `timesheets` sweeps BOTH
// `Timesheet` (lifecycle-only, never adopts — task 6.2) and `Employee` (the adopt target) — the cursor
// starts at zero, so the first tick after the flip backfills every pre-existing Employee (FR-TSP-091).

Deno.test('AC-TSP-003 an org owning `companies` but NOT `timesheets` polls ZERO Employee doctype calls, and its companies poll is unaffected', () => {
  const kinds = sweepKindsForOrg(['companies']).map((k) => k.kind);
  assert(!kinds.includes('employee'), 'a companies-only org must never poll Employee (FR-TSP-094)');
  assert(!kinds.includes('timesheet'), 'a companies-only org must never poll Timesheet either');
  assert(kinds.includes('supplier') && kinds.includes('customer'), 'the companies doctypes it DOES own must still be polled, unaffected');
});

Deno.test('AC-TSP-003 an org owning `timesheets` sweeps BOTH Timesheet and Employee', () => {
  const kinds = sweepKindsForOrg(['timesheets']).map((k) => k.kind).sort();
  assert(kinds.includes('timesheet'), 'a timesheets-owning org must poll Timesheet (lifecycle-only, task 6.2)');
  assert(kinds.includes('employee'), 'a timesheets-owning org must poll Employee (the adopt target, FR-TSP-091)');
});

Deno.test('AC-TSP-003 an org owning `timesheets` alone still polls NO companies/procurement/revenue doctype', () => {
  const kinds = sweepKindsForOrg(['timesheets']).map((k) => k.kind);
  assert(!kinds.includes('supplier') && !kinds.includes('customer'), 'a timesheets-only org must not poll companies doctypes');
  assert(!kinds.includes('purchase-invoice'), 'a timesheets-only org must not poll procurement doctypes');
  assert(!kinds.includes('sales-invoice'), 'a timesheets-only org must not poll revenue doctypes');
});

// ⚑ HIGH-B (Luna re-audit round 2, 2026-07-21) — DELIBERATE REVERSAL. This test previously asserted
// that Employee is "a global-ish master, not company-scoped". It is not: `Employee.company` is
// REQUIRED at create (the timesheet/employee spike, docs/spikes/2026-07-20-erpnext-timesheet-fields.md
// §"`company` | yes | required at create"), unlike Customer/Supplier which really are site-wide. An
// Employee belongs to exactly one Company, and adopting one is the COST-IDENTITY path (FR-TSP-090/092
// → confirm_erp_employee_link → approved hours posting against that Employee's costing rate), so
// admitting another tenant's Employee is a tenancy leak with a money consequence. The poll therefore
// requests `company` and conjoins it, exactly like every other company-scoped kind.
Deno.test('AC-TSP-003/HIGH-B the Employee poll fetches every field employeeFromDoc consumes, the lifecycle routing fields, AND the company dimension it is scoped by', () => {
  const fields = sweepFieldsForKind('employee');
  for (const required of EMPLOYEE_FROM_DOC_FIELDS) {
    assert(fields.includes(required), `the Employee poll must fetch every field its mapper reads — missing '${required}'`);
  }
  for (const required of ['name', 'modified', 'docstatus', 'amended_from']) {
    assert(fields.includes(required), `expected the Employee poll to fetch the lifecycle routing field '${required}'`);
  }
  assert(
    fields.includes('company'),
    'HIGH-B: Employee IS company-scoped — without fetching `company` the per-document admission gate is blind and (failing closed) would adopt nothing at all',
  );
});

Deno.test('HIGH-B every company-scoped kind FETCHES `company` — the half-fix (scope it, but never read it) fails closed and breaks adoption entirely', () => {
  for (const { kind } of sweepKindsForOrg(['procurement', 'revenue', 'timesheets', 'budget', 'companies'])) {
    const wants = isCompanyScopedKind(kind);
    const fetches = sweepFieldsForKind(kind).includes('company');
    assert(
      wants === fetches,
      `'${kind}': company-scoped=${wants} but the poll ${fetches ? 'does' : 'does NOT'} request the field — the two must move together`,
    );
  }
});
