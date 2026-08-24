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
-- The 42-name allow-list was re-derived from literal `.rpc('name'` / `.rpc("name"` calls under
-- pmo-portal/src and pmo-portal/pages, excluding tests, __tests__, and __mocks__, then sorted and
-- de-duplicated. The checkout contains 42 (the issue brief says 41; transition_procurement is the
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
-- ⚑ THE COUNT WAS RE-DERIVED BY HAND (52 -> 53 is not the arithmetic: 51 + 2 = 53), per the merge
-- hazard below.
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
select plan(5);

-- This is duplicated from 0185 as a visible proof contract. A future client RPC must retain its
-- authenticated grant explicitly after the default-privilege guard; otherwise the count below fails.
-- The names are by proname, matching the migration's conservative overload-safe allow-list (42 literal
-- frontend calls plus six existing authenticated RPC contracts).
create temp table client_callable_rpc_names (proname text primary key) on commit drop;
insert into client_callable_rpc_names (proname) values
  ('activate_budget_version'),
  ('admin_set_user_status'),
  ('approved_timesheet_for_push'),
  ('attest_timesheet_no_erp_document'),
  ('capture_vendor_invoice'),
  ('claim_sales_invoice_author'),
  ('clone_budget_version'),
  ('confirm_erp_employee_link'),
  ('create_payment'),
  ('create_procurement_invoice'),
  ('create_procurement_quotation'),
  ('create_procurement_receipt'),
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
  ('is_operator'),
  ('admin_change_domain_ownership'),
  ('list_budget_fiscal_years'),
  ('operator_agent_run_stats'),
  ('operator_create_org'),
  ('operator_grant_credits'),
  ('operator_set_domain_ownership'),
  ('operator_set_org_lifecycle_state'),
  ('operator_list_orgs'),
  ('operator_toggle_feature'),
  ('operator_usage_summary'),
  ('org_agent_run_stats'),
  ('org_credit_balance'),
  ('org_usage_summary'),
  ('release_credits'),
  ('release_outbox_hold'),
  ('reserve_credits'),
  ('save_timesheet_week'),
  ('select_procurement_quote'),
  ('set_project_contract_value'),
  ('set_work_order_value'),
  ('submit_sales_invoice'),
  ('transition_document_status'),
  ('transition_procurement'),
  ('transition_project'),
  ('transition_timesheet'),
  ('transition_work_order');

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
  53,
  'AC-ACL-002 all 53 retained client-callable RPC names still have a public function');

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     join client_callable_rpc_names c on c.proname = p.proname
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  53,
  'AC-ACL-003 all 53 retained client-callable RPCs retain authenticated EXECUTE after the default guard');

-- The production sweep: direct role ACL entries are the oracle. `distinct` prevents one function
-- granted to both roles from being named twice. The empty allow-list is intentional here: migration
-- 0185's allow-list is the only safe exemption, and this test checks its resulting surface.
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
   and not exists (select 1 from client_callable_rpc_names c where c.proname = p.proname);

select is(
  (select coalesce(string_agg(proname, ', ' order by proname), '') from anon_definer_write_sweep),
  '',
  'AC-ACL-004 no SECURITY DEFINER writer outside the client allow-list is explicitly executable by anon or authenticated (offenders are named)');

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
