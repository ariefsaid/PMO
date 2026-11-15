-- project_transition_role_matrix.test.sql
-- #2326: the server half of "the button's permission check matches the rule the save enforces".
-- For every move out of a delivery status (the "Change delivery status" control), each write role
-- that can('transition','project') offers the control to (Admin, Executive, Project Manager, Finance)
-- is accepted by transition_project, and Engineer (not offered) is refused with 42501.
-- The FE half is ProjectStatusControl.test.tsx 'AC-1005 (#2326): "Change status" for <role>'. If a
-- transition-specific role rule is ever added here, this file goes red and the offer must follow.
begin;
select plan(40);

insert into organizations (id, name) values ('23260000-0000-0000-0000-000000000001','Transition Role Matrix Org');
insert into auth.users (id, email) values
  ('23260000-0000-0000-0000-0000000000a5','trm-a5@example.com'),
  ('23260000-0000-0000-0000-0000000000a1','trm-a1@example.com'),
  ('23260000-0000-0000-0000-0000000000a2','trm-a2@example.com'),
  ('23260000-0000-0000-0000-0000000000a3','trm-a3@example.com'),
  ('23260000-0000-0000-0000-0000000000a4','trm-a4@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('23260000-0000-0000-0000-0000000000a5','23260000-0000-0000-0000-000000000001','TRM Admin','trm-a5@example.com','Admin'),
  ('23260000-0000-0000-0000-0000000000a1','23260000-0000-0000-0000-000000000001','TRM Executive','trm-a1@example.com','Executive'),
  ('23260000-0000-0000-0000-0000000000a2','23260000-0000-0000-0000-000000000001','TRM Project Manager','trm-a2@example.com','Project Manager'),
  ('23260000-0000-0000-0000-0000000000a3','23260000-0000-0000-0000-000000000001','TRM Finance','trm-a3@example.com','Finance'),
  ('23260000-0000-0000-0000-0000000000a4','23260000-0000-0000-0000-000000000001','TRM Engineer','trm-a4@example.com','Engineer');
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('23260000-0000-0000-0000-000000000010','23260000-0000-0000-0000-000000000001','TRM-001','Transition Role Matrix Project','Won, Pending KoM','23260000-0000-0000-0000-0000000000a2');

reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Admin may move Won, Pending KoM -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Admin may move Won, Pending KoM -> On Hold (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Admin may move Won, Pending KoM -> Close Out (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Admin may move Ongoing Project -> On Hold (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Admin may move Ongoing Project -> Close Out (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Admin may move On Hold -> Ongoing Project (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Admin may move On Hold -> Close Out (control offered)');
reset role;
update projects set status = 'Close Out' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Admin may move Close Out -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Executive may move Won, Pending KoM -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Executive may move Won, Pending KoM -> On Hold (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Executive may move Won, Pending KoM -> Close Out (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Executive may move Ongoing Project -> On Hold (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Executive may move Ongoing Project -> Close Out (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Executive may move On Hold -> Ongoing Project (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Executive may move On Hold -> Close Out (control offered)');
reset role;
update projects set status = 'Close Out' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Executive may move Close Out -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Project Manager may move Won, Pending KoM -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Project Manager may move Won, Pending KoM -> On Hold (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Project Manager may move Won, Pending KoM -> Close Out (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Project Manager may move Ongoing Project -> On Hold (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Project Manager may move Ongoing Project -> Close Out (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Project Manager may move On Hold -> Ongoing Project (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Project Manager may move On Hold -> Close Out (control offered)');
reset role;
update projects set status = 'Close Out' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Project Manager may move Close Out -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Finance may move Won, Pending KoM -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Finance may move Won, Pending KoM -> On Hold (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Finance may move Won, Pending KoM -> Close Out (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$,
  'AC-1005 (#2326): Finance may move Ongoing Project -> On Hold (control offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Finance may move Ongoing Project -> Close Out (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Finance may move On Hold -> Ongoing Project (control offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$,
  'AC-1005 (#2326): Finance may move On Hold -> Close Out (control offered)');
reset role;
update projects set status = 'Close Out' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$,
  'AC-1005 (#2326): Finance may move Close Out -> Ongoing Project (control offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move Won, Pending KoM -> Ongoing Project (control not offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move Won, Pending KoM -> On Hold (control not offered)');
reset role;
update projects set status = 'Won, Pending KoM' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move Won, Pending KoM -> Close Out (control not offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','On Hold') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move Ongoing Project -> On Hold (control not offered)');
reset role;
update projects set status = 'Ongoing Project' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move Ongoing Project -> Close Out (control not offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move On Hold -> Ongoing Project (control not offered)');
reset role;
update projects set status = 'On Hold' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Close Out') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move On Hold -> Close Out (control not offered)');
reset role;
update projects set status = 'Close Out' where id = '23260000-0000-0000-0000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"23260000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_project('23260000-0000-0000-0000-000000000010','Ongoing Project') $$, '42501', null,
  'AC-1005 (#2326): Engineer may not move Close Out -> Ongoing Project (control not offered)');

reset role;
select * from finish();
rollback;
