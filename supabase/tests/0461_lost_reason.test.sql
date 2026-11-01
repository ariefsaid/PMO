-- 0461_lost_reason.test.sql — #1577
-- AC-LR-001..007. Isolated org; UUID prefix 04490000-…
begin;
select plan(24);

insert into organizations (id, name) values ('04490000-0000-0000-0000-000000000001', 'Lost Reason Org (0461)');
insert into auth.users (id, email) values ('04490000-0000-0000-0000-0000000000a1', 'pm@lostreason0449.example');
insert into profiles (id, org_id, full_name, email, role) values
  ('04490000-0000-0000-0000-0000000000a1', '04490000-0000-0000-0000-000000000001',
   'PM 0449', 'pm@lostreason0449.example', 'Project Manager');
insert into projects (id, org_id, code, name, status, project_manager_id, contract_value, tax_treatment, tax_amount) values
  ('04490000-0000-0000-0000-000000000101','04490000-0000-0000-0000-000000000001','L-A','A','Negotiation','04490000-0000-0000-0000-0000000000a1',0,'exclusive',0),
  ('04490000-0000-0000-0000-000000000102','04490000-0000-0000-0000-000000000001','L-B','B','Tender Submitted','04490000-0000-0000-0000-0000000000a1',0,'exclusive',0),
  ('04490000-0000-0000-0000-000000000103','04490000-0000-0000-0000-000000000001','L-C','C','Leads','04490000-0000-0000-0000-0000000000a1',0,'exclusive',0),
  ('04490000-0000-0000-0000-000000000104','04490000-0000-0000-0000-000000000001','L-D','D','PQ Submitted','04490000-0000-0000-0000-0000000000a1',0,'exclusive',0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"04490000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-LR-001
select lives_ok($$ select transition_project('04490000-0000-0000-0000-000000000101','Loss Tender',null,null,'price','Undercut by 8%') $$,
  'AC-LR-001: Negotiation -> Loss Tender with a reason succeeds');
select is((select lost_reason || '|' || lost_note from projects where id='04490000-0000-0000-0000-000000000101'),
  'price|Undercut by 8%', 'AC-LR-001: reason and note stored');
-- audit_events is readable by own-org Admin/Operator only (0076), so read it as the table owner.
reset role;
select is((select detail ->> 'lost_reason' from audit_events where action='project.transition'
            and entity_id='04490000-0000-0000-0000-000000000101' order by created_at desc limit 1),
  'price', 'AC-LR-001: audit detail carries the reason');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04490000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-LR-002 (null / blank / unknown, both lost statuses)
select throws_ok($$ select transition_project('04490000-0000-0000-0000-000000000102','Loss Tender') $$,
  'P0001', null, 'AC-LR-002: Loss Tender without a reason is refused');
select throws_ok($$ select transition_project('04490000-0000-0000-0000-000000000102','Declined',null,null,'  ') $$,
  'P0001', null, 'AC-LR-002: blank reason refused');
select throws_ok($$ select transition_project('04490000-0000-0000-0000-000000000102','Declined',null,null,'bogus') $$,
  'P0001', null, 'AC-LR-002: unknown reason key refused');
select is((select status::text from projects where id='04490000-0000-0000-0000-000000000102'),
  'Tender Submitted', 'AC-LR-002: refused call left the project unchanged');

-- AC-LR-003
select throws_ok($$ select transition_project('04490000-0000-0000-0000-000000000102','Loss Tender',null,null,'other',' ') $$,
  'P0001', null, 'AC-LR-003: other without a note refused');
select lives_ok($$ select transition_project('04490000-0000-0000-0000-000000000102','Loss Tender',null,null,'other','Client merged') $$,
  'AC-LR-003: other with a note succeeds');
select throws_ok($$ select transition_project('04490000-0000-0000-0000-000000000103','Declined',null,null,'price', repeat('x',501)) $$,
  'P0001', null, 'AC-LR-003: a note over 500 characters is refused');

-- AC-LR-004 revive clears, audit keeps, re-lose stores fresh
select lives_ok($$ select transition_project('04490000-0000-0000-0000-000000000103','Declined',null,null,'capacity',null) $$,
  'AC-LR-004: Leads -> Declined with capacity');
select lives_ok($$ select transition_project('04490000-0000-0000-0000-000000000103','Negotiation') $$,
  'AC-LR-004: Declined -> Negotiation (revive)');
select is((select lost_reason is null and lost_note is null from projects where id='04490000-0000-0000-0000-000000000103'),
  true, 'AC-LR-004: revive cleared the reason and note');
reset role;
select is((select count(*)::int from audit_events where action='project.transition'
            and entity_id='04490000-0000-0000-0000-000000000103' and detail ->> 'lost_reason' = 'capacity'),
  1, 'AC-LR-004: the earlier reason is still in its audit row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"04490000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$ select transition_project('04490000-0000-0000-0000-000000000103','Loss Tender',null,null,'timing',null) $$,
  'AC-LR-004: re-losing the revived deal succeeds');
select is((select lost_reason from projects where id='04490000-0000-0000-0000-000000000103'),
  'timing', 'AC-LR-004: the re-loss stores the new reason');

-- AC-LR-005 a reason passed with a non-lost target is never stored
select lives_ok($$ select transition_project('04490000-0000-0000-0000-000000000104','Quotation Submitted',null,null,'price','x') $$,
  'AC-LR-005: non-lost target with a stray reason succeeds');
select is((select lost_reason is null from projects where id='04490000-0000-0000-0000-000000000104'),
  true, 'AC-LR-005: stray reason not stored');

-- AC-LR-007 authenticated cannot write the columns directly
select throws_ok($$ update projects set lost_reason = 'price' where id='04490000-0000-0000-0000-000000000104' $$,
  '42501', null, 'AC-LR-007: direct UPDATE of lost_reason is denied');
select throws_ok($$ insert into projects (id, org_id, code, name, status, lost_reason)
    values ('04490000-0000-0000-0000-000000000199','04490000-0000-0000-0000-000000000001','L-X','X','Leads','price') $$,
  '42501', null, 'AC-LR-007: an INSERT naming lost_reason is denied (column-granted INSERT, 0173)');

reset role;
select throws_ok($$ update projects set lost_reason = 'price' where id='04490000-0000-0000-0000-000000000104' $$,
  '23514', null, 'AC-LR-007 (FR-LR-009): even the owner cannot put a reason on an open deal');
select throws_ok($$ update projects set lost_reason = 'bogus' where id='04490000-0000-0000-0000-000000000101' $$,
  '23514', null, 'AC-LR-007 (FR-LR-001): even the owner cannot store a key outside the nine on a lost deal');
select ok(not has_function_privilege('anon', 'public.transition_project(uuid,project_status,text,date,text,text)', 'execute'),
  'AC-LR-007: anon cannot execute transition_project');
select ok(has_function_privilege('authenticated', 'public.transition_project(uuid,project_status,text,date,text,text)', 'execute'),
  'AC-LR-007: authenticated can execute transition_project');
select * from finish();
rollback;
