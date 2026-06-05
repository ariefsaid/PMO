-- 0032_pipeline_stage_config_rls.test.sql
-- AC-1010: pipeline_stage_config RLS + seed + anon-revoke.
-- (i)   org-A PM SELECTs pipeline_stage_config → reads org-A rows only.
-- (ii)  org-B user SELECTs → 0 rows (cross-org isolated).
-- (iii) org-A Engineer INSERT → 42501 (coarse write gate blocks Engineer).
-- (iv)  org-A PM INSERT → lives_ok (coarse write gate admits PM).
-- (v)   default-org seed has 5 OD-SP-2 rows; Negotiation win_prob = 0.75 (two is() calls).
-- (vi)  anon cannot execute transition_project (anon execute revoked).
-- (FR-PR-008/009/010, OD-SP-2, OD-PR-A)
-- Note: plan(7) — items (v) uses two is() assertions for count + value.
begin;
select plan(7);

-- Fixtures: two dedicated test orgs (NOT the default '...0001' so counts are deterministic).
insert into organizations (id, name) values
  ('00320000-0000-0000-0000-000000000001','PSC RLS Org A'),
  ('00320000-0000-0000-0000-000000000002','PSC RLS Org B');

insert into auth.users (id, email) values
  ('00320000-0000-0000-0000-0000000000a2','psc-pm-a@example.com'),
  ('00320000-0000-0000-0000-0000000000a4','psc-eng-a@example.com'),
  ('00320000-0000-0000-0000-0000000000b1','psc-user-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00320000-0000-0000-0000-0000000000a2','00320000-0000-0000-0000-000000000001','PSC PM A','psc-pm-a@example.com','Project Manager'),
  ('00320000-0000-0000-0000-0000000000a4','00320000-0000-0000-0000-000000000001','PSC Eng A','psc-eng-a@example.com','Engineer'),
  ('00320000-0000-0000-0000-0000000000b1','00320000-0000-0000-0000-000000000002','PSC User B','psc-user-b@example.com','Project Manager');

-- Seed org-A pipeline_stage_config rows (as table owner — bypasses RLS for fixture setup).
insert into pipeline_stage_config (org_id, status, win_probability) values
  ('00320000-0000-0000-0000-000000000001','Leads',0.100),
  ('00320000-0000-0000-0000-000000000001','PQ Submitted',0.250),
  ('00320000-0000-0000-0000-000000000001','Negotiation',0.750);

-- ── Test (i): org-A PM reads only org-A rows ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00320000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select count(*)::int from pipeline_stage_config),
  3,
  'AC-1010: in-org read returns org-A rows (3 seeded)');

-- ── Test (ii): org-B user sees 0 rows (cross-org isolation) ──────────────────
set local request.jwt.claims = '{"sub":"00320000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*)::int from pipeline_stage_config),
  0,
  'AC-1010: cross-org read isolated (org-B user sees 0 org-A rows)');

-- ── Test (iii): org-A Engineer INSERT → 42501 ────────────────────────────────
set local request.jwt.claims = '{"sub":"00320000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select throws_ok(
  $$ insert into pipeline_stage_config (org_id, status, win_probability)
     values ('00320000-0000-0000-0000-000000000001','On Hold',0.900) $$,
  '42501', null,
  'AC-1010: Engineer write blocked by coarse gate');

-- ── Test (iv): org-A PM INSERT → lives_ok ────────────────────────────────────
set local request.jwt.claims = '{"sub":"00320000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ insert into pipeline_stage_config (org_id, status, win_probability)
     values ('00320000-0000-0000-0000-000000000001','On Hold',0.900) $$,
  'AC-1010: authorized PM write succeeds');

reset role;

-- ── Tests (v): default-org seed invariant ─────────────────────────────────────
-- Read as table owner (no role switch needed) — bypasses RLS for the seed invariant check.
select is(
  (select count(*)::int from pipeline_stage_config
   where org_id = '00000000-0000-0000-0000-000000000001'),
  5,
  'AC-1010: default-org seed has 5 OD-SP-2 rows');

select is(
  (select win_probability from pipeline_stage_config
   where org_id = '00000000-0000-0000-0000-000000000001' and status = 'Negotiation'),
  0.750,
  'AC-1010: Negotiation win prob = 0.75');

-- ── Test (vi): anon cannot execute transition_project ────────────────────────
-- transition_project has: revoke execute on function ... from anon.
-- Calling it as anon role should raise permission-denied (42501).
set local role anon;

select throws_ok(
  $$ select transition_project('00000000-0000-0000-0000-000000000001'::uuid,'Loss Tender') $$,
  '42501', null,
  'AC-1010: anon cannot execute transition_project');

reset role;
select * from finish();
rollback;
