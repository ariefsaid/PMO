-- 0065_milestone_rollup_oracle.test.sql — worked-example rollup oracle (AC-DEL-019).
-- Milestones E(w=20)/P(w=30)/C(w=50) → effective% 100/40/0 → project delivery = 32%.
-- Also covers: null calculated_pct for a task-less milestone; project with no milestones returns a summary row with null delivery.
-- Fixture namespace: 00650000-… (unique to this test).
begin;
select plan(12);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into auth.users (id, email) values
  ('00650000-0000-0000-0000-0000000000a1','ro-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00650000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'RO PM','ro-pm@example.com','Project Manager');

insert into companies (id, org_id, name, type) values
  ('00650000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','RO Client','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, budget, contract_value) values
  ('00650000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'RO-001','Rollup Test Project','Ongoing Project',
   '00650000-0000-0000-0000-000000000010',
   '00650000-0000-0000-0000-0000000000a1',100000,100000),
  -- empty project (no milestones) for the summary-row check
  ('00650000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001',
   'RO-002','Empty Project','Ongoing Project',
   '00650000-0000-0000-0000-000000000010',
   '00650000-0000-0000-0000-0000000000a1',100000,100000);

-- Milestones E(w=20), P(w=30), C(w=50), N(w=0, no tasks — zero weight excluded from denominator).
insert into project_milestones (id, org_id, project_id, name, weight, sort_order) values
  ('00650000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001',
   '00650000-0000-0000-0000-000000000020','Engineering design',20,0),
  ('00650000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001',
   '00650000-0000-0000-0000-000000000020','Procurement',30,1),
  ('00650000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000001',
   '00650000-0000-0000-0000-000000000020','Construction',50,2),
  ('00650000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000001',
   '00650000-0000-0000-0000-000000000020','No-tasks Milestone',0,3);

-- E: 5 tasks all Done → calculated_pct = 100.
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('00650000-0000-0001-0001-000000000001','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000031','E-T1','Done'),
  ('00650000-0000-0001-0001-000000000002','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000031','E-T2','Done'),
  ('00650000-0000-0001-0001-000000000003','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000031','E-T3','Done'),
  ('00650000-0000-0001-0001-000000000004','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000031','E-T4','Done'),
  ('00650000-0000-0001-0001-000000000005','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000031','E-T5','Done');

-- P: 5 tasks, 2 Done → calculated_pct = 40.
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('00650000-0000-0001-0002-000000000001','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000032','P-T1','Done'),
  ('00650000-0000-0001-0002-000000000002','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000032','P-T2','Done'),
  ('00650000-0000-0001-0002-000000000003','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000032','P-T3','To Do'),
  ('00650000-0000-0001-0002-000000000004','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000032','P-T4','To Do'),
  ('00650000-0000-0001-0002-000000000005','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000032','P-T5','To Do');

-- C: 4 tasks, 0 Done → calculated_pct = 0.
insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('00650000-0000-0001-0003-000000000001','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000033','C-T1','To Do'),
  ('00650000-0000-0001-0003-000000000002','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000033','C-T2','To Do'),
  ('00650000-0000-0001-0003-000000000003','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000033','C-T3','To Do'),
  ('00650000-0000-0001-0003-000000000004','00000000-0000-0000-0000-000000000001','00650000-0000-0000-0000-000000000020','00650000-0000-0000-0000-000000000033','C-T4','To Do');

-- N: no tasks (to test calculated_pct is null and effective_pct = 0).

-- ── Tests (as the PM, so RLS scopes results to the default org). ────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00650000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-DEL-019: get_project_milestones effective % = 100/40/0 for E/P/C.
select is(
  (select effective_pct from get_project_milestones('00650000-0000-0000-0000-000000000020')
    where id = '00650000-0000-0000-0000-000000000031'),
  100::numeric,
  'AC-DEL-019: get_project_milestones effective_pct = 100 for milestone E (5/5 Done)');

select is(
  (select effective_pct from get_project_milestones('00650000-0000-0000-0000-000000000020')
    where id = '00650000-0000-0000-0000-000000000032'),
  40::numeric,
  'AC-DEL-019: get_project_milestones effective_pct = 40 for milestone P (2/5 Done)');

select is(
  (select effective_pct from get_project_milestones('00650000-0000-0000-0000-000000000020')
    where id = '00650000-0000-0000-0000-000000000033'),
  0::numeric,
  'AC-DEL-019: get_project_milestones effective_pct = 0 for milestone C (0/4 Done)');

-- AC-DEL-019: calculated_pct is null for a task-less milestone; effective_pct = 0.
select ok(
  (select calculated_pct is null from get_project_milestones('00650000-0000-0000-0000-000000000020')
    where id = '00650000-0000-0000-0000-000000000034'),
  'AC-DEL-019: calculated_pct is null for a milestone with no tasks');

select is(
  (select effective_pct from get_project_milestones('00650000-0000-0000-0000-000000000020')
    where id = '00650000-0000-0000-0000-000000000034'),
  0::numeric,
  'AC-DEL-019: effective_pct = 0 for a task-less milestone (coalesce fallback)');

-- AC-DEL-019: get_projects_delivery returns 32 for the worked-example project.
-- N has weight=0 so it is excluded from denominator: (20*100 + 30*40 + 50*0) / (20+30+50) = 3200/100 = 32.
select is(
  (select delivery_pct::numeric(10,0)
     from get_projects_delivery(array['00650000-0000-0000-0000-000000000020'::uuid])),
  32::numeric,
  'AC-DEL-019: get_projects_delivery returns 32 for the worked-example project (weights 20/30/50 → 32%)');

-- AC-DEL-007/019: a project with no milestones is present in get_projects_delivery so
-- the Projects list can render committed spend + budget even when delivery is unknown.
select is(
  (select count(*)::int
     from get_projects_delivery(array['00650000-0000-0000-0000-000000000021'::uuid])),
  1,
  'AC-DEL-007/019: a project with no milestones is present in get_projects_delivery');

select ok(
  (select delivery_pct is null
     from get_projects_delivery(array['00650000-0000-0000-0000-000000000021'::uuid])),
  'AC-DEL-007/019: a project with no milestones has null delivery_pct');

select is(
  (select committed_spend::numeric(10,0)
     from get_projects_delivery(array['00650000-0000-0000-0000-000000000021'::uuid])),
  0::numeric,
  'AC-DEL-007/019: a project with no milestones still reports committed_spend');

select is(
  (select budget::numeric(10,0)
     from get_projects_delivery(array['00650000-0000-0000-0000-000000000021'::uuid])),
  100000::numeric,
  'AC-DEL-007/019: a project with no milestones still reports budget');

-- I-1 no-signal suppression: a project whose milestones ALL have no tasks and no input_pct
-- must return NULL delivery_pct (not a misleading 0%), so the chip is suppressed.
-- Using the empty project (00650000-0000-0000-0000-000000000021) with two no-signal milestones.
reset role;
insert into project_milestones (id, org_id, project_id, name, weight, sort_order)
  values
    ('00650000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001',
     '00650000-0000-0000-0000-000000000021','No-signal A',1,0),
    ('00650000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000001',
     '00650000-0000-0000-0000-000000000021','No-signal B',1,1);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00650000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok(
  (select delivery_pct is null
     from get_projects_delivery(array['00650000-0000-0000-0000-000000000021'::uuid])),
  'I-1: get_projects_delivery returns NULL when ALL milestones have no tasks and no input_pct');

-- I-1: a project with milestones that HAVE tasks (even 0 done) returns a non-null delivery_pct (real 0%).
-- Add one task (not done) to no-signal A to give it a signal.
reset role;
insert into tasks (id, org_id, project_id, milestone_id, name, status)
  values ('00650000-0000-0001-0004-000000000001','00000000-0000-0000-0000-000000000001',
          '00650000-0000-0000-0000-000000000021','00650000-0000-0000-0000-000000000041','NS-T1','To Do');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00650000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok(
  (select delivery_pct is not null
     from get_projects_delivery(array['00650000-0000-0000-0000-000000000021'::uuid])),
  'I-1: get_projects_delivery returns non-null when at least one milestone has a task (real 0%)');

reset role;

select * from finish();
rollback;
