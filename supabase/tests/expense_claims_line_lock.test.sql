-- expense_claims_line_lock.test.sql — #775: a claim approval takes the SAME per-line lock procurement takes
-- (0243 §7 key), so claims and purchase requests cannot both spend one line's headroom. A second, genuinely
-- concurrent session (dblink — the 0151 / AC-APR-021 idiom) holds the key. AC-EXP-026.
-- password=postgres is the Supabase LOCAL default; this file only runs under `supabase test db`.
begin;
select plan(3);
create extension if not exists dblink;

insert into organizations (id, name, default_currency) values ('02474000-0000-0000-0000-00000000000a','EXP Lock Org','IDR');
insert into auth.users (id, email) values
  ('02474000-0000-0000-0000-0000000000a1','exp-l-pm@example.com'),
  ('02474000-0000-0000-0000-0000000000a2','exp-l-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02474000-0000-0000-0000-0000000000a1','02474000-0000-0000-0000-00000000000a','L PM','exp-l-pm@example.com','Project Manager','active'),
  ('02474000-0000-0000-0000-0000000000a2','02474000-0000-0000-0000-00000000000a','L Eng','exp-l-eng@example.com','Engineer','active');
insert into projects (id, org_id, name, status) values
  ('02474000-0000-0000-0000-000000000101','02474000-0000-0000-0000-00000000000a','L Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02474000-0000-0000-0000-000000000201','02474000-0000-0000-0000-00000000000a','02474000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02474000-0000-0000-0000-00000000000a','02474000-0000-0000-0000-000000000201','Materials',1000);
update budget_versions set status = 'Active' where id = '02474000-0000-0000-0000-000000000201';
insert into spend_approvers (org_id, project_id, profile_id) values
  ('02474000-0000-0000-0000-00000000000a','02474000-0000-0000-0000-000000000101','02474000-0000-0000-0000-0000000000a1');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number, submitted_at) values
  ('02474000-0000-0000-0000-000000000401','02474000-0000-0000-0000-00000000000a','claim','02474000-0000-0000-0000-0000000000a2','02474000-0000-0000-0000-000000000101','Materials','Locked line',100,'Submitted','EXP-2610030001',now() + interval '1 hour');

select dblink_connect('exp_line', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('exp_line', 'begin');
select ok(
  (select count(*)::int from dblink('exp_line', format($q$select pg_advisory_xact_lock(%s)$q$,
     hashtextextended('spend-line:02474000-0000-0000-0000-000000000101:Materials', 0))) as t(a text)) = 1,
  'AC-EXP-026: a second session holds the Materials line lock');

set local lock_timeout = '200ms';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02474000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02474000-0000-0000-0000-000000000401','Approved') $$,
  '55P03', 'canceling statement due to lock timeout',
  'AC-EXP-026: a claim approval on a locked line waits for the lock');
reset role;

select dblink_exec('exp_line', 'commit');
select dblink_disconnect('exp_line');
set local lock_timeout = 0;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02474000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02474000-0000-0000-0000-000000000401','Approved') $$,
  'AC-EXP-026: once the other session ends the same approval proceeds');
reset role;

select * from finish();
rollback;
