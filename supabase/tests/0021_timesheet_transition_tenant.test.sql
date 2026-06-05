-- 0021_timesheet_transition_tenant.test.sql
-- AC-905: tenant isolation + illegal-map gate inside transition_timesheet.
-- Cross-org transition raises 42501 (the RPC's internal org re-assertion, not RLS).
-- Illegal Draft→Approved jump raises P0001 (legal-map data gate).
begin;
select plan(2);

-- Fixtures: two orgs, two users, one timesheet each (inserted as table owner).
insert into organizations (id, name) values
  ('00210000-0000-0000-0000-000000000001','TS Tenant A'),
  ('00210000-0000-0000-0000-000000000002','TS Tenant B');

insert into auth.users (id, email) values
  ('00210000-0000-0000-0000-0000000000a1','ts-ta@example.com'),
  ('00210000-0000-0000-0000-0000000000b1','ts-tb@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00210000-0000-0000-0000-0000000000a1','00210000-0000-0000-0000-000000000001','TS Tenant A User','ts-ta@example.com','Engineer'),
  ('00210000-0000-0000-0000-0000000000b1','00210000-0000-0000-0000-000000000002','TS Tenant B User','ts-tb@example.com','Engineer');

-- Org-B Submitted timesheet (target for org-A cross-org attempt).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00210000-0000-0000-0000-000000000010','00210000-0000-0000-0000-000000000002',
   '00210000-0000-0000-0000-0000000000b1','2026-06-01','Submitted');

-- Org-A Draft timesheet (for the illegal-map test — Draft→Approved is not in the map).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00210000-0000-0000-0000-000000000011','00210000-0000-0000-0000-000000000001',
   '00210000-0000-0000-0000-0000000000a1','2026-06-01','Draft');

-- ── Test 1: org-A user attempts to transition an org-B timesheet → 42501 ───
set local role authenticated;
set local request.jwt.claims = '{"sub":"00210000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select transition_timesheet('00210000-0000-0000-0000-000000000010','Approved') $$,
  '42501', null,
  'AC-905: cross-org timesheet transition raises 42501 (tenant isolation inside RPC)');

-- ── Test 2: illegal Draft→Approved jump by the org-A owner → P0001 ─────────
-- (Draft is only allowed to transition to Submitted per the legal map.)
select throws_ok(
  $$ select transition_timesheet('00210000-0000-0000-0000-000000000011','Approved') $$,
  'P0001', null,
  'AC-905: illegal Draft→Approved jump rejected (P0001)');

reset role;
select * from finish();
rollback;
