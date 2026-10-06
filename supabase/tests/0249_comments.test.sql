-- 0249_comments.test.sql — AC-CMT-001..003 (#790).
-- Mutation notes: drop `author_id = auth.uid()` from comments_insert → spoof test reddens; drop the org clause
-- from comments_select/insert → the other-org tests redden; drop the org/active gate inside notify_workflow_user
-- (0237) → the no-access mention tests redden; drop `author_id = auth.uid()` from comments_update → non-author
-- delete reddens.
begin;
select plan(20);

insert into organizations (id, name) values
  ('07900000-0000-0000-0000-000000000001','CMT Org A'),
  ('07900000-0000-0000-0000-000000000002','CMT Org B');
insert into auth.users (id, email) values
  ('07900000-0000-0000-0000-0000000000a1','cmt-author@example.com'),
  ('07900000-0000-0000-0000-0000000000a2','cmt-peer@example.com'),
  ('07900000-0000-0000-0000-0000000000a3','cmt-disabled@example.com'),
  ('07900000-0000-0000-0000-0000000000b1','cmt-other-org@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07900000-0000-0000-0000-0000000000a1','07900000-0000-0000-0000-000000000001','Author','cmt-author@example.com','Engineer','active'),
  ('07900000-0000-0000-0000-0000000000a2','07900000-0000-0000-0000-000000000001','Peer','cmt-peer@example.com','Engineer','active'),
  ('07900000-0000-0000-0000-0000000000a3','07900000-0000-0000-0000-000000000001','Disabled','cmt-disabled@example.com','Engineer','disabled'),
  ('07900000-0000-0000-0000-0000000000b1','07900000-0000-0000-0000-000000000002','Other Org','cmt-other-org@example.com','Project Manager','active');
insert into projects (id, org_id, code, name, status) values
  ('07900000-0000-0000-0000-000000000010','07900000-0000-0000-0000-000000000001','CMT-A','CMT Project A','Ongoing Project'),
  ('07900000-0000-0000-0000-000000000020','07900000-0000-0000-0000-000000000002','CMT-B','CMT Project B','Ongoing Project');
insert into tasks (id, org_id, project_id, name, status) values
  ('07900000-0000-0000-0000-000000000101','07900000-0000-0000-0000-000000000001','07900000-0000-0000-0000-000000000010','CMT Task A','To Do');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07900000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-CMT-001: post on a project and on a task.
select lives_ok($$ insert into comments (id, entity_type, entity_id, body)
  values ('07900000-0000-0000-0000-000000000c01','project','07900000-0000-0000-0000-000000000010','Is the scope final?') $$,
  'AC-CMT-001 a reader can comment on a project');
select lives_ok($$ insert into comments (id, entity_type, entity_id, body)
  values ('07900000-0000-0000-0000-000000000c02','task','07900000-0000-0000-0000-000000000101','Blocked on a drawing') $$,
  'AC-CMT-001 a reader can comment on a task');
select is((select author_id from comments where id = '07900000-0000-0000-0000-000000000c01'),
  '07900000-0000-0000-0000-0000000000a1'::uuid, 'AC-CMT-001 author_id defaults to the caller');

set local request.jwt.claims = '{"sub":"07900000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from comments where entity_id in
  ('07900000-0000-0000-0000-000000000010','07900000-0000-0000-0000-000000000101')), 2,
  'AC-CMT-001 a colleague who can read the records sees both comments');

-- Author spoofing and bad bodies.
select throws_ok($$ insert into comments (entity_type, entity_id, body, author_id)
  values ('project','07900000-0000-0000-0000-000000000010','spoof','07900000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'AC-CMT-001 posting as another author is refused');
select throws_ok($$ insert into comments (entity_type, entity_id, body)
  values ('project','07900000-0000-0000-0000-000000000010','   ') $$,
  '23514', null, 'AC-CMT-001 a blank body is refused');
select throws_ok($$ insert into comments (entity_type, entity_id, body)
  values ('project','07900000-0000-0000-0000-000000000010', repeat('x', 4001)) $$,
  '23514', null, 'AC-CMT-001 a body over 4000 chars is refused');
select throws_ok($$ insert into comments (entity_type, entity_id, body)
  values ('project','07900000-0000-0000-0000-0000000000ff','ghost parent') $$,
  '42501', null, 'AC-CMT-001 a comment on a record that does not exist is refused');

-- Non-author delete / edit.
select is((with u as (update comments set archived_at = now()
   where id = '07900000-0000-0000-0000-000000000c01' returning 1) select count(*)::int from u), 0,
  'AC-CMT-001 a non-author cannot soft-delete the comment');
select throws_ok($$ update comments set body = 'edited' where id = '07900000-0000-0000-0000-000000000c01' $$,
  '42501', null, 'AC-CMT-001 comments cannot be edited (no edit in v1)');
select throws_ok($$ delete from comments where id = '07900000-0000-0000-0000-000000000c01' $$,
  '42501', null, 'AC-CMT-001 comments cannot be hard-deleted');

set local request.jwt.claims = '{"sub":"07900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((with u as (update comments set archived_at = now()
   where id = '07900000-0000-0000-0000-000000000c01' returning 1) select count(*)::int from u), 1,
  'AC-CMT-001 the author can soft-delete their own comment');

-- AC-CMT-003: another org can neither read nor write.
set local request.jwt.claims = '{"sub":"07900000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from comments), 0, 'AC-CMT-003 another org''s user reads no comments');
select throws_ok($$ insert into comments (entity_type, entity_id, body)
  values ('project','07900000-0000-0000-0000-000000000010','cross-org') $$,
  '42501', null, 'AC-CMT-003 another org''s user cannot comment on this org''s project');
select throws_ok($$ insert into comments (entity_type, entity_id, body)
  values ('task','07900000-0000-0000-0000-000000000101','cross-org') $$,
  '42501', null, 'AC-CMT-003 another org''s user cannot comment on this org''s task');

set local role anon;
select throws_ok($$ select count(*) from comments $$, '42501', null, 'AC-CMT-003 anon has no access to comments');

-- AC-CMT-002: mentions notify only readers of the parent.
set local role authenticated;
set local request.jwt.claims = '{"sub":"07900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ insert into comments (id, entity_type, entity_id, body, mentions) values
  ('07900000-0000-0000-0000-000000000c03','project','07900000-0000-0000-0000-000000000010','@Peer @Disabled @Other @Me please look',
   array['07900000-0000-0000-0000-0000000000a2','07900000-0000-0000-0000-0000000000a3',
         '07900000-0000-0000-0000-0000000000b1','07900000-0000-0000-0000-0000000000a1']::uuid[]) $$,
  'AC-CMT-002 a comment can carry mentions');
reset role;
select is((select count(*)::int from notifications where owner_id = '07900000-0000-0000-0000-0000000000a2'
  and metadata->'entity'->>'id' = '07900000-0000-0000-0000-000000000010'), 1,
  'AC-CMT-002 a mentioned colleague is notified');
select is((select count(*)::int from notifications where owner_id in
  ('07900000-0000-0000-0000-0000000000b1','07900000-0000-0000-0000-0000000000a3')), 0,
  'AC-CMT-002 a mentioned user without access (other org, disabled) gets no notification');
select is((select count(*)::int from notifications where owner_id = '07900000-0000-0000-0000-0000000000a1'), 0,
  'AC-CMT-002 the author is never notified of their own mention');

select * from finish();
rollback;
