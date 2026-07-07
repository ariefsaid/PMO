-- 0131_org_stamp_trigger.test.sql — org_id stamp trigger (harden/org-id-seam; charter tenancy seam,
-- post-audit MED-1/2). Proves the before-insert stamp_org_id() trigger makes the org_id seam
-- forward-compatible for NON-seed-org authenticated users, while preserving the seed-org path, the
-- service-role / explicit-org path, AND the existing "explicit foreign org_id → 42501" contract that
-- ~11 other pgTAP files already document (0070_procurement_files_rls.test.sql lines ~122-124 et al).
--
-- Regression context: before this trigger, an authenticated non-seed-org user's insert WITHOUT org_id
-- defaulted to the seed org (constant column default) and was rejected by RLS WITH CHECK
-- (org_id = auth_org_id()) — see 0002 AC-103b. The trigger stamps the caller's real org so the write
-- SUCCEEDS in that case.
--
-- Design (narrow variant, Director decision 2026-07-07): the trigger stamps NEW.org_id := auth_org_id()
-- ONLY when NEW.org_id is NULL or still the seed-org literal (i.e. the caller relied on the default /
-- sent nothing real). A GENUINELY foreign, explicitly-supplied org_id (neither NULL nor the seed
-- literal) is left untouched, so RLS WITH CHECK still hard-rejects it with 42501 — unchanged from
-- pre-trigger behavior. Both branches are proven below (Part 1 = the fix; Part 1b = the preserved
-- hard-reject).
begin;
select plan(10);

-- ── Fixtures: the SEED org already exists (0001). Add TWO non-seed orgs (C, D) + one PM user in each,
-- plus a seed-org PM.
insert into organizations (id, name) values
  ('cccccccc-0000-0000-0000-00000000000c','Org C (non-seed)'),
  ('dddddddd-0000-0000-0000-00000000000d','Org D (non-seed, forgery target)');

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-0000000000c1','c@example.com'),   -- Org C, PM (write role)
  ('50000000-0000-0000-0000-00000000005e','seed@example.com'); -- seed org, PM (write role)

insert into profiles (id, org_id, full_name, email, role) values
  ('c0000000-0000-0000-0000-0000000000c1','cccccccc-0000-0000-0000-00000000000c','User C','c@example.com','Project Manager'),
  ('50000000-0000-0000-0000-00000000005e','00000000-0000-0000-0000-000000000001','Seed PM','seed@example.com','Project Manager');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Part 1 — NON-seed-org (Org C) authenticated user, NULL/no org_id supplied. THIS is the fix:
-- inserts WITHOUT org_id succeed and are stamped with Org C (were rejected by RLS before the trigger).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- AC-ORGSTAMP-001: projects insert WITHOUT org_id succeeds (no RLS rejection) — the seam fix.
select lives_ok(
  $$ insert into projects (id, name, status)
     values ('c1111111-0000-0000-0000-000000000001','Org C Project','Ongoing Project') $$,
  'AC-ORGSTAMP-001: non-seed-org user inserts a project WITHOUT org_id (trigger stamps their org)');

-- AC-ORGSTAMP-002: the stamped org_id is Org C, not the seed-org column default.
select is(
  (select org_id from projects where id = 'c1111111-0000-0000-0000-000000000001'),
  'cccccccc-0000-0000-0000-00000000000c'::uuid,
  'AC-ORGSTAMP-002: project stamped with the caller''s (Org C) org_id, not the seed-org default');

-- AC-ORGSTAMP-003: companies insert WITHOUT org_id also succeeds and is stamped with Org C.
select lives_ok(
  $$ insert into companies (id, name, type)
     values ('c2222222-0000-0000-0000-000000000002','Org C Co','Client') $$,
  'AC-ORGSTAMP-003: non-seed-org user inserts a company WITHOUT org_id (trigger stamps their org)');
select is(
  (select org_id from companies where id = 'c2222222-0000-0000-0000-000000000002'),
  'cccccccc-0000-0000-0000-00000000000c'::uuid,
  'AC-ORGSTAMP-003b: company stamped with Org C');

-- AC-ORGSTAMP-004: explicit org_id = the SEED-ORG LITERAL (the DAL's known non-forgery default value,
-- not a real other org) is treated as "no real org_id supplied" and coerced to the caller's org — the
-- insert lives (no 42501) AND lands in Org C, not the seed org. This is the same bug-fix path as
-- AC-ORGSTAMP-001, just reached via an explicit default value instead of an omitted column.
select lives_ok(
  $$ insert into projects (id, org_id, name, status)
     values ('c3333333-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Default-literal','Leads') $$,
  'AC-ORGSTAMP-004: explicit seed-org-literal org_id does not 42501 — treated as the default, coerced to caller''s org');
select is(
  (select org_id from projects where id = 'c3333333-0000-0000-0000-000000000003'),
  'cccccccc-0000-0000-0000-00000000000c'::uuid,
  'AC-ORGSTAMP-004b: seed-org-literal org_id coerced to the caller''s (Org C) org');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Part 1b — GENUINE cross-org forgery (explicit org_id = Org D, a real other non-seed org, NOT the
-- seed literal) is preserved untouched by the trigger and hard-rejected by RLS WITH CHECK (42501) —
-- the narrow variant's contract, matching the existing ~11-file convention (0070 etc).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into projects (id, org_id, name, status)
     values ('c4444444-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-00000000000d','Forged','Leads') $$,
  '42501', null,
  'AC-ORGSTAMP-004c: genuinely-foreign explicit org_id (Org D) is preserved by the trigger and rejected by RLS (42501), not silently coerced');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Part 2 — cross-org isolation: Org C's rows are NOT readable by a seed-org user (RLS SELECT intact).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-00000000005e","role":"authenticated"}';

select is(
  (select count(*)::int from projects where id = 'c1111111-0000-0000-0000-000000000001'), 0,
  'AC-ORGSTAMP-005: seed-org user cannot read Org C''s stamped project (SELECT isolation)');

-- AC-ORGSTAMP-006: seed-org PM inserts WITHOUT org_id — still lands in the seed org (no behavior change).
select lives_ok(
  $$ insert into projects (id, name, status)
     values ('50000000-0000-0000-0000-000000000051','Seed Project','Ongoing Project') $$,
  'AC-ORGSTAMP-006: seed-org user insert WITHOUT org_id succeeds');
select is(
  (select org_id from projects where id = '50000000-0000-0000-0000-000000000051'),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'AC-ORGSTAMP-006b: seed-org insert stays in the seed org (regression-safe)');

select * from finish();
rollback;
