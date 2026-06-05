-- 0025_timesheet_sod.test.sql
-- AC-909: SoD — an employee can NEVER approve their own timesheet, even when they are Admin.
-- The SoD check (v_uid = v_owner) is ordered BEFORE the role/manager check inside the RPC,
-- so Admin break-glass cannot defeat separation of duties (OD-TS-4-D, FR-TS-005).
begin;
select plan(2);

-- Fixtures: one org, one Admin user who owns a Submitted timesheet + an Engineer who owns a Draft.
insert into organizations (id, name) values
  ('00250000-0000-0000-0000-000000000001','TS SoD Org');

insert into auth.users (id, email) values
  ('00250000-0000-0000-0000-0000000000a1','ts-admin-sod@example.com'),
  ('00250000-0000-0000-0000-0000000000a2','ts-eng-bypass@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00250000-0000-0000-0000-0000000000a1','00250000-0000-0000-0000-000000000001','Admin SoD','ts-admin-sod@example.com','Admin'),
  ('00250000-0000-0000-0000-0000000000a2','00250000-0000-0000-0000-000000000001','Engineer Bypass','ts-eng-bypass@example.com','Engineer');

-- Admin's own Submitted timesheet.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00250000-0000-0000-0000-000000000010','00250000-0000-0000-0000-000000000001',
   '00250000-0000-0000-0000-0000000000a1','2026-06-01','Submitted');

-- Engineer's own Draft timesheet (for the RPC-bypass direct-UPDATE test).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00250000-0000-0000-0000-000000000011','00250000-0000-0000-0000-000000000001',
   '00250000-0000-0000-0000-0000000000a2','2026-06-08','Draft');

-- ── Test: Admin A calls Approve on their OWN sheet → 42501 (SoD wins) ──────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00250000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select transition_timesheet('00250000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'AC-909: SoD — an employee (even Admin) can never approve their own timesheet');

reset role;

-- ── Test (MED-TS-2): owner cannot bypass the RPC via a direct table UPDATE ──
-- The owner's own Draft sheet may only be self-updated while it stays Draft. A direct
-- `UPDATE ... SET status='Approved'` must be rejected by timesheets_update_own's WITH CHECK
-- (the only legal status path is transition_timesheet, a security-definer RPC). Without the
-- `status='Draft'` WITH CHECK clause an owner could self-approve, defeating SoD/legal-map.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00250000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ update timesheets set status = 'Approved', approved_by = '00250000-0000-0000-0000-0000000000a2'
       where id = '00250000-0000-0000-0000-000000000011' $$,
  '42501', null,
  'MED-TS-2: owner cannot self-approve via a direct UPDATE (RPC-bypass blocked by WITH CHECK)');

reset role;
select * from finish();
rollback;
