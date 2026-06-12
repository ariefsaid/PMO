-- 0066_document_superseded.test.sql — auto-Superseded + terminal behaviour
--   AC-DOC-060  child Approved → parent auto-Superseded (same tx)
--   AC-DOC-061  Superseded is terminal (no outbound transitions)
--   AC-DOC-070  (deferred to Task 1.4 storage RLS — this file owns RPC-level)
begin;
select plan(8);

-- Fixtures
insert into organizations (id, name) values
  ('00660000-0000-0000-0000-000000000002','Superseded Org B');

insert into auth.users (id, email) values
  ('00660000-0000-0000-0000-0000000000a1','super-pm@example.com'),
  ('00660000-0000-0000-0000-0000000000a2','super-pm2@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00660000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Super PM','super-pm@example.com','Project Manager'),
  ('00660000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','Super PM2','super-pm2@example.com','Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00660000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'SUPER-PRJ','Superseded Project','Ongoing Project','00660000-0000-0000-0000-0000000000a1');

-- Rev A: parent, authored by pm1, starting Approved
insert into project_documents (id, org_id, project_id, code, category, title, revision, status, author_id) values
  ('00660000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','DWG-SUP','Drawing','Foundation GA','A','Approved',
   '00660000-0000-0000-0000-0000000000a1');

-- Rev B: child with parent_document_id, authored by pm1, starting Draft
insert into project_documents (id, org_id, project_id, code, category, title, revision, status, author_id, parent_document_id) values
  ('00660000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','DWG-SUP','Drawing','Foundation GA','B','Draft',
   '00660000-0000-0000-0000-0000000000a1',
   '00660000-0000-0000-0000-000000000030');

-- Move Rev B: Draft → Issued (pm1 can issue own doc — no SoD on Issue)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00660000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_document_status('00660000-0000-0000-0000-000000000031','Issued') $$,
  'AC-DOC-060 setup: Rev B Draft→Issued succeeds'
);

-- AC-DOC-060: Approve Rev B (by pm2, not author) → Rev A auto-Superseded
set local request.jwt.claims = '{"sub":"00660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_document_status('00660000-0000-0000-0000-000000000031','Approved') $$,
  'AC-DOC-060: Approve Rev B succeeds'
);

select results_eq(
  $$ select status from project_documents where id = '00660000-0000-0000-0000-000000000030' $$,
  $$ values ('Superseded'::doc_status) $$,
  'AC-DOC-060: Rev A status is now Superseded after child approval'
);

select results_eq(
  $$ select status from project_documents where id = '00660000-0000-0000-0000-000000000031' $$,
  $$ values ('Approved'::doc_status) $$,
  'AC-DOC-060: Rev B status is Approved'
);

-- AC-DOC-060: Issued parent also superseded — set up a second parent/child pair
-- Rev C: Issued parent
insert into project_documents (id, org_id, project_id, code, category, title, revision, status, author_id) values
  ('00660000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','DWG-SUP2','Drawing','Slab Detail','C','Issued',
   '00660000-0000-0000-0000-0000000000a1');

-- Rev D: child of Rev C, starting Draft
insert into project_documents (id, org_id, project_id, code, category, title, revision, status, author_id, parent_document_id) values
  ('00660000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','DWG-SUP2','Drawing','Slab Detail','D','Draft',
   '00660000-0000-0000-0000-0000000000a1',
   '00660000-0000-0000-0000-000000000040');

-- Issue + Approve Rev D → Issued parent Rev C must also auto-Supersede
set local request.jwt.claims = '{"sub":"00660000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select transition_document_status('00660000-0000-0000-0000-000000000041','Issued') $$,
  'AC-DOC-060 setup: Rev D Draft→Issued'
);
set local request.jwt.claims = '{"sub":"00660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$ select transition_document_status('00660000-0000-0000-0000-000000000041','Approved') $$,
  'AC-DOC-060: Approve Rev D succeeds'
);
select results_eq(
  $$ select status from project_documents where id = '00660000-0000-0000-0000-000000000040' $$,
  $$ values ('Superseded'::doc_status) $$,
  'AC-DOC-060: Issued parent Rev C auto-Superseded when child approved'
);

-- AC-DOC-061: Superseded is terminal — any transition from Superseded is rejected
select throws_ok(
  $$ select transition_document_status('00660000-0000-0000-0000-000000000030','Closed') $$,
  'P0001', null,
  'AC-DOC-061: Superseded→Closed rejected (terminal, P0001)');

select finish();
rollback;
