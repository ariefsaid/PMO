# Plan #719 — record change history, DATA LAYER (migration 0260)

**Spec:** [`docs/specs/record-change-history.spec.md`](../specs/record-change-history.spec.md) (binding). **Scope:** D1 capture,
D2 visibility, D3 read-side union with `audit_events` (data layer only), D4 grants + definer hygiene, and the read RPC
the UI will call. **Out of scope:** D5 (the History tab UI, `RecordHistory`, the repository, i18n) — a later ticket;
AC-CHG-015..019 belong to it.
**Owner acceptance (2026-10-06):** every open question at its recommended default — Q1 first set only · Q2 contact
email/phone/notes `flag` only · Q3 no export · Q4 no DELETE capture · Q5 read-side merge for audit readers · Q6
indefinite retention · Q7 project History includes child events, with kind filters (`docs/decisions.md` OD-CHG-1).

## Decisions taken in this plan (each names what it settles)

1. **Migration slot `0260`** — the spec's `0219` is stale. Forward `supabase/migrations/0260_record_change_history.sql`,
   rollback `supabase/migrations/rollback/0260_record_change_history_down.sql`.
2. **Trigger name `<table>_zz_record_change`**, `AFTER INSERT OR UPDATE ... FOR EACH ROW`. AFTER means it reads `NEW`
   after every BEFORE trigger (org stamp, currency stamp, tax base, witness stamps); the `zz_` slot also sorts it after the
   table's other AFTER triggers (audit, cascade, notify), the `0215` convention.
3. **Parent resolution is static, not dynamic SQL.** The registry carries `parent_col` (a column on the row) and an
   optional `parent_via` (`'budget_versions'` or `'procurements'`, enforced by a CHECK) for the two one-hop cases:
   a budget line rolls up to its version's project, and a PR / RFQ / PO / payment to its procurement's project
   (spec table: "Parent = project"). The trigger resolves `parent_via` with a fixed `if/elsif`. A budget line takes
   `currency` from its version (the line has none).
4. **Unknown table = loud failure.** The trigger raises when its table has no registry row; `record_history_visible`
   raises for an entity type with no arm. The catalog gate (AC-CHG-011) calls the latter for every registry entity, so a
   missing arm is a red test, not a silent "no history".
5. **`service_role` keeps the table defaults** on both new tables (the `audit_events` shape; `0137` AC-SVCROLE-008
   requires INSERT on every public table). "Client role" in D4 / AC-CHG-009 = `anon`, `authenticated`.
6. **Read API = `list_record_history(...)`, SECURITY INVOKER.** It reads `record_changes` and `audit_events` as the
   caller, so each table's own RLS decides: history rows by D2's policy, audit lines by `audit_events_select`
   (own-org Admin / Operator). A non-Admin therefore gets no audit lines without any role check in the function
   (FR-CHG-011 "where the caller can read `audit_events`"). Being invoker, it is outside the `0178` definer allow-list:
   the allow-list count is **59**, re-derived from the current file and unchanged.
   - Signature: `list_record_history(p_entity_type text, p_entity_id uuid, p_include_children boolean default false,
     p_entity_types text[] default null, p_before_seq bigint default null, p_before_at timestamptz default null,
     p_limit integer default 50)`; `p_limit` is clamped to 1..200.
   - Change rows page by `seq` (newest first, served by the two indexes). Audit lines have no `seq` (returned as
     `null`); each page returns the audit lines whose `created_at` falls in `[min(created_at) of this page,
     p_before_at)`; the last page (fewer change rows than `p_limit`) has no lower bound. The client passes the smallest
     `seq` and the smallest `created_at` it has received so far as the next cursor, so every audit line lands on exactly
     one page.
   - Audit lines are the requested record's own (`entity_id = p_entity_id`), also when children are included:
     audit rows carry no entity type or parent, and resolving child ids per page would scan every child event.
   - Audit actions already covered by a captured field change, or with no record page, are excluded:
     `project.create`, `project.transition`, `project.contract_value.set`, `work_order.create`,
     `work_order.transition`, `work_order.value.set`, `budget_version.create`, `budget_version.update`,
     `procurement.create`, and every `*.delete`.
7. **Whole-row `to_jsonb` is in-memory only.** NFR-CHG-005's "flag/omit columns are never serialized" is met for what
   is *written*: the diff loops over the registry's captured and flag lists, and a flag column contributes only
   `{"changed":true}`. An exact no-op (`OLD is not distinct from NEW`) returns before any jsonb is built.
8. **Actor:** `auth.uid()`; only when it is null, the transaction-local `app.actor_id` (empty string = unset); else null.

## Column classification (spec D1 "fixed in the plan's task 1")

Kinds: `text | number | money | date | timestamp | enum | ref | bool`. Every column of every tracked table is in
exactly one list (gated by AC-CHG-011). Omit reasons: **K** key/tenancy/bookkeeping (`id`, `org_id`, `created_at`,
`updated_at`, `last_update`), **S** stamped by a trigger or a transition RPC (the source edit is captured instead),
**I** import stamps, **E** external-sync mirror.

| entity_type (table) | parent | captured | flag | omit |
|---|---|---|---|---|
| `project` (`projects`) | — | code, name text · status enum · client_id ref · project_manager_id ref · end_client_id ref · contract_value, budget, spent, tax_amount money · tax_rate number · start_date, end_date, contract_date date · archived_at timestamp · customer_contract_ref, currency, tax_template, service_line, sector, location, award_type, bidding_entity text · tax_treatment enum · subject_to_vat bool | — | K: id, org_id, created_at, last_update · S: decided_at, contract_value_set_by, contract_value_set_at, tax_base_numerator, tax_base_denominator, pmo_project_number · I: import_batch_id, imported_at, import_key |
| `budget_version` (`budget_versions`) | project (`project_id`) | project_id ref · version number · name text · status enum · currency text | — | K: id, org_id, created_at · S: activated_at · I |
| `budget_line_item` (`budget_line_items`) | project (via `budget_versions`) | budget_version_id ref · category enum · description, fiscal_year text · budgeted_amount, actual_amount money | — | K: id, org_id · I |
| `work_order` (`work_orders`) | project (`project_id`) | project_id ref · wo_number, client_po_number, title, currency, tax_template text · status, tax_treatment enum · order_value, tax_amount money · tax_rate number · order_date, start_date, end_date date | description | K: id, org_id, created_at · S: order_value_set_by, order_value_set_at, issued_by, issued_at, over_commit_ack_by, over_commit_ack_at, closed_at, cancelled_at, tax_base_numerator, tax_base_denominator |
| `procurement` (`procurements`) | project (`project_id`) | code, title, pr_number, po_number, currency text · project_id, requested_by_id, vendor_id ref · status, budget_category enum · total_value money | approval_notes, rejection_notes | K: id, org_id, created_at, updated_at · S: approved_by_id, vendor_invoiced_at · I |
| `purchase_request` (`purchase_requests`) | project (via `procurements`) | procurement_id ref · pr_number, reference_number, currency text · status enum · date date · amount money | — | K: id, org_id, created_at · I · E: erp_docstatus, erp_modified, erp_amended_from, erp_cancelled_at, external_ref |
| `rfq` (`rfqs`) | project (via `procurements`) | procurement_id ref · rfq_number, reference_number, currency text · status enum · date date · amount money | — | K · I · E: erp_docstatus, erp_modified, erp_amended_from, erp_cancelled_at |
| `purchase_order` (`purchase_orders`) | project (via `procurements`) | procurement_id ref · po_number, reference_number, currency text · status enum · date date · amount money | — | K · I · E: erp_* (4), external_ref |
| `payment` (`payments`) | project (via `procurements`) | procurement_id, invoice_id ref · pay_number, reference_number, currency text · status enum · date date · amount money | — | K · I · E: erp_* (4) |
| `task` (`tasks`) | project (`project_id`) | project_id, assignee_id, milestone_id, parent_task_id, meeting_id ref · name text · status, priority enum · start_date, end_date date · archived_at timestamp | description | K: id, org_id, created_at · S: completed_at, created_by · E: tombstoned_at, source_updated_at |
| `company` (`companies`) | — | name, short_name, client_number_segment text · type enum · archived_at timestamp | — | K: id, org_id, created_at · E: erp_party_type, erp_supplier_name, erp_customer_name, erp_tax_id, erp_payment_terms_days, erp_cancelled_at, erp_docstatus, erp_modified, erp_amended_from |
| `contact` (`contacts`) | company (`company_id`) | company_id ref · full_name, title text · archived_at timestamp | email, phone, notes | K: id, org_id, created_at · E: erp_modified |

(`pmo_project_number` is minted on insert and immutable, so S.)

## AC traceability (data-layer ACs only)

| AC | Owning test (pgTAP) |
|---|---|
| AC-CHG-001 one event, both columns, PM actor, parent null | `supabase/tests/record_changes_capture.test.sql` |
| AC-CHG-002 `updated_at`/`last_update`-only and same-value updates write nothing | `record_changes_capture.test.sql` |
| AC-CHG-003 company insert → one `insert` event, actor, empty changes | `record_changes_capture.test.sql` |
| AC-CHG-006 task date move → parent = project (also the via-parent for a budget line and a PO) | `record_changes_capture.test.sql` |
| AC-CHG-012 archive then restore → two `archived_at` events | `record_changes_capture.test.sql` |
| AC-CHG-013 rolled-back change leaves no event | `record_changes_capture.test.sql` |
| AC-CHG-004 contact `phone` → `{"changed":true}`, values absent from `changes::text`; omit-only update → no event | `record_changes_classification.test.sql` |
| AC-CHG-005 definer RPC actor; service-role `app.actor_id` set / unset; JWT user cannot override | `record_changes_actor.test.sql` |
| AC-CHG-007 same-org reader sees; org-B user reads zero and cannot insert into org A | `record_changes_visibility.test.sql` |
| AC-CHG-008 Engineer reads what they can read; deactivated member reads zero; source hidden by a narrower policy → zero | `record_changes_visibility.test.sql` |
| AC-CHG-009 client INSERT/UPDATE/DELETE/TRUNCATE on `record_changes`, any read of `record_history_config` → 42501 | `record_changes_grants.test.sql` |
| AC-CHG-010 function ACL, checked against the hosted grant shape | `record_changes_grants.test.sql` |
| AC-CHG-011 catalog gate + planted-defect self-test | `record_changes_catalog_gate.test.sql` |
| AC-CHG-014 500-row update → 500 events with correct values; bulk task update: one per changed row, none for no-op rows | `record_changes_bulk.test.sql` |
| AC-CHG-020 (new) read RPC: own + child events newest first, kind filter, `seq` cursor, RLS-scoped | `record_history_read.test.sql` |
| AC-CHG-021 (new) read RPC audit union: Admin gets non-covered audit lines exactly once across pages; covered actions excluded; non-Admin gets none | `record_history_read.test.sql` |

Mutation checks (spec "Deploy"), run on a scratch database and reverted, results in the PR: (M1) replace the
`record_changes_select` predicate with `true` → AC-CHG-007/008 go red; (M2) make the trigger take the actor from
`app.actor_id` ahead of `auth.uid()` → AC-CHG-005 goes red.

## Tasks

Conventions: fixture ids prefix `07190000-…`; every test `begin; … select * from finish(); rollback;`; every denial
asserts the exact SQLSTATE. DB-free sandbox: tests are run against a scratch Postgres with the Supabase roles shimmed,
CI's `pgtap` job is the proof of record.

### T0 — docs (this file + decision line) · commit `docs(history): #719 data-layer plan + OD-CHG-1 (#719)`
- This plan; `docs/decisions.md` gains `OD-CHG-1` (one line); spec gains AC-CHG-020/021 and the 0260 slot.

### T1 — RED: capture tests (2–5 min each)
1. `supabase/tests/record_changes_capture.test.sql` — AC-CHG-001/002/003/006/012/013 as above.
2. `supabase/tests/record_changes_classification.test.sql` — AC-CHG-004 (contact phone + email + notes flag; a
   `contacts.erp_modified`-only update writes nothing; a `tasks.description` change is `{"changed":true}`).
3. `supabase/tests/record_changes_actor.test.sql` — AC-CHG-005 (Finance via `set_project_contract_value` on a
   `Won, Pending KoM` project; `reset role` + `set local app.actor_id`; unset → null; PM JWT + `app.actor_id` = other user → PM).
4. Verify red: `psql -f` each file → fails on missing `record_changes`.

### T2 — GREEN: migration core
1. `supabase/migrations/0260_record_change_history.sql` §1 `record_history_config` (PK `entity_type`, unique
   `table_name`, `captured jsonb`, `flag_cols text[]`, `omit_cols text[]`, `parent_type`, `parent_col`, `parent_via`
   CHECK) + seed rows from the classification table.
2. §2 `record_changes` + the two indexes, `FORCE RLS`.
3. §3 `record_change_capture()` (definer, `search_path = public`) and §4 attach-by-list `do $$` (drop-then-create).
4. Verify T1 files green.

### T3 — visibility + grants
1. RED `record_changes_visibility.test.sql` (AC-CHG-007/008), `record_changes_grants.test.sql` (AC-CHG-009/010; grant
   EXECUTE to `anon`/`authenticated` inside the test to mirror the hosted default, then assert the migration's
   explicit revokes hold by re-running the migration's grant block — and assert `proacl` directly).
2. GREEN §5 `record_history_visible()` (invoker, static `case`, raise on unknown) + `record_changes_select` policy;
   §6 grants/revokes; §8 closing `do $$` ACL + classification self-assertion.

### T4 — catalog gate + bulk
1. `record_changes_catalog_gate.test.sql` (AC-CHG-011): offenders view over registry × `pg_trigger` × `pg_attribute` ×
   `has_column_privilege`; arm check via `lives_ok`; planted defects (`alter table companies add column`, `drop trigger
   contacts_zz_record_change`, a registry row with no arm) each named by the gate.
2. `record_changes_bulk.test.sql` (AC-CHG-014): 500 tasks, one `update ... set end_date = end_date + 1`; 500 events,
   spot + aggregate old/new check; a bulk update where half the rows are no-ops → events only for the changed half.

### T5 — read API
1. RED `record_history_read.test.sql` (AC-CHG-020/021).
2. GREEN §7 `list_record_history(...)` invoker SQL function; revoke from `public, anon`; grant `authenticated`.

### T6 — rollback, denominators, types
1. `supabase/migrations/rollback/0260_record_change_history_down.sql` — drop triggers by list, functions, tables.
   Verify: apply forward → down → forward on the scratch DB.
2. `scripts/isolation-probe-denominator.json` — add `record_changes` (`has_org` true, pk `id`) and
   `record_history_config` (`has_org` false, pk `entity_type`); no definer function to add (the capture function
   returns `trigger`, the others are invoker). Verify `node scripts/check-isolation-denominator.mjs` against the
   scratch DB.
3. `pmo-portal/src/lib/supabase/database.types.ts` — hand-add the two tables and the two callable functions.
   Verify `npm run typecheck`.

### T7 — full regression + mutation checks
1. Re-run every `supabase/tests/*.sql` file; the set of failing files must equal the pre-migration baseline (shim gaps).
2. M1 / M2 as above; record red counts; revert; re-run green.
3. Local gate: `npm ci`, `npm run typecheck`, `npx eslint --max-warnings=0` (no TS source touched except the types
   file), `npm run check:i18n`, `npm run build`.

## Results (2026-10-06, scratch Postgres 16 with the Supabase roles/auth/storage shimmed; CI `pgtap` is the proof of record)

- New files: 8 pgTAP files, 105 assertions, all green.
- Full suite: every existing `supabase/tests/*.sql` file run before and after 0260. The set of failing files is the
  same (shim gaps: dblink, per-database role settings, local default privileges); none fails because of 0260, and
  `dead_authenticated_write_grants` AC-DWG-011's offender list is identical before and after (no new table in it).
- Hosted grant shape: 0260 applied on a database whose `postgres` default privileges grant EXECUTE on functions and
  ALL on tables to `anon`/`authenticated` → the §8 self-assertion passes and `record_changes_grants` is 22/22.
  With the `record_change_capture` revoke removed, §8 raises (`function ACL is not the intended shape`).
- Rollback: forward → `rollback/0260_…_down.sql` → forward on one database; triggers, functions and tables gone after
  the down, capture suite green after the re-apply.
- `node scripts/check-isolation-denominator.mjs` against the migrated database: PASS (tables=97); with the old
  manifest it names both new tables as MISSING.
- Mutation M1 (`record_changes_select` predicate → `true`): `record_changes_visibility` 6 red (cross-org ×2,
  deactivated ×2, narrower-policy, hard-deleted) and `record_history_read` 1 red (deactivated). Reverted → green.
- Mutation M2 (actor = `app.actor_id` ahead of `auth.uid()`): `record_changes_actor` 2 red (JWT user re-attributed).
  Reverted → green.
- TDD note: `list_record_history` was written with §5–§7 before `record_history_read.test.sql`; the test's binding
  was proven by mutating the function (window bound and delete exclusion removed → 7 of 14 red), then restored.
- Local gate: `npm ci`, `npm run typecheck`, `npx eslint --max-warnings=0 src/lib/supabase/database.types.ts`,
  `npm run check:i18n`, `npm run build` all exit 0.
