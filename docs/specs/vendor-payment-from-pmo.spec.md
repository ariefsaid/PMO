# Spec — Pay a vendor bill from PMO on an ERP-connected org (#910)

> **Parent:** #791 (OD-ERP slate) · **Owner frame:** OD-ERP-3 (ERPNext is headless — nobody pays
> vendors in ERPNext screens, so PMO must), OD-ERP-4 (go-live item). **Architecture:** ADR-0058
> (money-idempotency outbox; Payment Entry anchors on `reference_no`, held-on-inconclusive),
> ADR-0048 (PMO mirrors ERP money, never recomputes). **Amends:** nothing — extends
> `docs/specs/erpnext-adapter.spec.md` §5.10 (Slice-6 payment kinds) and wires OBS-VWH-002
> (`docs/specs/vendor-withholding.spec.md` §3), which recorded the gap and left it out of #876.
> **Withholding:** the amount paid is net of withholding per DD-VWH-2/DD-VWH-3
> (`docs/specs/vendor-withholding.spec.md` §2) — ERPNext's `outstanding_amount` already is the net
> payable. **Plan:** `docs/plans/2026-10-08-vendor-payment-from-pmo.md`. **Migration slot:** 0274.

## 0. Job story

When RIS's finance user sees an ERP-owned vendor bill with an outstanding amount on a procurement
case, I want to record the payment right there in the procurement ledger — against that bill, for
what we actually owe (net of any PPh withheld) — so that the Payment Entry lands in ERPNext, the
bill closes as Paid without anyone opening ERPNext, and the payment shows in the case's ledger with
the money rules (approver ≠ payer) still holding.

## 1. Scope

**In:** the procurement ledger's payment capture on an org whose `procurement` domain is
ERP-owned (flipped) — the repository's external dispatch record for `erp_doc_kind: 'payment'`, the
served resolution of the Payment Entry's party/amount/references, the server-side money gate
(SoD + case state), the Payment Entry body, the payer-attribution stamp, and the curated e2e
journey through the **form** (the #876 e2e paid through the dispatch directly — AC-ENA-053's
shape — which is exactly the bypass this issue closes).

**Out (explicit):**
- The PMO-native payment capture path (DAL `createPayment` RPC) — unchanged, except the form stops
  sending an illegal status (DD-VPAY-8, which also unbreaks the native form capture 0178 reported).
- Supplier advance / on-account payments (no bill reference) — refused on the flipped path pending
  OQ-VPAY-1.
- Multi-currency / FX vendor payments — `received_amount` mirrors `paid_amount` (same figure); the
  binding's company currency governs, as today.
- Payment cancellation/amendment UI — the existing PE cancel path (doctypeRegistry
  `submittable`, `erp_amended_from` sweep amendment) is unchanged.
- The bukti potong / tax registers (#898) — withholding display already shipped (#876 slices 1–2).

## 2. Decisions (Director, 2026-10-08 — DD lines, revisable by the owner)

- **DD-VPAY-1 — the repo seam maps `amount` → `paid_amount`.** The external-route wire record for a
  payment carries `paid_amount` (+ `date`, `invoiceId`, `procurementId`, `erp_doc_kind: 'payment'`)
  and drops `referenceNumber`/`status`, mirroring the revenue twin's mapping
  (`src/lib/repositories/index.ts:630-645`). One line of reasoning: the seam is where the
  camelCase form input becomes the ERP wire record — the same place the revenue payment already
  does it; the body builder stays dumb.
- **DD-VPAY-2 — references[] are built SERVER-side from `invoiceId`; caller-supplied references are
  discarded.** (Luna BLOCK 5 precedent for `incoming-payment`, `dispatchFactory.ts:434-455`.) The
  payload is never trusted to name the bill: the dispatch resolves the bill's ERP name from
  `external_refs` (procurement domain) and allocates the whole `paid_amount` to it.
- **DD-VPAY-3 — a bill reference is REQUIRED on the flipped path.** `invoiceId` absent, unmapped,
  or not in the command's own case ⇒ `commit-rejected` before any ERP write. Reasoning: the issue's
  acceptance is paying a *bill*; an unreferenced PE has no outstanding cap and no case anchor to
  gate. Supplier advances stay out pending OQ-VPAY-1.
- **DD-VPAY-4 — the supplier resolves server-side from the case's vendor mapping.** The `payment`
  kind joins `resolveProcurementOrderRefs`' supplier resolution (`resolveCaseSupplierName`,
  `dispatchFactory.ts:87-98`) — the command never carries a supplier, and the `vendorId` fallback
  (`dispatchFactory.ts:1362-1366`) can never fire for a payment. Unmapped case vendor ⇒
  `commit-rejected` (fail closed), never a `party: undefined` reaching ERP.
- **DD-VPAY-5 — SoD-b and the case-state gate are enforced SERVER-side on the dispatch path.** A
  procurement `payment` create is refused (403) when the caller is the case's `approved_by_id`
  (mirroring `transition_procurement`'s rule, `0006_procurement_lifecycle.sql:222-225`, which alone
  no longer covers the flipped org — there the dispatched PE **is** the money release), and refused
  (422) when the case is not at `Vendor Invoiced`. Precedent: `sodGuard.ts` (SI submit) and
  `approvalGuard.ts` (timesheet approved-ness) — a DB re-read decides, the payload never does.
- **DD-VPAY-6 — `paid_from`/`paid_to`/`posting_date`/`reference_date` are ALWAYS sent, and a
  missing binding account default refuses with `commit-rejected` naming the setting.** (DD-EXP-12..22
  ruling for Employee Payment Entries, `docs/decisions.md:3093`; `bodies/expensePayment.ts:4-6` — a
  Bank-typed `paid_from` needs `reference_date` once the anchor's `reference_no` is stamped.)
  Today `peToBody` silently sends `undefined` accounts, which dies as an opaque ERPNext
  mandatory-field error. Account resolution stays the binding-config resolver
  (`default_cash_account ?? default_bank_account`, `default_payable_account`) — the R9 §2 frozen
  shape AC-ENA-053 benches against; a live Company-doc read is the expense path's stricter pattern
  and is deliberately not imported here.
- **DD-VPAY-7 — the amount gate is `0 < paid_amount ≤ bill outstanding`, and an unknown
  outstanding refuses.** Read from the bill mirror (`procurement_invoices.erp_outstanding_amount`)
  in the same server pass that resolves the reference. Reasoning: ERPNext refuses
  above-outstanding allocation anyway (DD-VWH-3); failing closed at the seam with a message that
  names the bill beats a raw ERP validation error, and `null` outstanding (bill not yet mirrored)
  must not become "uncapped".
- **DD-VPAY-8 — the payment capture form stops asking for a status.** `payments.status` is
  origination-`Scheduled`-only; `Paid` is reached only by paying (0178's ruling,
  `0178_sod_class_completeness.sql:343-349`). The form's `{Pending, Processed, Cleared}` options
  are illegal against the CHECK (`0035:83`) and make EVERY native payment capture from this form
  fail today (0178's reported defect, `:299-303`). The form sends `status: null` (native RPC
  coalesces `Scheduled`); the external wire record omits it — the ERP docstatus is the only status
  truth (mirror derives `Paid`/`Scheduled`, `readModelWriters.ts:496`).
- **DD-VPAY-9 — the payment records who paid.** `payments.recorded_by_id` (nullable, FK
  `profiles`) is stamped by the mirror writer from the dispatch caller (`ctx.callerUserId`,
  `readModelWriters.ts:49-53`); machine writes (sweep finalize/replay) stay null. Reasoning:
  money-path primer bucket 3 — on a flipped org this row is the pay artifact; an unattributed
  money release is an audit gap (SI author-set precedent, 0132). No client write path exists to
  forge it (`payments` carries NO direct client write grant, `0100:6-10`).
- **DD-VPAY-10 — the form defaults the amount to the selected bill's outstanding.**
  `erp_outstanding_amount` is ERPNext's own net-of-withholding payable (DD-VWH-2/3, proven by
  AC-VWH-005's figures: gross 1,110,000 → outstanding 1,090,000). The user may pay less (partial);
  the server gate (DD-VPAY-7) remains the authority.

## 3. Requirements (EARS)

- **FR-VPAY-001 (event)** — When a user submits the procurement ledger's payment capture on a
  flipped org, the system shall dispatch a `procurement` create command for `erp_doc_kind:
  'payment'` carrying `procurementId`, `invoiceId`, `paid_amount` and `date`, with the capture
  session's command identity (`intent`, ADR-0058 BLOCK 2) so every retry of the same capture
  reconciles instead of duplicating.
- **FR-VPAY-002 (ubiquitous)** — The system shall resolve the Payment Entry's `party` server-side
  from the case's vendor `external_refs` mapping (`Supplier:<name>` → bare ERP name) and shall not
  read any supplier from the command payload.
- **FR-VPAY-003 (event)** — When a payment command carries an `invoiceId`, the system shall resolve
  that bill's ERP `Purchase Invoice` name from `external_refs` and build `references[]` as a single
  allocation of the full `paid_amount` against it, discarding any caller-supplied references.
- **FR-VPAY-004 (unwanted)** — If the payment command carries no `invoiceId`, an `invoiceId` with
  no procurement-domain `external_refs` mapping, or an `invoiceId` whose bill belongs to a
  different case, then the system shall refuse with `commit-rejected` before any ERPNext write,
  naming the bill or the missing mapping — never an account or company name.
- **FR-VPAY-005 (unwanted)** — If the caller of a procurement payment create is the case's
  approver, or the case's status is not `Vendor Invoiced`, then the system shall refuse the
  dispatch before the outbox insert (403 for the approver, mirroring 0006's SoD-b wording; 422 for
  the state), on a DB re-read of the case — never on payload-carried facts.
- **FR-VPAY-006 (unwanted)** — If `paid_amount` is not a positive figure, exceeds the bill's
  mirrored `erp_outstanding_amount`, or the bill's outstanding is unknown (`null`), then the system
  shall refuse with `commit-rejected` naming the bill.
- **FR-VPAY-007 (ubiquitous)** — The Payment Entry body shall always carry `payment_type: 'Pay'`,
  `party_type: 'Supplier'`, `party`, `paid_amount`, `received_amount` (= `paid_amount`),
  `paid_from`, `paid_to`, `posting_date` and `reference_date`, where `paid_from` is the binding's
  `default_cash_account ?? default_bank_account` and `paid_to` its `default_payable_account`; a
  binding that states none of the cash/bank pair refuses with `commit-rejected` naming the missing
  Administration → Accounting setting.
- **FR-VPAY-008 (state)** — While a submitted Payment Entry references an ERP-owned bill, the bill
  shall show Paid in PMO exactly when its mirrored `erp_outstanding_amount` reaches zero
  (existing `piStatus.ts` derivation + the sweep's PI poll / feed refresh — no new derivation).
- **FR-VPAY-009 (state)** — While a payment's PE is mirrored, the case ledger shall show a Payment
  row with the ERP-derived `pay_number`, the header `paid_amount` oracle and the docstatus-derived
  status (existing `upsertPaymentMirror`), now stamped with `recorded_by_id` = the dispatch caller
  on a create, null on machine writes.
- **FR-VPAY-010 (ubiquitous)** — On a flipped org the payment capture form shall ask only for what
  PMO owns: the bill (required), the amount (defaulting to the bill's outstanding), the date and
  the optional PMO-side reference; it shall not offer a status select (DD-VPAY-8) and shall not ask
  for facts the dispatch drops (the `groupRefIsPmoAuthored` ruling).
- **NFR-VPAY-001** — The server-side gates (FR-VPAY-004/005/006) add at most three DB reads (case,
  bill, external-ref) and zero ERP reads; they run before the outbox insert, so a refused payment
  leaves no outbox row.
- **NFR-VPAY-002** — All money comparisons are in integer cents; `paid_amount` keeps the
  numeric(14,2) column discipline (`payments_amount_nonneg`, 0058).
- **NFR-VPAY-003** — A held Payment Entry recovery (ADR-0058 C-1: mutable anchor ⇒ held, never
  reissued) surfaces through the existing `command-held` classification; this slice adds no
  recovery change and no new skip.
- **OBS-VPAY-001** — Today every form payment on a flipped org dies at ERPNext with a
  mandatory-field error: the wire record carries `amount` (never `paid_amount`), no references and
  no supplier the body can read (`bodies/paymentEntry.ts:10-22` reads `paid_amount`/`references`/
  `ctx.refs.supplier`; the repo sends `amount`/`invoiceId` only,
  `src/lib/repositories/index.ts:605-614`; both supplier resolvers miss —
  `dispatchFactory.ts:616` gates on `{purchase-order, goods-receipt, purchase-invoice}`,
  `:1362-1366` reads a `vendorId` the payment never carries). OBS-VWH-002 recorded this and
  deferred it here.
- **OBS-VPAY-002** — The approver≠payer rule exists only inside `transition_procurement`'s
  `Vendor Invoiced → Paid` branch (`0006:222-225`); the served dispatch gate for a procurement
  payment is role-only (`authGuard.ts:36`), so on a flipped org a direct dispatch (or the approver
  via the form) could mint a Payment Entry the SoD rule exists to prevent.

## 4. Acceptance criteria (Given/When/Then)

- **AC-VPAY-001** — Given a flipped org with a binding whose company defaults are set and an
  ERP-owned bill of net 1,000,000 + 11% VAT + 2% PPh withheld (outstanding 1,090,000) on a case at
  `Vendor Invoiced` approved by user A, when finance user B (≠ A) records the payment through the
  procurement ledger's capture form accepting the defaulted amount, then a Payment Entry of
  1,090,000 exists in ERPNext against that bill (submitted), PMO's payments row mirrors
  `pay_number` `ACC-PAY-*`, amount 1,090,000, status `Paid`, `invoice_id` = the bill, and
  `recorded_by_id` = B; after the sweep runs, the bill shows Paid with outstanding 0 and the
  payment appears in the case ledger.
- **AC-VPAY-002** — Given a payment command's resolved refs and the binding config, when the
  Payment Entry body is built, then it carries party/paid_amount/received_amount/references/
  paid_from/paid_to/posting_date/reference_date per FR-VPAY-007 — including the withheld-bill case
  (paid = the net outstanding, not the gross) and the missing-account case (refusal naming the
  setting); a body for a command with `paid_amount` absent is refused, never sent with `undefined`.
- **AC-VPAY-003** — Given a case at `Vendor Invoiced` approved by A: when A dispatches a payment
  create for it, the dispatch refuses 403 with the SoD-b wording; when anyone dispatches a payment
  create for a case at any other status, it refuses 422; when B (not the approver) dispatches, the
  gate passes; breaking the rule in the code (e.g. skipping the approver compare) turns the
  guard's tests red (mutation-checked).
- **AC-VPAY-004** — Given payment commands with (a) no `invoiceId`, (b) an `invoiceId` with no
  procurement `external_refs` mapping, (c) an `invoiceId` whose bill sits on another case,
  (d) `paid_amount` above the bill's outstanding, (e) `paid_amount` ≤ 0, (f) a bill with `null`
  outstanding, and (g) a caller-supplied `references[]` row naming a different bill — each is
  refused `commit-rejected` before any ERP write or outbox insert, and in (g) the dispatched
  references are the server-resolved bill allocation; the happy path resolves supplier + reference
  with zero ERP reads.
- **AC-VPAY-005** — Given a flipped org, when the repository's `createPayment` external route
  runs, the dispatched record contains exactly `{ procurementId, invoiceId, paid_amount, date,
  erp_doc_kind: 'payment' }` (no `status`, no `referenceNumber`, no `amount` key) and reuses the
  caller's `intent` as its command identity; the native route is byte-for-byte unchanged.
- **AC-VPAY-006** — Given the payment capture form on a flipped org, when it renders with a bill
  selected whose outstanding is 1,090,000, then no status select is offered, the amount is
  prefilled 1,090,000, the bill select is required, and submit without a bill is refused locally;
  on a PMO-native org the form is unchanged except that no status value is sent (null).
- **AC-VPAY-007** — Given the 0274 schema, then `payments.recorded_by_id` is a nullable uuid FK to
  `profiles`; a service-role mirror insert states it and a machine (null-caller) insert leaves it
  null; neither `authenticated` nor `anon` can INSERT or UPDATE any `payments` column including it
  (the table's existing no-client-write-grant posture holds).
- **AC-VPAY-008** — Given a payment create mirrored by the served writer, then the insert stamps
  `recorded_by_id` from the dispatch caller and an update (finalize retry, cancel tombstone) never
  overwrites it; the docstatus-derived status and `invoice_id` behaviour are unchanged.

## 5. Traceability (owning layer, ADR-0010)

| AC | Requirement | Layer | Owning test |
|---|---|---|---|
| AC-VPAY-001 | FR-VPAY-001/002/003/008/009 | e2e (Playwright, serial served lane) | `pmo-portal/e2e/serial/AC-VPAY-001-vendor-payment-form.spec.ts` |
| AC-VPAY-002 | FR-VPAY-007 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` |
| AC-VPAY-003 | FR-VPAY-005 | unit (Deno, edge) | `supabase/functions/adapter-dispatch/paymentGate.test.ts` |
| AC-VPAY-004 | FR-VPAY-003/004/006 | unit (Vitest) | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` |
| AC-VPAY-005 | FR-VPAY-001 | unit (Vitest) | `pmo-portal/src/lib/repositories/procurement.external.test.ts` |
| AC-VPAY-006 | FR-VPAY-010 | unit (Vitest/RTL) | `pmo-portal/pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx` |
| AC-VPAY-007 | FR-VPAY-009 (schema) | integration (pgTAP) | `supabase/tests/0274_payments_recorded_by.test.sql` |
| AC-VPAY-008 | FR-VPAY-009 (writer) | unit (Deno, edge) | `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` |

AC-VPAY-001 is the one curated cross-stack journey (the form → dispatch → ERPNext → sweep → ledger
loop). The direct-dispatch payment/settlement mechanics it relies on are already proven at
AC-ENA-053 and AC-VWH-005; this journey's delta is that the payment enters through the FORM and the
gate/body/resolution are the shipped code, not a hand-built payload.

## 6. Open questions (owner only — everything else is decided above)

- **OQ-VPAY-1 — supplier advances.** Does the client need to pay a vendor *before* any bill exists
  (on-account advance) from PMO? This slice refuses it (DD-VPAY-3). If yes, it needs its own
  amount source and repayment/allocation story — say so and we spec it separately.
- **OQ-VPAY-2 — partial payments.** Is paying less than the outstanding a real workflow for the
  client (instalments), or should the form be full-outstanding-only? Today: partial allowed
  (DD-VPAY-7), form defaults to full (DD-VPAY-10). No code changes either way unless the answer is
  "full only".
- **OQ-VPAY-3 — who may release a payment.** The dispatch role gate today is
  Admin·Exec·PM·Finance (`authGuard.ts:36`) and the transition role is Finance-only
  (`0006:207`). On an ERP-connected org the ledger payment **is** the release — should PMO narrow
  the form to Finance-only there, or is the four-role set + approver≠payer what the client accepts?
- **OQ-VPAY-4 — a client-visible payment memo.** The PE's `reference_no` carries PMO's
  idempotency key by ruling (ADR-0058 §3), so the ledger's "External ref" input on a flipped org
  never reaches ERPNext and the mirrored ref column shows the key. If the client needs their own
  bank reference visible in ERPNext, that needs a ruled home (custom field is refused,
  NFR-ENA-SEC-001) — accept as-is for go-live?
