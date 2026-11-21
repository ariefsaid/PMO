-- site_issue_close_proof_kept.test.sql — closed issues keep their close proof (site-issue-log FR-SIL-012).
-- Migration under test: 1112_site_issue_close_proof_kept.sql.
-- Mutation check: make the new block in guard_incident_file never raise → the first and third assertions go red.
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name, default_currency) values ('26200000-0000-0000-0000-00000000000a', 'CP Org', 'IDR');
insert into auth.users (id, email) values ('26200000-0000-0000-0000-0000000000a3', 'cp-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26200000-0000-0000-0000-0000000000a3', '26200000-0000-0000-0000-00000000000a', 'CP PM', 'cp-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26200000-0000-0000-0000-0000000000d1', '26200000-0000-0000-0000-00000000000a', 'CP Site', 'Ongoing Project', '26200000-0000-0000-0000-0000000000a3');
-- a: High, will be closed with two close files · b: High, stays open with one close file · c: Low, closed with one close file
insert into incident_reports (id, org_id, incident_date, type, severity, project_id, reported_by) values
  ('26200000-0000-0000-0000-000000000a01', '26200000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'High', '26200000-0000-0000-0000-0000000000d1', '26200000-0000-0000-0000-0000000000a3'),
  ('26200000-0000-0000-0000-000000000a02', '26200000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'High', '26200000-0000-0000-0000-0000000000d1', '26200000-0000-0000-0000-0000000000a3'),
  ('26200000-0000-0000-0000-000000000a03', '26200000-0000-0000-0000-00000000000a', '2026-11-18', 'Defect', 'Low',  '26200000-0000-0000-0000-0000000000d1', '26200000-0000-0000-0000-0000000000a3');
insert into storage.objects (bucket_id, name) values
  ('incident-files', 'fixture/a1'), ('incident-files', 'fixture/a2'), ('incident-files', 'fixture/b1'), ('incident-files', 'fixture/c1');
insert into incident_files (id, incident_id, kind, file_path) values
  ('26200000-0000-0000-0000-000000000f01', '26200000-0000-0000-0000-000000000a01', 'at_close', 'fixture/a1'),
  ('26200000-0000-0000-0000-000000000f02', '26200000-0000-0000-0000-000000000a01', 'at_close', 'fixture/a2'),
  ('26200000-0000-0000-0000-000000000f03', '26200000-0000-0000-0000-000000000a02', 'at_close', 'fixture/b1'),
  ('26200000-0000-0000-0000-000000000f04', '26200000-0000-0000-0000-000000000a03', 'at_close', 'fixture/c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"26200000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update incident_reports set status = 'Investigating' where id in ('26200000-0000-0000-0000-000000000a01', '26200000-0000-0000-0000-000000000a03');
update incident_reports set status = 'Closed' where id in ('26200000-0000-0000-0000-000000000a01', '26200000-0000-0000-0000-000000000a03');

select lives_ok($$ update incident_files set archived_at = now() where id = '26200000-0000-0000-0000-000000000f01' $$,
  'a closed High issue may archive one close file while another stays live');
select throws_ok($$ update incident_files set archived_at = now() where id = '26200000-0000-0000-0000-000000000f02' $$,
  '23514', 'a closed High or Critical issue keeps at least one close photo',
  'the last live close file of a closed High issue cannot be archived');
select is((select count(*)::int from incident_files where incident_id = '26200000-0000-0000-0000-000000000a01' and kind = 'at_close' and archived_at is null), 1,
  'the closed High issue still has a live close file');
select lives_ok($$ update incident_files set archived_at = now() where id = '26200000-0000-0000-0000-000000000f03' $$,
  'an issue that is not closed may archive its close file');
select lives_ok($$ update incident_files set archived_at = now() where id = '26200000-0000-0000-0000-000000000f04' $$,
  'a closed Low issue needs no close proof and may archive its close file');
-- Restoring is unaffected, and an archived file can be restored.
select lives_ok($$ update incident_files set archived_at = null where id = '26200000-0000-0000-0000-000000000f01' $$,
  'an archived close file can be restored');
reset role;
select is((select count(*)::int from incident_files where incident_id = '26200000-0000-0000-0000-000000000a01' and kind = 'at_close' and archived_at is null), 2,
  'both close files of the closed High issue are live again');

select * from finish();
rollback;
