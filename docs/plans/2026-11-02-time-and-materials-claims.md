# Time-and-materials claims - implementation plan (#1514)

Spec: [`docs/specs/time-and-materials-claims.spec.md`](../specs/time-and-materials-claims.spec.md) (**proposed; §10 decisions
await owner sign-off, each has a default this plan builds to**). Route item T3 of
[`2026-10-30-epc-odoo-build-route.md`](2026-10-30-epc-odoo-build-route.md); rulings #1488, #1443. Role contract:
`.claude/agents/eng-planner.md`. Model: [`2026-11-01-equipment-usage.md`](2026-11-01-equipment-usage.md) (same conventions).

**Gate: money + SoD.** T1 to T6 change what can be invoiced. Executor: **Director-dispatched Orca workers, one fresh worker per
slice, each slice its own branch and PR; T1 to T6 each ship alone** (never batched; CLAUDE.md money tier). T7 to T10 (no
migration) are batchable. Read [`docs/money-path-primer.md`](../money-path-primer.md) first: buckets 1 (duplicate money: an hour
billed twice), 3 (SoD), 4 (tenancy), 5 (wrong number on screen).

**Migration numbers (this lane's range, fixed): T1 = 0515, T2 = 0516, T3 = 0517, T4 = 0518, T5 = 0519.** Nothing outside
0515 to 0519. The repo head when written is `0496`; other lanes hold 0497 to 0514. On a collision use
`scripts/renumber-migration.sh <old> <new>`, never a hand `git mv`.

**Rebuilt bodies come from the latest migration at build time, not from the line numbers here.** T3 and T4 re-create
`assert_progress_claim_raisable`, `append_progress_claim_author`, `api_client_request_guard`; T2 touches `transition_timesheet`.
Find each newest definition first and copy THAT; the rollback restores the body the slice replaced:
`grep -liE "function +(public\.)?<name> *\(" supabase/migrations/*.sql | sort | tail -1` (case-insensitive).

## Waits on #1519 (equipment usage)

| Slice | Waits? | Why |
|---|---|---|
| T1 labour rates | no | no equipment dependency; `kind` check admits only `labour` until T5 |
| T2 assembly (labour) | no | sources = approved `timesheet_entries` |
| T3 sign-off + invoice bridge | no | works for any source kind |
| T4 reads, API tiers | no | |
| **T5 equipment lines (0519)** | **yes: #1519 S1 merged** (needs `equipment_assets`, `equipment_usage_entries`, its approve RPC and the archive RPC) | FK to assets, source = approved usage |
| T6 ERP reader | no (labour); the equipment case is added by T5 | |
| T7 to T10 | labour no; equipment parts follow T5 | |

The issue is formally `Blocked by #1519`; OQ-TM-11 asks the owner to confirm labour-first. If answered "no", hold every slice
until #1519 S1 lands; the plan is otherwise unchanged. Odoo's C4b (`2026-11-02-odoo-client-invoices.md`) starts only after **T3 and
T6 are on `dev`** and reads the canonical claim-line shape T6 fixes.

## What ships today (grounded; read on `origin/dev` at the head named above; re-verify at build)

- **Claim record:** `progress_claims` / `progress_claim_lines` (`0250_progress_billing.sql:259-307`), kind check
  `('down_payment','progress')` and a shape constraint (`:276-285`); lines require `boq_item_id` and are unique per
  `(claim_id, boq_item_id)` (`:293-304`) so T&M needs its own line table. Created only by `create_progress_claim`
  (latest body `0343_money_integrity.sql:2-178`), withdrawn by `withdraw_progress_claim` (`0250:600`). Immutable by trigger
  (`assert_progress_claim_update`, `:310`).
- **Invoice fence:** `assert_progress_claim_raisable` (`0250:635-668`) on `external_command_outbox` insert for the `revenue`
  domain: org match, not withdrawn, evidence attached. This is the single choke point T3 extends.
- **Invoice authors:** `append_progress_claim_author` (`0250:670-682`) writes the claim creator into `sales_invoice_authors` so
  the claim author cannot approve the invoice. T3 adds the confirmer.
- **Work-order fence:** `lock_work_order_billing`, `assert_work_order_invoiceable` (`0262`, readers re-defined in `0337`).
- **Acceptance pattern:** `work_order_acceptances` and `prepare/withdraw/confirm_work_order_acceptance`
  (`0337_contract_quantities.sql:94-330`): document check, sole-operator predicate, immutable confirm, audit. The model for T3.
- **Timesheets:** `timesheets` (week, status) and `timesheet_entries` (project, date, hours) (`0001_init_schema.sql:177-201`);
  `transition_timesheet` (latest `0180_rpc_active_member_gate.sql:780`) is the only status writer. Reopen path
  `0161_timesheet_reopen_unpushed.sql`; correction spec `docs/specs/timesheet-correction-path.spec.md`.
- **Billing kind:** `sales_invoices.billing_kind default 'contract'` (`0410_billing_kinds.sql:6`); `get_project_finances`
  is the drawdown authority (DD-BKIND-1, `docs/decisions.md`). `sales_invoice_work_billed` (`0250 §8`) counts claim invoices at net.
- **ERPNext claim body:** `pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenue.ts:409` reads `progress_claim_lines`;
  contract test `progressClaimInvoice.test.ts`.
- **No rate card, no billable flag, no project membership table** (searched `supabase/migrations/*.sql` for `bill_rate`,
  `hourly_rate`, `rate_card`, `project_members`). The project's person is `projects.project_manager_id`.
- **Helpers reused:** `stamp_org_id()`, `assert_is_active_member()`, `auth_org_id()`, `auth_role()`, `may_record_project_progress(project)`
  (`0245`), `log_audit(action, org, actor, entity, detail)`, org-local today `(now() at time zone coalesce(o.default_timezone,'UTC'))::date`.

## Plan questions (each has the default taken and the slice it changes)

| # | Question | Default taken | Slice |
|---|---|---|---|
| PQ-1 | One id for claim and sign-off? | `tm_claims.id` = `progress_claims.id` = `sales_invoices.id`; the `progress_claims` row is inserted at confirm with the same id (claim = invoice record, `0250` header note). | T3 |
| PQ-2 | Where does the unique live-source rule live when claims have a status? | `tm_claim_sources.is_live boolean` maintained by the withdraw RPC (and confirm leaves it true); partial unique `(source_kind, source_id) where is_live`. No trigger-derived state. | T2 |
| PQ-3 | How do `transition_timesheet` reopen and `archive` know a source is in a claim? | A stable helper `tm_source_is_live(kind, id)`; `transition_timesheet` and (T5) the usage archive/reopen RPC call it and refuse with `55000`. Edit `transition_timesheet` from its newest body only. | T2 / T5 |
| PQ-4 | Currency source for a rate line. | `projects.currency`; the save refuses any other code (`23514`). | T1 |
| PQ-5 | Which role prepares? | `may_record_project_progress(project)` (the project's PM, or Finance rank and above). | T3 |
| PQ-6 | Person with two labour lines on one date. | Refused at assignment save (exclusion-style overlap check in the RPC, `23505`). | T1 |
| PQ-7 | An entry spanning a rate change inside one claim. | Grouping key is `(line_key, rate_version)`; two versions in one claim give two claim lines, each frozen. | T2 |
| PQ-8 | ERP service item for a T&M line. | Reuse the existing claim item mapping; if an org has none, the push is held with the existing "map this item" reason (no new gate). | T6 |

## Architecture decisions

- **D1 One billing system.** T&M adds a *source of lines*, not a billing path: confirm inserts a `progress_claims` row of kind
  `time_materials` and attaches the signed document as `progress_claim_evidence`; everything after (raise, approve, outbox,
  recovery, mirror, withdraw, billed-work view) is the shipped code.
- **D2 Sign-off is the gate, at the choke point.** The extended `assert_progress_claim_raisable` refuses a `time_materials`
  claim without a confirmed `tm_claims` row; claim creation itself exists only inside `confirm_tm_signoff`. Two layers, both mutation-checked.
- **D3 Frozen lines.** Rate, unit, label and rate version are copied onto `tm_claim_lines` at assembly; confirm recomputes
  nothing from the live rate card (it re-validates only that sources are still Approved and live).
- **D4 Sources are consumed once.** The partial unique index is the authority; the RPC's pre-check only produces a friendly error.
- **D5 Internal hire rate (#1519) and client rate are different tables and never read across.**

## Slice map

| Slice | Migration | Scope | Gate | Ships |
|---|---|---|---|---|
| **T1** Rate card | 0515 | `contract_rate_lines`, `contract_rate_assignees`, save/end/assign RPCs, reads | money setting | **alone** |
| **T2** Assembly | 0516 | `tm_claims`, `tm_claim_lines`, `tm_claim_sources`, `assemble/deselect`, reopen guard | money | **alone** |
| **T3** Sign-off + invoice bridge | 0517 | prepare/withdraw/confirm, `progress_claims` kind, fence, authors, WO reserve | money + SoD | **alone** |
| **T4** Reads and API tiers | 0518 | list/preview reads, `api_client_request_guard` tiers, finance proof | read/tenancy | alone |
| **T5** Equipment lines | 0519 | equipment rate lines + usage sources + standby rule | money | **alone; after #1519 S1** |
| **T6** ERP reader | none | canonical claim-line reader, ERPNext contract test | money | **alone; after T3** |
| T7 data layer | none | DAL, repository, hooks, policy | | batchable (T7 to T10) |
| T8 screens | none | rate card, assemble, sign-off, detail | UI lane | batchable |
| T9 CLI | none | `pmo tm ...` | | batchable |
| T10 e2e | none | one curated journey | | with T8 |

Order: T1 → T2 → T3 → (T4, T6 in parallel branches; **never both heavy at once**: T4 is DB, T6 is Deno) → T7 to T10 → T5
(when #1519 S1 is on `dev`) → equipment additions to T6, T7, T8. At most two heavy loads at once.

## Conventions every task follows

- **pgTAP** files `supabase/tests/tm_<topic>.test.sql` (new), self-contained (`begin; … select * from finish(); rollback;`), starting
  from Fixture F1. **AC tag** = leading token of the pgTAP description / `it(...)` / `test(...)` title.
- **DB commands under the lock, reset and test in ONE hold** (run from repo root):
  `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<files>'`. Grep the output for `Parse errors`.
- **Every migration slice's gate:**
  1. `scripts/check-migration-collisions.sh && scripts/check-migration-collisions.sh --self-test`
  2. the slice's pgTAP files plus `supabase/tests/0250_progress_billing_claims.test.sql`,
     `supabase/tests/0250_progress_billing_evidence.test.sql`, `supabase/tests/0262_work_order_billing_refusal.test.sql`,
     `supabase/tests/0178_anon_executable_definers.test.sql` (regressions of what T2/T3 touch).
  3. `node scripts/check-isolation-denominator.mjs && node scripts/check-isolation-denominator.mjs --self-test` after adding each
     new table and every new non-trigger SECURITY DEFINER function (regprocedure text, `int` as `integer`) to
     `scripts/isolation-probe-denominator.json`; helpers stay invoker and revoked from clients.
  4. 0178 retained-RPC set: add each new client-callable writer to `client_callable_rpc_names` with an `⚑ AMENDED BY <number> (#1514)`
     note; **re-derive the count by hand from the VALUES list after rebase**. Reads and previews are `stable` and contain no
     `insert into`/`update <name>`/`delete from` text. Writers: T1 3 (`save_contract_rate_line`, `end_contract_rate_line`,
     `set_contract_rate_assignee`), T2 2 (`assemble_tm_claim`, `deselect_tm_source`), T3 3 (`prepare_tm_signoff`,
     `withdraw_tm_signoff`, `confirm_tm_signoff`).
  5. pgTAP 0136 (side-mirror inventory) and 0137 (service_role grants): every new table gets `grant all … to service_role`; no
     side-mirror table is added (nothing is posted by T&M itself).
  6. From `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, touched vitest files, `npx eslint --max-warnings=0 <touched>`.
- **Types after a migration:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`.
- **Grants:** each function ends `revoke all … from public, anon, authenticated;`, client RPCs then `grant execute … to authenticated;`;
  definers `alter function … owner to postgres;`. Each migration ends with a self-assertion `do $$ … $$` that raises if any new
  helper is executable by `authenticated` or any new function by `anon`/`public`.
- **SoD comparisons null-safe** (`is not distinct from`). **Rollback** `supabase/migrations/rollback/<NNNN>_<slug>_down.sql`,
  reverse dependency order; it restores replaced bodies verbatim. Rollback refuses while any `time_materials` claim exists.
- **Mutation check is a task** wherever a money or SoD rule is added: break the rule, see red, restore; evidence goes in the PR body.
- **Public repo:** synthetic UUID prefix `15140000-…`, `@example.com` emails, no tenant data, no weakness prose.
- **Commits:** conventional, no attribution trailers; before every push `git log --format=%B origin/dev..HEAD | grep -qi co-authored`
  must not match; never `--no-verify`.

## Fixture F1 (copied verbatim into every T&M pgTAP file; extend, never fork)

One org `15140000-0000-0000-0000-0000000000a1` (UTC), currency IDR project `15140000-…-p1` with a PM, users: `fin1` Finance,
`fin2` Finance (second), `adm` Admin, `pm1` Project Manager of p1, `pm2` PM of another project, `eng1` and `eng2` Engineers; a second
org `…a2` with its own project. An Approved timesheet week for `eng1` on p1 with 8 h on each of 15 weekdays (120 h), one Submitted week
for `eng2`, one Rejected week. A labour rate line "Site engineer" 50,000.00/h on p1 assigned to `eng1`. A project document on p1
(Approved, with a file path) and one without a file. Built with the repo's `tests` helpers as `supabase/tests/equipment_*` do.

---

## T1 - Contract rate card (`0515_contract_rates.sql`) - money setting, ships alone

Owns AC-TM-011 (rate half), AC-TM-012. Files: `supabase/migrations/0515_contract_rates.sql`,
`supabase/migrations/rollback/0515_contract_rates_down.sql`, `supabase/tests/tm_rates.test.sql`.

- **T1.1 (red, 4 min)** `tm_rates.test.sql`: `AC-TM-012 a rate in another currency is refused`, `… overlapping windows refused`,
  `AC-TM-011 a PM cannot save a rate`, `… Finance saves and the audit row has before/after`, `… stale expected_version → 40001`,
  `… identical save adds no version`. Run: see Conventions; expect red (no objects).
- **T1.2 (green, 5 min)** table `contract_rate_lines` (columns per spec §6; `kind check ('labour')` until T5; `rate numeric(14,2)
  check (rate >= 0 and rate < 'Infinity')`; unique `(org_id, project_id, line_key, version)`; partial unique current), `stamp_org_id` trigger,
  RLS + `force row level security`, select policy by role/project (Admin, Finance, Executive; PM when `projects.project_manager_id = auth.uid()`), column grants: select only.
- **T1.3 (green, 5 min)** `save_contract_rate_line(p_line jsonb)` and `end_contract_rate_line(p_project, p_line_key, p_effective_to,
  p_expected_version)` (copy the mechanics of `cost_attribution_write`, `0376:341-388`: org advisory lock, `expected_version`, `is_current` flip, `log_audit`).
  Role gate Admin/Finance first; currency = `projects.currency`.
- **T1.4 (green, 4 min)** `contract_rate_assignees` + `set_contract_rate_assignee(p_project, p_line_key, p_user, p_from, p_to)`;
  overlap refusal `23505`; assignee must be an active member of the org. Red/green test: `AC-TM-012 one person cannot hold two labour lines on one date`.
- **T1.5 (3 min)** self-assertion block, rollback file, denominator JSON, 0178 count (+3).
- **T1.6 Mutation check:** remove the role gate in `save_contract_rate_line`; `AC-TM-011 a PM cannot save a rate` must go red; restore.
- **T1.7 Gate** (Conventions §1 to §6).

## T2 - Assembly and live sources (`0516_tm_claim_assembly.sql`) - money, ships alone

Owns AC-TM-003, AC-TM-005, AC-TM-008 (timesheet half), AC-TM-013.

- **T2.1 (red)** `tm_assembly.test.sql`: the 120 h case lists one line of 120 h; Submitted/Rejected weeks absent; `AC-TM-005` unrated
  (unassigned person, date outside any rate window) listed with reason and absent from the total; `AC-TM-013` three 0.333 h × 100.00 lines; `AC-TM-003` a second assembly omits live hours.
- **T2.2 (green)** tables `tm_claims` (Draft/SignedOff/Withdrawn, currency from project, `gross_amount` check), `tm_claim_lines`
  (unique `(claim_id, line_key, rate_version)`; amount `round(units*rate,2)` check), `tm_claim_sources` (`is_live`; partial unique
  `(source_kind, source_id) where is_live`); indexes `(org_id, project_id, status)` and `(source_id)`; RLS read as T1; no client DML.
- **T2.3 (green)** internal helper `tm_assignable_sources(project, from, to)` (invoker, revoked): approved, non-archived timesheet
  entries joined to the effective assignee line and rate version; returns `unrated_reason` for the rest. Single source for preview and assemble.
- **T2.4 (green)** `assemble_tm_claim(p_project, p_from, p_to, p_work_order, p_exclude jsonb)` inserts the draft claim, lines (rate frozen),
  sources; the insert races on the partial unique and returns the friendly `P0001` "already in claim X". Project-level `for update`
  lock first, then work order billing lock when linked (same order as `create_progress_claim`).
- **T2.5 (green)** `deselect_tm_source(p_claim, p_source)` on a Draft claim, recomputing the line and header in the same transaction.
- **T2.6 (red→green)** `tm_source_is_live(kind, id)` stable; edit `transition_timesheet` (newest body) to refuse Approved → reopen with `55000`
  naming the claim; test `AC-TM-008 reopen of an approved week in a live claim is refused; allowed after withdraw`.
- **T2.7 Mutation checks:** drop the unique index → `AC-TM-003` concurrent case red; remove the `is_live` guard in `transition_timesheet` → `AC-TM-008` red; restore.
- **T2.8 Gate.** 0178 count +2.

## T3 - Client sign-off and the invoice bridge (`0517_tm_signoff.sql`) - money + SoD, ships alone

Owns AC-TM-001, 002, 004, 006, 007, 009, 010, 019.

- **T3.1 (red)** `tm_signoff.test.sql`: the issue acceptance end to end (`AC-TM-001`: 120 h × 50,000.00 → 6,000,000.00, invoice lines
  show the units and rate); `AC-TM-002` raising an invoice for a Draft claim is refused; `AC-TM-006` preparer confirm refused,
  sole-operator allowed, PM refused, missing document/file refused; `AC-TM-007` approver = preparer or confirmer refused, third user ok;
  `AC-TM-004` rate change after confirm leaves the claim; `AC-TM-009` kind `contract`, drawdown rises; `AC-TM-010` WO fence `BW001`.
- **T3.2 (green)** widen `progress_claims.kind` check and `progress_claims_kind_shape` to admit `time_materials` (net-gross shape:
  no down-payment fields, `dp_recovery_amount = 0`); migrate with `alter table … drop constraint … add constraint …` in this order, rollback reverses.
- **T3.3 (green)** `prepare_tm_signoff(p_claim, p_document, p_note)` (Draft claim; `may_record_project_progress`; same-project document),
  `withdraw_tm_signoff(p_claim)` (preparer, Admin, Finance; sets `Withdrawn`, `is_live=false` on its sources), modelled on
  `prepare/withdraw_work_order_acceptance` (`0337:201-266`).
- **T3.4 (green)** `confirm_tm_signoff(p_claim)`: Admin/Finance; preparer ≠ confirmer or the exact `0298` sole-active-member predicate
  (copy `0337:279-282`); document Issued/Approved, same project, with a file; re-validate every source still Approved and live; take
  `lock_work_order_billing` first when a WO is linked and call `assert_work_order_invoiceable(org, wo, project, claim_id::text, gross, currency)`;
  insert `progress_claims` (kind `time_materials`, `created_by` = preparer, gross) and `progress_claim_evidence` for the document;
  status `SignedOff`; `log_audit('tm_signoff.confirm', …)` with basis. One transaction.
- **T3.5 (green)** extend `assert_progress_claim_raisable` (newest body): for a `time_materials` claim require a `tm_claims` row
  `SignedOff` with `confirmed_by` set, else `55000`. Extend `append_progress_claim_author` to also insert the confirmer.
- **T3.6 (green)** a small invoice-line reader for T&M claims used by the native invoice creation path (read the newest
  `create_native_sales_invoice`/claim raise code first; if the claim lines are copied at raise time, add the T&M branch there; do not add a second raiser).
- **T3.7 Mutation checks (evidence in the PR body):** `confirm` without the document → red; preparer = confirmer allowed → `AC-TM-006` red;
  fence returns true for `time_materials` → `AC-TM-019`/`AC-TM-002` red; skip the authors insert → `AC-TM-007` red; restore each.
- **T3.8 Gate.** 0178 count +3; `pmo-portal` gate; rollback refuses while any `time_materials` claim exists.

## T4 - Reads and API tiers (`0518_tm_reads_api_tiers.sql`) - alone

Owns AC-TM-011 (reads), AC-TM-009 (payload proof).

- **T4.1 (red)** `tm_reads.test.sql`: `list_tm_claims(p_project)` and `preview_tm_claim(p_project, p_from, p_to)` return per-line units/rate/amount
  and unrated rows to Finance/Admin/Exec/PM-of-project; Engineer and foreign-org callers get nothing/denied; `get_project_finances` for a
  project with a T&M invoice carries it in contract billing (no code change expected: the test proves it).
- **T4.2 (green)** the two reads (stable, invoker where RLS suffices, definer only if an amounts audience is needed); `api_client_request_guard`
  tiers (newest body): Finance/Admin clients may call rate and sign-off writers and the reads, Engineer clients refused.
- **T4.3 Gate.**

## T5 - Equipment rate lines and usage sources (`0519_tm_equipment.sql`) - money, ships alone, **after #1519 S1**

Owns AC-TM-015.

- **T5.1 (red)** `tm_equipment.test.sql`: 40 h work + 6 h standby, rate 800,000.00/h, no standby rate → bills 40 h, lists 6 h unbilled;
  with a standby rate bills both; draft/rejected usage absent; `AC-TM-008 archiving a usage entry in a live claim is refused`; an asset from another org refused.
- **T5.2 (green)** widen `contract_rate_lines.kind` to admit `equipment` with `asset_id` FK to `equipment_assets` and a check
  (equipment ⇒ asset_id not null, labour ⇒ null); extend `tm_assignable_sources` to union approved `equipment_usage_entries`; extend `tm_source_is_live` use in the usage archive/reopen RPCs (newest bodies).
- **T5.3 Mutation check:** bill standby with no standby rate → red; restore. **Gate.** The internal hire rate (`equipment_costing_settings`)
  is never read: a test asserts the claim rate is unchanged when a hire rate changes.

## T6 - ERP reader for T&M lines (no migration) - money, ships alone, after T3

Owns AC-TM-014. Files: `pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenue.ts` (and its test file),
`supabase/functions/_shared/…` only if the body builder lives there (find it with
`grep -rn "progress_claim_lines" pmo-portal/src supabase/functions`).

- **T6.1 (red)** extend `progressClaimInvoice.test.ts` (import the shipped handler, mock `globalThis.fetch`): a signed T&M claim of 120 h ×
  50,000.00 → body lines `{label, quantity 120, rate 50000, amount 6000000}`; no line for an unsigned source; header = sum; the idempotency key is the claim/invoice id.
- **T6.2 (green)** read `tm_claim_lines` when the claim kind is `time_materials` and map both kinds to one canonical line shape
  (label, unit, quantity, rate, amount, item). Record the field names in the PR body for Odoo's C4b-T1 (`2026-11-02-odoo-client-invoices.md`).
- **T6.3 Mutation check:** include an unsigned line → red; restore. `deno test` via `scripts/deno-test-edge-fns.sh`; vitest for the seam file;
  `scripts/check-edge-fn-test-binding.mjs`.

## T7 - Data layer (no migration) - batchable

Files (new unless noted): `pmo-portal/src/lib/db/timeAndMaterials.ts`, `src/lib/repositories/timeAndMaterials.ts` (+ contract),
`src/hooks/useTimeAndMaterials.ts`, `src/auth/policy.ts` (edit), `src/lib/projectFinances.ts` (no change expected).

- **T7.1 (red→green)** DAL wrappers for each RPC (typed; bounded lists with the `LIST_LIMIT + 1` sentinel); repository seam; hooks with keys
  `[root, orgId, …args]`, mutations invalidate every TM root and `['project-finances']`. Tests: `src/hooks/useTimeAndMaterials.test.tsx` (keys carry org id; confirm invalidates claims and finances).
- **T7.2 (red→green)** policy (UX only, mirrors RPC gates): `tmRate.manage` Admin/Finance; `tmClaim.prepare` per `may_record_project_progress`;
  `tmSignoff.confirm` Admin/Finance and `record.preparedBy !== currentUserId`. Tests in `src/auth/policy.test.ts`.
- **Gate:** `npm run check:guards && npm run typecheck`, touched tests, eslint.

## T8 - Screens (no migration) - batchable, UI lane

Owns AC-TM-016. Strictly `DESIGN.md` tokens; shared primitives (`EntityFormModal`, `useEntityForm`, `TextField`, `SelectField`, `Combobox`,
`FormGrid`, `FieldError`, `ConfirmDialog`, `classifyMutationError`). i18n namespace `timeAndMaterials` (`public/locales/en` and `id`, both complete). Load impeccable + taste + ui-ux-pro-max.

- **T8.1 (red)** `pages/project/TimeAndMaterials.test.tsx`: `AC-TM-016` rate card save, assignee, assemble list with the unrated section, prepare, confirm by a second user, claim detail drill-down; `ConfirmDialog` on confirm and withdraw; axe clean; keyboard path.
- **T8.2 (green)** page under the project Billing tab beside progress claims; rate-card panel; "Create invoice" opens the existing invoice flow with the claim preselected (no new invoice screen).
- **T8.3** `scripts/ux-proof.sh <route>` on the touched routes; one rendered review by the Director; cap one review and one fix.

## T9 - CLI (no migration) - batchable

Owns AC-TM-017. Files: `scripts/lib/pmo-tm.mjs` (new), wired in `scripts/pmo.mjs`, `scripts/pmo-tm.test.mjs` (`node:test`, fake PostgREST; precedent `scripts/lib/pmo-attribution.mjs`).
`tm claim preview` is read-only. Gate: `node --test scripts/*.test.mjs`.

## T10 - One curated e2e (no migration)

Owns AC-TM-018. `pmo-portal/e2e/AC-TM-018-time-and-materials-claim.spec.ts` (read `docs/e2e-parallel-conventions.md`; tag `@e2e-isolation`; no
`process.env.CI` gate). Journey: Finance sets the rate and assignee, a manager approves the engineer's week, PM assembles, a second user confirms the sign-off,
the invoice is raised, the page shows approved units and rate. Run `scripts/e2e-local.sh AC-TM-018` once under the lock. The browser suite itself runs on the release PR only.

## AC → layer traceability

| AC | Layer | Slice | File |
|---|---|---|---|
| AC-TM-001 | pgTAP | T3 | `supabase/tests/tm_signoff.test.sql` |
| AC-TM-002 | pgTAP | T3 | `tm_signoff.test.sql` |
| AC-TM-003 | pgTAP | T2 | `tm_assembly.test.sql` |
| AC-TM-004 | pgTAP | T3 | `tm_signoff.test.sql` |
| AC-TM-005 | pgTAP | T2 | `tm_assembly.test.sql` |
| AC-TM-006 | pgTAP | T3 | `tm_signoff.test.sql` |
| AC-TM-007 | pgTAP | T3 | `tm_signoff.test.sql` |
| AC-TM-008 | pgTAP | T2 (timesheet), T5 (usage) | `tm_assembly.test.sql`, `tm_equipment.test.sql` |
| AC-TM-009 | pgTAP | T3 (write), T4 (payload) | `tm_signoff.test.sql`, `tm_reads.test.sql` |
| AC-TM-010 | pgTAP | T3 | `tm_signoff.test.sql` |
| AC-TM-011 | pgTAP | T1 (rates), T4 (reads) | `tm_rates.test.sql`, `tm_reads.test.sql` |
| AC-TM-012 | pgTAP | T1 | `tm_rates.test.sql` |
| AC-TM-013 | pgTAP | T2 | `tm_assembly.test.sql` |
| AC-TM-014 | Deno | T6 | `progressClaimInvoice.test.ts` (extended) |
| AC-TM-015 | pgTAP | T5 | `tm_equipment.test.sql` |
| AC-TM-016 | Vitest/RTL + axe | T8 | `pages/project/TimeAndMaterials.test.tsx` |
| AC-TM-017 | Vitest (node:test) | T9 | `scripts/pmo-tm.test.mjs` |
| AC-TM-018 | Playwright (one) | T10 | `e2e/AC-TM-018-time-and-materials-claim.spec.ts` |
| AC-TM-019 | pgTAP (mutation) | T3 | `tm_signoff.test.sql` + PR evidence |

Each AC has exactly one owning layer (halves of AC-TM-008/009/011 are the same assertion on two surfaces, recorded here).

## Spec deltas found while planning (none changes a requirement)

1. `progress_claim_lines` cannot hold T&M lines (BoQ key not null), so T&M lines live in `tm_claim_lines` and `progress_claims` carries the header only; the spec's "reuse the claim record" is met at the header, fence, evidence and invoice level.
2. Spec §2 "materials" wording: this issue bills people and machines; priced extras are OQ-TM-10 (default out).
3. T6 is its own slice because the ERPNext claim reader is a shared money file (Odoo's C4b depends on its shape).
