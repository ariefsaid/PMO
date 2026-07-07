-- 0052_incidents_crud.test.sql — the Incident register CRUD write contract (CRUD+RBAC program, Incidents slice).
-- Proves the RLS write contract for incident_reports on top of the EXISTING policies (migration 0002):
--   incident_reports_select : org_id = auth_org_id()                              (read scoped to org)
--   incident_reports_insert : WITH CHECK (org_id = auth_org_id())                 (ANY member may file)
--   incident_reports_update : USING (org_id = auth_org_id() AND auth_role() IN     (managers update/close)
--                                     ('Admin','Executive','Project Manager','Finance'))
--                             WITH CHECK (org_id = auth_org_id())
-- NO new migration is required for this slice — the policies above already exist; this test
-- documents and locks the contract the Incidents UI relies on.
--   AC-IN-101  ANY member (an Engineer) CAN INSERT an incident (org_id defaulted from auth_org_id(), never sent).
--   AC-IN-102  a manager (PM) CAN UPDATE an incident's status (Open→Investigating) in its own org — and it persists.
--   AC-IN-103  an Engineer (non-manager) CANNOT UPDATE/close an incident (USING role gate hides it → 0-row no-op).
--   AC-IN-104  cross-org write denied: org-B PM cannot INSERT an org-A incident (WITH CHECK → 42501) and an
--              org-B PM UPDATE of an org-A incident is a silent 0-row no-op (USING hides the row).
--   AC-IN-105  the org_id stamped on an Engineer-filed incident is the caller's org (column default; not spoofable).
-- RLS is the enforcement authority; the FE gating (rbac-visibility.md §G — managers-only investigate/close, the FE
-- being stricter than the RLS Finance-inclusive update set) is only a clarity projection.
begin;
select plan(11);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- "Org-A" is the DEFAULT org ('00000000-…-0001'): incident_reports.org_id defaults to that literal
-- (0001 schema), so a member in the default org satisfies the incident_reports_insert WITH CHECK
-- WITHOUT sending org_id — exactly the production createIncident() path. Org-B is a separate org used
-- only as the cross-org attacker. The 00520000-… namespace is unique to this test.
insert into organizations (id, name) values
  ('00520000-0000-0000-0000-000000000002','Incidents CRUD Org B');

insert into auth.users (id, email) values
  ('00520000-0000-0000-0000-0000000000a1','in-pm@example.com'),
  ('00520000-0000-0000-0000-0000000000a2','in-eng@example.com'),
  ('00520000-0000-0000-0000-0000000000b1','in-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00520000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','IN PM','in-pm@example.com','Project Manager'),
  ('00520000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','IN Eng','in-eng@example.com','Engineer'),
  ('00520000-0000-0000-0000-0000000000b1','00520000-0000-0000-0000-000000000002','IN PM B','in-pm-b@example.com','Project Manager');

-- An existing Open incident in org-A the PM will advance and the Engineer / cross-org user will fail to touch.
insert into incident_reports (id, org_id, incident_date, type, severity, status, reported_by) values
  ('00520000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',
   '2026-06-01','Near Miss','Low','Open','00520000-0000-0000-0000-0000000000a2');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IN-101/105: ANY member (an Engineer) CAN file an incident.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-IN-101: Engineer INSERT — org_id is NOT sent; the column default + auth_org_id() WITH CHECK stamp org-A.
select lives_ok(
  $$ insert into incident_reports (incident_date, type, severity)
       values ('2026-06-08','Spill','High') $$,
  'AC-IN-101: any member (Engineer) can file an incident (org_id defaulted, never sent)');

-- AC-IN-103: Engineer UPDATE of an incident's status runs without error but the USING role gate hides the
-- row (Engineer not in the manager set) → 0-row no-op (RLS silences it, no 42501 on UPDATE).
select lives_ok(
  $$ update incident_reports set status = 'Investigating'
       where id = '00520000-0000-0000-0000-000000000010' $$,
  'AC-IN-103: Engineer UPDATE incident status runs without error (USING role gate hides the row → RLS no-op)');

reset role;

-- AC-IN-105: confirm the Engineer-filed incident landed in the caller's (default) org (org_id not spoofable).
select is(
  (select org_id::text from incident_reports where type = 'Spill'),
  '00000000-0000-0000-0000-000000000001',
  'AC-IN-105: the Engineer-filed incident is stamped with the caller''s org (org_id column default)');

-- AC-IN-103: confirm the Engineer changed nothing — the incident is still Open.
select is(
  (select status::text from incident_reports where id = '00520000-0000-0000-0000-000000000010'),
  'Open',
  'AC-IN-103: Engineer UPDATE affected 0 rows (status unchanged, still Open)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IN-104: cross-org write denied — org-B PM, before any org-A manager mutation.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- AC-IN-104 (AMENDED — harden/org-id-seam, 0074 stamp trigger, narrow variant): org-B PM INSERT
-- explicitly stamped with org-A's org_id, which IS the seed-org literal (per the fixture note above) —
-- the stamp_org_id() trigger treats the seed literal as "no real org_id supplied" and coerces it to the
-- caller's (org-B's) own org, so the insert SUCCEEDS in org B rather than being rejected. NOT a tenancy
-- regression: the row still lands in the caller's own org, never org A. (A GENUINELY-foreign, non-seed
-- org_id is unchanged and still hard-rejected with 42501 — 0131_org_stamp_trigger.test.sql
-- AC-ORGSTAMP-004c.)
select lives_ok(
  $$ insert into incident_reports (id, org_id, incident_date, type, severity)
       values ('00520000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000001','2026-06-08','Cross Incident','Low') $$,
  'AC-IN-104: org-B PM INSERT with the seed-org-literal org_id succeeds (trigger coerces to org-B, not a real forgery)');
select is(
  (select org_id from incident_reports where id = '00520000-0000-0000-0000-000000000099'),
  '00520000-0000-0000-0000-000000000002'::uuid,
  'AC-IN-104: the inserted row lands in org B (caller''s own org), never org A — isolation holds');

-- AC-IN-104: org-B PM UPDATE of an org-A incident runs without error but the USING clause hides it → 0-row no-op.
select lives_ok(
  $$ update incident_reports set status = 'Closed'
       where id = '00520000-0000-0000-0000-000000000010' $$,
  'AC-IN-104: cross-org UPDATE of an org-A incident runs without error (USING hides it → RLS no-op)');

reset role;

-- AC-IN-104: confirm the cross-org UPDATE changed nothing (still Open).
select is(
  (select status::text from incident_reports where id = '00520000-0000-0000-0000-000000000010'),
  'Open',
  'AC-IN-104: cross-org UPDATE affected 0 rows (status unchanged, still Open)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-IN-102: the in-org PM (a manager) does the real status workflow.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-IN-102: PM CAN advance Open → Investigating (manager in the update role set, own org).
select lives_ok(
  $$ update incident_reports set status = 'Investigating'
       where id = '00520000-0000-0000-0000-000000000010' $$,
  'AC-IN-102: a manager (PM) can advance an incident Open→Investigating in its own org');

-- AC-IN-102: PM CAN close Investigating → Closed.
select lives_ok(
  $$ update incident_reports set status = 'Closed'
       where id = '00520000-0000-0000-0000-000000000010' $$,
  'AC-IN-102: a manager (PM) can close an incident Investigating→Closed');

reset role;

-- AC-IN-102: confirm the workflow persisted (no silent RLS no-op for the manager).
select is(
  (select status::text from incident_reports where id = '00520000-0000-0000-0000-000000000010'),
  'Closed',
  'AC-IN-102: incident_reports.status persisted as Closed (the manager workflow took effect)');

select * from finish();
rollback;
