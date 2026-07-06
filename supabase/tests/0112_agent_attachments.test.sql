-- 0112_agent_attachments.test.sql — agent_attachments owner isolation + Storage RLS.
begin;
select plan(17);

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

-- SEC-10 (review): a forged storage_path is rejected by the INSERT with-check policy.
-- The BEFORE trigger only stamps a NULL storage_path, so an explicit spoofed path is
-- preserved and then rejected because it does not match the org-scoped path convention.
select throws_ok(
  $$ insert into agent_attachments (id, thread_id, storage_path, mime_type, size_bytes, original_filename)
       values ('01120000-0000-0000-0000-000000000030','01120000-0000-0000-0000-000000000010','org/forged/agent-attachments/x','application/pdf',256,'forged-path.pdf') $$,
  '42501', null,
  'SEC-10: forged storage_path is rejected by the INSERT with-check policy');

-- SEC-10 (review): a forged owner_id is rejected. The trigger only stamps owner_id when it
-- is NULL or equals auth.uid(), so an explicit foreign owner_id is preserved and rejected
-- by the with-check (owner_id = auth.uid()).
select throws_ok(
  $$ insert into agent_attachments (id, thread_id, owner_id, mime_type, size_bytes, original_filename)
       values ('01120000-0000-0000-0000-000000000031','01120000-0000-0000-0000-000000000010','01120000-0000-0000-0000-0000000000a2','application/pdf',256,'forged-owner.pdf') $$,
  '42501', null,
  'SEC-10: forged owner_id is rejected by the INSERT with-check policy');

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

reset role;

-- SEC-10 (review): the bucket carries the allowed MIME set + the 8MB size cap so a future
-- migration that loosens either turns CI red (defense-in-depth; FR-AT2-ATT-004, NFR-AT2-SEC-007).
select is(
  (select allowed_mime_types from storage.buckets where id = 'agent-attachments'),
  ARRAY['application/pdf','image/png','image/jpeg','image/webp'],
  'SEC-10: agent-attachments bucket enforces the allowed MIME set');

select is(
  (select file_size_limit from storage.buckets where id = 'agent-attachments'),
  8388608::bigint,
  'SEC-10: agent-attachments bucket enforces the 8MB (8388608 byte) file size limit');

-- SEC-10 (review): the table-level CHECK rejects a disallowed MIME even when the caller is
-- the thread owner (RLS would pass) — the DB CHECK is the server-side floor, never trusting
-- the client. Runs as superuser so only the CHECK constraint can reject (23514 check_violation).
select throws_ok(
  $$ insert into agent_attachments (id, thread_id, mime_type, size_bytes, original_filename)
       values ('01120000-0000-0000-0000-000000000032','01120000-0000-0000-0000-000000000010','application/x-msdownload',256,'malware.exe') $$,
  '23514', null,
  'SEC-10: agent_attachments CHECK rejects a disallowed MIME type');

select * from finish();
rollback;
