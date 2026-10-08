# Plan — Pay a vendor bill from PMO on an ERP-connected org (#910)

> Spec: `docs/specs/vendor-payment-from-pmo.spec.md` (FR-VPAY-###, AC-VPAY-###, DD-VPAY-1..10).
> Branch `feat/910-vendor-payment` off `origin/dev`. **Lane: Director-dispatched (money path).**
> Migration: **YES — `0276_payments_recorded_by.sql`** (nullable payer stamp; renumber at merge via
> `scripts/renumber-migration.sh` if 0272/0273 land first). Every DB-driving command below runs
> under `scripts/with-db-lock.sh`; the heavy vitest runs under `scripts/with-test-lock.sh`.

## The exact gap in today's form → dispatch path

On a flipped org the ledger's payment capture assembles
`{ invoiceId, referenceNumber, status, date, amount, intent }`
(`pmo-portal/pages/procurement/RecordCaptureForm.tsx:440-448`) and
`repositories.procurement.createPayment` dispatches it verbatim plus `procurementId` and
`erp_doc_kind: 'payment'` (`pmo-portal/src/lib/repositories/index.ts:605-614`). The Payment Entry
body builder `peToBody` (`pmo-portal/src/lib/adapterSeam/erpnext/bodies/paymentEntry.ts:10-22`,
wired for kind `payment` at `doctypeBodies.ts:44`) reads none of that: it needs `paid_amount` /
`received_amount` (the repo sent `amount` — **missing amount**, both `undefined`),
`rec.references` (nothing resolves `invoiceId` → the PI's ERP name — **missing bill reference**),
and `ctx.refs.supplier` (**missing supplier**: `resolveProcurementOrderRefs` gates supplier
resolution on `{purchase-order, goods-receipt, purchase-invoice}`,
`dispatchFactory.ts:616,618-619`, and the fallback `resolveSupplierRef` reads a `vendorId` the
payment never carries, `dispatchFactory.ts:1362-1366` — so `party: undefined`). `paid_from` /
`paid_to` **are** sent from the binding config (`paymentEntry.ts:16-17`, the R9 §2 frozen shape)
but resolve to `undefined` without an error when the binding names no cash/bank account, and no
`posting_date`/`reference_date` is sent (a Bank-typed `paid_from` + the stamped `reference_no`
anchor needs `reference_date` — `bodies/expensePayment.ts:5-6`). Nothing server-side gates the
payment against the case: the only approver≠payer enforcement lives in `transition_procurement`'s
`Vendor Invoiced → Paid` branch (`supabase/migrations/0006_procurement_lifecycle.sql:222-225`),
which the dispatch path never passes, and the served gate is role-only
(`supabase/functions/adapter-dispatch/authGuard.ts:36`). Net: **every form payment on a flipped org
dies at ERPNext with an opaque mandatory-field error, and no Payment Entry can be produced from
PMO** (OBS-VWH-002). Rider: the form's payment status options `{Pending, Processed, Cleared}`
(`RecordCaptureForm.tsx:54-77`, default at `:182`) are illegal against the
`('Scheduled','Paid')` CHECK (`0035:83`) — 0178 documented every native form capture failing
(`0178_sod_class_completeness.sql:299-303`). The account resolver in play is the **binding-config
resolver** (`external_org_bindings.config`, `binding.ts:29-36`), not the expense path's live
Company-doc read (`expensePostingResolve.ts:21-25`) — DD-VPAY-6 keeps the frozen shape.

Failure/recovery posture is unchanged: kind `payment` is a submittable Payment Entry anchored on
the mutable `reference_no` (`doctypeRegistry.ts:113`) — held-on-inconclusive, never auto-reissued
(ADR-0058 C-1); the capture session's `intent` (`RecordCaptureForm.tsx:354`) already gives every
retry one command identity (BLOCK 2).

## Tasks (TDD; no prod code without a failing test)

### Task 1 — Body: always-send + fail-closed accounts (`paymentEntry.ts`) — AC-VPAY-002
RED: add to `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` (peToBody section):
binding with cash+payable → body has `paid_from`/`paid_to`/`posting_date`/`reference_date`
(`posting_date = reference_date = rec.date`), `payment_type 'Pay'`, `party_type 'Supplier'`,
`party = ctx.refs.supplier`, `references = rec.references ?? []`; binding with only
`default_bank_account` → `paid_from` = the bank account; binding with neither → AdapterError
`commit-rejected` naming `default_cash_account`/`default_bank_account` (the Administration →
Accounting setting, never the company); `paid_amount` absent/≤ 0 → `commit-rejected`.
GREEN: edit `bodies/paymentEntry.ts` `peToBody` — `required()`-style checks (the
`expensePayment.ts` idiom), `posting_date`/`reference_date` from `rec.date`.
Verify: `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts`
(then `src/lib/adapterSeam/erpnext/dispatchFactory.withholding.test.ts` +
`bodies/incomingPayment.withholding.test.ts` — the shared-body regression set).

### Task 2 — Server resolution: `payment` joins the refs pass (`dispatchFactory.ts`) — AC-VPAY-004
RED: add to `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` a
`resolvePaymentRefs` describe (mirror the `resolveRevenueRefs` incoming-payment cases, Luna BLOCK
5): kind `payment` + `invoiceId` resolved → `refs.pi` = the ERP PI name, `refs.supplier` = the
case vendor's bare ERP name via the SAME `resolveCaseSupplierName` read
(`dispatchFactory.ts:87-98` — extend the `:616` kind gate to `'payment'`), caller-supplied
`record.references` discarded; no `invoiceId` → `commit-rejected`; unmapped bill →
`commit-rejected`; bill on another case (bill `procurement_id ≠ record.procurementId`) →
`commit-rejected`; `paid_amount > bill.erp_outstanding_amount` → `commit-rejected` naming the bill;
`paid_amount ≤ 0` → `commit-rejected`; `erp_outstanding_amount` null → `commit-rejected`; zero ERP
reads in the happy path. GREEN: implement the resolution in `dispatchFactory.ts` next to
`resolveRevenueRefs` (DB reads: one `procurement_invoices` row, one `external_refs` lookup, the
case-supplier read Task 2 already shares) and merge its refs into the `ctx.refs` spread at
`dispatchFactory.ts:1329`; the body's `references` come from the resolved `refs.pi` +
`paid_amount` (extend `peToBody`'s `rec.references ?? []` default to prefer the server-resolved
allocation when `refs.pi` is present).
Verify: `cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/dispatchFactory.test.ts`
and `npx vitest run src/lib/adapterSeam/erpnext/dispatchFactory.poGrRefs.test.ts`
(supplier-gate neighbours must stay byte-for-byte).

### Task 3 — Money gate: SoD-b + case state on the dispatch path (`paymentGate.ts`) — AC-VPAY-003
RED: new `supabase/functions/adapter-dispatch/paymentGate.test.ts`: a procurement create for kind
`payment` whose case (DB re-read, service client) has `approved_by_id = callerUserId` →
`{ ok: false, status: 403, message: 'separation of duties: approver cannot pay own procurement' }`
(0006's wording); case `status ≠ 'Vendor Invoiced'` → `{ ok: false, status: 422 }`; case at
`Vendor Invoiced`, caller ≠ approver → ok; a missing case row → not-ok (fail closed, the
approvalGuard posture); non-payment kinds and other domains → ok WITHOUT any DB read (gated).
GREEN: new `supabase/functions/adapter-dispatch/paymentGate.ts` (pure + injected-read seam, the
`sodGuard.ts`/`approvalGuard.ts` module shape) and wire it in `adapter-dispatch/index.ts` BEFORE
the outbox insert for `domain: 'procurement'` + `erp_doc_kind: 'payment'` creates, using the
already-resolved `userId` (verified JWT sub — never a payload field).
Verify: `cd supabase/functions/adapter-dispatch && deno test paymentGate.test.ts --config deno.json --allow-env --allow-net --allow-read`
then `deno check index.ts`.

### Task 4 — Repo seam: the wire record (`repositories/index.ts`) — AC-VPAY-005
RED: extend `pmo-portal/src/lib/repositories/procurement.external.test.ts`'s
`createPayment` case (`:231-237`): the dispatched record is EXACTLY
`{ procurementId, invoiceId, paid_amount, date, erp_doc_kind: 'payment' }` — no `amount` key, no
`status`, no `referenceNumber`; `intent` passed through as the command identity; the native route
still calls the DAL with today's argument list (byte-for-byte). GREEN: remap the external branch
of `repositories.procurement.createPayment` (`index.ts:605-614`), the DD-VPAY-1 mapping.
Verify: `cd pmo-portal && npx vitest run src/lib/repositories/procurement.external.test.ts`.

### Task 5 — Form: ask only what PMO owns (`RecordCaptureForm.tsx`) — AC-VPAY-006
RED: new `pmo-portal/pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx`: on a flipped
org (`setDomainOwnership('procurement','external')` — the pushRouting test's idiom) with an
invoice row `{ id, erp_outstanding_amount: 1090000 }`: no `payment-status-select` rendered; select
the bill → amount input prefilled `1090000`; submit without a bill refused locally (no dispatch
call); submit dispatches with the defaulted `amount`; on a PMO-owned org the form renders as today
but submits `status: null` (never `Pending`). GREEN: in `RecordCaptureForm.tsx` — for
`kind === 'payment'`: hide the status select (DD-VPAY-8), require the invoice FK on a flipped org
(`groupRefIsPmoAuthored()` is the existing flipped-org predicate), prefill
`amountStr` from the selected bill's `erp_outstanding_amount` (DD-VPAY-10), send
`status: null` otherwise; leave every other kind untouched.
Verify: `cd pmo-portal && npx vitest run pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx pages/procurement/RecordCaptureForm.groupRef.test.tsx pages/procurement/RecordCaptureForm.taxTemplate.test.tsx`

### Task 6 — Migration `0276_payments_recorded_by.sql` + pgTAP — AC-VPAY-007
`supabase/migrations/0276_payments_recorded_by.sql`:
`alter table public.payments add column if not exists recorded_by_id uuid references public.profiles(id);`
(reversible: `drop column if exists`; no grant/RLS change — `payments` has no client write grant,
`0100:6-10`; recheck `0058`/`0178` invariants stay the only writers). pgTAP
`supabase/tests/0276_payments_recorded_by.test.sql`: column exists, nullable, FK to `profiles`;
service-role insert states it, null-caller insert leaves it null; `authenticated`/`anon` INSERT or
UPDATE on `payments` is refused (column-grant oracle style, the 0266/AC-VWH-009 idiom).
Verify (ONE lock hold — this branch adds a migration):
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0276_payments_recorded_by.test.sql'`

### Task 7 — Mirror writer stamps the payer (`readModelWriters.ts`) — AC-VPAY-008
RED: in `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts`'s payment section:
create with `callerUserId: 'user-b'` → insert carries `recorded_by_id: 'user-b'`; create with no
caller (sweep replay) → `recorded_by_id` absent/null; an UPDATE (finalize retry, cancel
tombstone) never writes the column. GREEN: `upsertPaymentMirror` (`readModelWriters.ts:490-528`)
adds `recorded_by_id: ctx.callerUserId ?? null` to the create-path insert only.
Verify: `cd supabase/functions/adapter-dispatch && deno test readModelWriters.money.test.ts --config deno.json --allow-env --allow-net --allow-read`
(then the edge-fn test-binding guard: `cd .. && cd .. && npm run check:edge-test-binding --silent` from repo root).

### Task 8 — The curated journey (form → PE → bill Paid → ledger) — AC-VPAY-001
New `pmo-portal/e2e/serial/AC-VPAY-001-vendor-payment-form.spec.ts`, `@e2e-isolation: serial`
(flips `external_domain_ownership` + bindings — org-global state, the AC-ENA-053 class). Seeds via
admin client exactly like `AC-ENA-053-pi-payment.spec.ts:62-99` (company + `external_refs`
`Supplier:` mapping + case at `Vendor Invoiced` with `approved_by_id` = admin) and
`AC-VWH-005-vendor-withholding.spec.ts` (tax template; bill recorded by dispatch — net 1,000,000,
PPN 11%, PPh 23 2% → outstanding 1,090,000). Gates on `SUPABASE_FUNCTIONS_URL` (the DEPENDENCY —
never `process.env.CI`, `check-e2e-isolation.sh`); no skips to allowlist. Journey: sign in as
`finance@acme.test` (`e2e/helpers.ts` `login`) → open the case → ledger capture offers Payment
(`ledgerCapture.ts:53`) → select the bill (amount prefilled 1,090,000) → Save → **no
`page.route`** — the real served dispatch commits; assert the `payments` row (`pay_number`
`ACC-PAY-*`, amount 1,090,000, status `Paid`, `invoice_id`, `recorded_by_id` = finance user) via
admin; POST `erpnext-sweep` with `SWEEP_SECRET` (the VWH-005 `:210-216` idiom) → poll the bill to
`Paid` / outstanding 0 → assert the ledger renders the Payment row. Also assert the ERP PE's
`paid_amount` == 1,090,000 when bench creds are exported (the AC-ENA-053 optional-verification
pattern).
Verify: `scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- npx playwright test AC-VPAY-001`
(from `pmo-portal/`; the served lane — the money-command rule forbids `page.route` here).

### Task 9 — Local final gate (all builders, before the PR)
- `cd pmo-portal && npm run typecheck`
- `cd pmo-portal && npx eslint --max-warnings=0 src/lib/adapterSeam/erpnext/bodies/paymentEntry.ts src/lib/adapterSeam/erpnext/dispatchFactory.ts src/lib/repositories/index.ts pages/procurement/RecordCaptureForm.tsx src/lib/repositories/procurement.external.test.ts pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx src/lib/adapterSeam/erpnext/bodies/bodies.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.test.ts`
- `cd pmo-portal && scripts/with-test-lock.sh npx vitest run --changed origin/dev`
- The touched e2e journey (Task 8's command) + `npm run check:e2e-isolation`
- Task 6's pgTAP chain; `cd supabase/functions/adapter-dispatch && deno check index.ts && deno test . --config deno.json --allow-env --allow-net --allow-read`
CI is the full-suite gate (PR → `dev` = `verify` + `pgtap`); do not repeat the suite locally.

## Traceability

| AC | Requirement | Layer | Owning test | Task |
|---|---|---|---|---|
| AC-VPAY-001 | FR-VPAY-001/002/003/008/009 | e2e (serial served) | `e2e/serial/AC-VPAY-001-vendor-payment-form.spec.ts` | 8 |
| AC-VPAY-002 | FR-VPAY-007 | unit (Vitest) | `src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` | 1 |
| AC-VPAY-003 | FR-VPAY-005 | unit (Deno) | `supabase/functions/adapter-dispatch/paymentGate.test.ts` | 3 |
| AC-VPAY-004 | FR-VPAY-003/004/006 | unit (Vitest) | `src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` | 2 |
| AC-VPAY-005 | FR-VPAY-001 | unit (Vitest) | `src/lib/repositories/procurement.external.test.ts` | 4 |
| AC-VPAY-006 | FR-VPAY-010 | unit (Vitest/RTL) | `pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx` | 5 |
| AC-VPAY-007 | FR-VPAY-009 (schema) | pgTAP | `supabase/tests/0276_payments_recorded_by.test.sql` | 6 |
| AC-VPAY-008 | FR-VPAY-009 (writer) | unit (Deno) | `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` | 7 |

Coverage ≥ 80% lines on changed code; every security-critical rule (SoD gate, amount gate, account
fail-closed) gets a mutation check: break the rule → the owning test goes red (binding rule for the
money path).

## Risks / notes

- **`peToBody` serves ONLY kind `payment`** (`doctypeBodies.ts:44`; `incoming-payment` has its own
  `peReceiveToBody`) — Tasks 1–2 cannot drift into the revenue path; the withholding twin
  (`incomingPayment.withholding.test.ts`) stays in Task 1's verify for proof.
- **Existing green tests that pin today's broken shape:** `procurement.external.test.ts:231-237`
  asserts only `erp_doc_kind` (extends, not bends); the 0079 pgTAP suite calls `create_payment(…,
  null, …)` four times (0178's accepted shape — unaffected: the form change sends null, the RPC
  signature is untouched).
- **Bench variance:** `paid_from` comes from the binding's account defaults (AC-ENA-053 seeds
  `Cash - PSC`/`Creditors - PSC`); a real binding with a Bank-typed default is exactly why
  `reference_date` ships in Task 1.
- **Sweep convergence:** the bill flips Paid via the existing PI poll/feed refresh
  (`piStatus.ts`, FR-ENA-116/DD-VWH-5) within one sweep interval — no new writer; the e2e drives
  the sweep explicitly so the assertion is deterministic.
