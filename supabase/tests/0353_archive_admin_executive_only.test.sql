-- 0353: only Admin and Executive archive or restore projects and companies.
begin;
select plan(8);
insert into auth.users(id,email) values
('03530000-0000-0000-0000-000000000001','archive-pm@example.com'),
('03530000-0000-0000-0000-000000000002','archive-finance@example.com'),
('03530000-0000-0000-0000-000000000003','archive-executive@example.com'),
('03530000-0000-0000-0000-000000000004','archive-admin@example.com');
insert into profiles(id,org_id,full_name,email,role) values
('03530000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','PM','archive-pm@example.com','Project Manager'),
('03530000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Finance','archive-finance@example.com','Finance'),
('03530000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Executive','archive-executive@example.com','Executive'),
('03530000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Admin','archive-admin@example.com','Admin');
insert into projects(id,org_id,code,name,status,project_manager_id) values
('03530000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','0353','Archive guard','Ongoing Project','03530000-0000-0000-0000-000000000001');
insert into companies(id,org_id,name,type) values
('03530000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','Archive guard vendor','Vendor');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03530000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ update projects set archived_at = now() where id = '03530000-0000-0000-0000-000000000010' $$,
  '42501', null, 'AC-ARC-001: Finance cannot archive a project');
select throws_ok($$ update companies set archived_at = now() where id = '03530000-0000-0000-0000-000000000020' $$,
  '42501', null, 'AC-ARC-001: Finance cannot archive a company');
select lives_ok($$ update companies set name = 'Archive guard vendor (renamed)' where id = '03530000-0000-0000-0000-000000000020' $$,
  'AC-ARC-001: Finance still edits a company');

set local request.jwt.claims = '{"sub":"03530000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$ update projects set archived_at = now() where id = '03530000-0000-0000-0000-000000000010' $$,
  '42501', null, 'AC-ARC-001: a Project Manager cannot archive a project');
select throws_ok($$ update companies set archived_at = now() where id = '03530000-0000-0000-0000-000000000020' $$,
  '42501', null, 'AC-ARC-001: a Project Manager cannot archive a company');

set local request.jwt.claims = '{"sub":"03530000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$ update projects set archived_at = now() where id = '03530000-0000-0000-0000-000000000010' $$,
  'AC-ARC-001: an Executive archives a project');

set local request.jwt.claims = '{"sub":"03530000-0000-0000-0000-000000000004","role":"authenticated"}';
select lives_ok($$ update companies set archived_at = now() where id = '03530000-0000-0000-0000-000000000020' $$,
  'AC-ARC-001: an Admin archives a company');

set local request.jwt.claims = '{"sub":"03530000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ update projects set archived_at = null where id = '03530000-0000-0000-0000-000000000010' $$,
  '42501', null, 'AC-ARC-001: Finance cannot restore an archived project');

select * from finish();
rollback;
