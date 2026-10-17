-- 0310_document_storage_read_alignment.test.sql — document-storage read contract proof.
begin;
create extension if not exists pgtap;
select no_plan();

-- Isolated synthetic organizations and users; all object rows are inserted by the table owner.
insert into organizations (id, name) values
  ('03100067-0000-0000-0000-000000000001', 'DSR Project Org A'),
  ('03100067-0000-0000-0000-000000000002', 'DSR Project Org B'),
  ('03100071-0000-0000-0000-000000000001', 'DSR Procurement Org A'),
  ('03100071-0000-0000-0000-000000000002', 'DSR Procurement Org B');

insert into auth.users (id, email, banned_until) values
  ('03100067-0000-0000-0000-0000000000a1', 'dsr-pm@example.test', null),
  ('03100067-0000-0000-0000-0000000000a2', 'dsr-eng@example.test', null),
  ('03100067-0000-0000-0000-0000000000a3', 'dsr-admin@example.test', null),
  ('03100067-0000-0000-0000-0000000000a4', 'dsr-finance@example.test', null),
  ('03100067-0000-0000-0000-0000000000a5', 'dsr-executive@example.test', null),
  ('03100067-0000-0000-0000-0000000000b1', 'dsr-other@example.test', null),
  ('03100067-0000-0000-0000-0000000000a9', 'dsr-no-profile@example.test', null),
  ('03100071-0000-0000-0000-0000000000a1', 'dsr-proc-pm@example.test', null),
  ('03100071-0000-0000-0000-0000000000a2', 'dsr-proc-eng@example.test', null),
  ('03100071-0000-0000-0000-0000000000a3', 'dsr-proc-admin@example.test', null),
  ('03100071-0000-0000-0000-0000000000a4', 'dsr-proc-finance@example.test', null),
  ('03100071-0000-0000-0000-0000000000a5', 'dsr-proc-executive@example.test', null);

insert into profiles (id, org_id, full_name, email, role, status) values
  ('03100067-0000-0000-0000-0000000000a1', '03100067-0000-0000-0000-000000000001', 'DSR PM', 'dsr-pm@example.test', 'Project Manager', 'active'),
  ('03100067-0000-0000-0000-0000000000a2', '03100067-0000-0000-0000-000000000001', 'DSR Engineer', 'dsr-eng@example.test', 'Engineer', 'active'),
  ('03100067-0000-0000-0000-0000000000a3', '03100067-0000-0000-0000-000000000001', 'DSR Admin', 'dsr-admin@example.test', 'Admin', 'active'),
  ('03100067-0000-0000-0000-0000000000a4', '03100067-0000-0000-0000-000000000001', 'DSR Finance', 'dsr-finance@example.test', 'Finance', 'active'),
  ('03100067-0000-0000-0000-0000000000a5', '03100067-0000-0000-0000-000000000001', 'DSR Executive', 'dsr-executive@example.test', 'Executive', 'active'),
  ('03100067-0000-0000-0000-0000000000b1', '03100067-0000-0000-0000-000000000002', 'DSR Other', 'dsr-other@example.test', 'Project Manager', 'active'),
  ('03100071-0000-0000-0000-0000000000a1', '03100071-0000-0000-0000-000000000001', 'DSR Procurement PM', 'dsr-proc-pm@example.test', 'Project Manager', 'active'),
  ('03100071-0000-0000-0000-0000000000a2', '03100071-0000-0000-0000-000000000001', 'DSR Procurement Engineer', 'dsr-proc-eng@example.test', 'Engineer', 'active'),
  ('03100071-0000-0000-0000-0000000000a3', '03100071-0000-0000-0000-000000000001', 'DSR Procurement Admin', 'dsr-proc-admin@example.test', 'Admin', 'active'),
  ('03100071-0000-0000-0000-0000000000a4', '03100071-0000-0000-0000-000000000001', 'DSR Procurement Finance', 'dsr-proc-finance@example.test', 'Finance', 'active'),
  ('03100071-0000-0000-0000-0000000000a5', '03100071-0000-0000-0000-000000000001', 'DSR Procurement Executive', 'dsr-proc-executive@example.test', 'Executive', 'active');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('03100067-0000-0000-0000-000000000020', '03100067-0000-0000-0000-000000000001', 'DSR-PRJ', 'DSR Project', 'Ongoing Project', '03100067-0000-0000-0000-0000000000a1');
insert into project_documents (id, org_id, project_id, code, category, title, status, author_id) values
  ('03100067-0000-0000-0000-000000000030', '03100067-0000-0000-0000-000000000001', '03100067-0000-0000-0000-000000000020', 'DSR-D', 'Drawing', 'DSR Draft', 'Draft', '03100067-0000-0000-0000-0000000000a1');
insert into procurements (id, org_id, title, status) values
  ('03100071-0000-0000-0000-000000000010', '03100071-0000-0000-0000-000000000001', 'DSR Procurement', 'Vendor Quoted');

insert into storage.buckets (id, name, public)
values ('dsr-other-bucket', 'dsr-other-bucket', false);

insert into storage.objects (id, bucket_id, name, owner) values
  ('03100067-0000-0000-0000-000000000090', 'project-documents', '03100067-0000-0000-0000-000000000001/03100067-0000-0000-0000-000000000020/03100067-0000-0000-0000-000000000030/draft.pdf', '03100067-0000-0000-0000-0000000000a1'),
  ('03100067-0000-0000-0000-000000000092', 'project-documents', '03100067-0000-0000-0000-000000000002/03100067-0000-0000-0000-000000000020/03100067-0000-0000-0000-000000000030/foreign.pdf', '03100067-0000-0000-0000-0000000000b1'),
  ('03100067-0000-0000-0000-000000000093', 'project-documents', '03100067-0000-0000-0000-000000000001/03100067-0000-0000-0000-000000000020/03100067-0000-0000-0000-000000000030', '03100067-0000-0000-0000-0000000000a1'),
  ('03100067-0000-0000-0000-000000000094', 'dsr-other-bucket', '03100067-0000-0000-0000-000000000001/03100067-0000-0000-0000-000000000020/03100067-0000-0000-0000-000000000030/other-bucket.pdf', '03100067-0000-0000-0000-0000000000a1'),
  ('03100071-0000-0000-0000-000000000090', 'procurement-files', '03100071-0000-0000-0000-000000000001/03100071-0000-0000-0000-000000000010/quotation/03100071-0000-0000-0000-000000000099/seed.pdf', '03100071-0000-0000-0000-0000000000a1'),
  ('03100071-0000-0000-0000-000000000091', 'procurement-files', '03100071-0000-0000-0000-000000000001/03100071-0000-0000-0000-0000000000ff/quotation/03100071-0000-0000-0000-00000000beef/orphan.pdf', '03100071-0000-0000-0000-0000000000a1'),
  ('03100071-0000-0000-0000-000000000092', 'procurement-files', '03100071-0000-0000-0000-000000000002/03100071-0000-0000-0000-000000000010/quotation/03100071-0000-0000-0000-000000000099/foreign.pdf', '03100071-0000-0000-0000-0000000000b1'),
  ('03100071-0000-0000-0000-000000000093', 'procurement-files', '03100071-0000-0000-0000-000000000001/03100071-0000-0000-0000-000000000010/quotation/03100071-0000-0000-0000-000000000099', '03100071-0000-0000-0000-0000000000a1');

-- AC-DSR-001: every persisted role can read the exact own-org project object while active.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Project Manager reads exact project object');
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Engineer reads exact project object');
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a3","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Admin reads exact project object');
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a4","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Finance reads exact project object');
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a5","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Executive reads exact project object');

-- AC-DSR-001: every persisted role can read the exact own-org procurement object while active.
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Project Manager reads exact procurement object');
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Engineer reads exact procurement object');
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a3","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Admin reads exact procurement object');
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a4","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Finance reads exact procurement object');
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a5","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 active Executive reads exact procurement object');
reset role;

-- AC-DSR-002: disabling the writer does not expose the Draft-backed object through either policy.
update profiles set status='disabled' where id='03100067-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000090'), 0, 'AC-DSR-002 AC-DSR-005 disabled Project Manager cannot read Draft-backed project object');
reset role;
update profiles set status='active' where id='03100067-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-002 reactivated Project Manager reads project object again');
reset role;
update profiles set status='disabled' where id='03100067-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000090'), 0, 'AC-DSR-002 disabled Engineer cannot read project object');
reset role;
update profiles set status='active' where id='03100067-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-002 reactivated Engineer reads project object again');
reset role;

update profiles set status='disabled' where id='03100071-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100071-0000-0000-0000-000000000090'), 0, 'AC-DSR-002 AC-DSR-005 disabled Project Manager cannot read parent-backed procurement object');
reset role;
update profiles set status='active' where id='03100071-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-002 reactivated Project Manager reads procurement object again');
reset role;
update profiles set status='disabled' where id='03100071-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100071-0000-0000-0000-000000000090'), 0, 'AC-DSR-002 disabled Engineer cannot read procurement object');
reset role;
update profiles set status='active' where id='03100071-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-002 reactivated Engineer reads procurement object again');
reset role;

-- AC-DSR-003: changing only banned_until denies writer and non-writer reads; clearing restores them.
update auth.users set banned_until=now()+interval '1 day' where id='03100067-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000090'), 0, 'AC-DSR-003 AC-DSR-005 future-banned Project Manager cannot read Draft-backed project object');
reset role;
update auth.users set banned_until=null where id='03100067-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-003 clearing Project Manager ban restores project read');
reset role;
update auth.users set banned_until=now()+interval '1 day' where id='03100067-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000090'), 0, 'AC-DSR-003 future-banned Engineer cannot read project object');
reset role;
update auth.users set banned_until=null where id='03100067-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-003 clearing Engineer ban restores project read');
reset role;

update auth.users set banned_until=now()+interval '1 day' where id='03100071-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100071-0000-0000-0000-000000000090'), 0, 'AC-DSR-003 AC-DSR-005 future-banned Project Manager cannot read parent-backed procurement object');
reset role;
update auth.users set banned_until=null where id='03100071-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-003 clearing Project Manager ban restores procurement read');
reset role;
update auth.users set banned_until=now()+interval '1 day' where id='03100071-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100071-0000-0000-0000-000000000090'), 0, 'AC-DSR-003 future-banned Engineer cannot read procurement object');
reset role;
update auth.users set banned_until=null where id='03100071-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-003 clearing Engineer ban restores procurement read');
reset role;

-- AC-DSR-001 / AC-DSR-003: an expired ban is an active-member positive control.
update auth.users set banned_until=now()-interval '1 day' where id='03100067-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 AC-DSR-003 expired-ban Project Manager reads project object');
reset role;
update auth.users set banned_until=now()-interval '1 day' where id='03100067-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100067-0000-0000-0000-000000000090'$$, $$values ('03100067-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 AC-DSR-003 expired-ban Engineer reads project object');
reset role;
update auth.users set banned_until=now()-interval '1 day' where id='03100071-0000-0000-0000-0000000000a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 AC-DSR-003 expired-ban Project Manager reads procurement object');
reset role;
update auth.users set banned_until=now()-interval '1 day' where id='03100071-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000090'$$, $$values ('03100071-0000-0000-0000-000000000090'::uuid)$$, 'AC-DSR-001 AC-DSR-003 expired-ban Engineer reads procurement object');
reset role;
update auth.users set banned_until=null where id in (
  '03100067-0000-0000-0000-0000000000a1', '03100067-0000-0000-0000-0000000000a2',
  '03100071-0000-0000-0000-0000000000a1', '03100071-0000-0000-0000-0000000000a2');

-- AC-DSR-004: exact own-org objects with a foreign prefix or malformed path remain invisible.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000092'), 0, 'AC-DSR-004 Project Manager cannot read foreign-org project object');
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000093'), 0, 'AC-DSR-004 Project Manager cannot read malformed project path');
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000094'), 0, 'AC-DSR-004 unrelated bucket object remains invisible');
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100071-0000-0000-0000-000000000092'), 0, 'AC-DSR-004 Project Manager cannot read foreign-org procurement object');
select is((select count(*)::int from storage.objects where id='03100071-0000-0000-0000-000000000093'), 0, 'AC-DSR-004 Project Manager cannot read malformed procurement path');
reset role;

-- AC-DSR-004: anon and an authenticated subject without a profile see no seeded objects.
set local request.jwt.claims = '{}';
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id='project-documents' and id in ('03100067-0000-0000-0000-000000000090', '03100067-0000-0000-0000-000000000092', '03100067-0000-0000-0000-000000000093')), 0, 'AC-DSR-004 anon sees no seeded project-document objects');
select is((select count(*)::int from storage.objects where bucket_id='procurement-files' and id in ('03100071-0000-0000-0000-000000000090', '03100071-0000-0000-0000-000000000091', '03100071-0000-0000-0000-000000000092', '03100071-0000-0000-0000-000000000093')), 0, 'AC-DSR-004 anon sees no seeded procurement-file objects');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a9","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100067-0000-0000-0000-000000000090'), 0, 'AC-DSR-004 authenticated user without a profile sees no project object');
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a9","role":"authenticated"}';
select is((select count(*)::int from storage.objects where id='03100071-0000-0000-0000-000000000090'), 0, 'AC-DSR-004 authenticated user without a profile sees no procurement object');
reset role;

-- AC-DSR-005: parent visibility and the intentional procurement orphan read stay intact.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03100067-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from project_documents where id='03100067-0000-0000-0000-000000000030' and status='Draft'), 1, 'AC-DSR-005 active writer sees the Draft parent of the project object');
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from procurements where id='03100071-0000-0000-0000-000000000010'), 1, 'AC-DSR-005 active writer sees the procurement parent');
set local request.jwt.claims = '{"sub":"03100071-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq($$select id from storage.objects where id='03100071-0000-0000-0000-000000000091'$$, $$values ('03100071-0000-0000-0000-000000000091'::uuid)$$, 'AC-DSR-005 active Engineer retains org-wide read of procurement orphan segment');
reset role;

-- AC-DSR-006: preserve the existing SELECT policy attributes and both FOR ALL definitions.
select is((select cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_project_doc_read'), 'SELECT', 'AC-DSR-006 project read policy remains SELECT');
select is((select roles::text from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_project_doc_read'), '{public}', 'AC-DSR-006 project read policy retains its role set');
select is((select permissive from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_project_doc_read'), 'PERMISSIVE', 'AC-DSR-006 project read policy retains permissive mode');
select is((select with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_project_doc_read'), null::text, 'AC-DSR-006 project read policy retains its null check expression');
select is((select cmd from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_proc_file_read'), 'SELECT', 'AC-DSR-006 procurement read policy remains SELECT');
select is((select roles::text from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_proc_file_read'), '{public}', 'AC-DSR-006 procurement read policy retains its role set');
select is((select permissive from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_proc_file_read'), 'PERMISSIVE', 'AC-DSR-006 procurement read policy retains permissive mode');
select is((select with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_proc_file_read'), null::text, 'AC-DSR-006 procurement read policy retains its null check expression');
select is(
  (select regexp_replace(qual, E'\\s+', ' ', 'g') from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_project_doc_write'),
  '((bucket_id = ''project-documents''::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, ''/''::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, ''/''::text), 1) = 4) AND (auth_role() = ANY (ARRAY[''Admin''::user_role, ''Executive''::user_role, ''Project Manager''::user_role, ''Finance''::user_role])) AND (EXISTS ( SELECT 1 FROM project_documents pd WHERE (((pd.id)::text = split_part(objects.name, ''/''::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, ''/''::text, 2)) AND (pd.status = ''Draft''::doc_status)))))',
  'AC-DSR-006 project FOR ALL USING definition matches the captured baseline');
select is(
  (select regexp_replace(with_check, E'\\s+', ' ', 'g') from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_project_doc_write'),
  '((bucket_id = ''project-documents''::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, ''/''::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, ''/''::text), 1) = 4) AND (auth_role() = ANY (ARRAY[''Admin''::user_role, ''Executive''::user_role, ''Project Manager''::user_role, ''Finance''::user_role])) AND (EXISTS ( SELECT 1 FROM project_documents pd WHERE (((pd.id)::text = split_part(objects.name, ''/''::text, 3)) AND (pd.org_id = auth_org_id()) AND ((pd.project_id)::text = split_part(objects.name, ''/''::text, 2)) AND (pd.status = ''Draft''::doc_status)))))',
  'AC-DSR-006 project FOR ALL WITH CHECK definition matches the captured baseline');
select is(
  (select regexp_replace(qual, E'\\s+', ' ', 'g') from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_proc_file_write'),
  '((bucket_id = ''procurement-files''::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, ''/''::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, ''/''::text), 1) = 5) AND (auth_role() = ANY (ARRAY[''Admin''::user_role, ''Executive''::user_role, ''Project Manager''::user_role, ''Finance''::user_role])) AND (EXISTS ( SELECT 1 FROM procurements p WHERE (((p.id)::text = split_part(objects.name, ''/''::text, 2)) AND (p.org_id = auth_org_id())))))',
  'AC-DSR-006 procurement FOR ALL USING definition matches the captured baseline');
select is(
  (select regexp_replace(with_check, E'\\s+', ' ', 'g') from pg_policies where schemaname='storage' and tablename='objects' and policyname='storage_objects_proc_file_write'),
  '((bucket_id = ''procurement-files''::text) AND (auth.uid() IS NOT NULL) AND (split_part(name, ''/''::text, 1) = (auth_org_id())::text) AND (array_length(string_to_array(name, ''/''::text), 1) = 5) AND (auth_role() = ANY (ARRAY[''Admin''::user_role, ''Executive''::user_role, ''Project Manager''::user_role, ''Finance''::user_role])) AND (EXISTS ( SELECT 1 FROM procurements p WHERE (((p.id)::text = split_part(objects.name, ''/''::text, 2)) AND (p.org_id = auth_org_id())))))',
  'AC-DSR-006 procurement FOR ALL WITH CHECK definition matches the captured baseline');

select * from finish();
rollback;
