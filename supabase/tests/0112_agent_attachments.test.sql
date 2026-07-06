-- 0112_agent_attachments.test.sql — agent_attachments owner isolation + Storage RLS.
begin;
select plan(12);

insert into organizations (id, name) values
  ('01120000-0000-0000-0000-000000000002','Agent Attachments Org B');

insert into auth.users (id, email) values
  ('01120000-0000-0000-0000-0000000000a1','att-ann@example.com'),
  ('01120000-0000-0000-0000-0000000000a2','att-bob@example.com'),
  ('01120000-0000-0000-0000-0000000000b1','att-carol@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01120000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','ATT Ann','att-ann@example.com','Engineer'),
  ('01120000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','ATT Bob','att-bob@example.com','Engineer'),
  ('01120000-0000-0000-0000-0000000000b1','01120000-0000-0000-0000-000000000002','ATT Carol','att-carol@example.com','Engineer');

insert into agent_threads (id, owner_id, title) values
  ('01120000-0000-0000-0000-000000000010','01120000-0000-0000-0000-0000000000a1','Ann attachment thread');

insert into agent_attachments (
  id, owner_id, thread_id, storage_path, mime_type, size_bytes, original_filename, extracted_text_status, extracted_text, extracted_text_chars
) values (
  '01120000-0000-0000-0000-000000000020',
  '01120000-0000-0000-0000-0000000000a1',
  '01120000-0000-0000-0000-000000000010',
  'org/00000000-0000-0000-0000-000000000001/agent-attachments/01120000-0000-0000-0000-000000000020',
  'application/pdf',
  512,
  'quote.pdf',
  'ready',
  'Known quoted amount is 42.',
  26
);

insert into storage.objects (id, bucket_id, name, owner)
  values (
    gen_random_uuid(),
    'agent-attachments',
    'org/00000000-0000-0000-0000-000000000001/agent-attachments/01120000-0000-0000-0000-000000000020',
    '01120000-0000-0000-0000-0000000000a1'
  );

set local role authenticated;
set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from agent_attachments where id = '01120000-0000-0000-0000-000000000020'),
  1,
  'AC-AT2-004: owner reads own attachment row');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'agent-attachments'),
  1,
  'AC-AT2-004: owner reads own attachment storage object');

select lives_ok(
  $$ insert into agent_attachments (id, thread_id, mime_type, size_bytes, original_filename)
       values ('01120000-0000-0000-0000-000000000021','01120000-0000-0000-0000-000000000010','image/png',128,'photo.png') $$,
  'AC-AT2-004: owner can prepare an attachment row under own thread');

reset role;

select is(
  (select owner_id::text from agent_attachments where id = '01120000-0000-0000-0000-000000000021'),
  '01120000-0000-0000-0000-0000000000a1',
  'AC-AT2-004: prepared row is stamped to the thread owner');

select is(
  (select storage_path from agent_attachments where id = '01120000-0000-0000-0000-000000000021'),
  'org/00000000-0000-0000-0000-000000000001/agent-attachments/01120000-0000-0000-0000-000000000021',
  'AC-AT2-004: prepared row path is derived from org and attachment id');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select count(*)::int from agent_attachments where id = '01120000-0000-0000-0000-000000000020'),
  0,
  'AC-AT2-004: same-org non-owner reads zero attachment rows');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'agent-attachments'),
  0,
  'AC-AT2-004: same-org non-owner reads zero storage objects');

select throws_ok(
  $$ insert into agent_attachments (thread_id, mime_type, size_bytes, original_filename)
       values ('01120000-0000-0000-0000-000000000010','application/pdf',256,'forged.pdf') $$,
  '42501', null,
  'AC-AT2-004: non-owner cannot prepare under another user thread');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01120000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*)::int from agent_attachments where id = '01120000-0000-0000-0000-000000000020'),
  0,
  'AC-AT2-004: cross-org user reads zero attachment rows');

select throws_ok(
  $$ insert into agent_attachments (thread_id, org_id, mime_type, size_bytes, original_filename)
       values ('01120000-0000-0000-0000-000000000010','01120000-0000-0000-0000-000000000002','application/pdf',256,'spoofed.pdf') $$,
  '42501', null,
  'AC-AT2-004: spoofed org/thread combination is denied');

reset role;

set local request.jwt.claims = '{}';
set local role anon;

select is(
  (select count(*)::int from agent_attachments),
  0,
  'AC-AT2-004: anon reads zero attachment rows');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'agent-attachments'),
  0,
  'AC-AT2-004: anon reads zero agent-attachments storage objects');

select * from finish();
rollback;
