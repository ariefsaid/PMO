-- spend_approvers_config.test.sql — #803 spend-approver configuration.
-- AC-APR-016 (Admin-only writes, rank floor, same-org, stamped org, no client created_by),
-- AC-APR-017 (audit), AC-APR-020 (org isolation). Migration: 0242_spend_approval_routing.sql.
begin;
select plan(14);

insert into organizations (id, name, default_currency) values
  ('02341000-0000-0000-0000-00000000000a', 'APR Cfg Org A', 'IDR'),
  ('02341000-0000-0000-0000-00000000000b', 'APR Cfg Org B', 'IDR');

insert into auth.users (id, email) values
  ('02341000-0000-0000-0000-0000000000a1', 'apr-cfg-admin@example.com'),
  ('02341000-0000-0000-0000-0000000000a2', 'apr-cfg-pm@example.com'),
  ('02341000-0000-0000-0000-0000000000a3', 'apr-cfg-fin@example.com'),
  ('02341000-0000-0000-0000-0000000000a4', 'apr-cfg-eng@example.com'),
  ('02341000-0000-0000-0000-0000000000b1', 'apr-cfg-admin-b@example.com'),
  ('02341000-0000-0000-0000-0000000000b2', 'apr-cfg-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('02341000-0000-0000-0000-0000000000a1','02341000-0000-0000-0000-00000000000a','Cfg Admin A','apr-cfg-admin@example.com','Admin','active'),
  ('02341000-0000-0000-0000-0000000000a2','02341000-0000-0000-0000-00000000000a','Cfg PM A','apr-cfg-pm@example.com','Project Manager','active'),
  ('02341000-0000-0000-0000-0000000000a3','02341000-0000-0000-0000-00000000000a','Cfg Finance A','apr-cfg-fin@example.com','Finance','active'),
  ('02341000-0000-0000-0000-0000000000a4','02341000-0000-0000-0000-00000000000a','Cfg Engineer A','apr-cfg-eng@example.com','Engineer','active'),
  ('02341000-0000-0000-0000-0000000000b1','02341000-0000-0000-0000-00000000000b','Cfg Admin B','apr-cfg-admin-b@example.com','Admin','active'),
  ('02341000-0000-0000-0000-0000000000b2','02341000-0000-0000-0000-00000000000b','Cfg PM B','apr-cfg-pm-b@example.com','Project Manager','active');

insert into projects (id, org_id, name, status) values
  ('02341000-0000-0000-0000-000000000101','02341000-0000-0000-0000-00000000000a','Cfg Project A','Ongoing Project'),
  ('02341000-0000-0000-0000-000000000102','02341000-0000-0000-0000-00000000000b','Cfg Project B','Ongoing Project');

-- ── as Admin A ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000a3') $$,
  'AC-APR-016: an active Admin adds a Finance user to the senior set');
select is(
  (select org_id from spend_approvers where profile_id = '02341000-0000-0000-0000-0000000000a3'),
  '02341000-0000-0000-0000-00000000000a'::uuid,
  'AC-APR-016: org_id is stamped from the caller, never sent');
select lives_ok(
  $$ insert into spend_approvers (project_id, profile_id)
     values ('02341000-0000-0000-0000-000000000101', '02341000-0000-0000-0000-0000000000a2') $$,
  'AC-APR-016: an active Admin names a PM as a project approver');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000a4') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a profile below approval rank (Engineer) cannot be named');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000b2') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a profile from another org cannot be named');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id)
     values ('02341000-0000-0000-0000-000000000102', '02341000-0000-0000-0000-0000000000a3') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a project from another org cannot be used');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id, created_by)
     values (null, '02341000-0000-0000-0000-0000000000a2', '02341000-0000-0000-0000-0000000000a2') $$,
  '42501', 'permission denied for table spend_approvers',
  'AC-APR-016: created_by is not client-writable');

-- ── as PM A ───────────────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from spend_approvers), 2,
  'AC-APR-016: an active member reads the org''s approvers');
select throws_ok(
  $$ insert into spend_approvers (project_id, profile_id) values (null, '02341000-0000-0000-0000-0000000000a2') $$,
  '42501', 'new row violates row-level security policy for table "spend_approvers"',
  'AC-APR-016: a non-Admin cannot add an approver');
delete from spend_approvers;  -- USING denies a non-Admin silently: 0 rows, no error
reset role;
select is((select count(*)::int from spend_approvers where org_id = '02341000-0000-0000-0000-00000000000a'), 2,
  'AC-APR-016: a non-Admin delete removes nothing');

-- ── as Admin B ────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from spend_approvers), 0,
  'AC-APR-020: another org''s Admin sees none of org A''s approvers');

-- ── Admin A removes the senior-set row ────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02341000-0000-0000-0000-0000000000a1","role":"authenticated"}';
delete from spend_approvers where profile_id = '02341000-0000-0000-0000-0000000000a3';
reset role;

select is(
  (select count(*)::int from audit_events
    where action = 'spend_approver.add' and actor_id = '02341000-0000-0000-0000-0000000000a1'
      and detail->>'profile_id' = '02341000-0000-0000-0000-0000000000a3'),
  1, 'AC-APR-017: adding an approver is audited with the actor and the profile');
select is(
  (select count(*)::int from audit_events
    where action = 'spend_approver.remove' and actor_id = '02341000-0000-0000-0000-0000000000a1'
      and detail->>'profile_id' = '02341000-0000-0000-0000-0000000000a3'),
  1, 'AC-APR-017: removing an approver is audited with the actor and the profile');
select is((select count(*)::int from spend_approvers where org_id = '02341000-0000-0000-0000-00000000000a'), 1,
  'AC-APR-016: the Admin removal landed');

select * from finish();
rollback;
