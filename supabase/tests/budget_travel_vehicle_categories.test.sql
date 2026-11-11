-- budget_travel_vehicle_categories.test.sql (#1326) — OWNS AC-TVC-001, AC-TVC-003, AC-TVC-005, AC-TVC-006.
-- Spec: docs/specs/budget-categories-travel-vehicle.spec.md. Migration 0366.
--   AC-TVC-001  the two categories exist, appended after the eight existing ones.
--   AC-TVC-003  an Admin moves DRAFT Special-expenses lines to a new category, one or many; nothing else moves.
--   AC-TVC-005  an Active version is never touched by the move.
--   AC-TVC-006  mapped actuals count every mapped account exactly once while Special expenses still maps the
--               old account during the accountant's reclass (precedence rule FR-TVC-006).
--   AC-TVC-007  the OAuth API client (`pmo rpc`) may call the move only as an active Admin.
-- Mutation checks (each must turn this file red): drop the Draft-status refusal; drop the Admin role check;
-- drop the org scope on the line lookup; allow any target category; drop the source-category check; relax
-- unique (org_id, erp_account); open the guard tier to any role.
-- Namespaced 1326 UUIDs. begin/rollback + finish().
begin;
create extension if not exists pgtap;
select plan(46);

insert into organizations (id, name) values
  ('13260000-0000-0000-0000-000000000001','TVC Org A'),
  ('13260000-0000-0000-0000-000000000002','TVC Org B');
insert into auth.users (id, email) values
  ('13260000-0000-0000-0000-0000000000a1','tvc-admin-a@example.test'),
  ('13260000-0000-0000-0000-0000000000a2','tvc-finance-a@example.test'),
  ('13260000-0000-0000-0000-0000000000a3','tvc-gone-admin-a@example.test'),
  ('13260000-0000-0000-0000-0000000000a4','tvc-pm-a@example.test'),
  ('13260000-0000-0000-0000-0000000000b1','tvc-admin-b@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('13260000-0000-0000-0000-0000000000a1','13260000-0000-0000-0000-000000000001','TVC Admin A','tvc-admin-a@example.test','Admin','active'),
  ('13260000-0000-0000-0000-0000000000a2','13260000-0000-0000-0000-000000000001','TVC Finance A','tvc-finance-a@example.test','Finance','active'),
  ('13260000-0000-0000-0000-0000000000a3','13260000-0000-0000-0000-000000000001','TVC Gone Admin A','tvc-gone-admin-a@example.test','Admin','disabled'),
  ('13260000-0000-0000-0000-0000000000a4','13260000-0000-0000-0000-000000000001','TVC PM A','tvc-pm-a@example.test','Project Manager','active'),
  ('13260000-0000-0000-0000-0000000000b1','13260000-0000-0000-0000-000000000002','TVC Admin B','tvc-admin-b@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
  ('13261111-0000-0000-0000-000000000001','13260000-0000-0000-0000-000000000001','TVC Project','Ongoing Project');

-- Versions: Active v1 (lines written while Draft, then activated), Archived v2, Draft v3.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('13262222-0000-0000-0000-000000000001','13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001',1,'TVC Active','Draft'),
  ('13262222-0000-0000-0000-000000000002','13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001',2,'TVC Archived','Draft'),
  ('13262222-0000-0000-0000-000000000003','13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001',3,'TVC Draft','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('13263333-0000-0000-0000-0000000000a1','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000001','Special expenses','Travel & lodging (active)',200.00),
  ('13263333-0000-0000-0000-0000000000a2','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000001','Labor','Crew (active)',1000.00),
  ('13263333-0000-0000-0000-0000000000c1','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000002','Special expenses','Vehicle (archived)',70.00),
  ('13263333-0000-0000-0000-0000000000d1','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000003','Special expenses','Hotel',100.10),
  ('13263333-0000-0000-0000-0000000000d2','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000003','Special expenses','Car rental',50.20),
  ('13263333-0000-0000-0000-0000000000d3','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000003','Special expenses','Fuel',30.30),
  ('13263333-0000-0000-0000-0000000000d4','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000003','Special expenses','Permits (Migas)',40.40),
  ('13263333-0000-0000-0000-0000000000d5','13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000003','Labor','Crew',10.00);
update budget_versions set status = 'Active' where id = '13262222-0000-0000-0000-000000000001';
update budget_versions set status = 'Archived' where id = '13262222-0000-0000-0000-000000000002';

-- The Active version, as a fingerprint of every line (id, category, description, amount).
create temp table tvc_active_before on commit drop as
  select string_agg(id::text || '|' || category::text || '|' || coalesce(description,'') || '|' || budgeted_amount::text,
                    ',' order by id) as fp
    from budget_line_items where budget_version_id = '13262222-0000-0000-0000-000000000001';
grant select on tvc_active_before to authenticated;
create function pg_temp.tvc_active_now() returns text language sql stable as $$
  select string_agg(id::text || '|' || category::text || '|' || coalesce(description,'') || '|' || budgeted_amount::text,
                    ',' order by id)
    from public.budget_line_items where budget_version_id = '13262222-0000-0000-0000-000000000001'
$$;
create function pg_temp.tvc_category(p_id uuid) returns text language sql stable as $$
  select category::text from public.budget_line_items where id = p_id
$$;
create function pg_temp.req(p_sub text, p_method text, p_path text) returns void language sql as $$
  select set_config('request.jwt.claims',
           json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'c1')::text, true),
         set_config('request.method', p_method, true),
         set_config('request.path', p_path, true),
         set_config('request.headers', '{}', true);
$$;

-- ── AC-TVC-001: the enum ──────────────────────────────────────────────────────────────────────────
select is(enum_range(null::public.budget_category)::text[],
  array['Labor','Materials','Subcontractors','Equipment','Permits & Fees','Overheads','Contingency','Special expenses',
        'Travel & accommodation','Vehicle'],
  'AC-TVC-001 Travel & accommodation and Vehicle are appended; the eight existing values keep their order');

-- ── AC-TVC-003: the RPC's surface ─────────────────────────────────────────────────────────────────
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'recategorise_budget_lines'), true,
  'AC-TVC-003 recategorise_budget_lines is SECURITY DEFINER (its body is the authorization)');
select ok((select 'search_path=public, pg_temp' = any(p.proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'recategorise_budget_lines'),
  'AC-TVC-003 the definer pins its search_path');
select ok(not has_function_privilege('anon', 'public.recategorise_budget_lines(uuid[],public.budget_category)', 'execute'),
  'AC-TVC-003 anon cannot execute recategorise_budget_lines');
select ok(has_function_privilege('authenticated', 'public.recategorise_budget_lines(uuid[],public.budget_category)', 'execute'),
  'AC-TVC-003 authenticated may call it (the body gates the role)');

set local role authenticated;

-- ── AC-TVC-003: refusals (each leaves the line untouched) ───────────────────────────────────────────
set local request.jwt.claims = '{"sub":"13260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d1']::uuid[], 'Travel & accommodation')$$,
  '42501', null, 'AC-TVC-003 Finance cannot re-categorise (Admin only)');

set local request.jwt.claims = '{"sub":"13260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d1']::uuid[], 'Travel & accommodation')$$,
  '42501', null, 'AC-TVC-003 a disabled Admin cannot re-categorise (active members only)');

set local request.jwt.claims = '{"sub":"13260000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d1']::uuid[], 'Travel & accommodation')$$,
  'P0002', 'budget line not found', 'AC-TVC-003 another org''s Admin cannot reach org A''s line');

set local request.jwt.claims = '{"sub":"13260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(pg_temp.tvc_category('13263333-0000-0000-0000-0000000000d1'), 'Special expenses',
  'AC-TVC-003 the refused calls changed nothing');
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-00000000ffff']::uuid[], 'Vehicle')$$,
  'P0002', 'budget line not found', 'AC-TVC-003 an unknown line is not found');
select throws_ok(
  $$select public.recategorise_budget_lines(array[]::uuid[], 'Vehicle')$$,
  '22023', null, 'AC-TVC-003 an empty list is refused');
select throws_ok(
  $$select public.recategorise_budget_lines(null, 'Vehicle')$$,
  '22023', null, 'AC-TVC-003 a null list is refused');
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d1']::uuid[], null)$$,
  '22023', null, 'AC-TVC-003 a null target category is refused');
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d1']::uuid[], 'Labor')$$,
  '22023', null, 'AC-TVC-003 the target must be Travel & accommodation or Vehicle');
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d5']::uuid[], 'Vehicle')$$,
  'P0001', null, 'AC-TVC-003 only Special expenses lines move (a Labor line is refused)');
select is(pg_temp.tvc_category('13263333-0000-0000-0000-0000000000d5'), 'Labor',
  'AC-TVC-003 the refused Labor line keeps its category');

-- ── AC-TVC-005: an Active (or Archived) version is never touched ────────────────────────────────────
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000a1']::uuid[], 'Travel & accommodation')$$,
  'P0001', 'only lines on a Draft budget version can be re-categorised — an active budget is never changed',
  'AC-TVC-005 a line on the Active version is refused');
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000c1']::uuid[], 'Vehicle')$$,
  'P0001', 'only lines on a Draft budget version can be re-categorised — an active budget is never changed',
  'AC-TVC-005 a line on an Archived version is refused');
select throws_ok(
  $$select public.recategorise_budget_lines(
      array['13263333-0000-0000-0000-0000000000d1','13263333-0000-0000-0000-0000000000a1']::uuid[], 'Travel & accommodation')$$,
  'P0001', 'only lines on a Draft budget version can be re-categorised — an active budget is never changed',
  'AC-TVC-005 a batch mixing a Draft line with an Active line is refused as a whole');
select is(pg_temp.tvc_category('13263333-0000-0000-0000-0000000000d1'), 'Special expenses',
  'AC-TVC-005 the refused mixed batch moved not even its Draft line');
select is(pg_temp.tvc_active_now(), (select fp from tvc_active_before),
  'AC-TVC-005 every line of the Active version is byte-for-byte unchanged after the refused calls');

-- ── AC-TVC-003: the moves ─────────────────────────────────────────────────────────────────────────
select is(public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d1']::uuid[], 'Travel & accommodation'), 1,
  'AC-TVC-003 an Admin moves one Draft line and is told how many moved');
select is(pg_temp.tvc_category('13263333-0000-0000-0000-0000000000d1'), 'Travel & accommodation',
  'AC-TVC-003 the single line is now Travel & accommodation');
select is(public.recategorise_budget_lines(
    array['13263333-0000-0000-0000-0000000000d2','13263333-0000-0000-0000-0000000000d3','13263333-0000-0000-0000-0000000000d2']::uuid[],
    'Vehicle'), 2,
  'AC-TVC-003 a bulk move counts each line once (a repeated id is not double-counted)');
select results_eq(
  $$select id::text, category::text, budgeted_amount from public.budget_line_items
     where budget_version_id = '13262222-0000-0000-0000-000000000003' order by id$$,
  $$values ('13263333-0000-0000-0000-0000000000d1','Travel & accommodation',100.10::numeric(14,2)),
           ('13263333-0000-0000-0000-0000000000d2','Vehicle',50.20::numeric(14,2)),
           ('13263333-0000-0000-0000-0000000000d3','Vehicle',30.30::numeric(14,2)),
           ('13263333-0000-0000-0000-0000000000d4','Special expenses',40.40::numeric(14,2)),
           ('13263333-0000-0000-0000-0000000000d5','Labor',10.00::numeric(14,2))$$,
  'AC-TVC-003 only the named lines moved; every amount (and so the version total) is unchanged');
select is(pg_temp.tvc_active_now(), (select fp from tvc_active_before),
  'AC-TVC-005 the Active version is still byte-for-byte unchanged after the Draft moves');
select throws_ok(
  $$select public.recategorise_budget_lines(array['13263333-0000-0000-0000-0000000000d1']::uuid[], 'Vehicle')$$,
  'P0001', null, 'AC-TVC-003 a line already moved is not Special expenses any more and is refused');

reset role;
select is((select count(*)::int from audit_events
            where action = 'budget_line.recategorise' and actor_id = '13260000-0000-0000-0000-0000000000a1'
              and org_id = '13260000-0000-0000-0000-000000000001'), 3,
  'AC-TVC-003 each moved line is audited once, to the acting Admin in org A');
select is((select detail from audit_events
            where action = 'budget_line.recategorise' and entity_id = '13263333-0000-0000-0000-0000000000d1'),
  jsonb_build_object('budget_version_id','13262222-0000-0000-0000-000000000003','from','Special expenses','to','Travel & accommodation'),
  'AC-TVC-003 the audit row names the version and the from/to categories');
select ok(exists (select 1 from budget_version_editors
                   where budget_version_id = '13262222-0000-0000-0000-000000000003'
                     and user_id = '13260000-0000-0000-0000-0000000000a1'),
  'AC-TVC-003 the moving Admin is recorded as an editor of the Draft (DD-BUDGET-7: an editor does not activate it)');
select ok(
  (select position('for update' in d) > 0 and position('for update' in d) < position('budget_version_editors' in d)
     from (select lower(pg_get_functiondef('public.activate_budget_version(uuid)'::regprocedure)) d) f),
  'AC-TVC-003 activate_budget_version locks the version FOR UPDATE before it reads the editor list (a racing move commits first)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"13260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.activate_budget_version('13262222-0000-0000-0000-000000000003')$$,
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'AC-TVC-003 the Admin who moved the lines cannot activate that Draft');
reset role;
select is((select status::text from budget_versions where id = '13262222-0000-0000-0000-000000000003'), 'Draft',
  'AC-TVC-003 the refused activation left the Draft a Draft');

-- ── AC-TVC-006: mapped actuals during the accountant's reclass ──────────────────────────────────────
-- The old account stays under Special expenses; the three new project accounts sit under the new categories.
-- The reclass journal moved 200 off the old account (debit 500, credit 200 ⇒ net 300) onto the new ones.
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('13260000-0000-0000-0000-000000000001','Special expenses','Travel expenses - TVC', true),
  ('13260000-0000-0000-0000-000000000001','Travel & accommodation','TEST-HOTEL - TVC', true),
  ('13260000-0000-0000-0000-000000000001','Travel & accommodation','TEST-TRAVEL - TVC', false),
  ('13260000-0000-0000-0000-000000000001','Vehicle','TEST-VEHICLE - TVC', true);
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state) values
  ('13260000-0000-0000-0000-000000000001','13262222-0000-0000-0000-000000000001','2026','pushed');
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id) values
  ('13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001','Travel expenses - TVC','2026',500.00,200.00,300.00,now(),'13264444-0000-0000-0000-000000000001'),
  ('13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001','TEST-HOTEL - TVC','2026',150.00,0,150.00,now(),'13264444-0000-0000-0000-000000000001'),
  ('13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001','TEST-TRAVEL - TVC','2026',50.00,0,50.00,now(),'13264444-0000-0000-0000-000000000001'),
  ('13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001','TEST-VEHICLE - TVC','2026',80.00,0,80.00,now(),'13264444-0000-0000-0000-000000000001'),
  ('13260000-0000-0000-0000-000000000001','13261111-0000-0000-0000-000000000001','Unmapped Office - TVC','2026',999.00,0,999.00,now(),'13264444-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"13260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select category::text, actuals_to_date from public.project_mapped_actuals('13261111-0000-0000-0000-000000000001','2026')
     where category in ('Special expenses','Travel & accommodation','Vehicle') order by category$$,
  $$values ('Special expenses',300.00::numeric), ('Travel & accommodation',200.00::numeric), ('Vehicle',80.00::numeric)$$,
  'AC-TVC-006 each account lands in exactly one category: the new accounts under the new categories, the old one under Special expenses');
select is(
  (select sum(actuals_to_date) from public.project_mapped_actuals('13261111-0000-0000-0000-000000000001','2026')),
  580.00::numeric,
  'AC-TVC-006 no double count: the categories add up to the mapped accounts'' nets (300 + 150 + 50 + 80), nothing more');
select results_eq(
  $$select category::text, actuals_to_date from public.get_budget_projection('13261111-0000-0000-0000-000000000001','2026')
     where category in ('Special expenses','Travel & accommodation','Vehicle') order by category$$,
  $$values ('Special expenses',300.00::numeric), ('Travel & accommodation',200.00::numeric), ('Vehicle',80.00::numeric)$$,
  'AC-TVC-006 budget vs actual reads the same split');
select is(
  (select pmo_budget_amount from public.get_budget_projection('13261111-0000-0000-0000-000000000001','2026')
    where category = 'Special expenses'),
  200.00::numeric,
  'AC-TVC-005 the Active budget still reports its Special expenses line (the Draft moves did not leak into it)');

-- FR-TVC-006 precedence: an account belongs to ONE category. The Admin cannot also list a new project account
-- under Special expenses, so the reclass can never count one GL row twice.
set local request.jwt.claims = '{"sub":"13260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account, is_push_target)
      values ('Special expenses','TEST-HOTEL - TVC', false)$$,
  '23505', null,
  'AC-TVC-006 an account already under Travel & accommodation cannot also back Special expenses');
select throws_ok(
  $$insert into public.budget_category_account_map (category, erp_account, is_push_target)
      values ('Vehicle','Travel expenses - TVC', false)$$,
  '23505', null,
  'AC-TVC-006 the old Special expenses account cannot also back Vehicle');

-- ── AC-TVC-007: the OAuth API client tier (pmo rpc) ────────────────────────────────────────────────
select pg_temp.req('13260000-0000-0000-0000-0000000000a1', 'POST', '/rpc/recategorise_budget_lines');
select lives_ok('select public.api_client_request_guard()',
  'AC-TVC-007 active Admin client: POST recategorise_budget_lines passes the guard');
select pg_temp.req('13260000-0000-0000-0000-0000000000a1', 'GET', '/rpc/recategorise_budget_lines');
select throws_ok('select public.api_client_request_guard()', '42501', null,
  'AC-TVC-007 Admin client: only POST reaches the RPC');
select pg_temp.req('13260000-0000-0000-0000-0000000000a4', 'POST', '/rpc/recategorise_budget_lines');
select throws_ok('select public.api_client_request_guard()', '42501', null,
  'AC-TVC-007 Project Manager client: refused');
select pg_temp.req('13260000-0000-0000-0000-0000000000a2', 'POST', '/rpc/recategorise_budget_lines');
select throws_ok('select public.api_client_request_guard()', '42501', null,
  'AC-TVC-007 Finance client: refused');
select pg_temp.req('13260000-0000-0000-0000-0000000000a3', 'POST', '/rpc/recategorise_budget_lines');
select throws_ok('select public.api_client_request_guard()', '42501', null,
  'AC-TVC-007 disabled Admin client: refused');
select pg_temp.req('13260000-0000-0000-0000-0000000000a1', 'POST', '/rpc/set_project_contract_value');
select lives_ok('select public.api_client_request_guard()',
  'AC-TVC-007 the existing load tier is unchanged for an active Admin');
select pg_temp.req('13260000-0000-0000-0000-0000000000a4', 'POST', '/rpc/get_project_milestones');
select lives_ok('select public.api_client_request_guard()',
  'AC-TVC-007 the ordinary RPC tier is unchanged for any member');

select * from finish();
rollback;
