begin;
select plan(2);

insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000e1','eng@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('a0000000-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000001','Eng A','eng@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('a1111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Project A1','Ongoing Project'),
  ('a1111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Project A2','Leads');

insert into procurements (id, org_id, title, status) values
  ('a2222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Proc A1','Draft'),
  ('a2222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Proc A2','Ordered');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- AC-407: an Engineer (read-allowed) reads all in-org projects via projects_select.
select is(
  (select count(*)::int from projects where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2,
  'AC-407: Engineer reads all in-org projects (RLS read path)');

-- AC-508: an Engineer reads all in-org procurements via procurements_select.
select is(
  (select count(*)::int from procurements where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 2,
  'AC-508: Engineer reads all in-org procurements (RLS read path)');

reset role;
select * from finish();
rollback;
