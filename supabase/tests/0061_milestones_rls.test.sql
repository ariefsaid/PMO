-- 0061_milestones_rls.test.sql — project_milestones RLS: reads open to all in-org roles;
-- writes (insert/update/delete) restricted to PM + Admin (FR-DEL-018, FR-DEL-019, OD-DEL-7).
-- AC-DEL-015: Engineer can SELECT; Engineer INSERT → 42501; Finance UPDATE → RLS no-op.
-- AC-DEL-016: PM INSERT succeeds (org_id defaulted); row visible to Admin; Admin UPDATE input_pct.
-- Fixture namespace: 00610000-… (unique to this test).
begin;
select plan(8);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into auth.users (id, email) values
  ('00610000-0000-0000-0000-0000000000a1','ms-pm@example.com'),
  ('00610000-0000-0000-0000-0000000000a2','ms-eng@example.com'),
  ('00610000-0000-0000-0000-0000000000a3','ms-finance@example.com'),
  ('00610000-0000-0000-0000-0000000000a4','ms-admin@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00610000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','MS PM','ms-pm@example.com','Project Manager'),
  ('00610000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','MS Eng','ms-eng@example.com','Engineer'),
  ('00610000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','MS Finance','ms-finance@example.com','Finance'),
  ('00610000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000001','MS Admin','ms-admin@example.com','Admin');

insert into companies (id, org_id, name, type) values
  ('00610000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','MS Client','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, contract_value) values
  ('00610000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'MS-001','MS Test Project','Ongoing Project',
   '00610000-0000-0000-0000-000000000010',
   '00610000-0000-0000-0000-0000000000a1',1000000);

-- Seed a milestone as owner (bypasses RLS) for read/update tests.
insert into project_milestones (id, org_id, project_id, name, sort_order) values
  ('00610000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00610000-0000-0000-0000-000000000020','Phase One',0);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DEL-015: Engineer — reads allowed, writes blocked.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00610000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-DEL-015: Engineer SELECTs project_milestones in-org → rows returned
select ok(
  (select exists (select 1 from project_milestones
    where id = '00610000-0000-0000-0000-000000000030')),
  'AC-DEL-015: Engineer SELECTs project_milestones in-org → rows returned');

-- AC-DEL-015: Engineer INSERT milestone → 42501
select throws_ok(
  $$ insert into project_milestones (project_id, name)
       values ('00610000-0000-0000-0000-000000000020','Eng Attempt') $$,
  '42501', null,
  'AC-DEL-015: Engineer INSERT milestone → 42501 (project_milestones_write WITH CHECK role gate)');

-- AC-DEL-015: Finance UPDATE milestone → RLS no-op (USING hides the row, 0 rows updated)
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00610000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ update project_milestones set name = 'Finance Attempt'
       where id = '00610000-0000-0000-0000-000000000030' $$,
  'AC-DEL-015: Finance UPDATE milestone runs without error (USING hides the row → RLS no-op)');

reset role;

-- Confirm Finance changed nothing.
select is(
  (select name from project_milestones where id = '00610000-0000-0000-0000-000000000030'),
  'Phase One',
  'AC-DEL-015: Finance UPDATE affected 0 rows (name unchanged)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DEL-016: PM INSERT succeeds; row visible to Admin; Admin UPDATE input_pct.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00610000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-DEL-016: PM INSERT milestone for an in-org project succeeds (org_id defaulted, never sent)
select lives_ok(
  $$ insert into project_milestones (project_id, name, sort_order)
       values ('00610000-0000-0000-0000-000000000020','PM Created Milestone',1) $$,
  'AC-DEL-016: PM INSERT milestone for an in-org project succeeds (org_id defaulted, never sent)');

reset role;

-- AC-DEL-016: PM-inserted milestone is visible to another in-org member (Admin)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00610000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select ok(
  (select exists (select 1 from project_milestones
    where project_id = '00610000-0000-0000-0000-000000000020'
      and name = 'PM Created Milestone')),
  'AC-DEL-016: PM-inserted milestone is visible to another in-org member (Admin)');

-- AC-DEL-016: Admin UPDATE milestone.input_pct succeeds
select lives_ok(
  $$ update project_milestones set input_pct = 75
       where id = '00610000-0000-0000-0000-000000000030' $$,
  'AC-DEL-016: Admin UPDATE milestone.input_pct succeeds');

reset role;

select is(
  (select input_pct from project_milestones
    where id = '00610000-0000-0000-0000-000000000030'),
  75::numeric,
  'AC-DEL-016: Admin UPDATE persisted (input_pct = 75)');

select * from finish();
rollback;
