-- 2751_pm_money_scope_rule.test.sql — a Project Manager reads money for their own projects (DD-R1125-14, DD-R1125-15).
-- Migration under test: 2751_pm_money_scope_rule.sql.
-- Who is limited: access level Project Manager with job role Project Manager, Deputy Project Manager or none.
-- Own project: managed, named deputy, or standing in today for its manager.
-- Approval routing reads the whole project for every approver (AC-007); a client's own read is limited.
-- Mutation checks: make actor_money_scoped's job-role test always true → the Procurement Manager cases go red;
-- drop the stand-in branch → the stand-in cases go red; make money_read_is_internal return false → the routing cases go red;
-- make project_money_in_scope return true → the "other project" cases go red.
begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('27510000-0000-0000-0000-00000000000a', 'PS3 Org',       'IDR', true),
  ('27510000-0000-0000-0000-00000000000b', 'PS3 Other Org', 'IDR', true);
insert into auth.users (id, email)
select ('27510000-0000-0000-0000-0000000000' || k)::uuid, 'ps3-' || k || '@example.test'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b3','b4','c1','c2']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27510000-0000-0000-0000-0000000000a1', '27510000-0000-0000-0000-00000000000a', 'PS3 Admin',   'ps3-a1@example.test', 'Admin',           'active', null),
  ('27510000-0000-0000-0000-0000000000a2', '27510000-0000-0000-0000-00000000000a', 'PS3 Fin',     'ps3-a2@example.test', 'Finance',         'active', null),
  ('27510000-0000-0000-0000-0000000000a3', '27510000-0000-0000-0000-00000000000a', 'PS3 PM A',    'ps3-a3@example.test', 'Project Manager', 'active', 'project_manager'),
  ('27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-00000000000a', 'PS3 PM B',    'ps3-a4@example.test', 'Project Manager', 'active', null),
  ('27510000-0000-0000-0000-0000000000a5', '27510000-0000-0000-0000-00000000000a', 'PS3 Deputy A','ps3-a5@example.test', 'Project Manager', 'active', 'deputy_project_manager'),
  ('27510000-0000-0000-0000-0000000000a6', '27510000-0000-0000-0000-00000000000a', 'PS3 Deputy 0','ps3-a6@example.test', 'Project Manager', 'active', 'deputy_project_manager'),
  ('27510000-0000-0000-0000-0000000000a7', '27510000-0000-0000-0000-00000000000a', 'PS3 Buyer M', 'ps3-a7@example.test', 'Project Manager', 'active', 'procurement_manager'),
  ('27510000-0000-0000-0000-0000000000a8', '27510000-0000-0000-0000-00000000000a', 'PS3 Equip M', 'ps3-a8@example.test', 'Project Manager', 'active', 'equipment_manager'),
  ('27510000-0000-0000-0000-0000000000a9', '27510000-0000-0000-0000-00000000000a', 'PS3 HR M',    'ps3-a9@example.test', 'Project Manager', 'active', 'hr_manager'),
  ('27510000-0000-0000-0000-0000000000b1', '27510000-0000-0000-0000-00000000000a', 'PS3 PCM',     'ps3-b1@example.test', 'Project Manager', 'active', 'project_control_manager'),
  ('27510000-0000-0000-0000-0000000000b2', '27510000-0000-0000-0000-00000000000a', 'PS3 Exec',    'ps3-b2@example.test', 'Executive',       'active', null),
  ('27510000-0000-0000-0000-0000000000b3', '27510000-0000-0000-0000-00000000000a', 'PS3 Stand-in','ps3-b3@example.test', 'Project Manager', 'active', 'project_manager'),
  ('27510000-0000-0000-0000-0000000000b4', '27510000-0000-0000-0000-00000000000a', 'PS3 Old SI',  'ps3-b4@example.test', 'Project Manager', 'active', 'project_manager'),
  ('27510000-0000-0000-0000-0000000000c1', '27510000-0000-0000-0000-00000000000b', 'PS3 XOrg',    'ps3-c1@example.test', 'Admin',           'active', null),
  ('27510000-0000-0000-0000-0000000000c2', '27510000-0000-0000-0000-00000000000b', 'PS3 XOrg PM', 'ps3-c2@example.test', 'Project Manager', 'active', 'project_manager');
-- A: managed by PM A, deputy Deputy A. B: managed by PM B (no job role).
insert into projects (id, org_id, name, status, project_manager_id, deputy_manager_id, currency) values
  ('27510000-0000-0000-0000-0000000000d1', '27510000-0000-0000-0000-00000000000a', 'PS3 Project A', 'Ongoing Project', '27510000-0000-0000-0000-0000000000a3', '27510000-0000-0000-0000-0000000000a5', 'IDR'),
  ('27510000-0000-0000-0000-0000000000d2', '27510000-0000-0000-0000-00000000000a', 'PS3 Project B', 'Ongoing Project', '27510000-0000-0000-0000-0000000000a4', null, 'IDR');
-- Stand-ins for PM B: b3 today, b4 revoked, a6 ended yesterday.
insert into approval_stand_ins (org_id, delegator_id, stand_in_id, starts_on, ends_on, created_by, revoked_at) values
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-0000000000b3', native_org_today('27510000-0000-0000-0000-00000000000a') - 1, native_org_today('27510000-0000-0000-0000-00000000000a') + 1, '27510000-0000-0000-0000-0000000000a1', null),
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-0000000000b4', native_org_today('27510000-0000-0000-0000-00000000000a') - 1, native_org_today('27510000-0000-0000-0000-00000000000a') + 1, '27510000-0000-0000-0000-0000000000a1', now()),
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000a4', '27510000-0000-0000-0000-0000000000a6', native_org_today('27510000-0000-0000-0000-00000000000a') - 5, native_org_today('27510000-0000-0000-0000-00000000000a') - 1, '27510000-0000-0000-0000-0000000000a1', null);
-- B carries money: an active 1000 Labor budget and an 800 Labor purchase, paid. PM A approves spend org-wide; PM B is
-- B's named approver (so B is not on the flat matrix, which routes to every holder of approval rank).
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('27510000-0000-0000-0000-000000000101', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000d2', 1, 'v1', 'Draft', 'IDR');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-000000000101', 'Labor', 1000);
update budget_versions set status = 'Active' where id = '27510000-0000-0000-0000-000000000101';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('27510000-0000-0000-0000-00000000000a', null, '27510000-0000-0000-0000-0000000000a3'),
  ('27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-0000000000d2', '27510000-0000-0000-0000-0000000000a4'),
  ('27510000-0000-0000-0000-00000000000b', null, '27510000-0000-0000-0000-0000000000c2');
insert into procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, requested_by_id) values
  ('27510000-0000-0000-0000-000000000601', '27510000-0000-0000-0000-00000000000a', 'PS3 buy B', 'Ordered', 800, '27510000-0000-0000-0000-0000000000d2', 'IDR', 'Labor', '27510000-0000-0000-0000-0000000000a4');
insert into payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('27510000-0000-0000-0000-000000000701', '27510000-0000-0000-0000-00000000000a', '27510000-0000-0000-0000-000000000601', 'Paid', '2026-10-10', 800, 'IDR');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create temp table route_seen (who text, route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric) on commit drop;
create temp table figures_seen (who text, figures jsonb) on commit drop;
create temp table gate_seen (who text, v text) on commit drop;
grant all on route_seen, figures_seen, gate_seen to authenticated;
create or replace function pg_temp.see_route(p_who text) returns void language sql as $$
  insert into route_seen select p_who, r.* from public.spend_approval_route('27510000-0000-0000-0000-00000000000a',
    '27510000-0000-0000-0000-0000000000d2', 'Labor', 100, 'IDR', null) r;
  insert into figures_seen select p_who, f.figures from public.spend_approval_project_figures(array['27510000-0000-0000-0000-0000000000d2'::uuid]) f;
$$;
set local role authenticated;

-- ── Who is limited ───────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.scoped(p_uid uuid) returns boolean language sql as $$
  select pg_temp.act_as(p_uid); select public.actor_money_scoped();
$$;
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a3'), true,  'PS3 scope: job role Project Manager is limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a4'), true,  'PS3 scope: Project Manager access with no job role is limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a5'), true,  'PS3 scope: Deputy Project Manager is limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a7'), false, 'PS3 scope: Procurement Manager is not limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a8'), false, 'PS3 scope: Equipment Manager is not limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a9'), false, 'PS3 scope: HR Manager is not limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000b1'), false, 'PS3 scope: Project Control Manager is not limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a1'), false, 'PS3 scope: Admin is not limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000a2'), false, 'PS3 scope: Finance is not limited');
select is(pg_temp.scoped('27510000-0000-0000-0000-0000000000b2'), false, 'PS3 scope: Executive is not limited');

-- ── Own projects ─────────────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.own(p_uid uuid) returns uuid[] language sql as $$
  select pg_temp.act_as(p_uid); select coalesce(array_agg(x order by x), '{}') from public.actor_money_projects() x;
$$;
select is(pg_temp.own('27510000-0000-0000-0000-0000000000a3'), array['27510000-0000-0000-0000-0000000000d1'::uuid], 'PS3 own: PM A owns A');
select is(pg_temp.own('27510000-0000-0000-0000-0000000000a5'), array['27510000-0000-0000-0000-0000000000d1'::uuid], 'PS3 own: the deputy named on A owns A');
select is(pg_temp.own('27510000-0000-0000-0000-0000000000a6'), '{}'::uuid[], 'PS3 own: a deputy named on no project (and an ended stand-in) owns nothing');
select is(pg_temp.own('27510000-0000-0000-0000-0000000000b3'), array['27510000-0000-0000-0000-0000000000d2'::uuid], 'PS3 own: standing in today for PM B owns B');
select is(pg_temp.own('27510000-0000-0000-0000-0000000000b4'), '{}'::uuid[], 'PS3 own: a revoked stand-in owns nothing');

-- ── Reads a client makes: own project yes, another no ────────────────────────────────────────────
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a5');
select is(project_money_in_scope('27510000-0000-0000-0000-0000000000d1'), true,  'PS3 deputy: A is in scope');
select is(project_money_in_scope('27510000-0000-0000-0000-0000000000d2'), false, 'PS3 deputy: B is out of scope');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a6');
select is(project_money_in_scope('27510000-0000-0000-0000-0000000000d1'), false, 'PS3 deputy on no project: A is out of scope');

select pg_temp.act_as('27510000-0000-0000-0000-0000000000a3');
select is(money_read_is_internal(), false, 'PS3 a client read is not internal');
select throws_ok($$select * from project_finance_actuals('27510000-0000-0000-0000-0000000000d2')$$, 'P0002', 'project not found',
  'PS3 PM A: project_finance_actuals of B reads as not found');
select lives_ok($$select * from project_finance_actuals('27510000-0000-0000-0000-0000000000d1')$$, 'PS3 PM A: project_finance_actuals of A returns');
select is((select count(*) from project_pmo_spent_position('27510000-0000-0000-0000-0000000000d2'))::int, 0, 'PS3 PM A: spent position of B, no row');
select is((select count(*) from project_pmo_commitment_position('27510000-0000-0000-0000-0000000000d2'))::int, 0, 'PS3 PM A: commitment position of B, no row');
select is((select count(*) from project_pmo_paid_by_category('27510000-0000-0000-0000-0000000000d2'))::int, 0, 'PS3 PM A: paid by category of B, no row');
select is((select array_agg(project_id) from project_pmo_positions(array['27510000-0000-0000-0000-0000000000d1'::uuid, '27510000-0000-0000-0000-0000000000d2'])),
          array['27510000-0000-0000-0000-0000000000d1'::uuid], 'PS3 PM A: positions list A only');
select is((select count(*) from stock_issue_cost_lines('27510000-0000-0000-0000-0000000000d2'))::int, 0, 'PS3 PM A: stock issue cost of B, no row');
select is((select count(*) from equipment_charge_project_actuals('27510000-0000-0000-0000-0000000000d2'))::int, 0, 'PS3 PM A: equipment charge of B, no row');
select is((select count(*) from equipment_charge_project_actuals_between('27510000-0000-0000-0000-0000000000d2', null, null))::int, 0, 'PS3 PM A: equipment charge window of B, no row');
select is((select count(*) from cost_attribution_project_actuals('27510000-0000-0000-0000-0000000000d2'))::int, 0, 'PS3 PM A: attributed cost of B, no row');
select is((select count(*) from budget_attributed_year_sums('27510000-0000-0000-0000-0000000000d2', null))::int, 0, 'PS3 PM A: attributed year sums of B, no row');
select throws_ok($$select * from stock_issue_cost_lines_core('27510000-0000-0000-0000-0000000000d2')$$, '42501', null,
  'PS3 a client cannot call the internal body directly');
select throws_ok($$select * from equipment_charge_project_actuals_core('27510000-0000-0000-0000-0000000000d2', null)$$, '42501', null,
  'PS3 a client cannot call the internal equipment body directly');

-- ── Not limited: unchanged reads on another project ──────────────────────────────────────────────
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a7');
select is((select spent from project_pmo_positions(array['27510000-0000-0000-0000-0000000000d2'::uuid])), 800::numeric, 'PS3 Procurement Manager: B''s spend reads');
select is(project_money_in_scope('27510000-0000-0000-0000-0000000000d2'), true, 'AC-004 Procurement Manager: B is in scope for bill match and the other project reads');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a8');
select is((select spent from project_pmo_positions(array['27510000-0000-0000-0000-0000000000d2'::uuid])), 800::numeric, 'PS3 Equipment Manager: B''s spend reads');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a9');
select is((select spent from project_pmo_positions(array['27510000-0000-0000-0000-0000000000d2'::uuid])), 800::numeric, 'PS3 HR Manager: B''s spend reads');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000b1');
select is((select spent from project_pmo_positions(array['27510000-0000-0000-0000-0000000000d2'::uuid])), 800::numeric, 'PS3 Project Control Manager: B''s spend reads');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000b3');
select is((select spent from project_pmo_positions(array['27510000-0000-0000-0000-0000000000d2'::uuid])), 800::numeric, 'PS3 stand-in for PM B: B''s spend reads');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000c1');
select is((select count(*) from project_pmo_positions(array['27510000-0000-0000-0000-0000000000d2'::uuid]))::int, 0, 'PS3 another organisation: no row');

-- ── AC-007 approval routing computes from the whole project for every approver ───────────────────
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a1');
select pg_temp.see_route('admin');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a3');
select pg_temp.see_route('pm_a');
select is((select line_used from route_seen where who = 'admin'), 800::numeric, 'AC-007 Admin: the route counts B''s 800 spent on the line');
select results_eq($$select route, reason, approver_ids, line_budget, line_used from route_seen where who = 'pm_a'$$,
                  $$select route, reason, approver_ids, line_budget, line_used from route_seen where who = 'admin'$$,
  'AC-007 PM A approving on B: the same route as Admin');
select results_eq($$select figures from figures_seen where who = 'pm_a'$$, $$select figures from figures_seen where who = 'admin'$$,
  'AC-007 PM A approving on B: the same project figures as Admin');
select ok((select (figures->>'proj_spent')::numeric from figures_seen where who = 'pm_a') = 800, 'AC-007 PM A: figures carry B''s 800 spent');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a1');
insert into gate_seen select 'admin', procurement_amount_eligibility('27510000-0000-0000-0000-000000000601', 100);
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a3');
insert into gate_seen select 'pm_a', procurement_amount_eligibility('27510000-0000-0000-0000-000000000601', 100);
select is((select v from gate_seen where who = 'pm_a'), (select v from gate_seen where who = 'admin'),
  'AC-007 PM A: the purchase amount gate on B decides as it does for Admin');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a6');
insert into gate_seen select 'deputy_0', procurement_amount_eligibility('27510000-0000-0000-0000-000000000601', 100);
select is((select v from gate_seen where who = 'deputy_0'), (select v from gate_seen where who = 'admin'),
  'AC-007 a limited Project Manager who neither owns B nor approves on it: the gate still decides from the whole project');
-- The routed figures read is no way round the rule, and stays in the caller's organisation.
select is((select count(*) from spend_approval_project_figures(array['27510000-0000-0000-0000-0000000000d2'::uuid]))::int, 0,
  'PS3 a Project Manager who neither owns B nor approves on it reads no figures of B');
select is((select count(*) from spend_route_project_figures_routed(array['27510000-0000-0000-0000-0000000000d2'::uuid]))::int, 0,
  'PS3 nor through the routed read called directly');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000c2');
select is((select count(*) from spend_route_project_figures_routed(array['27510000-0000-0000-0000-0000000000d2'::uuid]))::int, 0,
  'PS3 an org-wide approver of another organisation reads no figures of B');
select is((select count(*) from spend_approval_project_figures(array['27510000-0000-0000-0000-0000000000d2'::uuid]))::int, 0,
  'PS3 nor through the figures read');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000c1');
select is((select count(*) from spend_approval_project_figures(array['27510000-0000-0000-0000-0000000000d2'::uuid]))::int, 0,
  'PS3 an Admin of another organisation reads no figures of B');
reset role;
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and (has_function_privilege('anon', p.oid, 'execute'))
              and p.proname in ('actor_money_scoped','actor_money_projects','spend_route_project_figures_routed',
                                'stock_issue_cost_lines_scoped','stock_issue_cost_lines_core')), null,
  'PS3 no new definer is executable by anon');
select ok((select bool_and(p.proconfig::text like '%search_path=public, pg_temp%') from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef
              and p.proname in ('actor_money_scoped','actor_money_projects','spend_route_project_figures_routed',
                                'stock_issue_cost_lines_scoped','equipment_charge_project_actuals_scoped',
                                'equipment_charge_project_actuals_between_scoped','cost_attribution_project_actuals_scoped',
                                'budget_attributed_year_sums_scoped')), 'PS3 every new definer pins its search_path');
set local role authenticated;

-- ── Deputy link stays in the organisation ────────────────────────────────────────────────────────
reset role;
select throws_ok($$update projects set deputy_manager_id = '27510000-0000-0000-0000-0000000000c1' where id = '27510000-0000-0000-0000-0000000000d2'$$,
  '42501', 'deputy project manager not in this organization', 'PS3 deputy from another organisation is refused');
set local role authenticated;
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a3');
select lives_ok($$update projects set deputy_manager_id = '27510000-0000-0000-0000-0000000000a6' where id = '27510000-0000-0000-0000-0000000000d1'$$,
  'PS3 a Project Manager sets the deputy as they set the manager');
select pg_temp.act_as('27510000-0000-0000-0000-0000000000a6');
select is(project_money_in_scope('27510000-0000-0000-0000-0000000000d1'), true, 'PS3 the newly named deputy reads A');

select * from finish();
rollback;
