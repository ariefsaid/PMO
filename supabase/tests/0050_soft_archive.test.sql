-- 0050_soft_archive.test.sql — soft-archive primitive (ADR-0018, migration 0012_soft_archive.sql).
-- Proves the cross-cutting archive seam on projects + companies:
--   (1) `archived_at timestamptz` exists and is NULLABLE on both tables;
--   (2) a write-role can set archived_at on its OWN org rows (incl. projects, whose table-wide UPDATE
--       was revoked in 0008 — the new column-grant must re-enable this);
--   (3) the partial `WHERE archived_at IS NULL` index exists on each table (the default-list fast path);
--   (4) no regression — archiving is a plain UPDATE under the existing FOR ALL write policy, RLS unchanged.
--   (5) ADR-0018 role boundary: an Engineer (not in the write-role set) attempting to set archived_at
--       is silently denied (0 rows affected) on both projects and companies.
--   (6) ADR-0018 org boundary: a user from a DIFFERENT org attempting to archive an org-A project/company
--       is silently denied (0 rows affected) — cross-org archive is impossible via RLS USING clause.
-- AC ownership: ADR-0018 archive primitive (no FR-id yet; this is the foundation migration).
begin;
select plan(20);

-- ── (1) Columns exist + are nullable (schema contract) ──────────────────────
select has_column('public', 'projects',  'archived_at',
  'ADR-0018: projects.archived_at column exists');
select has_column('public', 'companies', 'archived_at',
  'ADR-0018: companies.archived_at column exists');
select col_is_null('public', 'projects',  'archived_at',
  'ADR-0018: projects.archived_at is nullable (NULL = live row)');
select col_is_null('public', 'companies', 'archived_at',
  'ADR-0018: companies.archived_at is nullable (NULL = live row)');
select col_type_is('public', 'projects',  'archived_at', 'timestamp with time zone',
  'ADR-0018: projects.archived_at is timestamptz');
select col_type_is('public', 'companies', 'archived_at', 'timestamp with time zone',
  'ADR-0018: companies.archived_at is timestamptz');

-- ── (3) Partial index exists with the archived_at IS NULL predicate ─────────
-- Assert via pg_indexes so the WHERE predicate (not just the index name) is proven.
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'projects'
       and indexname = 'projects_live_idx'
       and indexdef ilike '%where (archived_at is null)%'),
  'ADR-0018: projects has a partial index on (archived_at IS NULL) for the default list filter');
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'companies'
       and indexname = 'companies_live_idx'
       and indexdef ilike '%where (archived_at is null)%'),
  'ADR-0018: companies has a partial index on (archived_at IS NULL) for the default list filter');

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org-A: one PM (write-role), one Engineer (non-write-role), one live project + company.
-- Org-B: one PM, used only as the cross-org attacker in (5)/(6).
insert into organizations (id, name) values
  ('00500000-0000-0000-0000-000000000001','Soft-Archive Org A'),
  ('00500000-0000-0000-0000-000000000002','Soft-Archive Org B');
insert into auth.users (id, email) values
  ('00500000-0000-0000-0000-0000000000a1','sa-pm@example.com'),
  ('00500000-0000-0000-0000-0000000000a2','sa-eng@example.com'),
  ('00500000-0000-0000-0000-0000000000b1','sa-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('00500000-0000-0000-0000-0000000000a1','00500000-0000-0000-0000-000000000001',
   'SA PM','sa-pm@example.com','Project Manager'),
  ('00500000-0000-0000-0000-0000000000a2','00500000-0000-0000-0000-000000000001',
   'SA Eng','sa-eng@example.com','Engineer'),
  ('00500000-0000-0000-0000-0000000000b1','00500000-0000-0000-0000-000000000002',
   'SA PM B','sa-pm-b@example.com','Project Manager');
insert into companies (id, org_id, name, type) values
  ('00500000-0000-0000-0000-000000000010','00500000-0000-0000-0000-000000000001','SA Client','Client');
insert into projects (id, org_id, code, name, status, client_id, project_manager_id) values
  ('00500000-0000-0000-0000-000000000020','00500000-0000-0000-0000-000000000001',
   'SA-001','SA Project','Ongoing Project','00500000-0000-0000-0000-000000000010',
   '00500000-0000-0000-0000-0000000000a1');

-- ── (5) Role boundary: Engineer (non-write-role) cannot archive — 0 rows affected ───────────────
-- The projects_write / companies_write FOR ALL USING clause requires
--   auth_role() IN ('Admin','Executive','Project Manager','Finance').
-- 'Engineer' is not in that set, so the row is invisible for DML → silent 0-row no-op (no 42501).
-- Run BEFORE the PM archives so archived_at IS NULL is the baseline.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00500000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ADR-0018 role boundary: Engineer UPDATE on projects.archived_at runs without error (RLS no-op).
select lives_ok(
  $$ update projects set archived_at = now()
       where id = '00500000-0000-0000-0000-000000000020' $$,
  'ADR-0018 role boundary: Engineer UPDATE projects.archived_at runs without error (RLS silences it)');

-- ADR-0018 role boundary: Engineer UPDATE on companies.archived_at runs without error (RLS no-op).
select lives_ok(
  $$ update companies set archived_at = now()
       where id = '00500000-0000-0000-0000-000000000010' $$,
  'ADR-0018 role boundary: Engineer UPDATE companies.archived_at runs without error (RLS silences it)');

reset role;

-- Confirm 0 rows were actually changed — archived_at must still be NULL.
select ok(
  (select archived_at is null from projects  where id = '00500000-0000-0000-0000-000000000020'),
  'ADR-0018 role boundary: Engineer archive attempt affected 0 rows on projects (archived_at still NULL)');
select ok(
  (select archived_at is null from companies where id = '00500000-0000-0000-0000-000000000010'),
  'ADR-0018 role boundary: Engineer archive attempt affected 0 rows on companies (archived_at still NULL)');

-- ── (6) Org boundary: cross-org user cannot archive org-A rows — 0 rows affected ───────────────
-- The USING clause requires org_id = auth_org_id().  Org-B PM's auth_org_id() returns org-B's ID,
-- so org-A rows are invisible for DML → silent 0-row no-op.
-- Also run BEFORE the PM archives so archived_at IS NULL remains the baseline.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00500000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- ADR-0018 org boundary: org-B PM UPDATE on org-A projects.archived_at runs without error (RLS no-op).
select lives_ok(
  $$ update projects set archived_at = now()
       where id = '00500000-0000-0000-0000-000000000020' $$,
  'ADR-0018 org boundary: org-B PM UPDATE org-A projects.archived_at runs without error (RLS silences it)');

-- ADR-0018 org boundary: org-B PM UPDATE on org-A companies.archived_at runs without error (RLS no-op).
select lives_ok(
  $$ update companies set archived_at = now()
       where id = '00500000-0000-0000-0000-000000000010' $$,
  'ADR-0018 org boundary: org-B PM UPDATE org-A companies.archived_at runs without error (RLS silences it)');

reset role;

-- Confirm 0 rows were actually changed — archived_at must STILL be NULL (org denial held).
select ok(
  (select archived_at is null from projects  where id = '00500000-0000-0000-0000-000000000020'),
  'ADR-0018 org boundary: cross-org archive attempt affected 0 rows on projects (archived_at still NULL)');
select ok(
  (select archived_at is null from companies where id = '00500000-0000-0000-0000-000000000010'),
  'ADR-0018 org boundary: cross-org archive attempt affected 0 rows on companies (archived_at still NULL)');

-- ── (2) A write-role can set archived_at on its OWN org rows (RLS + grant) ──
-- Act as the in-org PM (a write-role; passes projects_write / companies_write role gate).
-- Runs AFTER the negative tests so archived_at IS NULL is still the baseline going in.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00500000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- A PM can archive its own org PROJECT (proves the 0012 GRANT UPDATE(archived_at) un-does the 0008 revoke).
select lives_ok(
  $$ update projects set archived_at = now()
       where id = '00500000-0000-0000-0000-000000000020' $$,
  'ADR-0018: a write-role can set projects.archived_at on its own org row (column grant + FOR ALL policy)');

-- A PM can archive its own org COMPANY (companies was never column-revoked; table grant covers it).
select lives_ok(
  $$ update companies set archived_at = now()
       where id = '00500000-0000-0000-0000-000000000010' $$,
  'ADR-0018: a write-role can set companies.archived_at on its own org row');

reset role;

-- The archive timestamps actually persisted (no silent RLS no-op).
select ok(
  (select archived_at is not null from projects  where id = '00500000-0000-0000-0000-000000000020'),
  'ADR-0018: projects.archived_at persisted (the archive write took effect)');
select ok(
  (select archived_at is not null from companies where id = '00500000-0000-0000-0000-000000000010'),
  'ADR-0018: companies.archived_at persisted (the archive write took effect)');

select * from finish();
rollback;
