-- 0352: an attachment stays in a thread its owner owns, on update as on insert.
begin;
select plan(3);

insert into auth.users (id, email) values
  ('03520000-0000-0000-0000-0000000000a1','att-move-ann@example.com'),
  ('03520000-0000-0000-0000-0000000000a2','att-move-bob@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('03520000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Move Ann','att-move-ann@example.com','Engineer'),
  ('03520000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','Move Bob','att-move-bob@example.com','Engineer');
insert into agent_threads (id, owner_id, title) values
  ('03520000-0000-0000-0000-000000000011','03520000-0000-0000-0000-0000000000a1','Ann thread 1'),
  ('03520000-0000-0000-0000-000000000012','03520000-0000-0000-0000-0000000000a1','Ann thread 2'),
  ('03520000-0000-0000-0000-000000000021','03520000-0000-0000-0000-0000000000a2','Bob thread');
insert into agent_attachments (id, owner_id, thread_id, storage_path, mime_type, size_bytes, original_filename)
values ('03520000-0000-0000-0000-000000000030','03520000-0000-0000-0000-0000000000a1','03520000-0000-0000-0000-000000000011',
  'org/00000000-0000-0000-0000-000000000001/agent-attachments/03520000-0000-0000-0000-000000000030','application/pdf',512,'quote.pdf');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03520000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update agent_attachments set thread_id = '03520000-0000-0000-0000-000000000012'
      where id = '03520000-0000-0000-0000-000000000030' $$,
  'AC-SEC-230: owner may move an attachment between own threads');

select throws_ok(
  $$ update agent_attachments set thread_id = '03520000-0000-0000-0000-000000000021'
      where id = '03520000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-SEC-230: an attachment cannot be moved into another user''s thread');

reset role;
select is(
  (select thread_id from agent_attachments where id = '03520000-0000-0000-0000-000000000030'),
  '03520000-0000-0000-0000-000000000012'::uuid,
  'AC-SEC-230: the refused move leaves the attachment in its own thread');

select * from finish();
rollback;
