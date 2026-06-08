-- 0053_document_transition_sod.test.sql — the transition_document_status RPC contract (migration 0017).
-- Proves the SoD that was previously FE-only is now SERVER-enforced: the SECURITY DEFINER RPC re-asserts
-- org + the master-data role gate + the legal status map + approver≠author, and is the SOLE writer of
-- project_documents.status (the direct-UPDATE grant no longer includes the status column).
--
--   AC-DOC-201  the document author CANNOT approve their own document (SoD → 42501).
--   AC-DOC-202  the document author CANNOT reject their own document (SoD → 42501).
--   AC-DOC-203  a DIFFERENT manager (PM) CAN approve a document they did not author (Issued → Approved).
--   AC-DOC-204  illegal status hops are rejected by the legal map (Draft → Approved → P0001).
--   AC-DOC-205  a non-write-role (Engineer) CANNOT transition a document (role gate → 42501).
--   AC-DOC-206  cross-org transition is denied (an org-B PM cannot move an org-A document → 42501).
--   AC-DOC-207  the status column is RPC-only: a direct `update … set status` by a write-role → 42501.
begin;
select plan(10);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org-A is the DEFAULT org. doc-pm authors the document; doc-pm2 is a DIFFERENT manager who may
-- approve it; doc-eng is a non-write-role; doc-pm-b is the cross-org attacker. Unique 00530000-… ns.
insert into organizations (id, name) values
  ('00530000-0000-0000-0000-000000000002','Doc SoD Org B');

insert into auth.users (id, email) values
  ('00530000-0000-0000-0000-0000000000a1','doc-sod-pm@example.com'),
  ('00530000-0000-0000-0000-0000000000a2','doc-sod-pm2@example.com'),
  ('00530000-0000-0000-0000-0000000000a3','doc-sod-eng@example.com'),
  ('00530000-0000-0000-0000-0000000000b1','doc-sod-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00530000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','DOC SoD PM','doc-sod-pm@example.com','Project Manager'),
  ('00530000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','DOC SoD PM2','doc-sod-pm2@example.com','Project Manager'),
  ('00530000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','DOC SoD Eng','doc-sod-eng@example.com','Engineer'),
  ('00530000-0000-0000-0000-0000000000b1','00530000-0000-0000-0000-000000000002','DOC SoD PM B','doc-sod-pm-b@example.com','Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00530000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'DOC-SOD-A','Doc SoD Project A','Ongoing Project','00530000-0000-0000-0000-0000000000a1'),
  ('00530000-0000-0000-0000-000000000021','00530000-0000-0000-0000-000000000002',
   'DOC-SOD-B','Doc SoD Project B','Ongoing Project','00530000-0000-0000-0000-0000000000b1');

-- An org-A document authored by doc-pm (a1), already moved to Issued (ready for approve/reject).
insert into project_documents (id, org_id, project_id, code, category, title, status, author_id) values
  ('00530000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00530000-0000-0000-0000-000000000020','DOC-SOD-001','Drawing','SoD Drawing','Issued',
   '00530000-0000-0000-0000-0000000000a1');
-- A second org-A document in Draft (for the legal-map illegal-hop test).
insert into project_documents (id, org_id, project_id, code, category, title, status, author_id) values
  ('00530000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001',
   '00530000-0000-0000-0000-000000000020','DOC-SOD-002','Drawing','Draft Drawing','Draft',
   '00530000-0000-0000-0000-0000000000a1');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-201/202: the AUTHOR (doc-pm a1) cannot approve OR reject their OWN document.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00530000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select transition_document_status('00530000-0000-0000-0000-000000000030','Approved') $$,
  '42501', null,
  'AC-DOC-201: the document author cannot APPROVE their own document (SoD → 42501)');

select throws_ok(
  $$ select transition_document_status('00530000-0000-0000-0000-000000000030','Rejected') $$,
  '42501', null,
  'AC-DOC-202: the document author cannot REJECT their own document (SoD → 42501)');

reset role;
-- The document is still Issued (the author's self-approve/reject was rejected, not partially applied).
select is(
  (select status::text from project_documents where id = '00530000-0000-0000-0000-000000000030'),
  'Issued',
  'AC-DOC-201/202: status unchanged after the author''s blocked self-approve/reject (still Issued)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-205: a non-write-role (Engineer) cannot transition the document (role gate → 42501).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00530000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select throws_ok(
  $$ select transition_document_status('00530000-0000-0000-0000-000000000030','Approved') $$,
  '42501', null,
  'AC-DOC-205: a non-write-role (Engineer) cannot transition a document (role gate → 42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-206: cross-org transition denied (org-B PM moving an org-A document → 42501).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00530000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select throws_ok(
  $$ select transition_document_status('00530000-0000-0000-0000-000000000030','Approved') $$,
  '42501', null,
  'AC-DOC-206: cross-org transition (org-B PM on an org-A document) is denied → 42501');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-204: illegal status hops rejected by the legal map (Draft → Approved → P0001).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00530000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ select transition_document_status('00530000-0000-0000-0000-000000000031','Approved') $$,
  'P0001', null,
  'AC-DOC-204: an illegal status hop (Draft → Approved) is rejected by the legal map → P0001');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-203: a DIFFERENT manager (doc-pm2 a2, not the author) CAN approve the Issued document.
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ select transition_document_status('00530000-0000-0000-0000-000000000030','Approved') $$,
  'AC-DOC-203: a different manager (not the author) can approve the document (Issued → Approved)');

reset role;
select is(
  (select status::text from project_documents where id = '00530000-0000-0000-0000-000000000030'),
  'Approved',
  'AC-DOC-203: the transition persisted (a non-author manager''s approve took effect)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-DOC-207: the status column is RPC-only — a direct UPDATE of status by a write-role → 42501.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00530000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ update project_documents set status = 'Closed' where id = '00530000-0000-0000-0000-000000000030' $$,
  '42501', null,
  'AC-DOC-207: a direct UPDATE of project_documents.status is denied — the column is RPC-only → 42501');

-- A direct UPDATE of a METADATA column (still granted) by the write-role succeeds — proving the
-- lockdown narrowed only `status`, not the whole table.
select lives_ok(
  $$ update project_documents set title = 'SoD Drawing (Rev B)' where id = '00530000-0000-0000-0000-000000000030' $$,
  'AC-DOC-207: a direct UPDATE of a metadata column still works (only status was locked to the RPC)');

reset role;

select * from finish();
rollback;
