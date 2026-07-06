-- 0125_ops_admin_disabled_reads_nothing.test.sql
-- AC-INV-002 [pgTAP]: disabled member reads nothing AND cannot write.
-- Pins FR-INV-003: is_active_member() conjoined into EVERY business-table policy — SELECT USING
-- AND the write policies' USING/WITH CHECK (INSERT/UPDATE/DELETE) alike. A disabled user with a
-- still-valid JWT must be unable to WRITE, not just read (the C1 gap — the prior conjunction pass
-- covered select|all only and silently missed ~30 write policies).
begin;
select plan(14);

-- ── Fixtures: org A, an active Admin, and a DISABLED member M. ──
insert into organizations (id, name) values
  ('01120000-0000-0000-0000-000000000001','AC-INV-002 Org');
insert into auth.users (id, email) values
  ('01120000-0000-0000-0000-0000000000a1','inv002-admin@example.com'),
  ('01120000-0000-0000-0000-0000000000a2','inv002-member@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01120000-0000-0000-0000-0000000000a1','01120000-0000-0000-0000-000000000001','A Admin','inv002-admin@example.com','Admin','active'),
  ('01120000-0000-0000-0000-0000000000a2','01120000-0000-0000-0000-000000000001','M Member','inv002-member@example.com','Engineer','disabled');

-- Seed business rows AS TABLE OWNER (bypassing RLS) so "0 rows" is a real deny, not an empty table.
insert into projects (id, org_id, name, status, project_manager_id) values
  ('01120000-0000-0000-0000-0000000b0001','01120000-0000-0000-0000-000000000001','P','Internal Project','01120000-0000-0000-0000-0000000000a2');
insert into procurements (id, org_id, title, project_id, requested_by_id, status) values
  ('01120000-0000-0000-0000-0000000c0001','01120000-0000-0000-0000-000000000001','PR','01120000-0000-0000-0000-0000000b0001','01120000-0000-0000-0000-0000000000a2','Draft');
insert into agent_usage (id, org_id, owner_id, model, cost) values
  ('01120000-0000-0000-0000-0000000d0001','01120000-0000-0000-0000-000000000001','01120000-0000-0000-0000-0000000000a2','gpt-test',5);
-- org_features row (mig 0070) seeded AS TABLE OWNER so the read-deny is real, not an empty table.
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('01120000-0000-0000-0000-000000000001','incidents',true,'01120000-0000-0000-0000-0000000000a1');

-- Write-deny target rows (owned by M) seeded as table owner so an UPDATE that "should succeed"
-- proves the deny is the is_active_member conjunct, not row-invisibility from a different scope.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('01120000-0000-0000-0000-000000100001','01120000-0000-0000-0000-000000000001','01120000-0000-0000-0000-0000000000a2','2024-01-01','Draft');
insert into user_views (id, org_id, user_id, name) values
  ('01120000-0000-0000-0000-000000110001','01120000-0000-0000-0000-000000000001','01120000-0000-0000-0000-0000000000a2','V');
insert into incident_reports (id, org_id, incident_date, type, severity, reported_by) values
  ('01120000-0000-0000-0000-000000120001','01120000-0000-0000-0000-000000000001','2024-01-01','Near-miss','Low','01120000-0000-0000-0000-0000000000a2');
insert into notifications (id, org_id, owner_id, title) values
  ('01120000-0000-0000-0000-000000130001','01120000-0000-0000-0000-000000000001','01120000-0000-0000-0000-0000000000a2','N');

-- ════════════════════════════════════════════════════════════════════════════
-- READ-deny: under M's DISABLED JWT, every business-table SELECT returns 0 rows.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from profiles),    0,'AC-INV-002 disabled M reads 0 profiles');
select is((select count(*)::int from projects),    0,'AC-INV-002 disabled M reads 0 projects');
select is((select count(*)::int from procurements),0,'AC-INV-002 disabled M reads 0 procurements');
select is((select count(*)::int from agent_usage), 0,'AC-INV-002 disabled M reads 0 agent_usage');
select is((select count(*)::int from org_features), 0,'AC-INV-002 disabled M reads 0 org_features (entitlements respect is_active_member)');

-- ════════════════════════════════════════════════════════════════════════════
-- WRITE-deny (C1 fix): INSERT via the previously-missed write policies is rejected; UPDATE on
-- the previously-missed write policies affects 0 rows. Proves WITH CHECK / USING conjunction.
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into timesheets (org_id, user_id, week_start_date, status) values ('01120000-0000-0000-0000-000000000001','01120000-0000-0000-0000-0000000000a2','2024-02-05','Draft') $$,
  '42501', null,
  'AC-INV-002 disabled M timesheets INSERT denied (WITH CHECK conjunct)');
select throws_ok(
  $$ insert into user_views (org_id, user_id, name) values ('01120000-0000-0000-0000-000000000001','01120000-0000-0000-0000-0000000000a2','V2') $$,
  '42501', null,
  'AC-INV-002 disabled M user_views INSERT denied (WITH CHECK conjunct)');
select throws_ok(
  $$ insert into incident_reports (org_id, incident_date, type, severity, reported_by) values ('01120000-0000-0000-0000-000000000001','2024-02-05','T','Low','01120000-0000-0000-0000-0000000000a2') $$,
  '42501', null,
  'AC-INV-002 disabled M incident_reports INSERT denied (WITH CHECK conjunct)');
select throws_ok(
  $$ insert into notifications (org_id, owner_id, title) values ('01120000-0000-0000-0000-000000000001','01120000-0000-0000-0000-0000000000a2','N2') $$,
  '42501', null,
  'AC-INV-002 disabled M notifications INSERT denied (WITH CHECK conjunct)');

-- UPDATE write-deny: targets whose USING matches a disabled in-org owner (so the only thing that
-- flips them to 0 rows is the is_active_member() conjunct on USING). Benign column updates that
-- keep each policy's WITH CHECK satisfied isolate the test to the USING (row-visibility) clause.
with upd as (
  update timesheets set status = 'Draft' where user_id = '01120000-0000-0000-0000-0000000000a2' returning id)
select is((select count(*)::int from upd), 0,
  'AC-INV-002 disabled M timesheets UPDATE affects 0 rows (USING conjunct)');
with upd as (
  update user_views set description = 'touch' where user_id = '01120000-0000-0000-0000-0000000000a2' returning id)
select is((select count(*)::int from upd), 0,
  'AC-INV-002 disabled M user_views UPDATE affects 0 rows (USING conjunct)');
with upd as (
  update notifications set read_at = now() where owner_id = '01120000-0000-0000-0000-0000000000a2' returning id)
select is((select count(*)::int from upd), 0,
  'AC-INV-002 disabled M notifications UPDATE affects 0 rows (USING conjunct)');
with upd as (
  update profiles set title = 'touch' where id = '01120000-0000-0000-0000-0000000000a2' returning id)
select is((select count(*)::int from upd), 0,
  'AC-INV-002 disabled M profiles self-UPDATE affects 0 rows (USING conjunct)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- Control: an ACTIVE admin DOES read their org's rows (proves the deny is status-scoped, not
-- org-scoped — is_active_member() returns true for the active admin).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from projects), 1,
  'AC-INV-002 active admin reads 1 project (control — deny is status-scoped, not org-scoped)');
reset role;

select * from finish();
rollback;
