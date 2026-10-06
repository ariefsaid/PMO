-- spend_approval_line_lock.test.sql — #803 FR-APR-018: approvals on one (project, category) line are
-- serialized. A second, genuinely concurrent session (dblink — the 0151 idiom) holds the line lock; the
-- approval must WAIT for it (55P03 under lock_timeout). Delete the lock in §7 and this goes red.
-- password=postgres is the Supabase LOCAL default; this file only runs under `supabase test db`.
begin;
select plan(3);
create extension if not exists dblink;

insert into organizations (id, name, default_currency) values ('02345000-0000-0000-0000-00000000000a','APR Lock Org','IDR');
insert into auth.users (id, email) values
  ('02345000-0000-0000-0000-0000000000a1','apr-lock-pm@example.com'),
  ('02345000-0000-0000-0000-0000000000a2','apr-lock-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02345000-0000-0000-0000-0000000000a1','02345000-0000-0000-0000-00000000000a','Lock PM','apr-lock-pm@example.com','Project Manager','active'),
  ('02345000-0000-0000-0000-0000000000a2','02345000-0000-0000-0000-00000000000a','Lock Eng','apr-lock-eng@example.com','Engineer','active');
insert into projects (id, org_id, name, status) values
  ('02345000-0000-0000-0000-000000000101','02345000-0000-0000-0000-00000000000a','Lock Project','Ongoing Project');
-- budget_line_items_draft_guard: lines only land on a Draft version, so seed Draft → lines → Active.
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02345000-0000-0000-0000-000000000201','02345000-0000-0000-0000-00000000000a','02345000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02345000-0000-0000-0000-00000000000a','02345000-0000-0000-0000-000000000201','Materials',1000);
update budget_versions set status = 'Active' where id in ('02345000-0000-0000-0000-000000000201');
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02345000-0000-0000-0000-00000000000a','02345000-0000-0000-0000-000000000101','02345000-0000-0000-0000-0000000000a1');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02345000-0000-0000-0000-000000000401','02345000-0000-0000-0000-00000000000a','Locked line','02345000-0000-0000-0000-000000000101','02345000-0000-0000-0000-0000000000a2','Requested',100,'Materials');

select dblink_connect('apr_line', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('apr_line', 'begin');
select ok(
  (select count(*)::int from dblink('apr_line', format($q$select pg_advisory_xact_lock(%s)$q$,
     hashtextextended('spend-line:02345000-0000-0000-0000-000000000101:Materials', 0))) as t(a text)) = 1,
  'AC-APR-021: a second session holds the Materials line lock');

set local lock_timeout = '200ms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02345000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02345000-0000-0000-0000-000000000401','Approved') $$,
  '55P03', 'canceling statement due to lock timeout',
  'AC-APR-021: an approval on a locked line waits for the lock');
reset role;

select dblink_exec('apr_line', 'commit');
select dblink_disconnect('apr_line');
set local lock_timeout = 0;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02345000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02345000-0000-0000-0000-000000000401','Approved') $$,
  'AC-APR-021: once the other session ends the same approval proceeds');
reset role;

select * from finish();
rollback;
