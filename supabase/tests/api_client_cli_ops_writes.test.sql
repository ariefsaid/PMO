-- api_client_cli_ops_writes.test.sql — 0370 guard tiers for `pmo budgets activate --source` and `pmo accounts map set` (#1270 B).
-- Allowed and refused per role, no tier for activate_budget_version, foreign-org isolation behind the guard, and a
-- down/up round trip of the guard body (down restores the 0367 body).
begin;
create extension if not exists pgtap;
select plan(51);
insert into organizations (id,name) values ('03700000-0000-0000-0000-0000000000a0','CLI guard org'),('03700000-0000-0000-0000-0000000000b0','CLI guard other org');
insert into auth.users(id,email) values
 ('03700000-0000-0000-0000-0000000000c1','g-admin@example.com'),('03700000-0000-0000-0000-0000000000c2','g-exec@example.com'),('03700000-0000-0000-0000-0000000000c3','g-pm@example.com'),('03700000-0000-0000-0000-0000000000c4','g-fin@example.com'),
 ('03700000-0000-0000-0000-0000000000c5','g-eng@example.com'),('03700000-0000-0000-0000-0000000000c6','g-dis@example.com'),('03700000-0000-0000-0000-0000000000c7','g-other-admin@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03700000-0000-0000-0000-0000000000c1','03700000-0000-0000-0000-0000000000a0','Admin','g-admin@example.com','Admin','active'),
 ('03700000-0000-0000-0000-0000000000c2','03700000-0000-0000-0000-0000000000a0','Exec','g-exec@example.com','Executive','active'),
 ('03700000-0000-0000-0000-0000000000c3','03700000-0000-0000-0000-0000000000a0','PM','g-pm@example.com','Project Manager','active'),
 ('03700000-0000-0000-0000-0000000000c4','03700000-0000-0000-0000-0000000000a0','Fin','g-fin@example.com','Finance','active'),
 ('03700000-0000-0000-0000-0000000000c5','03700000-0000-0000-0000-0000000000a0','Eng','g-eng@example.com','Engineer','active'),
 ('03700000-0000-0000-0000-0000000000c6','03700000-0000-0000-0000-0000000000a0','Disabled Admin','g-dis@example.com','Admin','disabled'),
 ('03700000-0000-0000-0000-0000000000c7','03700000-0000-0000-0000-0000000000b0','Other Admin','g-other-admin@example.com','Admin','active');
insert into projects(id,org_id,name,code) values
 ('03700000-0000-0000-0000-0000000000d1','03700000-0000-0000-0000-0000000000a0','Guard project A','CG-A'),('03700000-0000-0000-0000-0000000000d2','03700000-0000-0000-0000-0000000000b0','Guard project B','CG-B');
insert into budget_versions(id,org_id,project_id,version,name,status) values
 ('03700000-0000-0000-0000-0000000000e1','03700000-0000-0000-0000-0000000000a0','03700000-0000-0000-0000-0000000000d1',1,'A draft','Draft'),('03700000-0000-0000-0000-0000000000e2','03700000-0000-0000-0000-0000000000b0','03700000-0000-0000-0000-0000000000d2',1,'B draft','Draft');
insert into budget_category_account_map(id,org_id,category,erp_account,is_push_target) values
 ('03700000-0000-0000-0000-0000000000f1','03700000-0000-0000-0000-0000000000a0','Labor','5110 - Salary',true),('03700000-0000-0000-0000-0000000000f2','03700000-0000-0000-0000-0000000000b0','Labor','5110 - Salary',true);
create or replace function pg_temp.req(p_sub text,p_method text,p_path text) returns void language sql as $$
select set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated','client_id','pmo-cli')::text,true),
set_config('request.method',p_method,true),set_config('request.path',p_path,true),set_config('request.headers','{}',true);$$;
create temp table _up_guard as select pg_get_functiondef('public.api_client_request_guard()'::regprocedure) as d;
grant select on _up_guard to authenticated;
set local role authenticated;
-- ── the tiers, at head ──
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/budget_activation_mode');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 active Admin may call budget_activation_mode');
select pg_temp.req('03700000-0000-0000-0000-0000000000c2','POST','/rpc/budget_activation_mode');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 active Executive may call budget_activation_mode');
select pg_temp.req('03700000-0000-0000-0000-0000000000c3','POST','/rpc/budget_activation_mode');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 active Project Manager may call budget_activation_mode');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','POST','/rpc/budget_activation_mode');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 active Finance may call budget_activation_mode');
select pg_temp.req('03700000-0000-0000-0000-0000000000c5','POST','/rpc/budget_activation_mode');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Engineer refused budget_activation_mode');
select pg_temp.req('03700000-0000-0000-0000-0000000000c6','POST','/rpc/budget_activation_mode');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 disabled Admin refused budget_activation_mode');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','GET','/rpc/budget_activation_mode');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 GET on the budget ops RPCs is refused');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/activate_budget_version');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 activate_budget_version has NO tier: active Admin refused');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','POST','/rpc/activate_budget_version');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 activate_budget_version has NO tier: active Finance refused');
select pg_temp.req('03700000-0000-0000-0000-0000000000c3','POST','/rpc/activate_budget_version');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 activate_budget_version has NO tier: active Project Manager refused');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','GET','/budget_category_account_map');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 active Admin reads the account map');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/budget_category_account_map');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 active Admin inserts account map rows');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/set_budget_push_account');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 active Admin calls set_budget_push_account');
select pg_temp.req('03700000-0000-0000-0000-0000000000c2','POST','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Executive refused account map writes');
select pg_temp.req('03700000-0000-0000-0000-0000000000c2','POST','/rpc/set_budget_push_account');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Executive refused set_budget_push_account');
select pg_temp.req('03700000-0000-0000-0000-0000000000c3','POST','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Project Manager refused account map writes');
select pg_temp.req('03700000-0000-0000-0000-0000000000c3','POST','/rpc/set_budget_push_account');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Project Manager refused set_budget_push_account');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','POST','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Finance refused account map writes');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','POST','/rpc/set_budget_push_account');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Finance refused set_budget_push_account');
select pg_temp.req('03700000-0000-0000-0000-0000000000c5','POST','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Engineer refused account map writes');
select pg_temp.req('03700000-0000-0000-0000-0000000000c5','POST','/rpc/set_budget_push_account');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Engineer refused set_budget_push_account');
select pg_temp.req('03700000-0000-0000-0000-0000000000c6','GET','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 disabled Admin refused account map reads');
select pg_temp.req('03700000-0000-0000-0000-0000000000c6','POST','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 disabled Admin refused account map writes');
select pg_temp.req('03700000-0000-0000-0000-0000000000c6','POST','/rpc/set_budget_push_account');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 disabled Admin refused set_budget_push_account');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','PATCH','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Admin cannot PATCH the account map');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','DELETE','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Admin cannot DELETE account map rows');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','GET','/budget_category_account_map');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 kept: active Finance still reads the account map (0367 tier)');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','POST','/rpc/link_m365_documents_batch');
select lives_ok('select public.api_client_request_guard()','AC-OPR-001 kept: active Finance still calls link_m365_documents_batch (0367 tier)');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/recategorise_budget_lines');
select lives_ok('select public.api_client_request_guard()','AC-1326 kept: active Admin still calls recategorise_budget_lines (0366 tier)');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','POST','/rpc/mark_erp_purchase_documents');
select lives_ok('select public.api_client_request_guard()','AC-13 kept: active Finance still calls mark_erp_purchase_documents (0364 tier)');
-- ── foreign org: behind the guard, the RPCs and RLS decide ──
select pg_temp.req('03700000-0000-0000-0000-0000000000c7','POST','/rpc/budget_activation_mode');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 a foreign-org Admin passes the guard on role alone (the guard is not the tenancy check)');
select is(public.budget_activation_mode('03700000-0000-0000-0000-0000000000e1'),'blocked','AC-CLI-B3 foreign org: budget_activation_mode answers blocked for another organisation''s version');
select is(public.budget_activation_mode('03700000-0000-0000-0000-0000000000e2'),'allowed','AC-CLI-B3 own org: the foreign Admin''s own version is allowed (control)');
select is((select count(*)::int from public.budget_category_account_map),1,'AC-CLI-B3 foreign org: account map read shows only the caller org');
select throws_ok($q$insert into public.budget_category_account_map(org_id,category,erp_account) values ('03700000-0000-0000-0000-0000000000a0','Labor','5120 - Allowance')$q$,'42501',null,'AC-CLI-B3 foreign org: cannot insert a map row into another organisation');
select throws_ok($q$select public.set_budget_push_account('03700000-0000-0000-0000-0000000000f1')$q$,'P0002',null,'AC-CLI-B3 foreign org: set_budget_push_account cannot see another organisation''s map row');
-- ── Prefer: resolution=… (upsert) is refused on every new POST tier ──
create or replace function pg_temp.reqp(p_sub text,p_method text,p_path text,p_prefer text) returns void language sql as $$
select set_config('request.jwt.claims',json_build_object('sub',p_sub,'role','authenticated','client_id','pmo-cli')::text,true),
set_config('request.method',p_method,true),set_config('request.path',p_path,true),
set_config('request.headers',json_build_object('prefer',p_prefer)::text,true);$$;
select pg_temp.reqp('03700000-0000-0000-0000-0000000000c1','POST','/budget_category_account_map','resolution=merge-duplicates');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Admin POST account map with Prefer merge-duplicates is refused');
select pg_temp.reqp('03700000-0000-0000-0000-0000000000c1','POST','/budget_category_account_map','return=representation,resolution=ignore-duplicates');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Admin POST account map with Prefer ignore-duplicates is refused');
select pg_temp.reqp('03700000-0000-0000-0000-0000000000c1','POST','/rpc/set_budget_push_account','resolution=merge-duplicates');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Admin set_budget_push_account with Prefer merge-duplicates is refused');
select pg_temp.reqp('03700000-0000-0000-0000-0000000000c4','POST','/rpc/budget_activation_mode','resolution=merge-duplicates');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 Finance budget_activation_mode with Prefer merge-duplicates is refused');
select pg_temp.reqp('03700000-0000-0000-0000-0000000000c1','POST','/budget_category_account_map','return=representation');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 control: Prefer return=representation (what the CLI sends) is allowed');
-- external-items now reads actor_authorization_state with the service client, because an API client may not call it:
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/actor_authorization_state');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 an API-client token is refused actor_authorization_state (so external-items must not use the caller token for it)');
-- ── down/up round trip ──
reset role;
do $do$ begin execute $down$
create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item'];
  purchase_read_views constant text[] := array['erp_purchase_orphans', 'erp_purchase_orphans_all'];  -- 0364
  -- ADMIN/FINANCE TIER (`pmo purchases set-aside`, #1319 AC-13)  -- 0364
  set_aside_rpcs constant text[] := array['mark_erp_purchase_documents'];  -- 0364
  -- ACTIVE-ADMIN `pmo rpc` TIER (#1326) — keep in step with scripts/pmo.mjs ADMIN_RPCS.  -- 0366
  admin_cli_rpcs constant text[] := array['recategorise_budget_lines'];  -- 0366
  -- OPERATOR READ TIER (`pmo get/documents/m365`, #1270) — keep in step with scripts/pmo.mjs.  -- 0367
  operator_read_tables constant text[] := array['budget_versions', 'budget_line_items', 'budget_category_account_map', 'erp_gl_entry_mirror', 'project_documents', 'org_m365_document_settings', 'm365_record_folder_sweeps'];  -- 0367
  operator_read_rpcs constant text[] := array['project_mapped_actuals', 'link_m365_documents_batch'];  -- 0367
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (purchase_rpcs) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'POST' and target = any (operator_read_rpcs) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'POST' and target = any (set_aside_rpcs) then  -- 0364
      if coalesce(public.auth_role()::text in ('Admin', 'Finance') and public.is_active_member(), false) then  -- 0364
        return;  -- 0364
      end if;  -- 0364
    end if;  -- 0364
    if method = 'POST' and target = any (admin_cli_rpcs) then  -- 0366
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then  -- 0366
        return;  -- 0366
      end if;  -- 0366
    end if;  -- 0366
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
    if method = 'GET' and target = any (operator_read_tables) then  -- 0367
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then  -- 0367
        return;  -- 0367
      end if;  -- 0367
    end if;  -- 0367
    if method = 'GET' and target = any (purchase_read_views) then
      if coalesce(public.auth_role()::text in ('Admin', 'Executive', 'Project Manager', 'Finance') and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;

revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;
$down$; end $do$;
set local role authenticated;
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/budget_activation_mode');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 down: budget_activation_mode is refused again');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/budget_category_account_map');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 down: account map POST is refused again');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/set_budget_push_account');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 down: set_budget_push_account is refused again');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','GET','/budget_category_account_map');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 down: the 0367 operator read of the account map survives');
select pg_temp.req('03700000-0000-0000-0000-0000000000c4','POST','/rpc/link_m365_documents_batch');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 down: the 0367 document batch tier survives');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/recategorise_budget_lines');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 down: the 0366 admin rpc tier survives');
reset role;
do $$ begin execute (select d from _up_guard); end $$;
set local role authenticated;
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/budget_activation_mode');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 up again: budget_activation_mode is allowed');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/budget_category_account_map');
select lives_ok('select public.api_client_request_guard()','AC-CLI-B3 up again: account map POST is allowed for Admin');
select pg_temp.req('03700000-0000-0000-0000-0000000000c1','POST','/rpc/activate_budget_version');
select throws_ok('select public.api_client_request_guard()','42501',null,'AC-CLI-B3 up again: activate_budget_version still has no tier');
reset role;
select * from finish();
rollback;
