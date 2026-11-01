# Subcontract acceptance, caps and variations - implementation plan (#1513)

Spec: [`docs/specs/subcontract-acceptance.spec.md`](../specs/subcontract-acceptance.spec.md) (**owner-signed 2026-11-01**).
Route item T2 of [`2026-10-30-epc-odoo-build-route.md`](2026-10-30-epc-odoo-build-route.md). Extends decision #1489,
ADR-0091 (client BAST shape), ADR-0075 (spend approval routing), ADR-0058 (money outbox), ADR-0093 (purchase documents
linked, status derived), ADR-0094 (PMO standalone, ERP route). Role contract: `.claude/agents/eng-planner.md`.

**Owner rulings in force (OD-GRILL-20261101, `docs/decisions.md` "OD-GRILL-20261101"):** the owner accepted **every**
open-question default OQ-1..OQ-10 of the spec. This plan treats each recommended default as a **ruling**, not a
question:

| OQ | Ruling this plan builds |
|---|---|
| OQ-1 | An explicit, set-at-creation flag `procurements.is_subcontract`; caps apply only when the PO has issued BoQ lines. |
| OQ-2 | Subcontract purchases only. Goods purchases keep receipts; no cap on them. |
| OQ-3 | A variation is a child record of the **same** purchase, routed through the shipped spend approval on the additional amount. |
| OQ-4 | PM / Finance / Admin issue PO revisions; issuer is not the variation's approver unless sole operator. |
| OQ-5 | No final (closing) subcontract acceptance in this plan; a PO is closed manually. |
| OQ-6 | Quantity only. A rate change is a plain PO revision through spend approval, outside this plan. |
| OQ-7 | Verified excess stays *verified, not on PO*, unpayable, with its age shown; no expiry. |
| OQ-8 | The cap is on pre-tax line quantity; retention is out of scope. |
| OQ-9 | Acceptance is never posted to the ERP. |
| OQ-10 | An ERP-origin bill linked in that exceeds the cap is a reconciliation exception; PMO refuses payment until a variation or a credit note clears it. |

Also binding: OD-BILL-1 (client billing is by the client's PO/work order; this plan only **links** a cost variation to an
existing client work order and never creates one).

**Gate: money path.** Vendor-bill caps, PO amounts, spend approval and the ERP push are all money. Executor:
Director-dispatched Orca workers, **one worker per slice, each slice its own branch and PR**. The money / SoD slices
**S1, S2, S3, S4 and S5 each ship alone**, never batched (CLAUDE.md money tier, `docs/orca-dispatch.md`). S6, S7a and S7b
are UI-lane and batchable with each other. Every money-slice worker reads [`docs/money-path-primer.md`](../money-path-primer.md)
first and reuses the outbox / sweep / SoD architecture it maps; nothing here re-derives it.

Everything cited was read on `origin/dev` at `6440a961` (migration head `0426_imprest_approval_route.sql`) and re-checked
at `b52aa48a` in the 2026-11-01 review. A path marked **(new)** does not exist yet.

**Migration numbers (Lane B range 0442–0446; 0440/0441 belong to sibling slices).** S1 `0448_subcontract_po_lines.sql`,
S2 `0443_subcontract_acceptances.sql`, S3 `0444_subcontract_bill_caps.sql`, S4 `0445_po_variations.sql`, S5
`0446_subcontract_erp_guards.sql`. On a collision, `scripts/renumber-migration.sh` within this range only; never take a
number outside it. Every `<NNNN>` in a code block below is that slice's number.

---

## Today's behaviour this plan builds on (read in shipped code)

| Fact | Where |
|---|---|
| `purchase_orders` has `status in ('Draft','Issued','Acknowledged','Closed')` and a nullable `amount numeric(14,2)`; no lines. | `supabase/migrations/0035_procurement_record_tables.sql:63-73` |
| Clients hold **no** insert/update/delete on `purchase_orders` (select only); every write is a definer. | `0058_procurement_records_write_hardening.sql:36`, `0075_explicit_api_grants.sql:226` |
| A PO is born **Issued** when the purchase moves to Ordered. | `0362_procurement_start_anywhere.sql:290-293` (inside `transition_procurement`, defined at `:154`) |
| `create_purchase_order` also inserts a PO (status from the caller, default Draft), minting its own number. | `0373_procurement_queue_gate_and_currency.sql:202-228` |
| Vendor bills are captured by `capture_vendor_invoice` (transition to Vendor Invoiced + `create_procurement_invoice` in one transaction). | `0273_vendor_tax_defaults.sql:272-306`; `create_procurement_invoice` head body `0373_…:230-284`; FE call `pmo-portal/src/lib/db/procurementLifecycle.ts:430` |
| "Not cancelled" for a bill is `coalesce(erp_docstatus,1) <> 2 and erp_cancelled_at is null`; there is no native PMO cancel of a vendor bill (client DELETE revoked). | `0373_…:324-329` (create_payment), `0361_procurement_erp_linking.sql` (`procurement_payment_within_ceiling`); delete revoke `0177_delete_path_sod_and_project_money_sod.sql:218-220` |
| Procurement creation is the definer `create_procurement_with_items(p_id, p_header, p_items)` with a whitelist of header keys. | `0406_procurement_atomic_create.sql:15-85` (whitelist at `:29`) |
| Spend approval: `spend_approval_route(org, project, category, amount, currency, requester, decider, submitted_at)` → `(route, reason, approver_ids, line_budget, line_used)`; "line used" counts `greatest(0,total_value,items)` of committed purchases. | `0247_expense_claims.sql:523-…` |
| `transition_procurement` Requested→Approved: requester ≠ approver **outside** the Admin skip, `spend-line:<project>:<category>` advisory lock, route check, Admin break-glass audited, roles PM/Finance/Executive. | `0362_…:154-262` (row lock `:177-179`, SoD `:207-210`, spend-line lock `:226`, route refusals `:233-237`) |
| `approved_total_value` / `amount_approved_by_id` are refused to non-bypass actors; a definer body passes. | `0362_…:99-106` (`guard_procurement_approved_total`), restated `0368_procurement_payment_allowed.sql:50-…` |
| One payment rule for every path: `procurement_payment_allowed(p_procurement_id) returns text` (null = allowed). | `0368_procurement_payment_allowed.sql:18-45` |
| One question before an ERP procurement create is (re)issued from the outbox: `procurement_create_refusal(org, procurement, kind, actor)`; asked by `claim_outbox_for_commit`. | `0373_…:20-62`, claim at `0373_…:137` |
| Foreground ERP gate in the edge function. | `supabase/functions/adapter-dispatch/procurementGateGuard.ts:20-34`, imported `index.ts:84` |
| Client BAST shape to reuse: header + lines, Draft/Confirmed/Withdrawn, immutability triggers, `prepare/withdraw/confirm` definers, sole-operator predicate, document check. | `0337_contract_quantities.sql:94-127` (tables), `:174-199` (immutability), `:201-265` (prepare/withdraw), `:267-…` (confirm; sole-operator `:283`, document `:287`), `0339_read_model_access_and_confirmation_time.sql:9` (head confirm) |
| "Project PM or Finance rank+" predicate. | `0245_management_pack.sql:55` (`may_record_project_progress`) |
| `purchase-order` has no recovery-probe anchor in the ERPNext registry. | `pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts:106` |
| Sync-workflow registry and tier declarations (shape to extend). | `pmo-portal/src/lib/adapterSeam/connect/workflows.ts:12-46`; `erpnext/workflowDeclarations.ts:44`, `odoo/workflowDeclarations.ts:50` |
| Vendor-bill capture in the UI goes through the DAL directly (case-aggregate write, not the repository seam). | `pmo-portal/src/hooks/useProcurementDetail.ts:16-21,195`; page `pmo-portal/pages/ProcurementDetails.tsx:780-809` |
| No subcontract concept exists today. | `scripts/prior-art.sh subcontract` (decisions, ADRs, migrations, hooks, issues) and `grep -rn subcontract supabase/migrations pmo-portal/src` — only the `Subcontractors` budget category (`0001_init_schema.sql`) and the category account map. |

---

## Planner questions (new, found while planning; each has the default this plan takes)

None blocks dispatch. Each names the one slice that changes if the coordinator overrides it.

| # | Question | Default taken | Slice |
|---|---|---|---|
| PQ-1 | Shipped POs are **born Issued** (`0362_…:292`), so "add lines to a Draft subcontract PO, freeze at Issue" (FR-SCA-001/002) has no Draft window to hang on. | Lines are drafted as revision 1 on the subcontract PO while it has **no issued revision**, whatever `purchase_orders.status` says, and are frozen by an explicit `issue_subcontract_po_lines(po)` that writes revision 1 and sets the PO `Issued`. "Issued" in the spec = "has an issued revision" in this plan. | S1 |
| PQ-2 | Can revision 1 total more than the purchase's approved amount? | No. Revision 1's total must be ≤ `coalesce(approved_total_value, nullif(total_value, 0))` (23514); when both are absent, issuing is refused (23514, "record the purchase's value first"). Otherwise issuing lines would raise spend past an approval, or past what the budget line counts (`spend_approval_route` counts `total_value`), without routing. | S1 |
| PQ-3 | Several POs on one subcontract purchase? | At most **one** PO per subcontract purchase carries BoQ lines (partial unique index on revisions by procurement). Bills on that purchase cap against that PO. | S1 |
| PQ-4 | A subcontract purchase with draft (unissued) lines, or a bill already captured before lines exist. | Capture is refused (`SC002`) while draft lines exist without an issued revision; issuing revision 1 is refused once a non-cancelled bill exists on the purchase (23514). A subcontract PO with no lines at all bills as today (OQ-1). | S1, S3 |
| PQ-5 | When does an approved variation count against the budget line? | At **approval**: `procurements.total_value` and (when set) `approved_total_value` rise by the variation amount in the same definer, and `amount_approved_by_id` is stamped with the variation's approver. Two approved-not-yet-revised variations therefore cannot both fit the same headroom, the payment ceiling admits the revised bill, and approver ≠ payer (SoD-b) covers the variation's approver on every payment path, because each one already compares the payer with `amount_approved_by_id` (Paid guard `0368_…:82`, `procurement_create_refusal` `0373_…:52` and through it the outbox claim, `paymentGate.ts:114`). This is the column's shipped meaning: "the billed amount was later approved higher" (`paymentGate.ts:112-113`); `approve_procurement_amount` re-stamps it the same way (`0349_…:254`). | S4 |
| PQ-6 | After a post-work variation is rejected (Disputed), can it be raised again? | Disputed is terminal for that record. A new post-work variation may be raised over the same unresolved quantity; once approved and revised it makes that quantity payable, and the Disputed figure shrinks by what is now on the PO. | S4 |
| PQ-7 | The spec names "PM, Finance" for the client work-order link. Admin? | Admin too (every procurement writer admits Admin, `0362_…:246`). Engineers and Executives cannot link. | S4 |
| PQ-8 | Which "line verified" when the latest confirmed acceptance omits a line? | Per line, the quantity on the latest **Confirmed** acceptance **that includes the line** (cumulative, monotone by FR-SCA-014). | S2 |
| PQ-9 | Connected mode: the shipped purchase-invoice command carries no BoQ lines, so the claim-time re-check (FR-SCA-022) cannot evaluate the cap. | Fail closed: `procurement_create_refusal` refuses a `purchase-invoice` create for a subcontract purchase with issued lines (`subcontract_bill_lines_required`) until #1505 carries the lines; #1505 replaces that branch with the cap evaluation over the stored payload lines. | S5 |
| PQ-10 | What clears an OQ-10 reconciliation exception? | For a mirrored `procurement_invoices` row: (a) an Admin/Finance attributes BoQ line quantities through `attribute_subcontract_bill_lines`, which runs the same cap; or (b) the ERP cancels or amends the bill (the shipped predicate drops it). For a linked ERP Purchase Invoice (`procurement_erp_links`, not a PMO bill row, so it cannot carry lines): only the ERP cancel or `unlink_erp_purchase_document` (shipped, `0361_…`) clears it. | S5 |
| PQ-11 | Connected org (procurement externally owned): PMO cannot change the ERP PO until #1505 carries `purchase-order.revise`. | `issue_subcontract_po_lines` in a connected org requires the lines total to equal the mirrored PO amount and does not write the amount; `issue_po_revision` is refused (42501, detail `erp_revise_pending`) until #1505 lifts it. The ERP mirror's own writes of `purchase_orders.amount` are never refused (ADR-0048: the ledger is the oracle). | S1, S4 |
| PQ-12 | A purchase that is Cancelled or Rejected. | Every new writer (lines, acceptance, bill, variation, revision) refuses it (42501). | S1-S4 |

---

## Architecture

### Design decisions

- **D1 Reuse, do not fork.** Acceptances copy ADR-0091's header/lines/immutability/RPC shape (`0337_…:94-216`) with `po_id`
  in place of `work_order_id`. Spend approval is **called** (`spend_approval_route`), never copied (ADR-0075 §3). Bill
  capture **wraps** the shipped `capture_vendor_invoice`; it never re-implements tax, numbering or the case transition.
- **D2 Lines and revisions are append-only.** `purchase_order_lines` rows are keyed `(po_id, revision, boq_item_id)` and
  become immutable once `purchase_order_revisions(po_id, revision)` exists. The effective revision is
  `max(revision) where status = 'Issued'`. Earlier revisions stay readable (spec Terms "PO revision").
- **D3 The cap is one function.** `subcontract_bill_cap_violation(po, lines jsonb, exclude_invoice)` (internal, no client
  execute) is the only place the rule lives: per line `billed_other + requested ≤ least(verified, po_qty)`. The capture
  wrapper, the ERP-origin attribution RPC and (from #1505) the outbox claim all call it. The mutation test (AC-SCA-014)
  replaces exactly this function. Because #1505 will feed it a queued payload nobody validated, the function validates its
  own input: it sums requested quantity per `boq_item_id` (a line named twice counts twice) and returns
  `unreadable_input` for a null, zero or negative quantity.
- **D4 Fail closed everywhere.** No issued revision with draft lines → refuse. A line not on the effective revision →
  refuse. A null/unreadable input → refuse. A connected-mode bill that cannot carry lines → refuse (PQ-9). An ERP-origin
  bill that cannot be attributed → reconciliation exception, payment refused (OQ-10).
- **D5 One lock, one order.** Advisory lock `subcontract-po:<po uuid>` via `subcontract_po_lock(po)`. Global order, never
  inverted: `procurements` row `FOR UPDATE` → (variation decide only) `spend-line:<project>:<category>` → `subcontract-po:<po>`
  → acceptance / variation / invoice rows. This matches `transition_procurement` (row, then spend-line, `0362_…:177-226`),
  which the capture wrapper calls inside the same transaction.
- **D6 Tenancy is inherited.** Every new table carries `org_id not null`, stamped by a `before insert` trigger from its
  parent (never from the client), FORCE RLS, `select` only to `authenticated`, no client DML. Child RLS is
  `exists (select 1 from <parent> …)` evaluated under the caller's RLS, so the Engineer purchasing scope
  (`0350_engineer_purchasing_scope.sql:84`) is inherited, not re-stated. **RLS does not apply inside a definer** (the
  owner bypasses it, `0243_…:511`; an invoker helper called from a definer runs as the owner too), so every definer
  states its scope as an explicit predicate. The purchase-visibility predicate is 0350's, verbatim:
  `public.auth_role() in ('Admin','Executive','Project Manager','Finance') or v_proc.requested_by_id = auth.uid()`.
  Bill quantities, billed and payable are "the same money by another name" under the 0350 ruling (no invoices for
  Engineers): every read that returns them returns `null` for them outside those four roles, never a `0` computed from
  rows RLS hid.
- **D6a Service role.** New tables keep the default `service_role` grant (`0080_service_role_grants.sql:26`), so the 0137
  catalog backstop (`supabase/tests/0137_service_role_grants.test.sql`) passes without an allow-list entry; the write
  guards are triggers, which bind every role. No new `*_erp_mirror` table is created, so the 0136 side-mirror inventory
  (`supabase/tests/0136_posture_b_side_mirror_droppable.test.sql`) is unchanged; if #1505 adds a revise mirror it extends
  that set.
- **D7 ERP is a side mirror (ADR-0059/0094).** PMO owns acceptance, cap and variation. The ERP receives the effective PO
  line set through a canonical `purchase-order.revise` command (key `porev:<po uuid>:<revision>`) and the vendor bill
  through the shipped purchase-invoice command. Transport for both tiers is #1505; this plan ships the command contract,
  the guards and the fail-closed refusals, so standalone mode is complete without #1505.
- **D8 FE follows ADR-0016/0017.** Reads go page → hook → `repositories.subcontracts` → DAL `src/lib/db/subcontracts.ts`
  → RPC/RLS. The subcontract bill capture follows the shipped vendor-bill precedent: hook → DAL directly
  (`useProcurementDetail.ts:16-21`). `can()` is UX only; no `org_id` from the client.

### Data model (final names)

| Table (new) | Columns | Notes |
|---|---|---|
| `procurements.is_subcontract` | `boolean not null default false` | Set only by `create_procurement_with_items` header key; immutable after insert (trigger). No client grant. |
| `purchase_order_lines` | `id uuid pk`, `org_id`, `po_id → purchase_orders`, `revision int ≥ 1`, `boq_item_id → boq_items`, `quantity numeric(14,3) > 0`, `rate numeric(14,2) ≥ 0`, `unit text not null`, `amount numeric(14,2) generated always as (round(quantity*rate,2)) stored`, `created_at` | unique `(po_id, revision, boq_item_id)`; BoQ item on the purchase's project. |
| `purchase_order_revisions` | `id`, `org_id`, `po_id`, `procurement_id`, `revision int`, `status text check (= 'Issued')`, `total numeric(14,2)`, `variation_id uuid null` (FK added S4), `issued_by`, `issued_at`, `issue_basis text check in ('standard','sole_operator')` | unique `(po_id, revision)`; partial unique `(procurement_id) where revision = 1` (PQ-3). |
| `subcontract_acceptances` | as `work_order_acceptances` (`0337_…:94-114`) with `po_id` for `work_order_id`, no `is_final` | indexes `(po_id, status, confirmed_at desc, id desc)`, `(org_id, project_id)`, `(document_id)`. |
| `subcontract_acceptance_lines` | `acceptance_id`, `boq_item_id`, `quantity numeric(14,3) ≥ 0` | pk `(acceptance_id, boq_item_id)`. |
| `procurement_invoice_lines` | `org_id`, `invoice_id → procurement_invoices`, `boq_item_id`, `quantity numeric(14,3) > 0`, `rate numeric(14,2) ≥ 0`, `amount generated round(quantity*rate,2)`, `attributed_by uuid null` | pk `(invoice_id, boq_item_id)`; index `(boq_item_id)`. |
| `po_variations` | `id`, `org_id`, `po_id`, `procurement_id`, `project_id`, `number text`, `origin text check in ('pre_work','post_work')`, `status text check in ('Requested','Approved','Revised','Rejected','Disputed')`, `reason text not null check (length ≤ 1000)`, `amount numeric(14,2) ≥ 0`, `requested_by`, `requested_at`, `approved_by`, `approved_at`, `decided_notes`, `revision int null`, `work_order_id uuid null → work_orders`, `not_passed_reason text null`, `linked_by`, `linked_at` | check: not both `work_order_id` and `not_passed_reason`. |
| `po_variation_lines` | `variation_id`, `boq_item_id`, `additional_quantity numeric(14,3) > 0`, `rate numeric(14,2)` (copied from the effective PO line) | pk `(variation_id, boq_item_id)`. |

### Slice map

| Slice | Migration | Tasks | Blocked by | Worker tier | Ships |
|---|---|---|---|---|---|
| **S1 Subcontract flag, PO lines, revision 1** | `0448_subcontract_po_lines.sql` | S1.1-S1.8 | none | Sol (money: PO amount) | **alone** |
| **S2 Subcontract acceptance** | `0443_subcontract_acceptances.sql` | S2.1-S2.6 | S1 | Sol (SoD) | **alone** |
| **S3 Bill lines, the cap, position read** | `0444_subcontract_bill_caps.sql` | S3.1-S3.9 | S2 | **Sol** (money path) | **alone** |
| **S4 Variations, revisions, client link, tenancy** | `0445_po_variations.sql` | S4.1-S4.9 | S3 | **Sol** (money + SoD) | **alone** |
| **S5 ERP guards, OQ-10, `purchase-order.revise` contract** | `0446_subcontract_erp_guards.sql` | S5.1-S5.8 | S4 | **Sol** (money path) | **alone** |
| **S6 Data layer** (DAL, repository, hooks, rules, policy) | none | S6.1-S6.5 | S4 | Luna | batchable |
| **S7a Lines, acceptance and bill screens** | none | S7.1-S7.4 | S6 | Flash or Luna (UI lane) | batchable |
| **S7b Variation and link screens, push badge, e2e journey** | none | S7.5-S7.7 | S7a, S5 | Flash or Luna (UI lane) | batchable |

Order: S1 → S2 → S3 → S4 → (S5 ∥ S6) → S7a → S7b. Each slice is about one builder-day or less and ships on its own:
S1-S5 each leave dev green and standalone-complete for what they cover; S7 was split because its seven tasks (three
screens, i18n, the variation UI and the journey) exceed a builder-day. Branches `feat/sca-s<n>` off `origin/dev`, each in its own worktree with
`.env.local` copied in. Workers push their branch only; the Director opens PRs. A slice may stack on the previous slice's
branch before that PR merges; each money slice is still its own PR.

## Conventions every task follows

- **Test files.** pgTAP `supabase/tests/subcontract_<topic>.test.sql`, self-contained: `begin; create extension if not
  exists pgtap; select plan(N);` … `select * from finish(); rollback;` (the dblink file follows `0163_automation_cap_race.test.sql`'s
  extension-outside-transaction rule). Vitest beside the source. Playwright `pmo-portal/e2e/AC-SCA-001-subcontract-bill-cap-journey.spec.ts`
  with `// @e2e-isolation: self-isolated — …` on line 1 (`docs/e2e-parallel-conventions.md:52`).
- **AC tag** leads the pgTAP description / `it(...)` / `test(...)` title. Tests for requirements with no AC lead with
  their `FR-SCA-###` / `NFR-SCA-###`.
- **DB commands under the lock, reset and test in one hold:**
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<file>.test.sql'`.
- **Every migration slice's gate (S1-S5), all green before push, in order:**
  1. `scripts/check-migration-collisions.sh && scripts/check-migration-collisions.sh --self-test`
  2. `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <this slice's files> supabase/tests/0178_anon_executable_definers.test.sql'`
  3. `node scripts/check-isolation-denominator.mjs && node scripts/check-isolation-denominator.mjs --self-test`. The
     manifest `scripts/isolation-probe-denominator.json` is checked in **both directions** against the reset DB, so add,
     per slice: every new table to `tables` (model: the `work_order_acceptances` / `work_order_acceptance_lines` rows at
     `:146-147`; a child with no `org_id` is `"has_org":false,"b_read":"parent-org-only"`); **every** new SECURITY DEFINER
     signature to `definer_functions`, internal ones included (guards, `subcontract_billed`, the cap, the push refusal);
     and every new client-callable writer to `rpcs` with `expect_denial` codes whose `source` lines contain the literal
     SQLSTATE (model: `prepare_work_order_acceptance` at `:484`), plus the matching `$(rpc <name>` probe line in
     `scripts/isolation-probe.sh` (the checker requires exact coverage, `check-isolation-denominator.mjs:208-216`).
  4. The 0178 retained-RPC count: add each new **client-executable definer** to the VALUES list of
     `supabase/tests/0178_anon_executable_definers.test.sql`, re-derive the count **by hand from the list after rebasing**
     (it read 104 at the 0410 amendment on `6440a961`), update both hard-coded counts and add an `⚑ AMENDED BY <NNNN> (#1513)`
     header line. Client definers per slice: S1 +2, S2 +3, S3 +1, S4 +4, S5 +1.
  5. From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, touched vitest files, `npx eslint --max-warnings=0 <touched>`.
- **Types after a migration:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`.
- **Hosted-grants rule (0185/0210).** Every function ends `revoke all … from public, anon;`; internals also
  `from authenticated`; client RPCs then `grant execute … to authenticated`. Each migration ends with a closing
  self-assertion `do $$ … $$` that raises if a new table lacks FORCE RLS, holds a client DML grant, or a new internal
  function is client-executable.
- **Rollback:** `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`, reverse dependency order, and the same reverse in the
  migration header. NFR-SCA-007 follows the shipped refuse-if-rows precedent (`rollback/0281_vendor_withholding_slips_down.sql:1-8`,
  `rollback/0410_billing_kinds_down.sql:2-5`): each down file first raises `'rollback refused: <table> rows exist — export
  and remove them first'` when any row exists in a table it would drop, so revisions, acceptances, bill lines and
  variations are exported operationally (`scripts/prod-read.sh` / `pg_dump -t`) before a reversal. Never copy rows into a
  table in `public`: that schema is API-exposed and an `as select *` copy carries no RLS. The header says so.
- **Re-created shipped functions** carry the head body verbatim with each changed line marked `-- <NNNN>` (0247
  convention), and the down file restores the head body.
- **Audit:** every state change calls `public.log_audit('<entity>.<verb>', org, auth.uid(), id, detail)` (NFR-SCA-006).
- **Public repo:** synthetic data only; fixture UUID prefix `15130000-`, emails `@example.com`.
- **Commits:** conventional, no attribution trailers; before every push
  `git log --format=%B origin/dev..HEAD | grep -qi co-authored` must not match. Never `--no-verify`.

## Shared pgTAP fixture F1 (copied verbatim into every SCA pgTAP file; extend, never fork)

```sql
-- F1: org A (multi-member), org B (other tenant), org S (sole member). Inserted as superuser, before `set local role`.
insert into organizations (id, name, default_currency) values
  ('15130000-0000-0000-0000-00000000000a', 'SCA Org',       'IDR'),
  ('15130000-0000-0000-0000-00000000000b', 'SCA Other Org', 'IDR'),
  ('15130000-0000-0000-0000-00000000000c', 'SCA Solo Org',  'IDR');
insert into auth.users (id, email) values
  ('15130000-0000-0000-0000-0000000000a1', 'sca-admin@example.com'),
  ('15130000-0000-0000-0000-0000000000a2', 'sca-fin1@example.com'),
  ('15130000-0000-0000-0000-0000000000a3', 'sca-fin2@example.com'),
  ('15130000-0000-0000-0000-0000000000a4', 'sca-pm@example.com'),
  ('15130000-0000-0000-0000-0000000000a5', 'sca-eng@example.com'),
  ('15130000-0000-0000-0000-0000000000a6', 'sca-exec@example.com'),
  ('15130000-0000-0000-0000-0000000000a7', 'sca-pm-off@example.com'),
  ('15130000-0000-0000-0000-0000000000a8', 'sca-fin-off@example.com'),
  ('15130000-0000-0000-0000-0000000000b1', 'sca-xorg@example.com'),
  ('15130000-0000-0000-0000-0000000000c1', 'sca-solo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000a1', '15130000-0000-0000-0000-00000000000a', 'SCA Admin', 'sca-admin@example.com', 'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000a2', '15130000-0000-0000-0000-00000000000a', 'SCA Fin1',  'sca-fin1@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a3', '15130000-0000-0000-0000-00000000000a', 'SCA Fin2',  'sca-fin2@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-00000000000a', 'SCA PM',    'sca-pm@example.com',    'Project Manager', 'active'),
  ('15130000-0000-0000-0000-0000000000a5', '15130000-0000-0000-0000-00000000000a', 'SCA Eng',   'sca-eng@example.com',   'Engineer', 'active'),
  ('15130000-0000-0000-0000-0000000000a6', '15130000-0000-0000-0000-00000000000a', 'SCA Exec',  'sca-exec@example.com',  'Executive', 'active'),
  ('15130000-0000-0000-0000-0000000000a7', '15130000-0000-0000-0000-00000000000a', 'SCA PM Off', 'sca-pm-off@example.com', 'Project Manager', 'disabled'),
  ('15130000-0000-0000-0000-0000000000a8', '15130000-0000-0000-0000-00000000000a', 'SCA Fin Off', 'sca-fin-off@example.com', 'Finance', 'disabled'),
  ('15130000-0000-0000-0000-0000000000b1', '15130000-0000-0000-0000-00000000000b', 'SCA XOrg',  'sca-xorg@example.com',  'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000c1', '15130000-0000-0000-0000-00000000000c', 'SCA Solo',  'sca-solo@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-00000000000a', 'SCA Site',  'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d2', '15130000-0000-0000-0000-00000000000a', 'SCA Site Two', 'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-00000000000c', 'SCA Solo Site', 'Ongoing Project', null);
-- Client BoQ items: L1 (100 m3), L2 (50 m) on project d1; L9 on the solo project.
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15130000-0000-0000-0000-0000000000e1', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L1', 'Excavation', 'm3', 100, 150000),
  ('15130000-0000-0000-0000-0000000000e2', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L2', 'Piping',     'm',  50,  90000),
  ('15130000-0000-0000-0000-0000000000e9', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'L9', 'Solo work',  'ls', 10,  10000);
-- Subcontract purchase SP (Ordered, approved 12,000,000, Subcontractors line) and its PO.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-00000000000a', 'SCA earthworks subcontract',
   '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 12000000, 12000000,
   '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f9', '15130000-0000-0000-0000-00000000000c', 'SCA solo subcontract',
   '15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-0000000000c1', 'Ordered', 100000, null,
   null, 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'PO-SCA-1', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000f9', 'PO-SCA-9', 'Issued', current_date, 'IDR');
-- Signed Berita Acara documents (Issued, with a file) on each project.
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('15130000-0000-0000-0000-000000000201', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA period 1', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d1/15130000-0000-0000-0000-000000000201/ba1.pdf'),
  ('15130000-0000-0000-0000-000000000202', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d2', 'Acceptance', 'BA other project', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d2/15130000-0000-0000-0000-000000000202/ba2.pdf'),
  ('15130000-0000-0000-0000-000000000209', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'Acceptance', 'BA solo', 'Issued',
   '15130000-0000-0000-0000-00000000000c/15130000-0000-0000-0000-0000000000d9/15130000-0000-0000-0000-000000000209/ba9.pdf');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
```

Fixture F2 (S2 on) issues revision 1 of PO `…101`: L1 100 m3 @ 100,000 and L2 50 m @ 40,000 (total 12,000,000), as
superuser, by inserting the two `purchase_order_lines` rows and the `purchase_order_revisions` row
`(po …101, procurement …f1, revision 1, 'Issued', 12000000, issued_by …a4, 'standard')`; and revision 1 of PO `…109`:
L9 10 ls @ 10,000.

Fixture F3 (S3 on) appends a Confirmed acceptance as superuser with `pg_temp.confirmed_acceptance(p_po uuid, p_l1 numeric, p_l2 numeric)`:

```sql
create or replace function pg_temp.confirmed_acceptance(p_po uuid, p_l1 numeric, p_l2 numeric) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, confirmed_by,
                                       confirmed_at, confirm_basis, document_id)
  values (v, '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', p_po, current_date, 'Confirmed',
          '15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-0000000000a2', clock_timestamp(), 'standard',
          '15130000-0000-0000-0000-000000000201');
  insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e1', p_l1);
  if p_l2 is not null then insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e2', p_l2); end if;
  return v;
end $$;
```

(The immutability triggers fire on UPDATE/DELETE only, so a superuser INSERT of a Confirmed row is allowed, as in
`0337_work_order_acceptances.test.sql`.) Bills in tests are captured through the RPC as Fin1 with
`p_tax_treatment => 'exclusive', p_tax_amount => 0`.

---

## S1 - Subcontract flag, PO lines, revision 1 (`0448_subcontract_po_lines.sql`) - ships alone

Covers FR-SCA-001, 002, 003; OQ-1; PQ-1..4. Header:

```sql
-- 0448_subcontract_po_lines.sql — #1513 S1: subcontract purchases carry BoQ lines on their PO; revision 1 freezes them.
-- Spec docs/specs/subcontract-acceptance.spec.md (signed 2026-11-01) · Plan docs/plans/2026-11-01-subcontract-acceptance.md S1.
-- Proven by supabase/tests/subcontract_po_lines.test.sql and the 0178 allow-list.
-- ── REVERSE (also rollback/0448_subcontract_po_lines_down.sql; refused while rows exist, NFR-SCA-007) ──
--   do $$ begin if exists (select 1 from public.purchase_order_lines) or exists (select 1 from public.purchase_order_revisions)
--     then raise exception 'rollback refused: subcontract PO lines exist — export and remove them first'; end if; end $$;
--   drop trigger if exists purchase_orders_zz_subcontract_amount on public.purchase_orders;
--   drop function if exists public.issue_subcontract_po_lines(uuid);
--   drop function if exists public.set_subcontract_po_lines(uuid, jsonb);
--   drop table if exists public.purchase_order_revisions;   drop table if exists public.purchase_order_lines;
--   drop function if exists public.guard_purchase_order_subcontract_amount();
--   drop function if exists public.guard_purchase_order_line();
--   drop function if exists public.po_effective_revision(uuid);
--   drop function if exists public.subcontract_po_lock(uuid);
--   restore create_procurement_with_items from 0406_procurement_atomic_create.sql:15-85;
--   drop trigger if exists procurements_zz_subcontract_flag on public.procurements;
--   drop function if exists public.guard_procurement_subcontract_flag();
--   alter table public.procurements drop column if exists is_subcontract;
```

### S1.1 Failing test: the flag (OQ-1)

Create `supabase/tests/subcontract_po_lines.test.sql` (new) = F1 minus the `is_subcontract` value in the procurements
insert (S1 creates the column; the F1 insert works once S1 lands), then:

```sql
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select lives_ok($$ select create_procurement_with_items('15130000-0000-0000-0000-0000000000f2',
  '{"title":"SCA new sub","project_id":"15130000-0000-0000-0000-0000000000d1","budget_category":"Subcontractors","is_subcontract":true}'::jsonb,
  '[]'::jsonb) $$, 'FR-SCA-001 OQ-1 a purchase is created flagged subcontract');
select is((select is_subcontract from procurements where id = '15130000-0000-0000-0000-0000000000f2'), true,
  'FR-SCA-001 OQ-1 the flag is stored');
select throws_ok($$ update procurements set is_subcontract = false where id = '15130000-0000-0000-0000-0000000000f2' $$,
  '42501', null, 'FR-SCA-001 OQ-1 the flag cannot be changed after creation');
select throws_ok($$ select create_procurement_with_items('15130000-0000-0000-0000-0000000000f3',
  '{"title":"SCA bad","is_subcontract":"yes"}'::jsonb, '[]'::jsonb) $$, '22023', null,
  'FR-SCA-001 OQ-1 a non-boolean flag is invalid input');
```

Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/subcontract_po_lines.test.sql'` → fails (column missing).

### S1.2 Migration §1-§2: column, guard, creation key

```sql
alter table public.procurements add column is_subcontract boolean not null default false;
create or replace function public.guard_procurement_subcontract_flag() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.is_subcontract is distinct from old.is_subcontract then
    raise exception 'whether a purchase is a subcontract is set when it is created' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_subcontract_flag() from public, anon, authenticated;
create trigger procurements_zz_subcontract_flag before update of is_subcontract on public.procurements
  for each row execute function public.guard_procurement_subcontract_flag();
```

The `update` in S1.1 is refused by the column grant first (no `update (is_subcontract)` grant, `0075_…:197`); the trigger
is the second layer for definers. Then re-create `create_procurement_with_items` = `0406_…:15-85` verbatim with three
marked lines: the header whitelist (`:29`) gains `'is_subcontract'`; a type check
`or (p_header ? 'is_subcontract' and jsonb_typeof(p_header->'is_subcontract') is distinct from 'boolean')`; the insert
column list gains `is_subcontract` with `coalesce((p_header->>'is_subcontract')::boolean, false)`; the
"differs from request" comparison gains `or v_parent.is_subcontract is distinct from coalesce((p_header->>'is_subcontract')::boolean, false)`.
Same signature, so its grants stand (`0406_…:84-85`).

### S1.3 Failing tests: draft lines, issue, freeze (FR-SCA-001/002, PQ-1..4)

Append to `subcontract_po_lines.test.sql`:

```sql
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":100,"rate":100000,"unit":"m3"}]') $$,
  '42501', null, 'FR-SCA-001 an Engineer cannot draft PO lines');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":0,"rate":100000,"unit":"m3"}]') $$,
  '23514', null, 'FR-SCA-001 quantity must be above zero');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":1,"rate":1,"unit":"ls"}]') $$,
  '23514', null, 'FR-SCA-001 a BoQ item from another project is refused');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":100,"rate":100000,"unit":"m3"},
    {"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":50,"rate":40000,"unit":"m"}]') $$,
  'FR-SCA-001 the PM drafts two BoQ lines');
select is((select sum(amount) from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101'),
  12000000::numeric, 'FR-SCA-001 the lines total 12,000,000');
select is(issue_subcontract_po_lines('15130000-0000-0000-0000-000000000101'), 1, 'FR-SCA-002 revision 1 is issued');
select is((select amount from purchase_orders where id = '15130000-0000-0000-0000-000000000101'), 12000000::numeric,
  'FR-SCA-003 the PO amount is derived from the effective revision');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":120,"rate":100000,"unit":"m3"}]') $$,
  '42501', null, 'FR-SCA-002 lines are frozen once revision 1 is issued');
reset role;
select throws_ok($$ update purchase_orders set amount = 1 where id = '15130000-0000-0000-0000-000000000101' $$,
  '23514', null, 'FR-SCA-003 a hand-edited amount that disagrees with the revision is refused, even for the owner');
select throws_ok($$ update purchase_order_lines set quantity = 1 where po_id = '15130000-0000-0000-0000-000000000101' $$,
  '42501', null, 'FR-SCA-002 issued lines are immutable');
set local role authenticated;
-- PQ-2: a second subcontract purchase approved for 1,000 cannot issue lines worth more.
```

plus, for PQ-2/PQ-3/PQ-4, a second purchase `…f4` (Ordered, `approved_total_value` 1000, PO `…104`) inserted as superuser
before `set local role`, and:

```sql
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000104',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":2000,"unit":"m3"}]') $$, 'PQ-2 draft above approval is allowed as a draft');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000104') $$, '23514', null,
  'PQ-2 revision 1 above the approved amount is refused');
```

and, for PQ-4, a third purchase `…f5` with PO `…105` and one non-cancelled `procurement_invoices` row inserted as
superuser: `issue_subcontract_po_lines('…105')` → `throws_ok … '23514' … 'PQ-4 lines cannot be issued after a bill exists'`.
PQ-3: a second PO `…106` on `…f1` → `set_subcontract_po_lines('…106', …)` → `throws_ok … '23505' … 'PQ-3 one lined PO per subcontract purchase'`.
A non-subcontract purchase's PO → `throws_ok … '42501' … 'OQ-2 a goods purchase has no BoQ lines'`.

### S1.4 Migration §3: tables, stamps, RLS

```sql
create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  po_id uuid not null references public.purchase_orders(id),
  revision integer not null check (revision >= 1),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  unit text not null check (length(btrim(unit)) between 1 and 20),
  amount numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  created_at timestamptz not null default now(),
  unique (po_id, revision, boq_item_id)
);
create index purchase_order_lines_org_po_idx on public.purchase_order_lines (org_id, po_id, revision);
create index purchase_order_lines_boq_idx on public.purchase_order_lines (boq_item_id);
create table public.purchase_order_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  po_id uuid not null references public.purchase_orders(id),
  procurement_id uuid not null references public.procurements(id),
  revision integer not null check (revision >= 1),
  status text not null default 'Issued' check (status = 'Issued'),
  total numeric(14,2) not null check (total >= 0),
  variation_id uuid,
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default clock_timestamp(),
  issue_basis text not null check (issue_basis in ('standard','sole_operator')),
  unique (po_id, revision)
);
create unique index purchase_order_revisions_one_lined_po on public.purchase_order_revisions (procurement_id) where revision = 1;
create index purchase_order_revisions_org_idx on public.purchase_order_revisions (org_id, procurement_id);
```

`guard_purchase_order_line()` (before insert/update/delete on `purchase_order_lines`, invoker): on INSERT stamp
`new.org_id` from the PO; refuse (23514) when `boq_items.project_id` ≠ the PO's `procurements.project_id` or the org
differs; refuse (42501) any INSERT/UPDATE/DELETE when `purchase_order_revisions(po_id, revision)` exists; refuse (42501)
DELETE unless `current_setting('pmo.replace_po_draft_lines', true) = 'on'`. RLS (D6):

```sql
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_lines force row level security;
alter table public.purchase_order_revisions enable row level security;
alter table public.purchase_order_revisions force row level security;
create policy purchase_order_lines_read on public.purchase_order_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.purchase_orders po where po.id = po_id));
create policy purchase_order_revisions_read on public.purchase_order_revisions for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.purchase_orders po where po.id = po_id));
revoke all on public.purchase_order_lines, public.purchase_order_revisions from public, anon, authenticated;
grant select on public.purchase_order_lines, public.purchase_order_revisions to authenticated;
```

### S1.5 Migration §4: lock, effective revision, amount guard

```sql
create or replace function public.subcontract_po_lock(p_po_id uuid) returns void
  language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('subcontract-po:' || p_po_id::text, 0))
$$;
revoke all on function public.subcontract_po_lock(uuid) from public, anon, authenticated;

create or replace function public.po_effective_revision(p_po_id uuid) returns integer
  language sql stable security invoker set search_path = public as $$
  select max(r.revision) from public.purchase_order_revisions r where r.po_id = p_po_id and r.status = 'Issued'
$$;
revoke all on function public.po_effective_revision(uuid) from public, anon;
grant execute on function public.po_effective_revision(uuid) to authenticated;

create or replace function public.guard_purchase_order_subcontract_amount() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
declare v_total numeric;
begin
  select r.total into v_total from public.purchase_order_revisions r
   where r.po_id = new.id and r.revision = (select max(x.revision) from public.purchase_order_revisions x where x.po_id = new.id);
  if found and new.amount is distinct from v_total
     and coalesce(current_setting('pmo.subcontract_po_amount', true), '') <> 'on'
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then          -- PQ-11: the ERP mirror records ERP truth (ADR-0048)
    raise exception 'a subcontract PO''s amount is the total of its effective BoQ lines (%); change it by a PO revision', v_total
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_purchase_order_subcontract_amount() from public, anon, authenticated;
create trigger purchase_orders_zz_subcontract_amount before update of amount on public.purchase_orders
  for each row execute function public.guard_purchase_order_subcontract_amount();
```

The guard deliberately applies to every user-path actor (owner included) — the S1.3 owner-update assertion proves it; the
only PMO writer is a definer that sets the flag transaction-locally for one statement. The one exemption is the service
role (the ERP read-model mirror, `procurement_invoices_native_mirror_guard`'s idiom `0273_…:174-176`): refusing a mirror
write would fail the feed or sweep for the org, and a mirrored amount that disagrees with the revision shows on the
position read (`po_amount` ≠ revision total) rather than being rejected. S1.3 adds:
`FR-SCA-003 PQ-11 the service-role ERP mirror may record the ERP PO amount` — as superuser with
`set local request.jwt.claims = '{"role":"service_role"}'`, `lives_ok(update purchase_orders set amount = 1 …)`.

### S1.6 Migration §5: `set_subcontract_po_lines` and `issue_subcontract_po_lines`

```sql
create or replace function public.set_subcontract_po_lines(p_po_id uuid, p_lines jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_proc public.procurements; v_po public.purchase_orders; v_n integer;
begin
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id for update;          -- D5 row first
  perform public.subcontract_po_lock(p_po_id);                                                     -- D5 then the PO
  if not v_proc.is_subcontract then raise exception 'only a subcontract purchase has BoQ lines' using errcode = '42501'; end if;
  if v_proc.status::text in ('Cancelled','Rejected') then                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only a Project Manager, Finance or an Admin may set PO lines' using errcode = '42501'; end if;
  if exists (select 1 from public.purchase_order_revisions r where r.po_id = p_po_id) then
    raise exception 'PO lines are frozen once issued; raise a variation instead' using errcode = '42501'; end if;
  if exists (select 1 from public.purchase_order_revisions r join public.purchase_orders o on o.id = r.po_id
              where o.procurement_id = v_proc.id and r.po_id <> p_po_id)
     or exists (select 1 from public.purchase_order_lines l join public.purchase_orders o on o.id = l.po_id
              where o.procurement_id = v_proc.id and l.po_id <> p_po_id) then
    raise exception 'a subcontract purchase has one PO with BoQ lines' using errcode = '23505'; end if;      -- PQ-3
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one BoQ line is required' using errcode = '23502'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric, unit text)
              where not coalesce(x.quantity > 0 and x.quantity = round(x.quantity, 3) and x.rate >= 0
                                 and x.rate = round(x.rate, 2) and length(btrim(x.unit)) between 1 and 20, false)) then
    raise exception 'quantity above zero (3 decimals), rate zero or more (2 decimals) and a unit are required' using errcode = '23514'; end if;
  perform set_config('pmo.replace_po_draft_lines', 'on', true);
  delete from public.purchase_order_lines where po_id = p_po_id and revision = 1;
  perform set_config('pmo.replace_po_draft_lines', '', true);
  insert into public.purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit)
  select p_po_id, 1, x.boq_item_id, x.quantity, x.rate, btrim(x.unit)
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric, unit text);
  get diagnostics v_n = row_count;
  perform public.log_audit('purchase_order_lines.set', v_org, auth.uid(), p_po_id, jsonb_build_object('procurement_id', v_proc.id, 'lines', v_n));
  return v_n;
end $$;
```

(The same-project and unique checks fire from `guard_purchase_order_line` and the unique key — 23514 / 23505.)

`issue_subcontract_po_lines(p_po_id) returns integer`: same membership, row-then-PO locks, subcontract, closed-purchase
(PQ-12) and role checks; refuse (42501) if a revision exists; refuse (23502) if no draft lines; refuse (23514) if any
non-cancelled bill exists on the purchase (`coalesce(erp_docstatus,1) <> 2 and erp_cancelled_at is null`, PQ-4);
compute `v_total := sum(amount)`; PQ-2:

```sql
  v_ceiling := coalesce(v_proc.approved_total_value, nullif(v_proc.total_value, 0));
  if v_ceiling is null then
    raise exception 'record the purchase''s value or approval before issuing its BoQ lines' using errcode = '23514';
  end if;
  if v_total > v_ceiling then
    raise exception 'the BoQ lines total % exceeds the purchase''s approved value %', v_total, v_ceiling using errcode = '23514';
  end if;
  if public.domain_externally_owned(v_proc.org_id, 'procurement')                                 -- PQ-11
     and v_po.amount is not null and v_po.amount is distinct from v_total then
    raise exception 'the BoQ lines total % must equal the ERP purchase order amount %', v_total, v_po.amount using errcode = '23514';
  end if;
```

insert the revision row `(revision 1, total v_total, issued_by auth.uid(), issue_basis 'standard')`; then, **only when the
org is not connected** (`not public.domain_externally_owned(v_proc.org_id, 'procurement')`; a connected PO's amount is the
ERP's, PQ-11): `perform set_config('pmo.subcontract_po_amount','on',true); update purchase_orders set amount = v_total,
status = case when status = 'Draft' then 'Issued' else status end where id = p_po_id; perform set_config('pmo.subcontract_po_amount','',true);`;
audit `purchase_order_revision.issue` with `{revision:1,total}`; return 1. Grants for both:
`revoke all … from public, anon; grant execute … to authenticated;`.

S1.3 adds, beside the PQ-2 block: a subcontract purchase `…f6` with `total_value` 0 and no approval →
`throws_ok … '23514' … 'PQ-2 lines cannot be issued on a purchase with no recorded value'`; a Cancelled subcontract purchase
`…f7` → `set_subcontract_po_lines` `throws_ok … '42501' … 'PQ-12 a closed purchase takes no BoQ lines'`.

### S1.7 Closing assertion, rollback, 0178, denominator

Closing `do $$` asserts: both tables have `relforcerowsecurity`; `has_table_privilege('authenticated', t, 'INSERT')`,
`'UPDATE'`, `'DELETE'` are false for both; `subcontract_po_lock` and the two guards are not executable by `authenticated`.
Write `supabase/migrations/rollback/0448_subcontract_po_lines_down.sql` from the header. Add the two RPCs to the 0178
list (+2); in `scripts/isolation-probe-denominator.json` (Conventions gate step 3) add both tables, every new SECURITY
DEFINER signature (the two RPCs and `guard_procurement_subcontract_flag` only if written as definer — the plan writes the
guards as invoker), and `rpcs` entries + `scripts/isolation-probe.sh` probes for the two RPCs.

### S1.8 Gate and commit

Run the slice gate (Conventions) with `supabase/tests/subcontract_po_lines.test.sql`, regenerate types, commit
`feat(db): subcontract PO lines and revision 1 (#1513 S1)`.

---

## S2 - Subcontract acceptance (`0443_subcontract_acceptances.sql`) - ships alone

Covers AC-SCA-006 and FR-SCA-010..015; PQ-8. Header REVERSE lists, in order: refuse while rows exist (NFR-SCA-007); drop
`confirm_subcontract_acceptance(uuid)`, `withdraw_subcontract_acceptance(uuid)`,
`prepare_subcontract_acceptance(uuid,date,jsonb,uuid,text,uuid)`, `subcontract_verified(uuid)`; drop
`subcontract_acceptance_lines`, `subcontract_acceptances` (drops triggers); drop the two guard functions.

### S2.1 Failing test: AC-SCA-006 (owning) and FR-SCA-010..015

Create `supabase/tests/subcontract_acceptances.test.sql` (new) = F1 + F2, then:

```sql
select is(has_table_privilege('authenticated', 'public.subcontract_acceptances', 'INSERT'), false,
  'FR-SCA-015 clients hold no insert on acceptances');
select is(has_table_privilege('authenticated', 'public.subcontract_acceptance_lines', 'INSERT'), false,
  'FR-SCA-015 clients hold no insert on acceptance lines');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":10}]') $$, '42501', null,
  'FR-SCA-010 an Engineer cannot prepare a subcontract acceptance');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');  -- Fin1 is the preparer "A"
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":120}]', '15130000-0000-0000-0000-000000000201') $$,
  'FR-SCA-013 a verified quantity above the PO (120 > 100) is accepted on the draft');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":1}]') $$, '23514', null,
  'FR-SCA-010 a line not on the effective PO revision is refused');
select throws_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, '42501', null,
  'AC-SCA-006 the preparer cannot confirm in an org with other active members');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');  -- Fin2 confirms
select lives_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$,
  'AC-SCA-006 a different Finance member confirms with the signed document');
select is((select confirm_basis from subcontract_acceptances where po_id = '15130000-0000-0000-0000-000000000101'
  and status = 'Confirmed'), 'standard', 'AC-SCA-006 basis standard is recorded');
reset role;
select throws_ok($$ update subcontract_acceptances set note = 'x' where status = 'Confirmed' $$, '42501', null,
  'AC-SCA-006 a confirmed acceptance cannot be updated');
select throws_ok($$ delete from subcontract_acceptance_lines where acceptance_id in
  (select id from subcontract_acceptances where status = 'Confirmed') $$, '42501', null,
  'AC-SCA-006 confirmed lines cannot be deleted');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":110}]', '15130000-0000-0000-0000-000000000201') $$,
  '23514', null, 'FR-SCA-014 a cumulative quantity below the latest confirmed (120) is refused');
select lives_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":5}]', '15130000-0000-0000-0000-000000000202') $$,
  'FR-SCA-011 a draft may name a document from another project …');
select throws_ok($$ select confirm_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, '23514', null,
  'FR-SCA-011 … but confirming needs a same-project signed document with a file');
select lives_ok($$ select withdraw_subcontract_acceptance((select id from subcontract_acceptances
  where po_id = '15130000-0000-0000-0000-000000000101' and status = 'Draft')) $$, 'FR-SCA-010 the preparer withdraws a draft');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000c1');  -- sole member of org S
select lives_ok($$ select confirm_subcontract_acceptance(prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000109',
  current_date, '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":3}]', '15130000-0000-0000-0000-000000000209')) $$,
  'AC-SCA-006 the sole active member prepares and confirms');
select is((select confirm_basis from subcontract_acceptances where po_id = '15130000-0000-0000-0000-000000000109'),
  'sole_operator', 'AC-SCA-006 basis sole_operator is recorded');
select is((select count(*)::int from audit_events where action like 'subcontract_acceptance.%'
  and entity_id in (select id from subcontract_acceptances)), 6, 'NFR-SCA-006 prepare/withdraw/confirm are audited');
```

Run → fails (functions missing).

### S2.2 Tables, immutability, RLS

`subcontract_acceptances` = `0337_…:94-114` with `po_id uuid not null references public.purchase_orders(id)` for
`work_order_id`, no `is_final`, the two pair constraints copied, `note` ≤ 500. Indexes
`(org_id, project_id)`, `(po_id, status, confirmed_at desc, id desc)`, `(document_id)`.
`subcontract_acceptance_lines (acceptance_id, boq_item_id, quantity numeric(14,3) not null check (quantity >= 0 and quantity < 'Infinity'::numeric), primary key (acceptance_id, boq_item_id))`.
Immutability triggers `guard_subcontract_acceptance_immutable()` and `guard_subcontract_acceptance_line_immutable()` =
`0337_…:174-199` with the identity tuple `(id, org_id, project_id, po_id)` and the session flag
`pmo.replace_subcontract_acceptance`. RLS copies `0337_…:126-133` (read for active members of the org; lines through the
header), plus the purchase visibility join `and exists (select 1 from public.purchase_orders po where po.id = po_id)` (D6);
`revoke all … from public, anon, authenticated; grant select … to authenticated;`.

### S2.3 `subcontract_verified` (PQ-8)

```sql
create or replace function public.subcontract_verified(p_po_id uuid)
  returns table (boq_item_id uuid, quantity numeric, acceptance_id uuid, confirmed_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  select distinct on (l.boq_item_id) l.boq_item_id, l.quantity, a.id, a.confirmed_at
    from public.subcontract_acceptance_lines l
    join public.subcontract_acceptances a on a.id = l.acceptance_id
   where a.po_id = p_po_id and a.status = 'Confirmed'
   order by l.boq_item_id, a.confirmed_at desc, a.id desc
$$;
revoke all on function public.subcontract_verified(uuid) from public, anon;
grant execute on function public.subcontract_verified(uuid) to authenticated;
```

Only `Confirmed` rows count; Draft and Withdrawn never do (AC-SCA-009 is proven in S3 where it reaches payable).

### S2.4 `prepare_subcontract_acceptance`

Signature `(p_po_id uuid, p_acceptance_date date, p_lines jsonb, p_document_id uuid default null, p_note text default null, p_acceptance_id uuid default null) returns uuid`.
Body = `0337_…:201-248` with these replacements (each marked `-- 0443`):
- load `v_po` from `purchase_orders where id = p_po_id and org_id = v_org`; `v_project` from its procurement; lock the
  procurement row `for update`, then `perform public.subcontract_po_lock(p_po_id)` (D5);
- `if public.po_effective_revision(p_po_id) is null then raise exception 'the PO has no issued BoQ lines' using errcode = '42501'`;
- the "allocated to this work order" check reads `purchase_order_lines l where l.po_id = p_po_id and l.revision = public.po_effective_revision(p_po_id)`;
- no lump-sum and no `is_final` checks (OQ-5);
- FR-SCA-014: `if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric) join public.subcontract_verified(p_po_id) v on v.boq_item_id = x.boq_item_id where x.quantity < v.quantity) then raise exception 'a cumulative verified quantity cannot go below the last confirmed acceptance' using errcode = '23514'`;
- `may_record_project_progress(v_project)` gate kept verbatim (`0245_…:55`);
- audit action `subcontract_acceptance.prepare` with `{project_id, po_id}`.

### S2.5 `withdraw_` and `confirm_subcontract_acceptance`

`withdraw_subcontract_acceptance(p_id uuid) returns void` = `0337_…:250-265` with `po_id`, the procurement row lock then
`subcontract_po_lock`, audit `subcontract_acceptance.withdraw`.

`confirm_subcontract_acceptance(p_id uuid) returns uuid` = the head confirm (`0339_…:9-…`) reduced to: load and lock
(procurement row, `subcontract_po_lock`, acceptance row `for update`); require the PO has an effective revision;
`auth_role() in ('Admin','Finance')`; the sole-operator block **verbatim** from `0337_…:282-285`; the document check
**verbatim** from `0337_…:287-288`; re-check every line is on the effective revision (23514); re-check FR-SCA-014 against
`subcontract_verified(po)` (another acceptance may have confirmed since the draft was prepared); `update … set
status='Confirmed', confirmed_by=auth.uid(), confirmed_at=clock_timestamp(), confirm_basis=v_basis`; audit
`subcontract_acceptance.confirm` with `{project_id, po_id, basis}`; return `p_id`. No closing value, no work-order
billing calls (OQ-5).

All three: `revoke all … from public, anon; grant execute … to authenticated;`.

### S2.6 Closing assertion, rollback, 0178 (+3), denominator, gate, commit

As S1.7/S1.8 with `supabase/tests/subcontract_acceptances.test.sql`. Commit `feat(db): subcontract acceptance (#1513 S2)`.

---

## S3 - Bill lines, the cap, position read (`0444_subcontract_bill_caps.sql`) - ships alone (money path)

Covers AC-SCA-001, 004, 007, 008, 009, 014 and FR-SCA-020..024, NFR-SCA-001/002/004/005; PQ-4. Read
`docs/money-path-primer.md` "five things" #1 and #5 before starting. Header REVERSE: drop trigger
`procurement_invoices_zz_subcontract_capture`; drop `capture_subcontract_vendor_invoice(...)`,
`subcontract_po_position(uuid)`, `subcontract_bill_cap_violation(uuid,jsonb,uuid)`, `subcontract_billed(uuid,uuid)`,
`guard_subcontract_invoice_capture()`, `guard_procurement_invoice_line()`; refuse while rows exist, then drop `procurement_invoice_lines`.

### S3.1 Failing tests: caps (AC-SCA-001, 004, 008, 009 owning)

Create `supabase/tests/subcontract_bill_caps.test.sql` (new) = F1 + F2 + F3 and a helper:

```sql
create or replace function pg_temp.bill(p_l1 numeric, p_l2 numeric default null) returns uuid language sql as $$
  select (capture_subcontract_vendor_invoice(
    p_procurement_id => '15130000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
    p_amount => round(coalesce(p_l1,0) * 100000, 2) + round(coalesce(p_l2,0) * 40000, 2),
    p_tax_treatment => 'exclusive', p_tax_amount => 0,
    p_lines => (select jsonb_agg(x) from (
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e1','quantity',p_l1,'rate',100000) x where p_l1 is not null
      union all
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e2','quantity',p_l2,'rate',40000) where p_l2 is not null) s))).id
$$;
```

Then (each block uses `savepoint`/`rollback to savepoint` so blocks are independent):

```sql
-- AC-SCA-004: verified 80, PO 100.
savepoint s4;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 80, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select pg_temp.bill(90) $$, 'SC001', null, 'AC-SCA-004 a bill for 90 against verified 80 is refused (verified cap)');
select lives_ok($$ select pg_temp.bill(80) $$, 'AC-SCA-004 a bill for 80 is accepted');
reset role; rollback to savepoint s4;

-- AC-SCA-001: PO 100, verified 120.
savepoint s1;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 120, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_like($$ select pg_temp.bill(120) $$, '%L1%verified 120%PO 100%billed 0%',
  'AC-SCA-001 a bill for 120 is refused with SC001 naming verified 120, PO 100, billed 0');
select throws_ok($$ select pg_temp.bill(120) $$, 'SC001', null, 'AC-SCA-001 the refusal code is SC001');
select lives_ok($$ select pg_temp.bill(100) $$, 'AC-SCA-001 a bill for 100 is accepted');
select is((select payable from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  0::numeric, 'AC-SCA-001 payable now is 0 after it');
select is((select verified_not_on_po from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  20::numeric, 'AC-SCA-001 verified, not on PO = 20 remains visible');
reset role; rollback to savepoint s1;

-- AC-SCA-008: a cancelled bill releases its quantity.
savepoint s8;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 60, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(60);
reset role;
update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now()   -- the mirrored ERP cancel (shipped predicate)
 where procurement_id = '15130000-0000-0000-0000-0000000000f1';
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select is((select payable from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  60::numeric, 'AC-SCA-008 a cancelled bill''s quantity returns to payable');
select lives_ok($$ select pg_temp.bill(60) $$, 'AC-SCA-008 and can be billed again');
reset role; rollback to savepoint s8;

-- AC-SCA-009: Draft and Withdrawn acceptance quantities never raise payable.
savepoint s9;
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 10, null);
insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, withdrawn_at)
values ('15130000-0000-0000-0000-000000000301', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1',
        '15130000-0000-0000-0000-000000000101', current_date, 'Withdrawn', '15130000-0000-0000-0000-0000000000a4', now()),
       ('15130000-0000-0000-0000-000000000302', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1',
        '15130000-0000-0000-0000-000000000101', current_date, 'Draft', '15130000-0000-0000-0000-0000000000a4', null);
insert into subcontract_acceptance_lines values
  ('15130000-0000-0000-0000-000000000301', '15130000-0000-0000-0000-0000000000e1', 90),
  ('15130000-0000-0000-0000-000000000302', '15130000-0000-0000-0000-0000000000e1', 95);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select is((select payable from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  10::numeric, 'AC-SCA-009 only the latest Confirmed acceptance counts (Draft 95 and Withdrawn 90 do not)');
select throws_ok($$ select pg_temp.bill(11) $$, 'SC001', null, 'AC-SCA-009 a bill above the confirmed 10 is refused');
reset role; rollback to savepoint s9;
```

FR-tagged blocks in the same file:
- `FR-SCA-020` a plain `capture_vendor_invoice` on `…f1` as Fin1 → `throws_ok … 'SC002'` ("a subcontract bill must state its BoQ line quantities").
- `FR-SCA-023` a line at rate 100,001 → `23514`; amount ≠ Σ round(q×rate,2) → `23514`; an inclusive-tax bill whose
  `amount − tax_amount` equals the lines → accepted (OQ-8: the cap is on pre-tax lines).
- `FR-SCA-022 / NFR-SCA-004` as superuser `delete from purchase_order_revisions` is impossible (FK), so prove fail-closed with
  a PO whose revision exists but whose lines are removed via `alter table … disable trigger` inside the savepoint →
  `subcontract_bill_cap_violation(...)->>'reason' = 'unreadable_po_lines'` and the capture refuses `SC001`.
- `PQ-4` draft lines, no revision, on PO `…104` → capture `SC002`.
- `FR-SCA-021 D3` as superuser, `subcontract_bill_cap_violation(po, '[{L1,60},{L1,60}]', null)` with verified 100 →
  `->>'reason' = 'over_cap'` (summed, not checked row by row); with quantity `0` or `-1` → `'unreadable_input'`; the
  capture with L1 named twice → `23514`.
- `NFR-SCA-001` property: under `setseed(0.1513)`, 200 iterations of a random confirm (monotone) / random bill attempt
  (caught) / random cancel; after each step assert as superuser
  `not exists (select 1 from subcontract_po_position(po) where billed > least(verified, po_qty))` — one `ok(...)` at the end
  over a `bool_and` accumulated in a temp table.
- `NFR-SCA-005` `subcontract_po_position` on a PO the caller cannot see (Engineer, not requester) returns 0 rows, not a zero
  line; for the Engineer who **raised** the purchase (inside a savepoint, as superuser,
  `update procurements set requested_by_id = '…a5' where id = '…f1'`, so the Engineer sees the PO under 0350), after a bill of 60, the L1 row has
  `po_qty` 100 and `verified` 60 but `billed is null and payable is null` (D6: no bill money for Engineers, never a `0`
  from hidden rows).

Run → fails.

### S3.2 Failing test: concurrency mechanism and interleave (AC-SCA-007 owning)

Create `supabase/tests/subcontract_cap_concurrency.test.sql` (new) following `0151_timesheet_fence_concurrency.test.sql`
and `0163_automation_cap_race.test.sql` (dblink created **before** `begin`, dropped at the end):

```sql
create extension if not exists dblink;
begin;
create extension if not exists pgtap;
select plan(4);
-- F1 + F2 + one confirmed acceptance of L1 = 100; one bill of 90 already captured (headroom 10).
-- … F1/F2/F3 inserts, pg_temp.bill …
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 100, null);
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(90);
reset role;
select ok(pg_get_functiondef('public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text)'::regprocedure)
  ~ 'subcontract_po_lock\(.*\)[\s\S]*subcontract_bill_cap_violation', 'AC-SCA-007 the capture takes the PO lock before evaluating the cap');
-- second session holds the same advisory key
select dblink_connect('sca', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user, coalesce(inet_server_addr()::text, 'localhost'), inet_server_port()));
select dblink_exec('sca', 'begin');
select dblink('sca', $$ select pg_advisory_xact_lock(hashtextextended('subcontract-po:15130000-0000-0000-0000-000000000101', 0)) $$) as t(x text);
set local lock_timeout = '200ms';
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select pg_temp.bill(10) $$, '55P03', null, 'AC-SCA-007 a second capture blocks while another holds the PO''s headroom');
reset role;
select dblink_exec('sca', 'rollback');
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select pg_temp.bill(10) $$, 'AC-SCA-007 once released, exactly one capture of the last 10 succeeds');
select throws_ok($$ select pg_temp.bill(10) $$, 'SC001', null, 'AC-SCA-007 and the next one for the same 10 is refused');
reset role;
select dblink_disconnect('sca');
select * from finish();
rollback;
drop extension if exists dblink;
```

(Visibility: the advisory lock is a hash, so the second session needs no committed rows — the 0151 note.)

### S3.3 Failing test: the mutation check (AC-SCA-014 owning)

Create `supabase/tests/subcontract_cap_mutation.test.sql` (new) = F1 + F2 + F3, then as superuser inside the transaction:

```sql
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 80, null);
create or replace function public.subcontract_bill_cap_violation(p_po_id uuid, p_lines jsonb, p_exclude_invoice uuid)
  returns jsonb language sql stable as $$ select null::jsonb $$;      -- the mutant: allowed := true
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select pg_temp.bill(90) $$,
  'AC-SCA-014 with the cap mutated to always allow, AC-SCA-004''s refused bill (90 > verified 80) goes through — so the AC-SCA-004 test, which asserts its refusal, goes red');
select lives_ok($$ select pg_temp.bill(30) $$,
  'AC-SCA-014 and AC-SCA-001''s over-PO bill also goes through under the mutant (billed 120 > PO 100)');
select ok((select billed from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1') > 100,
  'AC-SCA-014 the mutant breaks the invariant billed ≤ min(verified, PO) — the cap lives in this one function only');
reset role;
```

`rollback` restores the real function. The point: the shipped refusal for AC-SCA-001/004 comes **only** from
`subcontract_bill_cap_violation` (D3); if a second unguarded path existed, the mutant would not change the outcome.

### S3.4 `procurement_invoice_lines`

```sql
create table public.procurement_invoice_lines (
  org_id uuid not null references public.organizations(id),
  invoice_id uuid not null references public.procurement_invoices(id),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  amount numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  attributed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (invoice_id, boq_item_id)
);
create index procurement_invoice_lines_boq_idx on public.procurement_invoice_lines (boq_item_id);
```

`guard_procurement_invoice_line()` (before insert/update/delete): stamp `org_id` from the invoice on INSERT; refuse
(42501) every UPDATE/DELETE and any INSERT unless `current_setting('pmo.subcontract_capture', true) = 'on'`. RLS:
select for active members where `exists (select 1 from public.procurement_invoices i where i.id = invoice_id)` (inherits
`procurement_invoices` read RLS, including the Engineer exclusion of `0350`). Select-only grant.

### S3.5 `subcontract_billed`, `subcontract_bill_cap_violation`

```sql
create or replace function public.subcontract_billed(p_po_id uuid, p_exclude_invoice uuid)
  returns table (boq_item_id uuid, quantity numeric)
  language sql stable security definer set search_path = public as $$
  select l.boq_item_id, sum(l.quantity)
    from public.procurement_invoice_lines l
    join public.procurement_invoices i on i.id = l.invoice_id
   where i.po_id = p_po_id
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null      -- shipped "not cancelled" (0373 create_payment)
     and (p_exclude_invoice is null or i.id <> p_exclude_invoice)
   group by l.boq_item_id
$$;
revoke all on function public.subcontract_billed(uuid, uuid) from public, anon, authenticated;

create or replace function public.subcontract_bill_cap_violation(p_po_id uuid, p_lines jsonb, p_exclude_invoice uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rev integer; v_bad record;
begin
  if p_po_id is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric)
                 where x.boq_item_id is null or x.quantity is null or not (x.quantity > 0 and x.quantity < 'Infinity'::numeric)) then
    return jsonb_build_object('reason', 'unreadable_input');                                  -- D3: the cap validates its own input
  end if;
  v_rev := public.po_effective_revision(p_po_id);
  if v_rev is null then return jsonb_build_object('reason', 'no_issued_lines'); end if;
  if not exists (select 1 from public.purchase_order_lines where po_id = p_po_id and revision = v_rev) then
    return jsonb_build_object('reason', 'unreadable_po_lines');
  end if;
  select x.boq_item_id, b.item_code, x.quantity as requested, pl.quantity as po_qty,
         coalesce(v.quantity, 0) as verified, coalesce(bl.quantity, 0) as billed
    into v_bad
    from (select r.boq_item_id, sum(r.quantity) as quantity                                 -- D3: a line named twice counts twice
            from jsonb_to_recordset(p_lines) r(boq_item_id uuid, quantity numeric) group by r.boq_item_id) x
    left join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
    left join public.boq_items b on b.id = x.boq_item_id
    left join (select * from public.subcontract_verified(p_po_id)) v on v.boq_item_id = x.boq_item_id
    left join (select * from public.subcontract_billed(p_po_id, p_exclude_invoice)) bl on bl.boq_item_id = x.boq_item_id
   where pl.boq_item_id is null
      or coalesce(bl.quantity, 0) + x.quantity > least(coalesce(v.quantity, 0), pl.quantity)
   order by b.item_code nulls first
   limit 1;
  if not found then return null; end if;
  if v_bad.po_qty is null then
    return jsonb_build_object('reason', 'line_not_on_po', 'boq_item_id', v_bad.boq_item_id);
  end if;
  return jsonb_build_object('reason', 'over_cap', 'boq_item_id', v_bad.boq_item_id, 'item_code', v_bad.item_code,
    'verified', v_bad.verified, 'po_qty', v_bad.po_qty, 'billed', v_bad.billed, 'requested', v_bad.requested);
end $$;
revoke all on function public.subcontract_bill_cap_violation(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.subcontract_bill_cap_violation(uuid, jsonb, uuid) to service_role;
```

`subcontract_verified` is invoker; called inside this definer it reads as the owner, which is intended (the cap must see
every confirmed row regardless of the caller's RLS).

### S3.6 `capture_subcontract_vendor_invoice` and the capture guard

```sql
create or replace function public.capture_subcontract_vendor_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date, p_lines jsonb,
  p_reference_number text default null, p_amount numeric default null, p_notes text default null,
  p_tax_treatment text default null, p_tax_amount numeric default null, p_tax_rate numeric default null,
  p_tax_template text default null, p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null, p_withheld_amount numeric default 0, p_withheld_pph_type text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_proc public.procurements; v_po uuid; v_rev integer; v_v jsonb; v_net numeric; v_lines_net numeric;
        v_inv public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select * into v_proc from public.procurements where id = p_procurement_id and org_id = public.auth_org_id() for update;
  if not found then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  select r.po_id into v_po from public.purchase_order_revisions r where r.procurement_id = p_procurement_id and r.revision = 1;
  if not v_proc.is_subcontract or v_po is null then
    raise exception 'this purchase has no issued BoQ lines; capture the bill without lines' using errcode = 'SC002';
  end if;
  perform public.subcontract_po_lock(v_po);                                                          -- D5, AC-SCA-007
  v_rev := public.po_effective_revision(v_po);
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric)
              left join public.purchase_order_lines pl on pl.po_id = v_po and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
              where pl.boq_item_id is null or x.rate is null or x.rate > pl.rate or x.rate <> round(x.rate, 2)
                 or x.quantity is null or x.quantity <= 0 or x.quantity <> round(x.quantity, 3))
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid) group by x.boq_item_id having count(*) > 1) then
    raise exception 'each bill line must be a distinct BoQ line of this PO at no more than the PO rate' using errcode = '23514'; -- FR-SCA-023
  end if;
  if v_proc.status::text in ('Cancelled','Rejected') then                                            -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501';
  end if;
  v_v := public.subcontract_bill_cap_violation(v_po, p_lines, null);
  if v_v is not null then
    if v_v->>'reason' = 'over_cap' then
      raise exception 'line % cannot be billed: verified %, PO %, billed %, this bill %',
        v_v->>'item_code', v_v->>'verified', v_v->>'po_qty', v_v->>'billed', v_v->>'requested' using errcode = 'SC001';
    end if;
    raise exception 'the bill cap could not be evaluated (%); the bill is refused', v_v->>'reason' using errcode = 'SC001';
  end if;
  select coalesce(sum(round(x.quantity * x.rate, 2)), 0) into v_lines_net
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  v_net := case when btrim(p_tax_treatment) = 'inclusive' then p_amount - p_tax_amount else p_amount end;
  if v_net is distinct from v_lines_net then
    raise exception 'the bill''s pre-tax amount % must equal its lines %', v_net, v_lines_net using errcode = '23514';
  end if;
  perform set_config('pmo.subcontract_capture', 'on', true);
  v_inv := public.capture_vendor_invoice(p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount, p_notes,
    p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator,
    p_external_ref, p_withheld_amount, p_withheld_pph_type);
  update public.procurement_invoices set po_id = v_po where id = v_inv.id;
  insert into public.procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate)
  select v_inv.id, x.boq_item_id, x.quantity, x.rate from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  perform set_config('pmo.subcontract_capture', '', true);
  perform public.log_audit('procurement_invoice.subcontract_lines', v_proc.org_id, auth.uid(), v_inv.id,
    jsonb_build_object('po_id', v_po, 'revision', v_rev, 'lines', p_lines));
  select * into v_inv from public.procurement_invoices where id = v_inv.id;
  return v_inv;
end $$;
revoke all on function public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text) from public, anon;
grant execute on function public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text) to authenticated;
```

Role and SoD come from the wrapped `capture_vendor_invoice` → `transition_procurement` (`0273_…:292`), unchanged
("cap enforced regardless of role", spec § Roles). The `update … set po_id` runs as the definer owner; the client
update grant on `procurement_invoices` is not involved (`0175_update_path_sod_class.sql:152`). If the worker finds
another trigger refusing the `po_id` update, it stops and reports — it does not loosen that trigger.

Capture guard (closes every other user path, FR-SCA-020, PQ-4):

```sql
create or replace function public.guard_subcontract_invoice_capture() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null then return new; end if;            -- seed/migration and the service-role mirror: see S5 (OQ-10)
  if coalesce(current_setting('pmo.subcontract_capture', true), '') = 'on' then return new; end if;
  if exists (select 1 from public.procurements p where p.id = new.procurement_id and p.is_subcontract)
     and (exists (select 1 from public.purchase_order_revisions r where r.procurement_id = new.procurement_id)
          or exists (select 1 from public.purchase_order_lines l join public.purchase_orders o on o.id = l.po_id
                      where o.procurement_id = new.procurement_id)) then
    raise exception 'a subcontract bill must state its BoQ line quantities' using errcode = 'SC002';
  end if;
  return new;
end $$;
revoke all on function public.guard_subcontract_invoice_capture() from public, anon, authenticated;
create trigger procurement_invoices_zz_subcontract_capture before insert on public.procurement_invoices
  for each row execute function public.guard_subcontract_invoice_capture();
```

### S3.7 `subcontract_po_position` (FR-SCA-050 data, NFR-SCA-005)

```sql
create or replace function public.subcontract_po_position(p_po_id uuid)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, revision integer,
                 po_qty numeric, verified numeric, billed numeric, payable numeric, verified_not_on_po numeric,
                 verified_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  with rev as (select public.po_effective_revision(p_po_id) as r),
  bl as (select l.boq_item_id, sum(l.quantity) q from public.procurement_invoice_lines l
           join public.procurement_invoices i on i.id = l.invoice_id
          where i.po_id = p_po_id and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
          group by l.boq_item_id)
  money as (select public.auth_role() in ('Admin','Executive','Project Manager','Finance') as ok)  -- D6 / 0350 ruling
  select pl.boq_item_id, b.item_code, b.description, pl.unit, pl.rate, pl.revision, pl.quantity,
         coalesce(v.quantity, 0),
         case when money.ok then coalesce(bl.q, 0) end,
         case when money.ok then greatest(least(coalesce(v.quantity, 0), pl.quantity) - coalesce(bl.q, 0), 0) end,
         greatest(coalesce(v.quantity, 0) - pl.quantity, 0),
         v.confirmed_at
    from rev cross join money join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = rev.r
    join public.boq_items b on b.id = pl.boq_item_id
    left join public.subcontract_verified(p_po_id) v on v.boq_item_id = pl.boq_item_id
    left join bl on bl.boq_item_id = pl.boq_item_id
   order by b.line_no nulls last, b.item_code
$$;
revoke all on function public.subcontract_po_position(uuid) from public, anon;
grant execute on function public.subcontract_po_position(uuid) to authenticated;
```

Invoker: a caller who cannot see the PO gets no rows (never a fabricated 0 line); a caller outside the four
invoice-reading roles gets `billed`/`payable` as `null` (rendered "—", not `0`). One PO's lines are a BoQ subset,
far below `max_rows` (1000); the FE asserts `rows.length < 1000` and errors otherwise (S6.3). `verified_at` feeds the
OQ-7 age display.

### S3.8 Closing assertion, rollback, 0178 (+1), denominator

As S1.7: `procurement_invoice_lines` FORCE RLS, no client DML; `subcontract_bill_cap_violation`, `subcontract_billed`,
both guards not executable by `authenticated`.

### S3.9 Gate and commit

Slice gate with `subcontract_bill_caps.test.sql`, `subcontract_cap_concurrency.test.sql`, `subcontract_cap_mutation.test.sql`,
plus the shipped neighbours that call the wrapped path: `supabase/tests/spend_approval_enforce.test.sql` and every
`supabase/tests/*vendor_invoice*.test.sql` (`ls supabase/tests | grep -i vendor_invoice`). Commit
`feat(db): subcontract bill caps (#1513 S3)`.

---

## S4 - Variations, revisions, client link, tenancy (`0445_po_variations.sql`) - ships alone (money + SoD)

Covers AC-SCA-002, 003, 005, 010, 013 and FR-SCA-030..036, 040..041; PQ-5..7. Header REVERSE: drop
`project_subcontract_exposure(uuid)`; drop and re-create `subcontract_po_position(uuid)` from S3; drop
`link_po_variation(uuid,uuid,text)`, `issue_po_revision(uuid)`, `decide_po_variation(uuid,boolean,text)`,
`request_po_variation(uuid,text,jsonb,text)`; `alter table purchase_order_revisions drop constraint purchase_order_revisions_variation_fk`;
refuse while rows exist, then drop `po_variation_lines`, `po_variations`; drop guard functions. (`amount_approved_by_id` is a shipped column; nothing to undo.)

### S4.1 Failing tests: variation route, SoD, revision (AC-SCA-002, 003, 005 owning)

Create `supabase/tests/po_variations.test.sql` (new) = F1 + F2 + F3 and, as superuser, an Active budget on project d1 with
a `Subcontractors` line of 13,000,000 (columns as `spend_approval_enforce.test.sql:62-79`: insert the version Draft, its
line, then `update budget_versions set status='Active'`), and `spend_approvers (org_id a, project_id null, profile_id …a6)`
and `(org_id a, project_id null, profile_id …a3)` (the Executive and Fin2 are the senior set; Fin2 is there so the
issuer ≠ approver refusal is reached by a user who holds the issuing role, not refused earlier on role). The purchase already commits 12,000,000 on that line, so 1,000,000 of headroom remains.

```sql
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 120, null);   -- verified 120 > PO 100
set local role authenticated;

-- AC-SCA-002: post-work variation for the 20, rejected → Disputed; bill for 101 refused.
savepoint s2;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select lives_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'post_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Extra excavation found on site') $$,
  'FR-SCA-034 the PM opens a variation from the verified, not on PO 20');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a6');
select lives_ok($$ select decide_po_variation((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101'), false, 'Not agreed') $$,
  'AC-SCA-002 the approver rejects it');
select is((select status from po_variations where po_id = '15130000-0000-0000-0000-000000000101'), 'Disputed',
  'AC-SCA-002 a rejected post-work variation is Disputed');
select is((select disputed from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  20::numeric, 'AC-SCA-002 the 20 shows Disputed');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select pg_temp.bill(101) $$, 'SC001', null, 'AC-SCA-002 a bill for 101 is refused');
rollback to savepoint s2;

-- AC-SCA-005: pre-work variation above the budget line headroom → senior set; requester cannot approve.
savepoint s5;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');   -- Fin1 requests 20 × 100,000 = 2,000,000 > 1,000,000 headroom
select lives_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Design change') $$,
  'FR-SCA-030 a variation request is raised');
select is((select route || '/' || reason from po_variation_route((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101'))),
  'org/exceeds_line', 'AC-SCA-005 a variation that exceeds the budget line routes to the senior set (shipped rule: route org, reason exceeds_line)');
select throws_like($$ select decide_po_variation((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101'), true, null) $$,
  '%separation of duties%', 'AC-SCA-005 the requester cannot approve it');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_like($$ select decide_po_variation((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101'), true, null) $$,
  '%requires a named approver%', 'AC-SCA-005 a PM outside the senior set cannot approve it');
rollback to savepoint s5;

-- AC-SCA-003: approved variation to 120, revision 2 issued; bill for the remaining 20 accepted; each SoD refusal proven.
savepoint s3;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(100);
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'post_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":20}]', 'Extra excavation');
select throws_like($$ select decide_po_variation((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101'), true, null) $$,
  '%separation of duties%', 'AC-SCA-003 requester ≠ approver is refused');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');   -- Fin2, in the senior set
select lives_ok($$ select decide_po_variation((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101'), true, 'Agreed') $$,
  'AC-SCA-003 the senior approver approves');
select throws_like($$ select issue_po_revision((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101')) $$,
  '%separation of duties%', 'AC-SCA-003 issuer ≠ approver is refused');
select throws_like($$ select transition_procurement('15130000-0000-0000-0000-0000000000f1', 'Paid') $$,
  '%approver cannot pay%', 'AC-SCA-003 the variation''s approver cannot pay the purchase (SoD-b, PQ-5)');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');   -- Fin1, not the approver
select is(issue_po_revision((select id from po_variations where po_id = '15130000-0000-0000-0000-000000000101')), 2,
  'AC-SCA-003 Fin1 issues revision 2');
select is((select po_qty from subcontract_po_position('15130000-0000-0000-0000-000000000101') where item_code = 'L1'),
  120::numeric, 'FR-SCA-033 the cap uses the new PO quantity immediately');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select pg_temp.bill(20) $$, 'AC-SCA-003 a bill for the remaining 20 is accepted');
select is((select amount from purchase_orders where id = '15130000-0000-0000-0000-000000000101'), 14000000::numeric,
  'FR-SCA-032 the PO amount follows revision 2');
rollback to savepoint s3;
```

The approval in AC-SCA-003 is 2,000,000 against 1,000,000 headroom, so it routes `senior` and the Executive is the named
approver — the same path AC-SCA-005 proves for refusals. FR-tagged blocks in the same file:
`FR-SCA-031` a 500,000 pre-work variation (5 × 100,000) fits → reason `within_budget`, route `flat` (no project
approvers configured; the shipped route values are `flat` / `project` / `org` / `admin`, `0247_expense_claims.sql:618-648`); `FR-SCA-032` a revision on a
Requested variation → 42501; `FR-SCA-034` a post-work variation above verified-not-on-PO (21) → 23514; `PQ-5` after
approval `procurements.total_value` and `approved_total_value` = 14,000,000 and `spend_approval_route(... , 'Subcontractors', 1, …)`
reports `line_used` 14,000,000; `PQ-5` the totals survive a later bill insert (no refresh trigger rewrites them);
`FR-SCA-036` (org S, PO `…109`): the sole member requests a variation and cannot approve it
(`'%separation of duties%'`; requester ≠ approver has no sole-operator exception, as `transition_procurement`
`0362_…:207-210`); then, as superuser, add a second active member `…c2` (Finance) to org S who requests a second variation,
the sole original member `…c1` approves it, `…c2` is set `disabled`, and `…c1` — now the approver **and** the sole active
member — issues the revision: `lives_ok` and `issue_basis = 'sole_operator'`; with `…c2` still active the same issue is
refused `'%separation of duties%'`; `NFR-SCA-006` every request/approve/reject/revise/link wrote an audit row.

### S4.2 Failing tests: client link (AC-SCA-010 owning)

Append to `po_variations.test.sql`, with work orders inserted as superuser: `…401` on project d1 (Issued) and `…402` on
project d2:

```sql
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","additional_quantity":5}]', 'Client asked for more piping');
select throws_ok($$ select link_po_variation((select id from po_variations where reason = 'Client asked for more piping'),
  '15130000-0000-0000-0000-000000000402', null) $$, '23514', null, 'AC-SCA-010 a work order on another project is refused');
select lives_ok($$ select link_po_variation((select id from po_variations where reason = 'Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401', null) $$, 'AC-SCA-010 a same-project work order is accepted');
select is((select work_order_id from po_variations where reason = 'Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401'::uuid, 'AC-SCA-010 shown on the variation');
select is((select count(*)::int from work_order_cost_variations('15130000-0000-0000-0000-000000000401')), 1,
  'AC-SCA-010 and shown on the work order');
select throws_ok($$ select link_po_variation((select id from po_variations where reason = 'Client asked for more piping'),
  null, '  ') $$, '23514', null, 'AC-SCA-010 "not passed on" requires a reason');
select lives_ok($$ select link_po_variation((select id from po_variations where reason = 'Client asked for more piping'),
  null, 'Absorbed as our risk') $$, 'AC-SCA-010 "not passed on" with a reason is accepted and replaces the link');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select link_po_variation((select id from po_variations where reason = 'Client asked for more piping'),
  '15130000-0000-0000-0000-000000000401', null) $$, '42501', null, 'FR-SCA-040 an Engineer cannot link');
select is((select status::text from work_orders where id = '15130000-0000-0000-0000-000000000401'), 'Issued',
  'FR-SCA-041 linking never changes the work order');
```

### S4.3 Failing test: tenancy isolation (AC-SCA-013 owning)

Create `supabase/tests/subcontract_tenancy.test.sql` (new) = F1 + F2 + F3 + one Requested variation `…501` on `…101`
(with one line), work order `…401` on d1 linked to it, and one bill line (inserted as superuser with
`set_config('pmo.subcontract_capture','on',true)` and `set_config('pmo.po_variation_write','on',true)`), then as org B's
Admin (the `attribute_subcontract_bill_lines` cross-org refusal is added to this file in S5):

```sql
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from subcontract_acceptances), 0, 'AC-SCA-013 org B reads none of org A''s acceptances');
select is((select count(*)::int from subcontract_acceptance_lines), 0, 'AC-SCA-013 … nor their lines');
select is((select count(*)::int from purchase_order_lines), 0, 'AC-SCA-013 … nor PO lines');
select is((select count(*)::int from purchase_order_revisions), 0, 'AC-SCA-013 … nor revisions');
select is((select count(*)::int from po_variations), 0, 'AC-SCA-013 … nor variations');
select is((select count(*)::int from po_variation_lines), 0, 'AC-SCA-013 … nor variation lines');
select is((select count(*)::int from procurement_invoice_lines), 0, 'AC-SCA-013 … nor bill lines');
select is((select count(*)::int from subcontract_po_position('15130000-0000-0000-0000-000000000101')), 0,
  'AC-SCA-013 … and the position read returns nothing');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]') $$, 'P0002', null,
  'AC-SCA-013 org B cannot write against org A''s PO');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'x') $$, 'P0002', null,
  'AC-SCA-013 org B cannot raise a variation on org A''s PO');
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":100000}]', p_amount => 100000,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, 'P0002', null, 'AC-SCA-013 org B cannot bill against org A''s purchase');
select throws_ok($$ select decide_po_variation((select id from po_variations limit 1), true, null) $$, 'P0002', null,
  'AC-SCA-013 org B cannot decide org A''s variation (it reads none, so the id is null → not found)');
select throws_ok($$ select decide_po_variation('15130000-0000-0000-0000-000000000501', true, null) $$, 'P0002', null,
  'AC-SCA-013 … nor by its known id');
select throws_ok($$ select issue_po_revision('15130000-0000-0000-0000-000000000501') $$, 'P0002', null,
  'AC-SCA-013 … nor issue its revision');
select throws_ok($$ select link_po_variation('15130000-0000-0000-0000-000000000501', null, 'x') $$, 'P0002', null,
  'AC-SCA-013 … nor link it');
select is((select count(*)::int from work_order_cost_variations('15130000-0000-0000-0000-000000000401')), 0,
  'AC-SCA-013 … and reads no cost variation on org A''s work order');
-- an offboarded org-A member reads nothing
reset role; update profiles set status = 'disabled' where id = '15130000-0000-0000-0000-0000000000a3'; set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from subcontract_acceptances), 0, 'AC-SCA-013 a disabled member reads no acceptances');
```

### S4.4 Tables and guards

```sql
create table public.po_variations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  po_id uuid not null references public.purchase_orders(id),
  procurement_id uuid not null references public.procurements(id),
  project_id uuid not null references public.projects(id),
  number text not null,
  origin text not null check (origin in ('pre_work','post_work')),
  status text not null default 'Requested' check (status in ('Requested','Approved','Revised','Rejected','Disputed')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  amount numeric(14,2) not null check (amount >= 0),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default clock_timestamp(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decided_notes text check (decided_notes is null or length(decided_notes) <= 1000),
  revision integer,
  work_order_id uuid references public.work_orders(id),
  not_passed_reason text check (not_passed_reason is null or length(btrim(not_passed_reason)) between 1 and 500),
  linked_by uuid references public.profiles(id),
  linked_at timestamptz,
  constraint po_variations_link_one check (work_order_id is null or not_passed_reason is null),
  constraint po_variations_approved_pair check ((status in ('Approved','Revised')) = (approved_by is not null and approved_at is not null)),
  constraint po_variations_rejected_origin check (status <> 'Disputed' or origin = 'post_work'),
  constraint po_variations_rejected_pre check (status <> 'Rejected' or origin = 'pre_work'),
  unique (org_id, number)
);
create index po_variations_po_idx on public.po_variations (po_id, status);
create index po_variations_project_idx on public.po_variations (org_id, project_id, status);
create index po_variations_work_order_idx on public.po_variations (work_order_id);
create table public.po_variation_lines (
  variation_id uuid not null references public.po_variations(id),
  boq_item_id uuid not null references public.boq_items(id),
  additional_quantity numeric(14,3) not null check (additional_quantity > 0 and additional_quantity < 'Infinity'::numeric),
  rate numeric(14,2) not null check (rate >= 0),
  amount numeric(14,2) generated always as (round(additional_quantity * rate, 2)) stored,
  primary key (variation_id, boq_item_id)
);
alter table public.purchase_order_revisions add constraint purchase_order_revisions_variation_fk
  foreign key (variation_id) references public.po_variations(id);
```

Writes only through the four definers: a `before update or delete` guard on `po_variations` refuses unless
`current_setting('pmo.po_variation_write', true) = 'on'` (42501); `po_variation_lines` refuses every UPDATE/DELETE and any
INSERT outside the same flag. RLS read as D6 through `purchase_orders`; lines through the header; select-only grants.
Number: `next_procurement_doc_number(org, 'VAR')` (the shipped counter, used by every procurement record).

### S4.5 `request_po_variation` and `po_variation_route`

`request_po_variation(p_po_id uuid, p_origin text, p_lines jsonb, p_reason text) returns uuid`:
active member; PO in caller's org (else P0002); procurement row `for update`; `subcontract_po_lock`; closed purchase
refused (PQ-12); require an effective revision (42501); FR-SCA-030 "any project member" = any active member of the org
who can read the purchase, stated as D6's explicit predicate (RLS does not apply inside this definer):
`if not (public.auth_role() in ('Admin','Executive','Project Manager','Finance') or v_proc.requested_by_id = auth.uid()) then
raise exception 'purchase order not found' using errcode = 'P0002'; end if;` (the same answer as a PO in another org, so
the refusal does not confirm the PO exists). S4.1 adds: `FR-SCA-030` an Engineer who did not raise the purchase → P0002;
inside a savepoint with `requested_by_id` set to the Engineer → `lives_ok`. Lines: each on the effective revision (23514), positive, 3 dp, no duplicates;
rate copied from the effective line; for `post_work` each `additional_quantity` ≤ that line's `verified_not_on_po` minus
quantity already on other `Requested`/`Approved` post-work variations for the line (23514, FR-SCA-034); amount =
Σ round(q × rate, 2). Insert under the write flag; audit `po_variation.request`.

`po_variation_route(p_id uuid)` (invoker read for the UI and tests; `revoke all … from public, anon; grant execute … to
authenticated`) returns the row of
`public.spend_approval_route(v.org_id, p.project_id, p.budget_category, v.amount, p.currency, v.requested_by, nullif(auth.uid(), v.requested_by), v.requested_at)`
— a call, never a copy (ADR-0075 §3, D1); the decider is the viewer unless the viewer is the requester, exactly as
`get_procurement_approval_routes` (`0243_…:310-326`). Route values are `flat` / `project` / `org` / `admin`; "senior set"
is route `org`.

### S4.6 `decide_po_variation`

```sql
create or replace function public.decide_po_variation(p_id uuid, p_approve boolean, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare v public.po_variations; v_proc public.procurements; v_route record; v_uid uuid := auth.uid();
        v_role user_role := public.auth_role(); v_is_admin boolean := (public.auth_role() = 'Admin');
begin
  perform public.assert_is_active_member();
  select * into v from public.po_variations where id = p_id and org_id = public.auth_org_id();
  if not found then raise exception 'variation not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v.procurement_id for update;                  -- D5 1
  if v_proc.project_id is not null and v_proc.budget_category is not null then                           -- D5 2 (0362_…:226)
    perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_proc.project_id::text || ':' || v_proc.budget_category::text, 0));
  end if;
  perform public.subcontract_po_lock(v.po_id);                                                           -- D5 3
  select * into v from public.po_variations where id = p_id for update;
  if v.status <> 'Requested' then raise exception 'only a Requested variation can be decided' using errcode = '42501'; end if;
  if v_uid = v.requested_by then                                                                         -- outside the Admin skip (OD-PROC-8)
    raise exception 'separation of duties: the requester cannot approve or reject their own variation' using errcode = '42501';
  end if;
  select * into v_route from public.spend_approval_route(v.org_id, v_proc.project_id, v_proc.budget_category, v.amount,
           v_proc.currency, v.requested_by, v_uid, v.requested_at);
  if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin and not coalesce(v_uid = any (v_route.approver_ids), false) then
    if v_route.route = 'admin' then
      raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
    end if;
    raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
  end if;
  if not v_is_admin and v_role::text not in ('Project Manager','Finance','Executive') then
    raise exception 'not authorized to decide a variation' using errcode = '42501';
  end if;
  perform set_config('pmo.po_variation_write', 'on', true);
  if p_approve then
    update public.po_variations set status = 'Approved', approved_by = v_uid, approved_at = clock_timestamp(),
           decided_by = v_uid, decided_at = clock_timestamp(), decided_notes = nullif(btrim(p_notes), '') where id = p_id;
    update public.procurements set total_value = total_value + v.amount,                                   -- PQ-5
           approved_total_value = case when approved_total_value is null then null else approved_total_value + v.amount end,
           amount_approved_by_id = v_uid,                                  -- PQ-5: SoD-b now covers the variation's approver
           updated_at = now() where id = v.procurement_id;
  else
    update public.po_variations set status = case when v.origin = 'post_work' then 'Disputed' else 'Rejected' end,
           decided_by = v_uid, decided_at = clock_timestamp(), decided_notes = nullif(btrim(p_notes), '') where id = p_id;
  end if;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit(case when p_approve then 'po_variation.approve' else 'po_variation.reject' end, v.org_id, v_uid, p_id,
    jsonb_build_object('route', v_route.route, 'reason', v_route.reason, 'amount', v.amount, 'line_budget', v_route.line_budget,
      'line_used', v_route.line_used, 'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
        and not coalesce(v_uid = any (v_route.approver_ids), false))));
end $$;
revoke all on function public.decide_po_variation(uuid, boolean, text) from public, anon;
grant execute on function public.decide_po_variation(uuid, boolean, text) to authenticated;
```

The route check copies `transition_procurement`'s **refusal shape** (`0362_…:227-237`) so both surfaces say the same
thing; the routing **decision** is the shipped function. The `procurements` update runs as the definer, which
`guard_procurement_approved_total` admits (`0368_…:54-58`, `actor_bypasses_rls()`), as does
`assert_procurement_routing_inputs_frozen` for `total_value` (`0243_…:514-518`). Stamping `amount_approved_by_id` puts
the variation's approver under approver ≠ payer on the Paid guard, the outbox claim and the edge payment gate with no
change to any of them (PQ-5); AC-SCA-003 proves it (the approver's `transition_procurement(…, 'Paid')` is refused).

### S4.7 `issue_po_revision` and `link_po_variation`

`issue_po_revision(p_variation_id uuid) returns integer`: active member; variation in org (P0002); procurement row
`for update`, `subcontract_po_lock(po)`; closed purchase refused (PQ-12); in a connected org
(`public.domain_externally_owned(org, 'procurement')`) refuse `42501` with `detail = 'erp_revise_pending'` (PQ-11, lifted
by #1505; S4.1 adds `PQ-11 a connected org cannot issue a PO revision before the ERP revise exists` flipping the org as superuser
inside a savepoint with `insert into external_domain_ownership (org_id, external_tier, domain) values (org a, 'erpnext',
'procurement')`, the fixture of `0273_vendor_tax_accounts_native_withholding.test.sql:148`); variation `for update`, status `Approved` (42501); role in
`('Admin','Finance','Project Manager')` (42501); SoD: `if auth.uid() = v.approved_by` then the 0337 sole-operator predicate
(`0337_…:283`) must hold, else `raise 'separation of duties: the variation''s approver cannot issue its PO revision'`
(42501), basis `sole_operator` when it holds; `v_new := po_effective_revision(po) + 1`; insert lines
`select po_id, v_new, l.boq_item_id, l.quantity + coalesce(vl.additional_quantity, 0), l.rate, l.unit from purchase_order_lines l left join po_variation_lines vl on vl.variation_id = p_variation_id and vl.boq_item_id = l.boq_item_id where l.po_id = po and l.revision = v_new - 1`;
check `sum(new.amount) - sum(prev.amount) = v.amount` (23514, FR-SCA-032 — never above the approved amount); insert the
revision row `(v_new, total, variation_id, issued_by, issue_basis)`; set PO amount under `pmo.subcontract_po_amount`;
variation `status = 'Revised', revision = v_new` under the write flag; audit `purchase_order_revision.issue`. Return `v_new`.

`link_po_variation(p_variation_id uuid, p_work_order_id uuid, p_not_passed_reason text) returns void`: active member;
role in `('Admin','Finance','Project Manager')` (PQ-7) else 42501; exactly one of the two arguments (23514 otherwise,
including a blank reason); a work order must have `project_id = v.project_id and org_id = v.org_id` (23514); writes
`work_order_id`, `not_passed_reason`, `linked_by`, `linked_at` (replacing an earlier link) under the write flag; audit
`po_variation.link`. Never touches `work_orders`, claims or invoices (FR-SCA-041).

`work_order_cost_variations(p_work_order_id uuid)` (invoker) returns `id, number, status, amount, po_id` of variations
linked to it — the "shown on the work order" read.

All client RPCs: `revoke all … from public, anon; grant execute … to authenticated;`.

### S4.8 Position with Disputed, project exposure (FR-SCA-035)

`drop function public.subcontract_po_position(uuid);` and re-create it (S3 body verbatim, re-granted as in S3.7) with one
more output column, `disputed numeric`, from one more CTE:

```sql
  dsp as (select l.boq_item_id, sum(l.additional_quantity) q
            from public.po_variations v join public.po_variation_lines l on l.variation_id = v.id
           where v.po_id = p_po_id and v.status = 'Disputed'
           group by l.boq_item_id)
  -- select list, after verified_not_on_po:
  --   least(greatest(coalesce(v.quantity, 0) - pl.quantity, 0), coalesce(dsp.q, 0)) as disputed
  -- from list: left join dsp on dsp.boq_item_id = pl.boq_item_id
```

Because `verified_not_on_po` falls as soon as a later variation's revision raises the PO quantity, `least(...)` shrinks
the Disputed figure by what is now on the PO (PQ-6) with no second subtraction.

```sql
create or replace function public.project_subcontract_exposure(p_project_id uuid)
  returns table (currency text, verified_not_on_po_value numeric, disputed_value numeric, oldest_unresolved_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  select p.currency,
         sum(round(x.verified_not_on_po * x.rate, 2)),
         sum(round(x.disputed * x.rate, 2)),
         min(x.verified_at) filter (where x.verified_not_on_po > 0)
    from public.procurements p
    join public.purchase_order_revisions r on r.procurement_id = p.id and r.revision = 1
    cross join lateral public.subcontract_po_position(r.po_id) x
   where p.project_id = p_project_id and p.is_subcontract
   group by p.currency
$$;
```

Per currency (no cross-currency sums, as `project_committed_spend` `0373_…:351-369`). Bounded by the number of
subcontract POs on one project. Add to `po_variations.test.sql`: `FR-SCA-035` after S4.1's s2 block (before rollback),
`project_subcontract_exposure(d1)` returns `(IDR, 2000000, 2000000, <confirmed_at>)`.

### S4.9 Closing assertion, rollback, 0178 (+4), denominator, gate, commit

As S1.7 for `po_variations`, `po_variation_lines`; the four RPCs into 0178 and the denominator. Gate files:
`po_variations.test.sql`, `subcontract_tenancy.test.sql`, `subcontract_bill_caps.test.sql` (position re-created),
`spend_approval_enforce.test.sql`. Commit `feat(db): PO variations, revisions and client link (#1513 S4)`.

---

## S5 - ERP guards, OQ-10, `purchase-order.revise` contract (`0446_subcontract_erp_guards.sql`) - ships alone

Covers AC-SCA-011, 012, FR-SCA-022, OQ-9, OQ-10, PQ-9, PQ-10. Read `docs/money-path-primer.md` in full, ADR-0058 §3 and
the C-1 invariant before starting. Both re-created functions are head bodies today (`procurement_create_refusal` only in
0373, `procurement_payment_allowed` only in 0368; re-grep `create (or replace )?function public.<name>` after rebasing in
case a sibling slice re-created one). Header REVERSE: restore `procurement_create_refusal` from `0373_…:20-62` and
`procurement_payment_allowed` from `0368_…:18-45`; drop `attribute_subcontract_bill_lines(uuid,jsonb)`,
`subcontract_cap_exceptions(uuid)`, `po_revision_push_refusal(uuid,uuid,integer,boolean)`.

### S5.1 Failing pgTAP: connected-mode refusals and OQ-10

Create `supabase/tests/subcontract_erp_guards.test.sql` (new) = F1 + F2 + F3 (verified L1 = 60), then as superuser
(service-role semantics: `set local request.jwt.claims = '{"role":"service_role"}'`) insert an ERP-origin bill on `…f1`
with no lines (`amount` 8,000,000, `po_id` null, `erp_docstatus` 1):

```sql
select is(procurement_create_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1',
  'purchase-invoice', '15130000-0000-0000-0000-0000000000a2'), 'subcontract_bill_lines_required',
  'FR-SCA-022 PQ-9 a queued subcontract bill that carries no lines is refused at claim time (fail closed)');
select is((select count(*)::int from subcontract_cap_exceptions('15130000-0000-0000-0000-0000000000f1')), 1,
  'OQ-10 the ERP-origin bill with no attributed lines is a reconciliation exception');
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), 'subcontract_cap_exception',
  'OQ-10 payment from PMO is refused while the exception stands');
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select attribute_subcontract_bill_lines((select id from procurement_invoices where procurement_id =
  '15130000-0000-0000-0000-0000000000f1' and po_id is null), '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":80,"rate":100000}]') $$,
  'SC001', null, 'OQ-10 attributing 80 against verified 60 is refused by the same cap');
reset role;
-- the ERP credit note / cancel clears it
update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now() where procurement_id = '15130000-0000-0000-0000-0000000000f1' and po_id is null;
select is(procurement_payment_allowed('15130000-0000-0000-0000-0000000000f1'), null, 'OQ-10 a cancelled ERP bill clears the exception');
select is(po_revision_push_refusal('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-000000000101', 2, true), null,
  'AC-SCA-012 (DB half) no live bill: a cancel-style revise is allowed');
```

a block proving the re-created `procurement_create_refusal` keeps SoD-b for a variation's approver: after S4's approval
by Fin2 (PQ-5 stamp), `procurement_create_refusal(org a, …f1, 'payment', '…a3') = 'separation_of_duties'`;
`OQ-10` read as a client: Fin1 sees the exception row from `subcontract_cap_exceptions('…f1')`, the Engineer sees none;
a linked ERP Purchase Invoice (superuser insert into `erp_purchase_documents` (`erp_doctype` 'Purchase Invoice',
`erp_docstatus` 1, `pmo_owned` false) + `procurement_erp_links` on `…f1`) is an exception with reason
`erp_linked_unattributed`;
and a block where a non-cancelled bill exists: `po_revision_push_refusal(org, po, 2, true) = 'po_has_submitted_bill'`,
`po_revision_push_refusal(org, po, 2, false) is null` (an edit-style revise cancels nothing), and
`po_revision_push_refusal(org, '<unknown uuid>', 2, true) = 'po_not_found'` (fail closed).

### S5.2 Migration: re-created `procurement_create_refusal` and `procurement_payment_allowed`

`procurement_create_refusal` = `0373_…:20-62` verbatim plus, after the `v_proc.id is null` check (each line marked):

```sql
  if p_erp_doc_kind = 'purchase-invoice' and v_proc.is_subcontract                                       -- 0446
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = v_proc.id) then -- 0446
    return 'subcontract_bill_lines_required';  -- PQ-9: #1505 replaces this with the cap over the payload  -- 0446
  end if;                                                                                                 -- 0446
```

Same signature, so `claim_outbox_for_commit` (`0373_…:137`) and the edge function's reissue check
(`procurementGateGuard.ts` `checkQueuedProcurementCreate`) pick it up with no code change. `procurement_payment_allowed`
= `0368_…:18-45` verbatim plus, before the final `return null`:

```sql
  if exists (select 1 from public.subcontract_cap_exceptions(v_row.id)) then return 'subcontract_cap_exception'; end if; -- 0446
```

Because the Paid guard, the ERP payment dispatch and the outbox claim all ask this one function (`0368_…` header §1), all
three refuse together.

### S5.3 `subcontract_cap_exceptions`, `attribute_subcontract_bill_lines`, `po_revision_push_refusal`

`subcontract_cap_exceptions` is **one invoker function** serving both callers: the UI (RLS decides what the caller sees;
Engineers see no bill rows, D6) and `procurement_payment_allowed` (a definer, so inside it the read runs as the owner and
sees every row):

```sql
create or replace function public.subcontract_cap_exceptions(p_procurement_id uuid)
  returns table (invoice_id uuid, erp_purchase_document_id uuid, number text, amount numeric, reason text)
  language sql stable security invoker set search_path = public as $$
  select i.id, null::uuid, i.vi_number, i.amount, 'no_lines'
    from public.procurements p
    join public.procurement_invoices i on i.procurement_id = p.id
   where p.id = p_procurement_id and p.is_subcontract
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = p.id)
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     and not exists (select 1 from public.procurement_invoice_lines l where l.invoice_id = i.id)
  union all
  select null::uuid, d.id, d.erp_name, d.grand_total, 'erp_linked_unattributed'
    from public.procurements p
    join public.procurement_erp_links k on k.procurement_id = p.id
    join public.erp_purchase_documents d on d.id = k.erp_purchase_document_id
   where p.id = p_procurement_id and p.is_subcontract
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = p.id)
     and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1 and not d.pmo_owned
$$;
revoke all on function public.subcontract_cap_exceptions(uuid) from public, anon;
grant execute on function public.subcontract_cap_exceptions(uuid) to authenticated, service_role;
```

(Columns: `procurement_erp_links` `0360_…:75-83`, `erp_purchase_documents` `0335_…:9-28`.) A linked ERP Purchase Invoice
is not a PMO bill row and cannot carry lines, so it clears only by the ERP cancel or `unlink_erp_purchase_document` (PQ-10).

`attribute_subcontract_bill_lines(p_invoice_id uuid, p_lines jsonb) returns void` (client, Admin/Finance): invoice
in org, on a subcontract purchase, currently without lines; procurement row lock then `subcontract_po_lock`; same
rate/shape checks as the capture (S3.6); `subcontract_bill_cap_violation(po, p_lines, p_invoice_id)` → SC001;
pre-tax amount equals the lines (23514); insert lines with `attributed_by = auth.uid()` under `pmo.subcontract_capture`,
set `po_id`; audit `procurement_invoice.attribute_lines`.

`po_revision_push_refusal(p_org uuid, p_po_id uuid, p_revision integer, p_revise_cancels boolean) returns text`
(service_role only): PO in org else `'po_not_found'`; revision issued else `'revision_not_issued'`; when
`p_revise_cancels` and a non-cancelled bill exists on the PO's purchase → `'po_has_submitted_bill'`; else null.

### S5.4 Failing Deno test: the revise guard (AC-SCA-011, AC-SCA-012 owning)

Create `supabase/functions/adapter-dispatch/poReviseGuard.test.ts` (new):

```ts
import { assertEquals } from '@std/assert';
import { checkPoRevise, poReviseRecoveryDecision } from './poReviseGuard.ts';
import { purchaseOrderReviseKey } from '../../../pmo-portal/src/lib/adapterSeam/purchaseOrderRevise.ts';

const ORG = '15130000-0000-0000-0000-00000000000a';
const PO = '15130000-0000-0000-0000-000000000101';
function rpcClient(answer: string | null, fail = false) {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, rpc: async (_fn: string, args: Record<string, unknown>) => {
    calls.push(args); return fail ? { data: null, error: { message: 'boom' } } : { data: answer, error: null }; } };
}

Deno.test('AC-SCA-012 a revise that would cancel a PO with a submitted bill is refused before any ERP write', async () => {
  const c = rpcClient('po_has_submitted_bill');
  const r = await checkPoRevise(c, ORG, { poId: PO, revision: 2 }, { reviseCancels: true });
  assertEquals(r, { ok: false, status: 422, message: 'po_has_submitted_bill' });
  assertEquals(c.calls[0], { p_org: ORG, p_po_id: PO, p_revision: 2, p_revise_cancels: true });
});

Deno.test('AC-SCA-012 an unanswerable guard refuses (fail closed)', async () => {
  assertEquals((await checkPoRevise(rpcClient(null, true), ORG, { poId: PO, revision: 2 }, { reviseCancels: true })).ok, false);
});

Deno.test('AC-SCA-011 one PMO revision has one key: a retry after a mid-way failure reuses it', () => {
  assertEquals(purchaseOrderReviseKey(PO, 2), `porev:${PO}:2`);
  assertEquals(purchaseOrderReviseKey(PO, 2), purchaseOrderReviseKey(PO, 2));
});

// AC-SCA-011 scope: #1505 owns the transport, so here the owning test proves the shipped seam module that the
// #1505 dispatch must call (key derivation + recovery decision). #1505's done-condition adds the wiring test that
// dispatch.ts recovery for `purchase-order.revise` calls poReviseRecoveryDecision (spec note 12).
Deno.test('AC-SCA-011 recovery after an inconclusive probe holds, never reissues (at most one ERP revision)', () => {
  assertEquals(poReviseRecoveryDecision({ probe: 'inconclusive' }), 'held');
  assertEquals(poReviseRecoveryDecision({ probe: 'found', key: `porev:${PO}:2`, expectedKey: `porev:${PO}:2` }), 'adopt');
  assertEquals(poReviseRecoveryDecision({ probe: 'found', key: `porev:${PO}:3`, expectedKey: `porev:${PO}:2` }), 'held');
  assertEquals(poReviseRecoveryDecision({ probe: 'absent-conclusive' }), 'reissue');
});
```

Run from `supabase/functions/adapter-dispatch/`: `deno test poReviseGuard.test.ts` → fails (modules missing).

### S5.5 `purchaseOrderRevise.ts` (seam) and `poReviseGuard.ts` (edge)

`pmo-portal/src/lib/adapterSeam/purchaseOrderRevise.ts` (new; relative imports only so Deno can import it):

```ts
/** #1513 — the canonical PO revision (`purchase-order.revise`): the full effective line set of one PMO revision. */
export interface PurchaseOrderRevise {
  key: string;            // porev:<po uuid>:<revision>
  poId: string;
  revision: number;       // ≥ 2 (revision 1 is the ordinary purchase-order create)
  lines: Array<{ itemRef: string; quantity: string; rate: string; unit: string }>; // 3-dp / 2-dp strings
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const PO_REVISE_KEY_RE = new RegExp(`^porev:${UUID}:[0-9]{1,6}$`);
export function purchaseOrderReviseKey(poId: string, revision: number): string {
  const key = `porev:${poId}:${revision}`;
  if (!PO_REVISE_KEY_RE.test(key) || revision < 2) throw new Error(`purchase-order.revise: bad key ${key}`);
  return key;
}
export type ReviseProbe =
  | { probe: 'inconclusive' }
  | { probe: 'absent-conclusive' }
  | { probe: 'found'; key: string; expectedKey: string };
/** ADR-0058 applied to a revise: adopt only our own key; anything uncertain is held for an operator (C-1 posture). */
export function poReviseRecoveryDecision(p: ReviseProbe): 'adopt' | 'held' | 'reissue' {
  if (p.probe === 'found') return p.key === p.expectedKey ? 'adopt' : 'held';
  return p.probe === 'absent-conclusive' ? 'reissue' : 'held';
}
```

`supabase/functions/adapter-dispatch/poReviseGuard.ts` (new): `checkPoRevise(client, orgId, { poId, revision }, { reviseCancels })`
calls `po_revision_push_refusal` and maps null → `{ ok: true, status: 200, message: '' }`, a string →
`{ ok: false, status: 422, message }`, an error → `{ ok: false, status: 422, message: 'gate-check-failed' }` (the
`procurementGateGuard.ts:15` constant); re-exports `poReviseRecoveryDecision`. Wire it in `index.ts` beside the
procurement gate (`index.ts:84` import; call where `checkProcurementGate` is called) for `command.domain === 'procurement'
&& command.operation === 'revise'`, with `reviseCancels` from the tier (`erpnext` → `true`, `odoo` → `false`). Until #1505
registers the revise operation in the router, the call site is reached by no command; add
`pmo-portal/src/lib/adapterSeam/dispatchGateWiring.test.ts` case `FR-SCA-022 the revise guard is wired before outbox enqueue`
that reads `index.ts` and asserts `checkPoRevise(` appears before `resolveMoneyOutbox` (the file's existing pattern).

### S5.6 Workflow registry and contract suite

`connect/workflows.ts`: add `'purchase-order.revise': { version: 1, summary: 'send the effective lines of one PO revision to the ERP once, never cancelling a billed order' }`.
`erpnext/workflowDeclarations.ts` and `odoo/workflowDeclarations.ts`: `'purchase-order.revise': { status: 'pending', version: 1, issue: 1505 }`.
`contractSuite/purchaseOrderRevise.suite.ts` (new) modelled on `imprestTransfer.suite.ts:1-40`: three cases — one
revision posts one document under its key; the same key again adopts it; a lost answer then retry leaves one document —
using an optional `revise?: () => ReviseHarness` on `ErpHarness` in `contractSuite/harness.ts`; register it in
`contractSuite/index.ts`. With both tiers `pending`, `parity.test.ts` passes and the suite runs only for a tier that
declares `supported` (#1505's job). Run: `cd pmo-portal && npx vitest run src/lib/adapterSeam/contractSuite/parity.test.ts src/lib/adapterSeam/contractSuite/tiers.contract.test.ts`.

### S5.7 Edge-function gate

From `supabase/functions/adapter-dispatch/`: `deno test poReviseGuard.test.ts procurementGateGuard.test.ts`;
`node scripts/check-edge-fn-test-binding.mjs` (repo root; the guard module test imports the shipped module, the wiring test
reads `index.ts`). `.githooks/pre-commit` runs `deno test` for the changed function.

### S5.8 Closing assertion, rollback, 0178 (+1: `attribute_subcontract_bill_lines`), denominator, gate, commit

Gate pgTAP files: `subcontract_erp_guards.test.sql` plus the shipped callers of the two re-created functions
(`ls supabase/tests | grep -E 'payment_allowed|queue_gate|0368|0373'`). Commit
`feat(erp): subcontract cap and revise guards fail closed (#1513 S5)`.

---

## S6 - Data layer (no migration) - batchable with S7

### S6.1 Failing test, then `src/lib/subcontracts/subcontractRules.ts` (new)

`pmo-portal/src/lib/subcontracts/subcontractRules.test.ts` (new):

```ts
import { describe, expect, it } from 'vitest';
import { payableOf, verifiedNotOnPo, prefillBillLines, capMessage } from './subcontractRules';

describe('subcontract rules (mirror of the SQL, display only)', () => {
  it('FR-SCA-050 payable = min(verified, PO) − billed, floored at 0', () => {
    expect(payableOf({ poQty: 100, verified: 120, billed: 100 })).toBe(0);
    expect(payableOf({ poQty: 100, verified: 80, billed: 0 })).toBe(80);
    expect(payableOf({ poQty: 100, verified: 80, billed: 90 })).toBe(0);
  });
  it('FR-SCA-050 verified, not on PO = max(verified − PO, 0)', () => {
    expect(verifiedNotOnPo({ poQty: 100, verified: 120 })).toBe(20);
    expect(verifiedNotOnPo({ poQty: 100, verified: 80 })).toBe(0);
  });
  it('FR-SCA-051 the bill form pre-fills payable per line and states the cap in words at zero', () => {
    const lines = [{ boqItemId: 'a', itemCode: 'L1', unit: 'm3', rate: 100000, poQty: 100, verified: 120, billed: 100, payable: 0, verifiedNotOnPo: 20 }];
    expect(prefillBillLines(lines)).toEqual([{ boqItemId: 'a', quantity: 0, max: 0, rate: 100000 }]);
    expect(capMessage(lines[0])).toBe('L1: nothing payable — 120 verified, 100 on the PO, 100 already billed');
  });
  it('NFR-SCA-001 property: over random sequences payable never lets billed exceed min(verified, PO)', () => {
    let seed = 1513;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const poQty = Math.round(rnd() * 200), verified = Math.round(rnd() * 250), billed = Math.round(rnd() * Math.min(poQty, verified));
      expect(billed + payableOf({ poQty, verified, billed })).toBeLessThanOrEqual(Math.min(poQty, verified));
    }
  });
});
```

Implement with plain functions in thousandths (`Math.round(x * 1000)`) to avoid float drift; `capMessage` returns `null`
when `payable > 0`. The i18n copy wraps this string (S7.1); the rule returns the English used by tests and as the
`defaultValue`. Run: `cd pmo-portal && npx vitest run src/lib/subcontracts/subcontractRules.test.ts`.

### S6.2 DAL `src/lib/db/subcontracts.ts` (new) and its test

Functions (each a typed `supabase.rpc`/`from` call, `throwRpc` on error, no `org_id` sent): `getPoPosition(poId)`
→ `subcontract_po_position`; `listPoRevisions(poId)`; `listPoLines(poId, revision)`; `setPoLines(poId, lines)`;
`issuePoLines(poId)`; `listSubcontractAcceptances(poId)` (header + lines, `order('confirmed_at', { ascending: false })`,
`.limit(200)`); `prepareSubcontractAcceptance(input)`; `confirmSubcontractAcceptance(id)`; `withdrawSubcontractAcceptance(id)`;
`captureSubcontractVendorInvoice(input)` (`CaptureVendorInvoiceInput & { lines }`, forwarding tax params exactly as
`procurementLifecycle.ts:430-450` does); `listPoVariations(poId)`; `requestPoVariation(input)`; `decidePoVariation(id, approve, notes)`;
`issuePoRevision(variationId)`; `linkPoVariation(variationId, workOrderId | null, reason | null)`;
`getVariationRoute(variationId)`; `getProjectSubcontractExposure(projectId)`; `listWorkOrderCostVariations(workOrderId)`;
`listSubcontractCapExceptions(procurementId)` → `subcontract_cap_exceptions` (OQ-10); `attributeSubcontractBillLines(invoiceId, lines)`.
Position rows type `billed` and `payable` as `number | null` (D6: `null` for a caller outside the four invoice-reading
roles); nothing coerces `null` to `0`. `src/lib/db/subcontracts.test.ts` (new) mocks `supabase` as
`src/lib/db/workOrderAcceptances.test.ts` does and asserts each call's RPC name and argument names, and that an SC001 error
surfaces with `code: 'SC001'` (FR-SCA-020).

### S6.3 Repository `src/lib/repositories/subcontracts.ts` (new) and registration

Reads and the non-capture writes behind `repositories.subcontracts` (register in `src/lib/repositories/index.ts` beside
`procurement: procurementRepository` at `:93`). `getPoPosition` throws `new Error('subcontract position truncated')` when
`rows.length >= 1000` (NFR-SCA-005). Add `src/lib/repositories/subcontracts.test.ts` for the truncation rule.

### S6.4 Hooks `src/hooks/useSubcontract.ts` (new) and the capture mutation

`usePoPosition(poId)`, `useSubcontractAcceptances(poId)`, `usePoVariations(poId)`, `useVariationRoute(id)`,
`useProjectSubcontractExposure(projectId)`, `useWorkOrderCostVariations(workOrderId)`, and mutations for each write that
invalidate `['subcontract', poId]` and the procurement detail key. The bill capture is added to
`src/hooks/useProcurementDetail.ts` as `captureSubcontractVendorInvoice` beside `captureVendorInvoice` (`:195`), calling the
DAL directly (the shipped case-aggregate precedent, `:16-21`). Tests: `src/hooks/useSubcontract.test.ts` (new) and one
case in `src/hooks/useProcurementDetail.test.ts` mirroring its `harden #2` case (`:249`).

### S6.5 Policy entities, gate, commit

`src/auth/policy.ts`: add entities `subcontractLines` (`edit`: Admin/Finance/PM), `subcontractAcceptance`
(`prepare`: Admin/Finance/Executive/PM — UX mirror of `may_record_project_progress`; `confirm`: Admin/Finance),
`poVariation` (`request`: every active role; `decide`: Admin/Finance/Executive/PM; `revise`: Admin/Finance/PM;
`link`: Admin/Finance/PM). Policy tests in the existing `src/auth/policy.test.ts`, one `it('FR-SCA-0xx …')` per action.
Gate: `npm run check:guards && npm run typecheck`, the touched vitest files, eslint on touched files. Commit
`feat(fe): subcontract data layer (#1513 S6)`.

---

## S7 - Screens and e2e journey (no migration) - UI lane, shipped as S7a (S7.1-S7.4) then S7b (S7.5-S7.7)

UI-lane gate: typecheck, eslint, touched vitest, the touched e2e, `scripts/ux-proof.sh` on `/procurement/:id` and
`/projects/:id` (work-orders tab); security-auditor only because money RPCs are called. Director does one rendered review;
owner judges screenshots. Strictly `DESIGN.md` tokens and the shared primitives (`EntityFormModal`, `useEntityForm`,
`TextField`, `SelectField`, `FormGrid`, `FieldError`, `ConfirmDialog`, `classifyMutationError`).

### S7.1 i18n

Add a `subcontract` block to `pmo-portal/public/locales/en/procurement.json` and `…/id/procurement.json` (lines-table
headers, acceptance, variation, link, cap messages incl. `capNothingPayable` with `{{code}} {{verified}} {{po}} {{billed}}`,
`capRefused` for SC001, `linesRequired` for SC002, push states `queued`/`held`/`failed`). Rebase translation files
immediately before the PR (#1070 rule).

### S7.2 `pages/procurement/SubcontractLinesSection.tsx` (new) — AC-SCA-015 owning

Failing test first: `pmo-portal/pages/procurement/SubcontractLinesSection.test.tsx` (new), mocking `useSubcontract`:

```tsx
it('AC-SCA-015 shows per-line PO / verified / billed / payable / verified-not-on-PO and totals that reconcile to the bill lines', async () => {
  mockPosition([
    { boqItemId: 'e1', itemCode: 'L1', unit: 'm3', rate: 100000, poQty: 100, verified: 120, billed: 100, payable: 0, verifiedNotOnPo: 20, disputed: 0, verifiedAt: '2026-10-20T00:00:00Z' },
    { boqItemId: 'e2', itemCode: 'L2', unit: 'm', rate: 40000, poQty: 50, verified: 30, billed: 10, payable: 20, verifiedNotOnPo: 0, disputed: 0, verifiedAt: '2026-10-20T00:00:00Z' },
  ]);
  mockBillLines([{ boqItemId: 'e1', quantity: 100 }, { boqItemId: 'e2', quantity: 10 }]);
  render(<SubcontractLinesSection poId="po1" />);
  const row = await screen.findByRole('row', { name: /L1/ });
  for (const v of ['100', '120', '100', '0', '20']) expect(within(row).getAllByText(v).length).toBeGreaterThan(0);
  expect(screen.getByTestId('subcontract-billed-total')).toHaveTextContent(formatCurrency(10400000, 'IDR'));
  expect(screen.getByTestId('subcontract-bill-lines-total')).toHaveTextContent(formatCurrency(10400000, 'IDR'));
});
```

plus `FR-SCA-050` states: loading skeleton; error (a failed read renders the error notice and **no** figures, never `0`);
empty (no issued lines → "No BoQ lines issued" with the `edit` affordance gated by `can('edit','subcontractLines')`);
Draft lines with an Issue button behind `ConfirmDialog`; OQ-7 age chip "verified, not on PO for N days" from `verifiedAt`;
Disputed figure; `billed`/`payable` `null` renders "—" (never `0`); OQ-10 exceptions from `listSubcontractCapExceptions`
render as a reconciliation notice naming each bill and its reason, with "Attribute lines" (Admin/Finance) for a `no_lines`
row. Mount it in `pages/ProcurementDetails.tsx` beside `LineItemsSection` (`:1110`) when
`procurement.is_subcontract` and the purchase has a PO. Run: `npx vitest run pages/procurement/SubcontractLinesSection.test.tsx`.

### S7.3 `pages/procurement/SubcontractAcceptanceModal.tsx` (new)

Modelled on `pages/project-detail/WorkOrderAcceptanceModal.tsx`: period date, per-line cumulative quantity (pre-filled
with last confirmed, `min` = last confirmed), document picker (same-project Acceptance documents), note; Prepare / Confirm
/ Withdraw. Tests `SubcontractAcceptanceModal.test.tsx`: `FR-SCA-014` the input refuses a value below the last confirmed;
`FR-SCA-012` the Confirm button is hidden for the preparer unless the org has one active member (UX only; server decides);
`FR-SCA-013` entering 120 on a 100 line shows the "verified, not on PO" hint and does not block.

### S7.4 `pages/procurement/SubcontractBillLines.tsx` (new) inside the vendor-bill capture

In `ProcurementDecisionZone` (`pages/procurement/ProcurementDecisionZone.tsx:114`), when the purchase has issued lines,
render `SubcontractBillLines` inside the vendor-bill capture: one row per line pre-filled with `payable` (editable down,
`max = payable`), rate fixed to the PO rate, the computed pre-tax amount written into the existing amount field
(read-only), and `capMessage` in words when payable is 0. Submit calls `captureSubcontractVendorInvoice`; an SC001 /
SC002 error is classified by `classifyMutationError` into the cap copy. Tests `SubcontractBillLines.test.tsx`:
`FR-SCA-051` prefill and the zero message; `FR-SCA-051` typing above payable is clamped and announced; `FR-SCA-020` a
server SC001 renders the refusal naming the line.

### S7.5 Variation and link UI

`pages/procurement/PoVariationModal.tsx` (new): from a line (pre-work) or from a line's verified-not-on-PO (post-work,
max = that amount), reason required; shows the route (`useVariationRoute`): "Decided by …" or "Needs a senior
approver". `pages/procurement/PoVariationsList.tsx` (new): status, amount, Approve / Reject (hidden for the requester;
server is the authority), Issue revision (hidden for the approver), Link to work order (`SelectField` of the project's work
orders) or Not passed on (reason). `pages/project-detail/tabs/WorkOrdersTab.tsx`: a "Cost variations" line per work order
from `useWorkOrderCostVariations`. Tests: `PoVariationsList.test.tsx` `FR-SCA-036` requester sees no Approve, approver
sees no Issue; `FR-SCA-041` the work-order line renders the linked variation read-only.

### S7.6 Push state badge (FR / ADR-0094)

Where a revision has an outbox row (connected org), show `queued` / `held` / `failed` from the existing pending-push read
(`src/lib/adapterSeam/pendingPush.ts`), never "sent" until confirmed. Test in `SubcontractLinesSection.test.tsx`:
`FR-SCA-022 a held revision push renders "held", not success` (the UI half of AC-SCA-011's wording; AC-SCA-011 is owned in
Deno, S5.4).

### S7.7 E2E journey and gate

`pmo-portal/e2e/AC-SCA-001-subcontract-bill-cap-journey.spec.ts` (new), line 1
`// @e2e-isolation: self-isolated — creates its own project, BoQ items, subcontract purchase, PO and documents each run and deletes them; touches no shared seed row.`
Fixture through the service-role client as `AC-APR-040-routed-procurement-approval.spec.ts:29-40` does (project with PM,
two BoQ items, Active budget, a subcontract purchase in Ordered with a PO, an Issued Acceptance document with a file). The
journey, each step a real user action:
1. PM opens the purchase, drafts lines L1 100 m3 @ 100,000, issues them (confirm dialog).
2. PM prepares an acceptance of 120 with the signed document; signs out; Finance (other user) confirms it.
3. Finance opens Record vendor bill: L1 is pre-filled with 100; changes it to 120 → the form refuses above payable; submits 100 → the bill appears.
4. The lines table shows payable 0 and verified, not on PO 20.
5. PM raises a post-work variation for the 20; the Executive (senior approver) approves; Finance issues revision 2.
6. Finance records a bill for 20 → accepted; the lines table shows PO 120, billed 120, payable 0, not-on-PO 0.
Goal oracle (step 6): the purchase's bills total 12,000,000 + 2,000,000 and no line shows billed above its PO quantity.
The test names AC-SCA-001 as its leading token; AC-SCA-001's **owning** proof stays pgTAP (traceability below).
Run: `scripts/e2e-local.sh AC-SCA-001` (CI's `integration` runs it on the release PR to `main`, owner rule 2026-10-30).
Then `scripts/ux-proof.sh` on the two routes. Commits: S7a ends S7.4 with `feat(ui): subcontract lines, acceptance and bill
screens (#1513 S7a)` after the same UI-lane gate on `/procurement/:id`; S7b ends here with
`feat(ui): subcontract variations, link and journey (#1513 S7b)`.

---

## Traceability (AC → owning test, one owner each)

| AC | Owning layer | File | Test title (leading token) | Slice |
|---|---|---|---|---|
| AC-SCA-001 | pgTAP | `supabase/tests/subcontract_bill_caps.test.sql` | `AC-SCA-001 a bill for 120 is refused with SC001 naming verified 120, PO 100, billed 0` (+ accepted 100, payable 0, not-on-PO 20) | S3 |
| AC-SCA-002 | pgTAP | `supabase/tests/po_variations.test.sql` | `AC-SCA-002 a rejected post-work variation is Disputed` (+ 20 shows Disputed, bill 101 refused) | S4 |
| AC-SCA-003 | pgTAP | `supabase/tests/po_variations.test.sql` | `AC-SCA-003 a bill for the remaining 20 is accepted` (+ requester ≠ approver and issuer ≠ approver refusals) | S4 |
| AC-SCA-004 | pgTAP | `supabase/tests/subcontract_bill_caps.test.sql` | `AC-SCA-004 a bill for 90 against verified 80 is refused (verified cap)` (+ 80 accepted) | S3 |
| AC-SCA-005 | pgTAP | `supabase/tests/po_variations.test.sql` | `AC-SCA-005 a variation that exceeds the budget line routes to the senior set (shipped rule)` (+ requester refused) | S4 |
| AC-SCA-006 | pgTAP | `supabase/tests/subcontract_acceptances.test.sql` | `AC-SCA-006 the preparer cannot confirm in an org with other active members` (+ confirm, immutability 42501, sole_operator) | S2 |
| AC-SCA-007 | pgTAP (dblink) | `supabase/tests/subcontract_cap_concurrency.test.sql` | `AC-SCA-007 once released, exactly one capture of the last 10 succeeds` (+ lock-order and block proofs) | S3 |
| AC-SCA-008 | pgTAP | `supabase/tests/subcontract_bill_caps.test.sql` | `AC-SCA-008 a cancelled bill's quantity returns to payable` | S3 |
| AC-SCA-009 | pgTAP | `supabase/tests/subcontract_bill_caps.test.sql` | `AC-SCA-009 only the latest Confirmed acceptance counts (Draft 95 and Withdrawn 90 do not)` | S3 |
| AC-SCA-010 | pgTAP | `supabase/tests/po_variations.test.sql` | `AC-SCA-010 a work order on another project is refused` (+ same project both sides, reason required) | S4 |
| AC-SCA-011 | Deno | `supabase/functions/adapter-dispatch/poReviseGuard.test.ts` | `AC-SCA-011 recovery after an inconclusive probe holds, never reissues (at most one ERP revision)` (+ key reuse) | S5 (seam); dispatch wiring proof is #1505's done-condition |
| AC-SCA-012 | Deno | `supabase/functions/adapter-dispatch/poReviseGuard.test.ts` | `AC-SCA-012 a revise that would cancel a PO with a submitted bill is refused before any ERP write` | S5 |
| AC-SCA-013 | pgTAP | `supabase/tests/subcontract_tenancy.test.sql` | `AC-SCA-013 org B reads none of org A's acceptances` (+ lines, revisions, variations, bill lines, writes) | S4 |
| AC-SCA-014 | pgTAP | `supabase/tests/subcontract_cap_mutation.test.sql` | `AC-SCA-014 with the cap mutated to always allow, AC-SCA-004's refused bill … goes through` | S3 |
| AC-SCA-015 | Vitest/RTL | `pmo-portal/pages/procurement/SubcontractLinesSection.test.tsx` | `AC-SCA-015 shows per-line PO / verified / billed / payable / verified-not-on-PO and totals that reconcile to the bill lines` | S7a |
| (journey) | Playwright | `pmo-portal/e2e/AC-SCA-001-subcontract-bill-cap-journey.spec.ts` | `AC-SCA-001 prepare → confirm → capture → refusal → variation → revision → bill` (reference, not owner) | S7b |

Requirements without an AC are proven by the FR-/NFR-tagged tests named in each slice (FR-SCA-001..003 S1;
010..015 S2; 020..024 S3; 030..036, 040..041 S4; 022 / OQ-10 S5; 050..051 S6/S7; NFR-SCA-001 S3 + S6, 002 S3, 004/005 S3,
006 S2/S4, 007 every rollback file; PQ-5 SoD-b for a variation's approver S4 (AC-SCA-003 block) + S5;
PQ-11/12 S1/S4).

## Scaling and risk notes (planner lens)

- **Hot path is per PO.** Every cap read is bounded by one PO's lines and its bills; indexes `(boq_item_id)` on bill and
  acceptance lines and `(po_id, status, confirmed_at desc, id desc)` on acceptances keep it index-only. A project-wide
  exposure read is one lateral per subcontract PO; if a project ever carries hundreds, pre-aggregate into a per-line
  summary table maintained by the same definers (deferred: not needed for one client).
- **Lock contention** is per PO (`subcontract-po:`), so two subcontracts never serialize each other; the spend-line lock
  is taken only by variation decisions.
- **`total_value` drift (PQ-5).** 0371/0386 refresh purchase totals from documents for document-started purchases; a
  subcontract purchase carries items or an approved total, which those refreshes leave alone (`0372_…:170` comment). S4's
  PQ-5 test pins this; if it fails, stop and raise it, do not loosen the refresh.
- **Duplicate money (primer #1).** The revise key is per `(po, revision)`, never per click; recovery holds on any
  uncertainty; a billed PO is never cancelled by a revise (AC-SCA-012).
- **Wrong number on screen (primer #5).** Position reads are invoker and return no row rather than a zero row on a hidden
  PO; the FE refuses a truncated read and renders an error, never `0`.
- **Duplicate logic avoided.** Tax, numbering, the case transition, routing, sole-operator and document checks are all
  called or copied verbatim with citations; the cap exists once (D3).

## Spec notes for the coordinator

The spec is not edited. Each note says what breaks if it is left as written, and the default this plan takes.

1. **FR-SCA-001/002 "Draft subcontract PO" has no Draft window in shipped code.** POs are inserted `Issued` when the
   purchase moves to Ordered (`0362_procurement_start_anywhere.sql:290-293`). Taken literally, lines could never be added.
   Plan: PQ-1 (draft lines until revision 1 is explicitly issued).
2. **FR-SCA-002 cross-reference.** It says later change is "by a PO revision (FR-SCA-021)"; FR-SCA-021 is the advisory
   lock — the revision is FR-SCA-032. Typo only.
3. **FR-SCA-024 / AC-SCA-008 presume a cancel action PMO does not have.** No native vendor-bill cancel exists (client
   DELETE revoked `0177_…:218-220`; no cancel RPC in `supabase/migrations/` by grep for `cancel_.*invoice`). Release
   happens through the shipped "not cancelled" predicate, i.e. a cancel or credit note mirrored from the ERP. In
   standalone mode a mis-captured subcontract bill therefore keeps consuming headroom. AC-SCA-008 is proven through the
   mirrored cancel; a native standalone cancel is a follow-up for the coordinator to file if wanted.
4. **AC-SCA-009 "rejected" acceptance.** The ADR-0091 shape has no Rejected state (Draft / Confirmed / Withdrawn,
   `0337_contract_quantities.sql:103`); the plan reads "rejected" as Withdrawn.
5. **ERP section: "PO is an immutable-anchor kind that may reissue on an inconclusive probe".** The registry gives
   `purchase-order` no recovery anchor (`pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts:106`, `anchorField: null`).
   For `purchase-order.revise` the plan is stricter: an inconclusive probe **holds** (never reissues), because an ERPNext
   amend cancels the prior PO and a second amend would orphan a bill. #1505 must choose the revise anchor.
6. **FR-SCA-022 cannot evaluate the cap at claim time with today's purchase-invoice command,** which carries no BoQ
   lines. The plan fails closed (PQ-9) until #1505 carries the lines.
7. **AC-SCA-011 mixes a server claim and a UI claim** ("UI shows queued/held"). The spec's traceability owns it in Deno;
   the plan owns it there and proves the UI half with an FR-tagged Vitest (S7.6).
8. **OQ-10 behaviour has no AC.** The plan proves it with OQ-10-tagged pgTAP in S5; the coordinator may want an AC.
9. **FR-SCA-040 / roles table name "PM, Finance" for the link;** the plan admits Admin too (PQ-7), as every procurement
   writer does.
10. **FR-SCA-031 "routes to the senior set as shipped".** `spend_approval_route` can also return `admin` when no senior
    approver is eligible; the plan surfaces that exactly as `transition_procurement` does (`0362_…:233-237`).
11. **The spec's journey row has no AC id.** The e2e file is named for AC-SCA-001 (the issue acceptance) as a reference;
    its owning proof stays pgTAP.
12. **AC-SCA-011 ("given a connected ERP") cannot be fully proven before #1505.** This plan owns the key and the
    hold-never-reissue decision in the shipped seam module (S5.4/S5.5); #1505 must add the wiring test that its dispatch
    recovery for `purchase-order.revise` calls `poReviseRecoveryDecision`. Until then no revise command exists, and a
    connected org cannot issue a revision at all (PQ-11), so nothing can mint a second ERP revision.
13. **FR-SCA-036 names requester ≠ approver and issuer ≠ approver, not approver ≠ payer for the variation's approver.**
    The plan adds it (PQ-5) by stamping the shipped amount-approver column, because a variation raises the amount the
    purchase may be paid; every payment path already enforces approver ≠ payer on that column.
14. **FR-SCA-020 makes a subcontract purchase with lines refuse every bill path without lines** (the S3 capture guard),
    including the shipped importer and a plain `capture_vendor_invoice`. That is the spec's fail-closed rule (NFR-SCA-004);
    a bulk subcontract bill import is a follow-up (spec Follow-ups).

## Review log (2026-11-01, Opus review against shipped code at `b52aa48a`)

Changes made in review: migration numbers fixed to Lane B 0442-0446; S7 split into S7a/S7b (builder-day bound); PQ-2
bounded by the requested value when no approval exists; PQ-5 stamps the variation's approver as amount approver (SoD-b on
every payment path) with AC-SCA-003 proof; PQ-11 (connected org) and PQ-12 (closed purchase) added; D6 states that RLS does
not apply inside definers and gives the explicit 0350 visibility predicate (replacing an invoker-helper approach that
would have run as the owner); bill money (`billed`, `payable`) is `null`, never `0`, for roles that cannot read bills;
the PO-amount guard admits the service-role ERP mirror (ADR-0048); the cap validates and sums its own input (D3); rollback
follows the refuse-if-rows precedent instead of copying rows into `public`; route assertions use the shipped route values
(`flat`/`project`/`org`/`admin`); the AC-SCA-003 issuer refusal now reaches the SoD check (Fin2 approver) instead of a
role refusal; FR-SCA-036 test made coherent; Disputed given exact SQL; OQ-10 exceptions are one invoker read used by both
the UI and the payment rule, including linked ERP Purchase Invoices; AC-SCA-013 covers every new writer; the isolation
denominator step names all three manifest sections and the probe-script coverage rule; 0137/0136 inventories addressed (D6a).
