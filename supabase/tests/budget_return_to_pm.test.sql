-- AC-1413-01..: an approver returns a waiting Draft to the PM (server-enforced SoD, role, org, state).
begin;
create extension if not exists pgtap;
select plan(16);

insert into organizations (id, name) values
 ('b1413000-0000-0000-0000-000000000001','Return Org'),('b1413000-0000-0000-0000-000000000002','Return Other Org');
insert into auth.users (id, email) values
 ('b1413000-0000-0000-0000-0000000000a1','pm-ret@example.com'),
 ('b1413000-0000-0000-0000-0000000000a2','fin-ret@example.com'),
 ('b1413000-0000-0000-0000-0000000000a3','eng-ret@example.com'),
 ('b1413000-0000-0000-0000-0000000000a4','out-ret@example.com');
insert into profiles (id, org_id, full_name, email, role) values
 ('b1413000-0000-0000-0000-0000000000a1','b1413000-0000-0000-0000-000000000001','PM','pm-ret@example.com','Project Manager'),
 ('b1413000-0000-0000-0000-0000000000a2','b1413000-0000-0000-0000-000000000001','Fin','fin-ret@example.com','Finance'),
 ('b1413000-0000-0000-0000-0000000000a3','b1413000-0000-0000-0000-000000000001','Eng','eng-ret@example.com','Engineer'),
 ('b1413000-0000-0000-0000-0000000000a4','b1413000-0000-0000-0000-000000000002','Out','out-ret@example.com','Finance');
insert into projects (id, org_id, name, status) values
 ('b1413111-0000-0000-0000-000000000001','b1413000-0000-0000-0000-000000000001','Return Project','Ongoing Project');

-- PM drafts three versions (created_by + editor stamped server-side).
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1413000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status) values
 ('b1413222-0000-0000-0000-000000000001','b1413000-0000-0000-0000-000000000001','b1413111-0000-0000-0000-000000000001',1,'D1','Draft'),
 ('b1413222-0000-0000-0000-000000000002','b1413000-0000-0000-0000-000000000001','b1413111-0000-0000-0000-000000000001',2,'D2','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
 ('b1413333-0000-0000-0000-000000000001','b1413000-0000-0000-0000-000000000001','b1413222-0000-0000-0000-000000000001','Labor','kept line',10,0);
select throws_ok($$select return_budget_version('b1413222-0000-0000-0000-000000000001','my own')$$,'42501',
 'separation of duties: You edited this version, so someone else must return it.',
 'AC-1413-02 the drafter cannot return their own draft');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1413000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select return_budget_version('b1413222-0000-0000-0000-000000000001','x')$$,'42501','not authorized',
 'AC-1413-03 a non-approver role is refused');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1413000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select return_budget_version('b1413222-0000-0000-0000-000000000001','x')$$,'42501','not authorized',
 'AC-1413-04 another org is refused');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1413000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select return_budget_version('b1413222-0000-0000-0000-000000000001','   ')$$,'22023',
 'a return reason of 1 to 1000 characters is required','AC-1413-05 a blank reason is refused');
select lives_ok($$select return_budget_version('b1413222-0000-0000-0000-000000000001','Please split labour by quarter')$$,
 'AC-1413-01 an eligible approver returns the waiting draft');
select throws_ok($$select return_budget_version('b1413222-0000-0000-0000-000000000001','again')$$,'P0001',
 'this version has already been returned','AC-1413-06 an already-returned draft cannot be returned again');
select throws_ok($$select activate_budget_version('b1413222-0000-0000-0000-000000000001')$$,'P0001',
 'this version was returned to its drafter; it must be resubmitted before it can be activated',
 'AC-1413-07 a returned draft cannot be activated');
select is((select return_reason from budget_versions where id='b1413222-0000-0000-0000-000000000001'),
 'Please split labour by quarter','AC-1413-01 the reason is stored');
select is((select count(*)::int from budget_line_items where budget_version_id='b1413222-0000-0000-0000-000000000001'),1,
 'AC-1413-08 the PM''s lines are kept');
reset role;
select ok((select count(*) = 1 from audit_events where action='budget_version.return' and entity_id='b1413222-0000-0000-0000-000000000001'
  and actor_id='b1413000-0000-0000-0000-0000000000a2'),
 'AC-1413-09 the return is audited');

-- PM sees the reason, still edits, resubmits; the approver then activates.
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1413000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select return_reason from budget_versions where id='b1413222-0000-0000-0000-000000000001'),
 'Please split labour by quarter','AC-1413-10 the PM can read the reason');
select lives_ok($$update budget_line_items set budgeted_amount=20 where id='b1413333-0000-0000-0000-000000000001'$$,
 'AC-1413-11 a returned draft stays editable');
select lives_ok($$select resubmit_budget_version('b1413222-0000-0000-0000-000000000001')$$,
 'AC-1413-12 the PM resubmits');
select throws_ok($$select resubmit_budget_version('b1413222-0000-0000-0000-000000000001')$$,'P0001',
 'only a returned Draft version can be resubmitted','AC-1413-13 resubmitting a waiting draft is refused');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1413000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select activate_budget_version('b1413222-0000-0000-0000-000000000001')$$,
 'AC-1413-14 after resubmit the approver can activate');
select throws_ok($$select return_budget_version('b1413222-0000-0000-0000-000000000001','late')$$,'P0001',
 'only a Draft version can be returned','AC-1413-15 a non-Draft version cannot be returned');
reset role;
select * from finish();
rollback;
