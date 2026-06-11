-- 0062_milestones_tenant_isolation.test.sql — project_milestones cross-org isolation.
-- AC-DEL-017: org-A PM SELECT returns only org-A milestones; INSERT with org-B project_id → 42501.
-- AC-DEL-018: org-A PM INSERT explicitly stamping org-B's org_id → WITH CHECK 42501.
-- Fixture namespace: 00620000-… (unique to this test).
begin;
select plan(5);

-- ── Fixtures ───────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00620000-0000-0000-0000-000000000002','Milestones Tenant Org B');

insert into auth.users (id, email) values
  ('00620000-0000-0000-0000-0000000000a1','ti-pm-a@example.com'),
  ('00620000-0000-0000-0000-0000000000b1','ti-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00620000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'TI PM A','ti-pm-a@example.com','Project Manager'),
  ('00620000-0000-0000-0000-0000000000b1','00620000-0000-0000-0000-000000000002',
   'TI PM B','ti-pm-b@example.com','Project Manager');

insert into companies (id, org_id, name, type) values
  ('00620000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','TI Client A','Client'),
  ('00620000-0000-0000-0000-000000000011','00620000-0000-0000-0000-000000000002','TI Client B','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, contract_value) values
  ('00620000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'TI-A-001','TI Project A','Ongoing Project',
   '00620000-0000-0000-0000-000000000010',
   '00620000-0000-0000-0000-0000000000a1',500000),
  ('00620000-0000-0000-0000-000000000021','00620000-0000-0000-0000-000000000002',
   'TI-B-001','TI Project B','Ongoing Project',
   '00620000-0000-0000-0000-000000000011',
   '00620000-0000-0000-0000-0000000000b1',500000);

-- One milestone in each org (inserted as owner, bypassing RLS).
insert into project_milestones (id, org_id, project_id, name) values
  ('00620000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00620000-0000-0000-0000-000000000020','Org A Milestone'),
  ('00620000-0000-0000-0000-000000000031','00620000-0000-0000-0000-000000000002',
   '00620000-0000-0000-0000-000000000021','Org B Milestone');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DEL-017: org-A PM SELECT returns only org-A milestone.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00620000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from project_milestones
    where id in (
      '00620000-0000-0000-0000-000000000030',
      '00620000-0000-0000-0000-000000000031')),
  1,
  'AC-DEL-017: org-A PM SELECT returns only org-A milestone (org-B row hidden by RLS)');

-- AC-DEL-017: org-A PM INSERT with an org-B project_id → rejected (WITH CHECK parent-project guard)
select throws_ok(
  $$ insert into project_milestones (project_id, name)
       values ('00620000-0000-0000-0000-000000000021','Cross Org Insert') $$,
  '42501', null,
  'AC-DEL-017: org-A PM INSERT with an org-B project_id → rejected (WITH CHECK parent-org guard → 42501)');

-- AC-DEL-018: org-A PM INSERT explicitly stamping org-B''s org_id → WITH CHECK 42501
select throws_ok(
  $$ insert into project_milestones (org_id, project_id, name)
       values ('00620000-0000-0000-0000-000000000002',
               '00620000-0000-0000-0000-000000000020','Explicit Org B Stamp') $$,
  '42501', null,
  'AC-DEL-018: org-A PM INSERT with explicit org-B org_id → WITH CHECK rejects (42501)');

reset role;

-- Confirm no cross-org insert landed.
select is(
  (select count(*)::int from project_milestones
    where project_id = '00620000-0000-0000-0000-000000000020'
      and name in ('Cross Org Insert','Explicit Org B Stamp')),
  0,
  'AC-DEL-017/018: no cross-org milestone row was inserted');

-- Confirm org-A PM''s INSERT is stamped with org-A (org_id column default).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00620000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into project_milestones (project_id, name)
       values ('00620000-0000-0000-0000-000000000020','Org A Valid Insert') $$,
  'AC-DEL-018: org-A PM INSERT without explicit org_id succeeds (org_id defaulted to auth_org_id())');

reset role;

select * from finish();
rollback;
