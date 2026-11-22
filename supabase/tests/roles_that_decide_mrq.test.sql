-- roles_that_decide_mrq.test.sql — material-request approval steps that name a job role (docs/specs/roles-that-decide.spec.md §2.2).
-- Migrations under test: 1840_holds_job_role.sql, 1841_mrq_job_role_steps.sql.
-- AC-RTD-003 three job-role steps decided in order by three holders · AC-RTD-004 another job role on the same level is refused,
-- a person with no job role on the base level is accepted · AC-RTD-006 the queue and the notified set equal who may decide; a
-- stand-in acts only for a holder · AC-RTD-007 a pin on a job-role step takes only a filler and lapses when the job role changes ·
-- AC-RTD-008 the snapshot keeps the job role · AC-RTD-009 (steps) naming a job role needs the setting on and an Admin.
-- AC-RTD-005 (a step with no job role decides as today) is owned by the untouched mrq_approval / mrq_step_pin / mrq_stuck_pin /
-- mrq_approver_inbox files.
-- Every denial asserts the errcode AND the message, so a different gate moving in front cannot pass it.
-- MUTATION NOTES (break the rule in 1840/1841; the named assertion must go red; restore):
--   1840 drop "p.built_in_role is null and" (mut:includes) ......... 'AC-RTD-004 a Storekeeper cannot decide the Material Coordinator step'
--   1840 mut:holds compares p.role to the base level instead of the key 'AC-RTD-004 a Project Manager job role cannot decide the Construction Manager step'
--   1841 mrq_submit copies null instead of c.job_role (mut:snapshot_job_role) 'AC-RTD-008 the in-flight request keeps its job roles'
--   1841 mrq_decide_step mut:twice compares (position, role, label) only, after a chain edit that changes only the job role
--                                                                    'AC-RTD-003 one person, one step: a changed job role is a different step'
--   1841 mrq_step_authority mut:fills_stand_in reads d.role = p_role 'AC-RTD-006 a stand-in for a holder of another job role cannot decide'
--   1841 mrq_set_step_pin mut:pin_fills reads p.role = v_role ......... 'AC-RTD-007 a pin on a job-role step refuses a person who does not fill it'
--   1841 mrq_set_chain drop the mut:job_role_setting check ............. 'AC-RTD-009 a job role cannot be named while built-in roles are off'
begin;
create extension if not exists pgtap;
select plan(34);

-- ── Fixtures (written as the table owner) ─────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('18410000-0000-0000-0000-00000000000a', 'RTD MRQ Org', 'IDR', 'Asia/Jakarta', true),
  ('18410000-0000-0000-0000-00000000000b', 'RTD MRQ Off Org', 'IDR', 'Asia/Jakarta', false);
insert into auth.users (id, email) values
  ('18410000-0000-0000-0000-0000000000a1', 'rtdm-admin@example.com'),
  ('18410000-0000-0000-0000-0000000000a2', 'rtdm-req@example.com'),
  ('18410000-0000-0000-0000-0000000000a3', 'rtdm-mc@example.com'),
  ('18410000-0000-0000-0000-0000000000a4', 'rtdm-sk@example.com'),
  ('18410000-0000-0000-0000-0000000000a5', 'rtdm-eng@example.com'),
  ('18410000-0000-0000-0000-0000000000a6', 'rtdm-cm@example.com'),
  ('18410000-0000-0000-0000-0000000000a7', 'rtdm-pm@example.com'),
  ('18410000-0000-0000-0000-0000000000a8', 'rtdm-fo@example.com'),
  ('18410000-0000-0000-0000-0000000000a9', 'rtdm-cm2@example.com'),
  ('18410000-0000-0000-0000-0000000000b1', 'rtdm-off-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18410000-0000-0000-0000-0000000000a1', '18410000-0000-0000-0000-00000000000a', 'RTDM Admin', 'rtdm-admin@example.com', 'Admin', 'active', null),
  ('18410000-0000-0000-0000-0000000000a2', '18410000-0000-0000-0000-00000000000a', 'RTDM Req',   'rtdm-req@example.com',   'Engineer', 'active', 'site_supervisor'),
  ('18410000-0000-0000-0000-0000000000a3', '18410000-0000-0000-0000-00000000000a', 'RTDM MC',    'rtdm-mc@example.com',    'Engineer', 'active', 'material_coordinator'),
  ('18410000-0000-0000-0000-0000000000a4', '18410000-0000-0000-0000-00000000000a', 'RTDM SK',    'rtdm-sk@example.com',    'Engineer', 'active', 'storekeeper'),
  ('18410000-0000-0000-0000-0000000000a5', '18410000-0000-0000-0000-00000000000a', 'RTDM Eng',   'rtdm-eng@example.com',   'Engineer', 'active', null),
  ('18410000-0000-0000-0000-0000000000a6', '18410000-0000-0000-0000-00000000000a', 'RTDM CM',    'rtdm-cm@example.com',    'Project Manager', 'active', 'construction_manager'),
  ('18410000-0000-0000-0000-0000000000a7', '18410000-0000-0000-0000-00000000000a', 'RTDM PM',    'rtdm-pm@example.com',    'Project Manager', 'active', 'project_manager'),
  ('18410000-0000-0000-0000-0000000000a8', '18410000-0000-0000-0000-00000000000a', 'RTDM FO',    'rtdm-fo@example.com',    'Finance', 'active', 'finance_officer'),
  ('18410000-0000-0000-0000-0000000000a9', '18410000-0000-0000-0000-00000000000a', 'RTDM CM2',   'rtdm-cm2@example.com',   'Project Manager', 'active', 'construction_manager'),
  ('18410000-0000-0000-0000-0000000000b1', '18410000-0000-0000-0000-00000000000b', 'RTDM Off',   'rtdm-off-admin@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('18410000-0000-0000-0000-0000000000d1', '18410000-0000-0000-0000-00000000000a', 'RTDM Site', 'Ongoing Project', '18410000-0000-0000-0000-0000000000a7');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('18410000-0000-0000-0000-000000000401', '18410000-0000-0000-0000-00000000000a', '18410000-0000-0000-0000-0000000000d1', 'RTDM WO', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('18410000-0000-0000-0000-000000000301', '18410000-0000-0000-0000-00000000000a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('18410000-0000-0000-0000-000000000311', '18410000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '18410000-0000-0000-0000-000000000301');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('18410000-0000-0000-0000-000000000801', '18410000-0000-0000-0000-00000000000a', 'RTDM-C', 'Central',  'central', null),
  ('18410000-0000-0000-0000-000000000802', '18410000-0000-0000-0000-00000000000a', 'RTDM-S', 'Site one', 'site',    '18410000-0000-0000-0000-0000000000d1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('18410000-0000-0000-0000-00000000000a', '18410000-0000-0000-0000-000000000801', '18410000-0000-0000-0000-0000000000a8');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._raise(p_qty numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp._as('18410000-0000-0000-0000-0000000000a2');
  v := public.mrq_save_draft(null,
         jsonb_build_object('work_order_id', '18410000-0000-0000-0000-000000000401', 'needed_by', current_date + 5),
         jsonb_build_array(jsonb_build_object('item_id', '18410000-0000-0000-0000-000000000311', 'quantity', p_qty,
                                              'over_plan_reason', 'needed for the pour')));
  perform public.mrq_submit(v);
  return v;
end $$;
grant execute on function pg_temp._raise(numeric) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;

-- AC-RTD-009 (steps): the setting gate and the Admin gate.
select pg_temp._as('18410000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.mrq_set_chain('[{"job_role":"storekeeper","label":"Stock"}]'::jsonb) $$, 'P0001',
  'MRQ_JOB_ROLE_OFF: turn on built-in roles before a step can name a job role',
  'AC-RTD-009 a job role cannot be named while built-in roles are off');
select is((select count(*)::int from approval_chain_steps where org_id = '18410000-0000-0000-0000-00000000000b'), 0,
  'AC-RTD-009 nothing persisted for the organisation with the setting off');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Finance","label":"Stock"}]'::jsonb) $$,
  'AC-RTD-009 a step with no job role is still accepted while the setting is off');
select pg_temp._as('18410000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.mrq_set_chain('[{"job_role":"storekeeper","label":"Stock"}]'::jsonb) $$, '42501',
  'MRQ_ADMIN_ONLY: only an Admin can change the approval chain', 'AC-RTD-009 a non-Admin cannot name a job role on a step');
select pg_temp._as('18410000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.mrq_set_chain('[{"job_role":"no_such_role","label":"Stock"}]'::jsonb) $$, 'P0001',
  'MRQ_JOB_ROLE_UNKNOWN: step 1 names a job role that does not exist', 'AC-RTD-009 an unknown job role is refused');

-- AC-RTD-003: the Admin sets three job-role steps in order.
select lives_ok($$ select public.mrq_set_chain('[{"job_role":"material_coordinator","label":"Stock check"},
                                                  {"job_role":"construction_manager","label":"Site check"},
                                                  {"job_role":"finance_officer","label":"Cost check"}]'::jsonb) $$,
  'AC-RTD-003 an Admin sets a chain of three job-role steps');
select is((select array_agg(role::text || ':' || job_role order by position) from approval_chain_steps
            where org_id = '18410000-0000-0000-0000-00000000000a'),
  array['Engineer:material_coordinator', 'Project Manager:construction_manager', 'Finance:finance_officer'],
  'AC-RTD-003 each step''s level is its job role''s base level');

insert into t_ids values ('r1', pg_temp._raise(10));
select is((select array_agg(job_role order by position) from material_request_steps where request_id = (select v from t_ids where k = 'r1')),
  array['material_coordinator', 'construction_manager', 'finance_officer'], 'AC-RTD-008 the submit snapshot carries each job role');

-- AC-RTD-004: same level, other job role → refused; then the holder decides.
select pg_temp._as('18410000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'approve') $$, '42501',
  'MRQ_NOT_JOB_ROLE: this step is for a job role you do not hold, and you stand in for no one who holds it today',
  'AC-RTD-004 a Storekeeper cannot decide the Material Coordinator step');
select is((select status from material_request_steps where request_id = (select v from t_ids where k = 'r1') and position = 1), 'open',
  'AC-RTD-004 the refused step stays open');
select ok(not exists (select 1 from public.mrq_waiting_for_me() where request_id = (select v from t_ids where k = 'r1')),
  'AC-RTD-006 the Storekeeper''s queue does not list the step');
select pg_temp._as('18410000-0000-0000-0000-0000000000a3');
select ok(exists (select 1 from public.mrq_waiting_for_me() w where w.request_id = (select v from t_ids where k = 'r1')
                     and w.step_position = 1 and w.job_role = 'material_coordinator'),
  'AC-RTD-006 the Material Coordinator''s queue lists the step with its job role');
select pg_temp._as('18410000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 2, 'approve') $$, 'P0001',
  'MRQ_OUT_OF_ORDER: step 2 is not the open step; steps are decided in order', 'AC-RTD-003 a step decided out of order is refused');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'approve') $$,
  'AC-RTD-003 the Material Coordinator decides step 1');

-- step 2: a project_manager holder sits on the same level as construction_manager and is refused.
select pg_temp._as('18410000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 2, 'approve') $$, '42501',
  'MRQ_NOT_JOB_ROLE: this step is for a job role you do not hold, and you stand in for no one who holds it today',
  'AC-RTD-004 a Project Manager job role cannot decide the Construction Manager step');
reset role;
select is((select array_agg(x order by x) from public.mrq_step_recipients(
             (select id from material_request_steps where request_id = (select v from t_ids where k = 'r1') and position = 2)) x),
  array['18410000-0000-0000-0000-0000000000a6', '18410000-0000-0000-0000-0000000000a9']::uuid[],
  'AC-RTD-006 the notified set for the Construction Manager step is exactly its two holders');
set local role authenticated;
select pg_temp._as('18410000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 2, 'approve') $$,
  'AC-RTD-003 the Construction Manager decides step 2');
select pg_temp._as('18410000-0000-0000-0000-0000000000a8');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 3, 'approve', null, '18410000-0000-0000-0000-000000000801') $$,
  'AC-RTD-003 the Finance Officer decides step 3');
select is((select status from material_requests where id = (select v from t_ids where k = 'r1')), 'approved',
  'AC-RTD-003 three holders in order approve the request');
select is((select array_agg(decided_by order by position) from material_request_steps where request_id = (select v from t_ids where k = 'r1')),
  array['18410000-0000-0000-0000-0000000000a3', '18410000-0000-0000-0000-0000000000a6', '18410000-0000-0000-0000-0000000000a8']::uuid[],
  'AC-RTD-003 each step records its decider');

-- AC-RTD-004: a person with no job role on the base level fills the step (FR-RTD-003).
insert into t_ids values ('r2', pg_temp._raise(4));
select pg_temp._as('18410000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 1, 'approve') $$,
  'AC-RTD-004 an Engineer with no job role decides the Material Coordinator step');

-- AC-RTD-008: the chain changes while r2 is in flight; r2 keeps its job roles.
select pg_temp._as('18410000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_chain('[{"job_role":"storekeeper","label":"Stock check"},
                                                  {"job_role":"construction_manager","label":"Site check"},
                                                  {"job_role":"finance_officer","label":"Cost check"}]'::jsonb) $$,
  'AC-RTD-008 the Admin changes step 1''s job role');
select is((select array_agg(job_role order by position) from material_request_steps where request_id = (select v from t_ids where k = 'r2')),
  array['material_coordinator', 'construction_manager', 'finance_officer'], 'AC-RTD-008 the in-flight request keeps its job roles');

-- AC-RTD-003 one person, one step: r2 is returned at step 2 and resubmitted under the new chain. The new step 1 names a different
-- job role (storekeeper), so it is a different step from the one the no-job-role Engineer decided in round 1: they may not decide it.
select pg_temp._as('18410000-0000-0000-0000-0000000000a6');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 2, 'return', 'check the count') $$,
  'AC-RTD-003 the Construction Manager returns r2');
select pg_temp._as('18410000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r2')) $$, 'AC-RTD-003 the author resubmits r2');
select pg_temp._as('18410000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 1, 'approve') $$, '42501',
  'MRQ_SOD_TWICE: you already decided another step of this request',
  'AC-RTD-003 one person, one step: a changed job role is a different step');
select pg_temp._as('18410000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 1, 'approve') $$,
  'AC-RTD-003 the Storekeeper decides the new job-role step 1');

-- AC-RTD-006: a stand-in acts only for a holder of the step's job role.
select pg_temp._as('18410000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_stand_in('18410000-0000-0000-0000-0000000000a7', '18410000-0000-0000-0000-0000000000a5',
                                                  current_date, current_date + 3) $$, 'AC-RTD-006 the Project Manager names a stand-in');
select pg_temp._as('18410000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 2, 'approve') $$, '42501',
  'MRQ_NOT_JOB_ROLE: this step is for a job role you do not hold, and you stand in for no one who holds it today',
  'AC-RTD-006 a stand-in for a holder of another job role cannot decide');

-- AC-RTD-007: pins on a job-role step.
select pg_temp._as('18410000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.mrq_set_step_pin('18410000-0000-0000-0000-0000000000d1', 2, '18410000-0000-0000-0000-0000000000a7') $$, 'P0001',
  'MRQ_PIN_INVALID: the approver must be an active member who holds the step''s role',
  'AC-RTD-007 a pin on a job-role step refuses a person who does not fill it');
select lives_ok($$ select public.mrq_set_step_pin('18410000-0000-0000-0000-0000000000d1', 2, '18410000-0000-0000-0000-0000000000a9') $$,
  'AC-RTD-007 a pin on a job-role step takes a holder');
select is((select job_role from approval_step_pins where project_id = '18410000-0000-0000-0000-0000000000d1' and position = 2),
  'construction_manager', 'AC-RTD-007 the pin records the step''s job role');
select lives_ok($$ select public.mrq_set_chain('[{"job_role":"storekeeper","label":"Stock check"},
                                                  {"job_role":"quality_manager","label":"Site check"},
                                                  {"job_role":"finance_officer","label":"Cost check"}]'::jsonb) $$,
  'AC-RTD-007 the Admin changes the job role at the pinned position (same level)');
reset role;
select is(public.mrq_pinned_to('18410000-0000-0000-0000-0000000000d1', 2, 'Project Manager', 'quality_manager'), null::uuid,
  'AC-RTD-007 the pin no longer applies after the job role at its position changes');

select * from finish();
rollback;
