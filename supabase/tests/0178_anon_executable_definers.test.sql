-- 0178_anon_executable_definers.test.sql — hosted function-ACL completeness proof.
--
-- ⚑ WEAK ON LOCAL BY CONSTRUCTION: local Docker does not reproduce hosted Supabase's explicit
-- anon/authenticated EXECUTE grants on newly-created public functions. The baseline sweep is therefore
-- expected to be quiet locally even though the same catalog query found 18 production exposures at
-- v0.9.0. The authoritative run is against the hosted project after migration 0185 is applied. A test
-- that is only green locally is exactly what allowed this defect through.
--
-- The sweep inspects pg_proc.proacl (falling back to acldefault only when proacl is NULL), not only
-- has_function_privilege(). That preserves the direct anon/authenticated grant dimension even when
-- role inheritance would make a privilege check misleading. It returns the offending function names,
-- not merely a count. The throwaway function in the regression section proves the sweep catches an
-- explicitly anon-granted SECURITY DEFINER writer inside this transaction.
--
-- The 43-name allow-list was re-derived from literal `.rpc('name'` / `.rpc("name"` calls under
-- pmo-portal/src and pmo-portal/pages, excluding tests, __tests__, and __mocks__, then sorted and
-- de-duplicated. The checkout contains 43 (the issue brief says 41; transition_procurement is the
-- additional production call). Six existing authenticated RPC contracts are also retained because
-- their migrations grant them to authenticated and the shipped pgTAP contracts invoke them through
-- PostgREST: reserve_credits, claim_sales_invoice_author, confirm_erp_employee_link,
-- operator_set_domain_ownership, admin_change_domain_ownership, create_vault_secret_for_org, and
-- release_credits. Dynamic service-client seams are intentionally not client-callable.
--
-- ⚑ AMENDED BY 0192 (#484): `operator_create_org` joins the retained set. With
-- `operator_set_org_lifecycle_state` (0191, #489) the retained count is 51.
--
-- ⚑ AMENDED BY 0193 (#498): `set_work_order_value` and `transition_work_order` join the retained set,
-- taking the count to 53. Both are SECURITY DEFINER writers invoked through PostgREST under a normal
-- member's authenticated JWT, so `authenticated` EXECUTE is the intended surface, and both gate their
-- own bodies on the org re-assertion + assert_is_active_member() + a role threshold, with the pgTAP
-- pairing this file's header demands in supabase/tests/0193_work_orders.test.sql (AC-WO-031/039/041/
-- 044/046/047/090/091/095). ⚑ `get_project_drawdown` is deliberately NOT listed: it is SECURITY
-- INVOKER by design (DD-WO-2), and adding it here would mean the sweep no longer notices if someone
-- later converts it to definer — the exact silencing this allow-list must never buy.
-- ⚑ AMENDED BY 0244 (#767): `set_sales_invoice_received_date` joins the retained set (count 54). A
-- SECURITY DEFINER writer called through PostgREST under a member's JWT; its body re-asserts the row's
-- org, an active membership and the Admin/Finance role, paired in supabase/tests/0244_sales_invoice_received_date.test.sql.
-- ⚑ THE COUNT WAS RE-DERIVED BY HAND (52 -> 53 is not the arithmetic: 51 + 2 = 53), per the merge
-- hazard below.
-- ⚑ AMENDED BY 0247 (#775): `transition_expense_claim` and `record_expense_advance_return` join the retained
-- set (+2). Both are SECURITY DEFINER writers invoked through PostgREST under a member's JWT; both re-assert
-- org + assert_is_active_member() + role in their bodies, with pgTAP pairing in
-- supabase/tests/expense_claims_transition.test.sql and expense_advances.test.sql (AC-EXP-010..017, 030..031).
-- `get_expense_claim_approval_routes`, `get_expense_advance_aging` and `expense_advance_outstanding` are
-- SECURITY INVOKER by design and deliberately NOT listed.
--
-- ⚑ AMENDED BY 0250 (#766): `attach_claim_evidence`, `create_progress_claim` and `withdraw_progress_claim`
-- join the retained set, taking the count to 57 (54 + 3, re-derived by hand from the list). Each is a SECURITY
-- DEFINER writer called through PostgREST under a member's JWT that re-asserts membership + Admin/Finance + org,
-- proven by supabase/tests/0250_progress_billing_{claims,evidence,withdraw}.test.sql. `record_progress_assessment`
-- and `get_project_billing` are SECURITY INVOKER and deliberately NOT listed.
-- ⚑ AMENDED BY 0272 (#893 / DD-EFK-1): the PMO-only sales and procurement e-Faktur setters join the retained
-- authenticated RPC set (+2, count 61). Both re-assert current Admin/Finance role, active membership, and org;
-- their row checks and mirror preservation are proved by supabase/tests/0272_efaktur_number.test.sql.
--
-- ⚑ AMENDED BY 0273 (#876 slice 2): `set_vendor_tax_defaults` joins the retained set (+1). A SECURITY DEFINER
-- writer called through PostgREST under a member's JWT; its body re-asserts the active membership, the
-- Admin/Finance role and the caller's org, paired in supabase/tests/0273_vendor_tax_defaults.test.sql
-- (AC-VWH-021/022). `create_procurement_invoice` / `capture_vendor_invoice` changed signature only (proname
-- unchanged). THE COUNT IS RE-DERIVED BY HAND from the list below.
--
-- ⚑ AMENDED BY 0290 (#1008): `assign_sales_invoice_project` joins the retained set (+1, count 70).
-- It is a SECURITY DEFINER PMO-attribution writer called under authenticated JWT and asserts active
-- membership, role, org/project/invoice scope, and billing context; paired with 0290 assignment pgTAP.
-- `fill_sales_invoice_project` is service-role-only and deliberately NOT retained.
-- ⚑ AMENDED BY 0275 (#784): `create_native_sales_invoice`, `transition_native_sales_invoice`, `record_native_receipt`
-- and `cancel_native_receipt` join the retained set, taking the count to 66 after the dev merge (dev's 62 + 4, re-derived by hand from the list).
-- Each is a SECURITY DEFINER writer called through PostgREST under a member's JWT that re-asserts membership + org +
-- Admin/Finance (and, for approval, approver ∉ author set), proven by supabase/tests/0275_native_revenue_*.test.sql and
-- 0275_revenue_write_roles.test.sql. `native_invoice_settled` (INVOKER, no client EXECUTE) is deliberately NOT listed.
--
-- ⚑ AMENDED BY 0349: `approve_procurement_amount` joins the retained set (+1, count 74). A SECURITY DEFINER
-- writer called under a member's JWT that re-asserts active membership, org, the approval role set and the
-- approval route, with its separation-of-duties exclusions proved by
-- supabase/tests/0349_procurement_payment_ceiling.test.sql (AC-SEC-211/215).
--
-- ⚑ AMENDED BY 0360 (#1319): `set_procurement_gates` joins the retained set (+1, count 75). A SECURITY DEFINER
-- writer called under a member's JWT that re-asserts active membership, the Admin role and the caller's org,
-- and refuses unknown keys / non-boolean values; proved by supabase/tests/procurement_flexible_foundation.test.sql
-- (FR-PFE-011). The other 0360 definers are service-role-only or non-writers and are deliberately NOT listed.
--
-- ⚑ AMENDED BY 0361 (#1319): `link_erp_purchase_documents`, `unlink_erp_purchase_document` and
-- `link_procurement_sharepoint_item` join the retained set (+3, count 78). Each is a SECURITY DEFINER writer
-- called under a member's JWT that re-asserts active membership, the caller's org and its role set
-- (link/SharePoint: Admin, Executive, Project Manager, Finance; unlink: Admin, Finance); linking refuses
-- cross-org, closed, mismatched and gated targets. Proved by supabase/tests/procurement_erp_links.test.sql
-- (FR-PFE-020, NFR-PFE-012, AC-PFE-023) and supabase/tests/erp_purchase_orphans.test.sql (AC-PFE-017).
-- The other 0361 definers are non-writers (`procurement_ledger_held`) or have no client EXECUTE.
--
-- ⚑ AMENDED BY 0364 (#1319 AC-13): `mark_erp_purchase_documents` joins the retained set (+1, count 79). A SECURITY
-- DEFINER writer called under a member's JWT that re-asserts active membership, the Admin/Finance role and the
-- caller's org, and refuses linked documents; proved by supabase/tests/procurement_erp_set_aside.test.sql (AC-13d).
-- The 0364 trigger functions (org stamp, clear-on-link) have no client EXECUTE and are deliberately NOT listed; the
-- clear-on-link effect is proved in the same file.
--
-- ⚑ AMENDED BY 0366 (#1326): `recategorise_budget_lines` joins the retained set (+1, count 80 after rebasing onto 0364, re-derived by hand
-- from the list). A SECURITY DEFINER writer called under a member's JWT (the app, `pmo rpc`) that re-asserts
-- active membership, the Admin role and the caller's org, and refuses lines on a non-Draft version; proved by
-- supabase/tests/budget_travel_vehicle_categories.test.sql (AC-TVC-003/005).
--
-- ⚑ AMENDED BY 0367 (#1270 A): `link_m365_documents_batch` joins the retained set (+1, count 81 after 0366's 80). A SECURITY
-- DEFINER writer under a member's JWT: active Admin/Executive/PM/Finance, org-scoped, host-pinned; proved by
-- supabase/tests/api_client_operator_reads.test.sql (AC-OPR-003/005).
--
-- ⚑ AMENDED BY 0376 (#1271): `save_cost_attribution_rule` and `end_cost_attribution_rule` join the retained set (+2,
-- count 83 after 0367's 81). SECURITY DEFINER writers under a member's JWT: active Admin/Finance, org from the JWT,
-- targets limited to the caller's org; proved by supabase/tests/cost_attribution.test.sql (AC-CAT-011).
-- ⚑ AMENDED BY #1422: `archive_budget_version_with_cancel_intent` joins the retained set (+1, count 84).
-- It preserves the four-role archive gate while atomically recording the ERP cancellation decision;
-- proved by supabase/tests/budget_archive_cancel_intents.test.sql (AC-BUD-122).
--
-- ⚑ AMENDED BY 0393: `update_procurement_header` joins the retained set (+1, count 85).
-- It checks active membership, org, requester/Admin authority and editable state;
-- supabase/tests/procurement_header_requester.test.sql exercises its contract and ACL.
--
-- ⚑ AMENDED BY 0419 (#1532 S9): `admin_set_feedback_surveys` joins the retained set (+1, count 89 on top of dev's 88,
-- re-derived by hand). Active-Admin writer under a member's JWT; supabase/tests/0419_feedback_surveys_switch.test.sql proves it.
-- Anonymous grants remain subject to the sweep even for retained names.
--
-- ⚑ AMENDED BY 0412 (#1512): `set_stock_warehouse_keeper` joins the retained set (+1, count 90 once both 0419 and 0412 are on dev). A SECURITY
-- DEFINER writer (the keeper table has no client write grant); its body gates on active membership, org and
-- Admin rank; supabase/tests/stock_master_data.test.sql proves the contract.
--
-- ⚑ AMENDED BY 0413 (#1512 S2a): `create_stock_document`, `save_stock_draft`, `post_stock_document` and
-- `cancel_stock_document` join the retained set (+4, count 94 on dev's 90, re-derived by hand from the list). SECURITY DEFINER
-- writers (documents, lines, ledger and balances have no client write grant); each gates on active membership and
-- the JWT org, and posting on keeper-or-Admin; stock_posting_guards / stock_tenant_isolation prove the contract.
--
-- ⚑ AMENDED BY 0422 (#1515): five imprest writers join the retained set (+5, count 99). Each re-asserts org, active
-- membership and role (or the plan author / route) in its body; proven by imprest_floats/imprest_plans pgTAP.
--
-- ⚑ AMENDED BY 0423 (#1515): two replenishment writers join (+2, count 101). transition_expense_claim and
-- record_expense_advance_return were already retained. Proven by imprest_replenishment pgTAP.
-- ⚑ AMENDED BY 0418 (#1512 S6): `set_stock_reorder_level` joins the retained set (+1, count 102, re-derived by hand from the list). A SECURITY
-- DEFINER writer (reorder levels have no client write grant); it gates on active membership, rank >= 20 and the JWT org;
-- stock_reorder.test.sql proves the contract.
--
-- ⚑ AMENDED BY 0424 (#1515): record_imprest_count joins (+1, count 103 with 0418, re-derived by hand from the list); it re-asserts org, active membership and
-- custodian-eligible-or-Finance/Admin in its body. The position/usage reads are invoker; imprest_float_choices is a
-- read. Proven by imprest_position pgTAP.
-- ⚑ 0426 (#1515 fix round) adds no definer: get_expense_claim_approval_routes and get_imprest_position stay invoker, re-created under
-- their own names, so the retained count stays 104 (recounted by hand from the list below: 104 rows).
-- ⚑ AMENDED BY 0442 (#1639): preview_task_reminders and send_task_reminders join the retained set (+2; merged with 0447 the count is 110). Each
-- asserts active membership and the caller's org in its body; proven by supabase/tests/task_reminders.test.sql.
-- ⚑ AMENDED BY 0410 (#1471): `set_sales_invoice_billing_kind` joins the retained set (+1, count 104 on dev's 103, re-derived by hand from the list). SECURITY
-- DEFINER writer under a member's JWT; re-asserts active membership, Admin/Finance and the caller's org; paired with
-- supabase/tests/billing_kinds_roles.test.sql (AC-007). `assign_sales_invoice_project` and
-- `create_native_sales_invoice` changed signature only (proname unchanged).
-- ⚑ AMENDED BY 0447 (#1519 S1): `save_equipment_usage`, `transition_equipment_usage`, `approve_equipment_usage_week` and
-- `archive_equipment_usage` join the retained set (+4, count 108 on dev's 104, re-derived by hand from the list). SECURITY
-- DEFINER writers (entries have no client INSERT/UPDATE grant); each re-asserts active membership and the JWT org, the
-- transition checks approver ≠ author before the approver role; proved by equipment_usage / equipment_rls pgTAP.
-- ⚑ AMENDED BY 0449 (#1513 S1): `set_subcontract_po_lines` and `issue_subcontract_po_lines` join the retained set (+2, count 112 with dev's additions,
-- re-derived by hand from the list). SECURITY DEFINER writers under a member's JWT: each re-asserts active membership, the caller's
-- org and a Project Manager / Finance / Admin role in its body. Proven by supabase/tests/subcontract_po_lines.test.sql.
-- ⚑ AMENDED BY 0448 (#1638): redate_stage_entry, add_skipped_stage_entry and import_project_stage_history join the retained set (+3, count 113 on dev's 110, re-derived by hand from the list). Each re-asserts org, active membership and role rank >= Project Manager through assert_stage_date_editor; proven by pipeline_stage_history_write.test.sql.
--
-- ⚑ AMENDED BY 0480 (#1605): `accept_connect_proposals`, `decide_connect_review` and `unlink_connect_match` join the retained
-- set (+3, count 118 on dev's 115, re-derived by hand from the list). SECURITY DEFINER writers under a member's JWT; each re-asserts the
-- org, active membership and the Admin (Finance for account rows) role in its body; proved by
-- supabase/tests/erp_connect_setup.test.sql (AC-ECA-004/007). The seven other 0480 functions are service-role-only or internal.
--
-- ⚑ AMENDED BY 0482 (#1606): `retry_connect_send` joins the retained set (+1, count 119 on the 118 above, re-derived by hand from the list). A SECURITY DEFINER writer under a member's JWT; it re-asserts the
-- org, active membership and the Admin role in its body (a held send is released and queued again, audited); proved by
-- supabase/tests/erp_connect_sends.test.sql. The other 0482 functions are service-role-only or internal.
--
-- The budget import and procurement import-run commands retain authenticated access;
-- their owning proofs are 0397_budget_import_protocol.test.sql and
-- 0399_procurement_import_identity_authority.test.sql. Atomic draft creation is
-- exercised by procurement_atomic_create.test.sql and its interleave companion.
-- Anonymous and PUBLIC grants remain subject to the sweep.
--
-- ⚑ MERGE HAZARD, learned the hard way here: the list and its CARDINALITY live in this one file.
-- Two branches each adding one name merge cleanly in the LIST (different lines) while the count
-- line is a real conflict that resolves to one side — leaving a list of 51 asserted as 50. That is
-- exactly what happened rebasing #484 onto #489. If you add a name, re-derive the count by hand
-- after any rebase; a clean `git rebase` is NOT evidence the number is right.
--
-- The count is deliberately HARDCODED and must stay so. Deriving it from the list would make any
-- addition self-approving and the guard toothless — catching an UNDECLARED definer is its whole job.
-- This is a DECLARATION, not a relaxation — the sweep's polarity is unchanged, and an UNDECLARED
-- SECURITY DEFINER writer granted to a client role still fails AC-ACL-004 by name. (It caught
-- operator_create_org on its first run, which is what the guard is for.) The function belongs in the
-- set for the same reason operator_set_domain_ownership and operator_toggle_feature do: it is invoked
-- through PostgREST under an OPERATOR's authenticated JWT, so `authenticated` EXECUTE is the intended
-- surface, and its own body gates on is_active_member() + is_operator() with pgTAP proof in
-- supabase/tests/operator_create_org.test.sql (AC-ORG-001/002). Anything added here without that
-- pairing IS a relaxation.

begin;
create extension if not exists pgtap;
select plan(6);

-- This is duplicated from 0185 as a visible proof contract. A future client RPC must retain its
-- authenticated grant explicitly after the default-privilege guard; otherwise the count below fails.
-- The names are by proname, matching the migration's conservative overload-safe allow-list (42 literal
-- frontend calls plus six existing authenticated RPC contracts).
create temp table client_callable_rpc_names (proname text primary key) on commit drop;
insert into client_callable_rpc_names (proname) values
  ('accept_connect_proposals'),
  ('activate_budget_version'),
  ('add_skipped_stage_entry'),
  ('assign_sales_invoice_project'),
  ('admin_set_user_status'),
  ('approve_procurement_amount'),
  ('archive_budget_version_with_cancel_intent'),
  ('approved_timesheet_for_push'),
  ('approve_equipment_usage_week'),
  ('archive_equipment_usage'),
  ('attach_claim_evidence'),
  ('attest_timesheet_no_erp_document'),
  ('cancel_native_receipt'),
  ('cancel_stock_document'),
  ('capture_vendor_invoice'),
  ('claim_sales_invoice_author'),
  ('clone_budget_version'),
  ('confirm_erp_employee_link'),
  ('confirm_work_order_acceptance'),
  ('create_native_sales_invoice'),
  ('decide_connect_review'),
  ('create_payment'),
  ('create_procurement_invoice'),
  ('create_procurement_with_items'),
  ('create_stock_document'),
  ('decide_imprest_float_change'),
  ('establish_imprest_float'),
  ('propose_imprest_float_amount'),
  ('record_vendor_withholding_slip'),
  ('correct_vendor_withholding_slip'),
  ('void_vendor_withholding_slip'),
  ('create_procurement_quotation'),
  ('create_procurement_receipt'),
  ('create_progress_claim'),
  ('prepare_work_order_acceptance'),
  ('create_purchase_order'),
  ('create_purchase_request'),
  ('create_rfq'),
  ('create_vault_secret_for_org'),
  ('get_budget_projection'),
  ('get_budget_push_status'),
  ('get_executive_dashboard'),
  ('get_finance_budget_review'),
  ('get_project_budget'),
  ('get_project_milestones'),
  ('get_projects_delivery'),
  ('get_projects_milestone_dates'),
  ('get_sales_pipeline'),
  ('get_win_rate'),
  ('import_budget_line_v2'),
  ('import_project_stage_history'),
  ('is_operator'),
  ('issue_subcontract_po_lines'),
  ('link_erp_purchase_documents'),
  ('link_procurement_sharepoint_item'),
  ('mark_erp_purchase_documents'),
  ('link_m365_documents_batch'),
  ('save_cost_attribution_rule'),
  ('save_equipment_usage'),
  ('save_stock_draft'),
  ('end_cost_attribution_rule'),
  ('admin_change_domain_ownership'),
  ('admin_set_feedback_surveys'),
  ('list_budget_fiscal_years'),
  ('operator_agent_run_stats'),
  ('operator_create_org'),
  ('operator_grant_credits'),
  ('operator_set_domain_ownership'),
  ('operator_set_org_lifecycle_state'),
  ('operator_list_orgs'),
  ('post_stock_document'),
  ('preview_task_reminders'),
  ('operator_toggle_feature'),
  ('operator_usage_summary'),
  ('org_agent_run_stats'),
  ('org_credit_balance'),
  ('org_usage_summary'),
  ('record_expense_advance_return'),
  ('record_imprest_count'),
  ('record_native_receipt'),
  ('recategorise_budget_lines'),
  ('redate_stage_entry'),
  ('release_credits'),
  ('release_outbox_hold'),
  ('request_imprest_replenishment'),
  ('reserve_credits'),
  ('retry_connect_send'),
  ('save_timesheet_week'),
  ('send_task_reminders'),
  ('select_procurement_quote'),
  ('set_procurement_invoice_efaktur'),
  ('set_procurement_gates'),
  ('set_project_contract_value'),
  ('set_sales_invoice_billing_kind'),
  ('set_sales_invoice_efaktur'),
  ('set_sales_invoice_received_date'),
  ('set_stock_reorder_level'),
  ('set_stock_warehouse_keeper'),
  ('set_subcontract_po_lines'),
  ('set_imprest_procurement_limit'),
  ('set_vendor_tax_defaults'),
  ('set_work_order_value'),
  ('start_procurement_import_run'),
  ('submit_sales_invoice'),
  ('transition_document_status'),
  ('transition_equipment_usage'),
  ('transition_expense_claim'),
  ('transition_imprest_plan'),
  ('transition_imprest_replenishment'),
  ('transition_native_sales_invoice'),
  ('transition_procurement'),
  ('transition_project'),
  ('transition_timesheet'),
  ('transition_work_order'),
  ('unlink_connect_match'),
  ('unlink_erp_purchase_document'),
  ('update_procurement_header'),
  ('withdraw_progress_claim'),
  ('withdraw_work_order_acceptance');

select ok(
  not exists (
    select 1
      from pg_default_acl d
      cross join lateral aclexplode(d.defaclacl) a
      join pg_roles r on r.oid = a.grantee
     where d.defaclrole = 'postgres'::regrole
       and d.defaclnamespace = 'public'::regnamespace
       and d.defaclobjtype = 'f'
       and r.rolname in ('anon', 'authenticated')
       and a.privilege_type = 'EXECUTE'
  ),
  'AC-ACL-001 postgres public function defaults do not grant EXECUTE to anon or authenticated');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join client_callable_rpc_names c on c.proname = p.proname
    where n.nspname = 'public'),
  119,
  'AC-ACL-002 all 119 retained client-callable RPC names still have a public function');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join client_callable_rpc_names c on c.proname = p.proname
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  119,
  'AC-ACL-003 all 119 retained client-callable RPCs retain authenticated EXECUTE after the default guard');

-- The production sweep: direct role ACL entries are the oracle. `distinct` prevents one function
-- granted to both roles from being named twice. Retained names exempt authenticated grants only;
-- an anonymous or PUBLIC grant is always reported, including for retained writers.
create temp view anon_definer_write_sweep as
select distinct p.oid, p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles grantee on grantee.oid = a.grantee
 where n.nspname = 'public'
   and p.prosecdef
   and (a.grantee = 0 or grantee.rolname in ('anon', 'authenticated'))
   and a.privilege_type = 'EXECUTE'
   and pg_get_functiondef(p.oid) ~* '(insert\s+into|update\s+(public\.)?[a-z_]|delete\s+from|merge\s+into)'
   and (a.grantee = 0 or grantee.rolname = 'anon'
        or not exists (select 1 from client_callable_rpc_names c where c.proname = p.proname));

select is(
  (select coalesce(string_agg(proname, ', ' order by proname), '') from anon_definer_write_sweep),
  '',
  'AC-ACL-004 no SECURITY DEFINER writer outside the client allow-list is explicitly executable by anon or authenticated (offenders are named)');

-- An authenticated client exemption must never exempt an anonymous grant.
grant execute on function public.update_procurement_header(uuid,jsonb) to anon;
select is(
  (select coalesce(string_agg(proname, ', ' order by proname), '') from anon_definer_write_sweep),
  'update_procurement_header',
  'AC-ACL-006 anonymous grants to retained client writers are named');
revoke execute on function public.update_procurement_header(uuid,jsonb) from anon;

-- REGRESSION: mutate the exact ACL class that production exposed. The sweep must return the function
-- name; a count-only or authenticated-only implementation is not sufficient. The transaction rollback
-- is the restore path, and explicit revoke/drop below makes the restoration obvious even before rollback.
create temp table anon_definer_write_probe_sink (marker text) on commit drop;
create or replace function public.anon_definer_write_probe() returns void
  language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.anon_definer_write_probe_sink (marker) values ('caught');
end
$$;
grant execute on function public.anon_definer_write_probe() to anon;

select is(
  (select coalesce(string_agg(proname, ', ' order by proname), '') from anon_definer_write_sweep),
  'anon_definer_write_probe',
  'AC-ACL-005 regression: the sweep catches and names a SECURITY DEFINER writer explicitly granted to anon');

revoke execute on function public.anon_definer_write_probe() from anon, authenticated;
drop function public.anon_definer_write_probe();

select * from finish();
rollback;
