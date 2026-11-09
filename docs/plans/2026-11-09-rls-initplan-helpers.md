# Plan: RLS helpers once per query, ALL write policies split (#842)

**Status:** plan only. **Migrations:** 0820–0825. **Tier:** RLS on every business table, so each slice gets
the three reviewers with security-auditor at depth.

## 0. What already shipped (read this before building anything)

The headline of #842 is done. #1254 (closed) shipped it in three migrations:

- `0646_rls_caller_initplans.sql`: every bare `auth_org_id()`, `auth_role()`, `is_active_member()`,
  `is_operator()` became `(select fn())`, generated from `pg_policy` with a drift guard.
- `0655_profiles_rls_initplans_and_features_set_based.sql`: the same for the six `profiles` policies.
- `0696_rls_row_policies_once_per_query.sql`: `auth.uid()`, `auth.jwt()`, `stock_admin()`,
  `stock_master_writer()`, `holds_spend_approval_authority(<wrapped role>)`.

Their catalog guards already fail CI on a bare zero-argument helper in any public or storage policy:
`supabase/tests/0646_rls_initplan.test.sql` and `supabase/tests/0696_rls_once_per_query_equivalence.test.sql`.

This plan covers only what is left: **two gaps** found in the inventory below.

## 1. Inventory

**Method.** Deciding artifact: `pg_policies` on the local stack, whose
`supabase_migrations.schema_migrations` max version is `0770` (the last migration on `origin/dev`,
2026-11-09). This is PostgreSQL's own deparse after every migration ran, so "latest definition wins" is
already applied. Scope: schemas `public` and `storage` (plus `cron`, noted only). Rebuild the numbers with
the queries in §1.4 before starting slice 1; if they differ, regenerate the slice lists.

**Totals:** 351 policies in `public` and 9 in `storage`. 362 public/storage policies call at least one
caller helper (1,392 calls). **Bare zero-argument helper calls: 0.**

### 1.1 Gap A: constant-argument helpers still run per row (141 calls, 87 policies, 37 tables)

`org_feature_enabled(p_org_id, p_key)` (plpgsql, security definer, STABLE, reads `org_features`) and
`domain_externally_owned(p_org_id, p_domain)` (sql, STABLE) are called with arguments that are constant for
the statement: `org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'procurement'::text)`. The inner
call is an initplan, but the outer function still runs once per row; PostgreSQL does not hoist a function
call because its arguments are constant. No policy passes a column (`org_id`) to either helper (0 found).

Tables (policy count): boq_items 3, budget_projections 1, companies 4, contacts 4, crm_activities 1,
external_reference_items 1, fx_rates 2, imprest_plan_lines 1, imprest_plans 1, incident_reports 3,
incoming_payments 3, payment_files 2, payments 3, procurement_documents 1, procurement_invoice_files 2,
procurement_invoices 3, procurement_items 7, procurement_quotation_files 2, procurement_quotations 1,
procurement_receipt_files 2, procurement_receipts 3, procurements 3, progress_assessment_quantities 3,
project_progress_entries 2, purchase_order_files 2, purchase_orders 3, purchase_request_files 2,
purchase_requests 1, rfq_files 2, rfqs 1, sales_invoices 3, stock_items 3, stock_units 3,
stock_warehouses 3, timesheet_entries 1, timesheets 2, user_views 3.

**Not in scope (per row by design):** 21 policies on 10 tables call helpers that take a row column
(`can_read_comment_parent(entity_type, entity_id)`, `can_read_meeting(meeting_id)`,
`task_domain_externally_owned(project_id)`, `may_record_project_progress(project_id)`,
`record_history_visible(...)`, `progress_assessment_line_ok(...)`, `boq_allowance_ok(...)`,
`boq_allowance_clear_ok(...)`, `has_meeting_grant(...)`, `is_meeting_attendee(...)`,
`profile_prefs_unchanged(...)`, `may_administer_profile(...)`). They depend on the row, so an initplan is
impossible; speeding them up means rewriting each as a join, a separate issue if a measurement asks for it.

### 1.2 Gap B: ALL-command policies (36)

An `ALL` policy is also a permissive `SELECT` policy, so every read ORs it with the table's own `SELECT`
policy, row by row (and every Gap A call inside it runs on reads too).

| Group | Table | ALL policy | Other permissive SELECT | Other write policies |
|---|---|---|---|---|
| Procurement core | procurement_items | procurement_items_write | 1 | 6 |
| | procurement_quotations | procurement_quotations_write | 1 | 0 |
| | procurement_documents | procurement_documents_write | 1 | 0 |
| | purchase_requests | purchase_requests_write | 1 | 0 |
| | rfqs | rfqs_write | 1 | 0 |
| Evidence files | procurement_invoice_files | procurement_invoice_files_write | 1 | 1 |
| | procurement_quotation_files | procurement_quotation_files_write | 1 | 1 |
| | procurement_receipt_files | procurement_receipt_files_write | 1 | 1 |
| | payment_files | payment_files_write | 1 | 1 |
| | purchase_order_files | purchase_order_files_write | 1 | 1 |
| | purchase_request_files | purchase_request_files_write | 1 | 1 |
| | rfq_files | rfq_files_write | 1 | 1 |
| Budget/finance | budget_category_account_map | budget_category_account_map_write | 1 | 0 |
| | budget_line_items | budget_line_items_write | 1 | 0 |
| | budget_projections | budget_projections_write | 1 | 0 |
| | budget_versions | budget_versions_write | 1 | 0 |
| | expense_claim_files | expense_claim_files_write | 1 | 0 |
| | expense_claim_lines | expense_claim_lines_write | 1 | 0 |
| | imprest_plan_lines | imprest_plan_lines_write | 1 | 0 |
| Delivery/CRM | projects | projects_write | 1 | 1 |
| | project_documents | project_documents_write | 1 | 2 |
| | project_milestones | project_milestones_write | 1 | 0 |
| | task_dependencies | task_dependencies_write | 1 | 0 |
| | timesheet_entries | timesheet_entries_write | 1 | 0 |
| | crm_activities | crm_activities_write | 1 | 0 |
| | pipeline_stage_config | pipeline_stage_config_write | 1 | 0 |
| Platform/storage | external_domain_ownership | external_domain_ownership_write | 1 | 0 |
| | external_reference_items | external_reference_items_write | 1 | 0 |
| | org_features | org_features_write | 1 | 2 |
| | storage.objects | storage_objects_agent_attachments_write | 4 | 5 |
| | storage.objects | storage_objects_expense_receipt_write (role `authenticated`) | 4 | 5 |
| | storage.objects | storage_objects_project_doc_write | 4 | 5 |
| Left as is | odoo_ledger_census_seen, odoo_revenue_census_seen | `*_service` | 0 | 0 |
| | cron.job, cron.job_run_details | pg_cron's own | 0 | 0 |

All 34 public/storage ALL policies are permissive with an explicit `WITH CHECK`. **In scope: 32.** The two
`*_census_seen` policies only match the service role, which bypasses RLS; they are the table's only
policy, so a read costs one initplan and there is nothing to OR with. The two `cron` policies belong to the
extension.

### 1.3 Restrictive policies (not changed, but they AND with everything above)

public: 35 SELECT, 4 INSERT, 3 UPDATE, 13 DELETE; storage: 1 each for INSERT/UPDATE/DELETE. Gap A wraps
inside restrictive policies keep them restrictive (`ALTER POLICY` restates only expressions). Gap B never
touches a restrictive policy.

### 1.4 Inventory queries (re-run before slice 1, read-only)

```sql
-- Gap A: tables and policies with a per-row constant-argument helper
select schemaname||'.'||tablename, policyname, cmd, permissive
from pg_policies
where schemaname in ('public','storage')
  and coalesce(qual,'')||coalesce(with_check,'')
      ~ '(?<!SELECT )(org_feature_enabled|domain_externally_owned)\(\( SELECT auth_org_id\(\) AS auth_org_id\), ''[a-z_]+''::text\)'
order by 1, 2;

-- Gap B: ALL-command policies
select schemaname, tablename, policyname, permissive, roles, qual, with_check
from pg_policies where cmd = 'ALL' order by 1, 2;
```

## 2. Rewrite patterns

### 2.1 Gap A: wrap the whole call

```sql
-- before
org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'procurement'::text)
-- after
( SELECT org_feature_enabled(( SELECT auth_org_id() AS auth_org_id), 'procurement'::text) AS org_feature_enabled)
```

Same for `NOT domain_externally_owned(...)` (the `NOT` stays outside the sub-select). Apply with
`ALTER POLICY ... USING (...) [WITH CHECK (...)]` only: policy OID, name, command, roles, permissive mode and
comment stay untouched, as 0646 did. Both helpers are STABLE and statement-invariant for these arguments,
so the result is identical and only the call count changes (once per statement instead of once per row).
A NULL result stays NULL inside the scalar sub-select, so three-valued logic is unchanged.

**Generate, do not hand-type.** Follow 0646's method: read the clause from `pg_policies`, apply a
token-aware transform that wraps only the two helper calls (string literals masked first, as the 0646 test's
`regexp_replace(... '''([^'']|'''')*''' ...)` does), record the insertion count per clause, and emit
`ALTER POLICY`. Prefix every migration with 0646's drift guard: lock the tables, compare the current
`pg_get_expr` text to the captured baseline, `raise exception` on any mismatch.

### 2.2 Gap B: split ALL into INSERT / UPDATE / DELETE, keep SELECT only when needed

An `ALL` policy with `USING u WITH CHECK c` means: SELECT `u`; INSERT check `c`; UPDATE using `u`, check `c`;
DELETE using `u`. Replace it, in one transaction, with:

```sql
drop policy <t>_write on public.<t>;
create policy <t>_write_insert on public.<t> as permissive for insert to <same roles> with check (<c>);
create policy <t>_write_update on public.<t> as permissive for update to <same roles> using (<u>) with check (<c>);
create policy <t>_write_delete on public.<t> as permissive for delete to <same roles> using (<u>);
-- only when u is NOT implied by an existing permissive SELECT policy for the same roles (see below):
create policy <t>_write_select on public.<t> as permissive for select to <same roles> using (<u>);
comment on policy <t>_write_insert on public.<t> is '<old comment> (split from <t>_write, 0820)';
-- same comment line for each new policy
```

**The SELECT branch is the one semantic trap.** Dropping the ALL policy removes `u` from the SELECT path.
That also matters for UPDATE/DELETE: PostgreSQL applies SELECT policies to any UPDATE/DELETE that reads the
row (a `WHERE`, `RETURNING`), so a row visible only through `u` would become unreadable *and* unwritable.
Per table, decide:

- **Drop the SELECT branch** only if `u` implies the table's permissive SELECT `USING` (each conjunct of the
  SELECT policy appears in `u`, after the 0646 normal form). Typical: `u` = org + active member + role list,
  SELECT = org + active member. Record the conjunct match in the migration header.
- **Otherwise keep `<t>_write_select`** with `u` verbatim. At 0770 every public ALL policy and its table's
  SELECT policy both carry `org_id = (select auth_org_id())` and `(select is_active_member())`, so the
  check is mostly about extra SELECT conjuncts (`archived_at`, feature gates, parent `EXISTS`) that `u`
  lacks. Keeping the branch preserves today's behaviour exactly; tightening it would be a separate,
  owner-ruled change, not part of this issue.

Names: check each new name is free first (`procurement_items_insert` etc. exist already, which is why the
suffix is `_write_insert`, not `_insert`).

## 3. Proving behaviour unchanged

Two layers per slice, both pgTAP (CI's `pgtap` job runs on any `supabase/**` change; no local runs under the
current owner rule).

**3.1 New catalog equivalence test per slice** (`supabase/tests/082N_<group>_policy_shape.test.sql`):

- Gap A: for each altered policy, the stored `pg_get_expr` equals the captured baseline with only the
  wrap applied (insertion count equal to the recorded count), and roles / cmd / permissive / comment are
  unchanged.
- Gap B: no `ALL` policy left on the slice's tables; each new policy's `qual` / `with_check` equals the old
  `u` / `c` text exactly; roles and permissive mode equal the old ones; `<t>_write_select` exists exactly
  where the slice header says it must.
- Behaviour probes in the 0696 style: per role (Admin, Executive, Project Manager, Finance, Engineer, an
  inactive member, a second-org member), `set local role authenticated` + `request.jwt.claims`, count
  visible rows and attempt one INSERT / UPDATE / DELETE; the expected numbers are written as literals
  captured from the pre-change behaviour (computed in the test's first block against the baseline policy,
  then re-checked after applying the migration's statements inside the same transaction, as 0696 does).

**3.2 Existing suites must stay green untouched** (outcome assertions never edited):

| Group | Suites that own the behaviour |
|---|---|
| Procurement core | `0004_rls_remediation`, `0014_procurement_role_gate`, `0015_procurement_sod`, `0018_procurement_new_table_rls`, `0045_procurement_rls_hardening`, `0052_procurement_crud`, `0056_procurement_items_read`, `0108_index_gap_hardening`, `0171_sod_class_completeness`, `0173_rpc_active_member_gate`, `m365_doc_linking_rls` |
| Evidence files | `0070_procurement_files_rls`, `0071_procurement_files_storage_rls`, `0078_procurement_record_files_rls`, `0110_procurement_records_write_hardening`, `0170_delete_path_sod_and_project_money_sod`, `0349_procurement_evidence_files` |
| Budget/finance | `0009_budget_role_gate`, `0010_budget_tenant_isolation`, `0060_finance_budget_review`, `0169_create_path_sod_residuals`, `0170_delete_path_sod_and_project_money_sod`, `0270_expense_posting_gate`, `0311_ledger_read_role_alignment`, `budget_category_account_map_rls`, `budget_projections_rls`, `expense_claims_schema_rls`, `imprest_rls`, `bfy_fiscal_year_rls_and_rpc_security` |
| Delivery/CRM | `0002_tenant_isolation`, `0032_pipeline_stage_config_rls`, `0033_project_direct_update_revoked`, `0046`–`0049` timesheet entry suites, `0050_soft_archive`, `0052_project_documents_crud`, `0053_document_transition_sod`, `0061_milestones_rls`, `0062_milestones_tenant_isolation`, `0072_crm_rls`, `0073_crm_activity_rls`, `0103_project_delete_admin_only`, `0165_timesheet_entry_date_bound_to_sheet_week`, `0268_role_gate_hardening`, `tasks_external_owned_rls` |
| Platform/storage | `0122_org_features_rls`, `0123_org_features_core_never_gated`, `0138_feature_flag_write_enforcement`, `0145_task_archive_rollup_and_rls`, `0168_update_path_sod_class`, `0655_profiles_rls_and_features_set_based`, `external_reference_items_rls`, `0067_document_storage_rls`, `0310_document_storage_read_alignment`, `0178_m365_member_gate` |
| All slices | `0001_rls_enabled`, `0005_force_rls`, `0137_service_role_grants`, `0178` definer allow-list, `0646_rls_initplan`, `0696_rls_once_per_query_equivalence`, the isolation-probe denominator (`scripts/check-isolation-denominator.mjs`) |

**3.3 Name-pinned references to update (policy name only, never an outcome).** These mention a
`*_write` ALL policy by name and must follow the split in the same slice:
`0010_budget_tenant_isolation`, `0033_project_direct_update_revoked`, `0046_timesheet_entry_with_check`,
`0049_timesheet_entry_project_tenancy`, `0050_soft_archive`, `0052_project_documents_crud`,
`0058_lint_hardening`, `0061_milestones_rls`, `0103_project_delete_admin_only`,
`0165_timesheet_entry_date_bound_to_sheet_week`, `0171_sod_class_completeness` (AC-SCC-083 text says
"rides on the FOR ALL budget_line_items_write policy"), `0173_rpc_active_member_gate`,
`0178_m365_member_gate`, `0268_role_gate_hardening`, `0310_document_storage_read_alignment`,
`bfy_column_nullable`, `bfy_draft_guard_fiscal_year`, `bfy_fiscal_year_rls_and_rpc_security`,
`erpnext_timesheets_module_unchanged_when_flipped`; scripts `scripts/check-module-completeness.mjs` (+ its
`.test.mjs`; it parses `timesheet_entries_write` and the `org_feature_enabled(` gate text, so check its
matcher accepts the wrapped form) and `scripts/m365-document-link-policy-mutation.mjs` (+ `.test.mjs`;
lists `project_documents_write` / `procurement_documents_write` with `command: 'ALL'`).

## 4. Mechanical checker

The zero-argument checker already exists as pgTAP catalog guards (0646, 0696) and runs in CI. Extend that
pattern rather than adding a text linter: it reads PostgreSQL's deparse, so it cannot be fooled by
formatting, comments or a later `ALTER POLICY`. A migration-text grep can.

New `supabase/tests/0825_rls_policy_shape_guard.test.sql`:

1. **Constant-argument guard.** Count `org_feature_enabled(` / `domain_externally_owned(` calls in
   `qual`/`with_check` of every public/storage policy whose arguments are only initplans and literals and
   that are not the sole expression of an enclosing `( SELECT ... AS ...)`. Must be 0. Reuse 0696's
   literal-masking and "wrapped" regexes; generalize the helper list into one array so the next helper is a
   one-word addition.
2. **ALL allowlist.** `select array_agg(schemaname||'.'||policyname order by 1) from pg_policies where
   cmd = 'ALL'` equals the allowlist `{cron.cron_job_policy, cron.cron_job_run_details_policy,
   public.odoo_ledger_census_seen_service, public.odoo_revenue_census_seen_service}`. A new ALL policy, or
   a stale entry, fails.
3. **Self-tests** (the gate is gated, as 0696 does): temporary control policies with a bare, a wrapped, a
   nested and a column-argument call; assert the detector counts 1 / 0 / 1 / 0.

## 5. Slices (each task 2–5 min; one migration + rollback + test per slice)

Common tasks in every slice (N = slice migration number):

1. Re-run §1.4 for the slice's tables; paste the `pg_policies` rows into the plan PR description.
2. Generate `supabase/migrations/0N_<slug>.sql` from the catalog (§2), drift guard first.
3. Write `supabase/migrations/rollback/0N_<slug>_down.sql`: Gap B drops the new policies and recreates the
   ALL policy verbatim (with comment); Gap A restores the captured expressions by `ALTER POLICY`.
4. Write `supabase/tests/0N_<group>_policy_shape.test.sql` (§3.1) first; it must fail before the migration
   (ALL policy still present, wrap count 0).
5. Update the name-pinned references for the slice's tables (§3.3).
6. For each Gap B table, record the SELECT-branch decision (dropped / kept, with the conjunct match) in the
   migration header.
7. Local gate allowed under the current owner rule: `npm run check:guards`, `node --check` on touched
   scripts, `bash scripts/check-migration-collisions.sh`. CI runs pgTAP.

| Slice | Migration | Gap B tables (ALL split) | Gap A tables (wrap) |
|---|---|---|---|
| 1 Procurement core | `0820_rls_procurement_core_policy_shape.sql` | procurement_items, procurement_quotations, procurement_documents, purchase_requests, rfqs | procurements, procurement_items, procurement_quotations, procurement_documents, procurement_invoices, procurement_receipts, purchase_orders, purchase_requests, rfqs |
| 2 Evidence files + receivables | `0821_rls_evidence_files_policy_shape.sql` | procurement_invoice_files, procurement_quotation_files, procurement_receipt_files, payment_files, purchase_order_files, purchase_request_files, rfq_files | the same seven + payments, incoming_payments, sales_invoices |
| 3 Budget/finance | `0822_rls_budget_finance_policy_shape.sql` | budget_category_account_map, budget_line_items, budget_projections, budget_versions, expense_claim_files, expense_claim_lines, imprest_plan_lines | budget_projections, imprest_plan_lines, imprest_plans, fx_rates |
| 4 Delivery/CRM | `0823_rls_delivery_crm_policy_shape.sql` | projects, project_documents, project_milestones, task_dependencies, timesheet_entries, crm_activities, pipeline_stage_config | timesheet_entries, timesheets, crm_activities, companies, contacts, incident_reports, boq_items, progress_assessment_quantities, project_progress_entries |
| 5 Platform + storage | `0824_rls_platform_storage_policy_shape.sql` | external_domain_ownership, external_reference_items, org_features, storage.objects ×3 | external_reference_items, stock_items, stock_units, stock_warehouses, user_views |
| 6 Guard | none (test only, number reserved) | `supabase/tests/0825_rls_policy_shape_guard.test.sql` (§4), lands last so it starts green | |

Slices 1–5 touch disjoint tables and can build in parallel; 6 depends on all five. Money-path tables
(procurement, payments, budgets, expense, imprest) put slices 1–3 in the Director-dispatched tier: each
ships alone, not batched.

**Measure.** Before slice 1 and after slice 5, `EXPLAIN (ANALYZE, BUFFERS)` as an `authenticated` Admin on
the largest seeded org for: `select * from procurement_items`, `select * from timesheet_entries`, and a
storage object list on `project-documents`. Expect the `org_feature_enabled` / `domain_externally_owned`
calls to move into `InitPlan` nodes and the per-row filter to lose the ALL branch. Attach to the slice PRs.

## 6. Risks

- **Dropping the SELECT branch silently changes visibility** (rows `u` admits that the SELECT policy's extra
  conjuncts reject, such as archived rows or rows behind a feature gate). Mitigation: §2.2 rule, keep `<t>_write_select` unless implication is shown; 3.1
  per-role probes include an inactive member and every role in `u`.
- **Restrictive policies.** Never split or merged; Gap A wraps keep `permissive = RESTRICTIVE`. The
  catalog test asserts the permissive column per policy. 13 restrictive DELETE policies carry the
  Admin-only delete and FK rulings (ADR-0019); their pgTAP owners (`0103`, `0170`, `0054`) must stay green.
- **SoD policies.** Approver ≠ author and `contract_value`-on-won live in security-definer RPCs and
  restrictive policies (`0015`, `0052_project_value_sod`, `0168`–`0171`, `0176`). Splitting a permissive
  ALL never weakens them, but a mistyped UPDATE `WITH CHECK` would; hence generation from the catalog plus
  exact-text equality in 3.1. `0171`'s AC-SCC-083 control (budget_line_items DELETE is live via the ALL
  policy) must still pass with DELETE now on `budget_line_items_write_delete`.
- **Security-definer helpers.** `org_feature_enabled` and `auth_org_id` are security definer. Wrapping does
  not change their grants or bodies; the 0178 definer allow-list and 0137 grants suites must stay
  unchanged. Do not alter any helper body in this issue.
- **Statement invariance.** The wrap is only valid because both helpers return the same value for the
  whole statement. A STABLE function already sees one snapshot per statement, and a data-modifying CTE's
  writes are invisible to the rest of its statement, so no in-statement flip can be observed today; the
  wrap changes call count, not the value. Do not mark either helper VOLATILE later without revisiting this.
- **Name-pinned tests and scripts** (§3.3) break by name only; update in the same slice or CI goes red.
- **Feature-flag write enforcement** (`0138`, `check-module-completeness.mjs`) recognises the gate by its
  `org_feature_enabled(` text; confirm the wrapped form still matches before slice 1 merges.
- **Rollback order.** Rollbacks run newest first (0824 → 0820); each restores its own tables only.

## 7. Issue bookkeeping

#842's initplan part shipped in #1254 (0646/0655/0696). When slices 1–6 land, close #842 citing this plan.
