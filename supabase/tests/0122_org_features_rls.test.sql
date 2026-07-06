-- 0122_org_features_rls.test.sql
-- AC-ENT-001 [pgTAP]: org_features RLS — every member of the org reads their own org's
-- entitlements (Admin AND Engineer alike — entitlements are not intra-org secrets, the FLIP of
-- the 2026-06-15 admin-write note); neither can INSERT/UPDATE/DELETE; the Operator may write any
-- org's row via the policy AND via operator_toggle_feature. A cross-org member reads nothing.
-- Pins FR-ENT-002/003.
begin;
select plan(10);

-- ── Fixtures: org A + org B, an org-A Admin, an org-A Engineer, a cross-org (org-B) Admin,
--    and a platform Operator whose home org is A. ──
insert into organizations (id, name) values
  ('01220000-0000-0000-0000-000000000001','AC-ENT-001 Org A'),
  ('01220000-0000-0000-0000-000000000002','AC-ENT-001 Org B');
insert into auth.users (id, email) values
  ('01220000-0000-0000-0000-0000000000a1','ent001-a-admin@example.com'),
  ('01220000-0000-0000-0000-0000000000a2','ent001-a-engineer@example.com'),
  ('01220000-0000-0000-0000-0000000000b1','ent001-b-admin@example.com'),
  ('01220000-0000-0000-0000-0000000000f1','ent001-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01220000-0000-0000-0000-0000000000a1','01220000-0000-0000-0000-000000000001','A Admin','ent001-a-admin@example.com','Admin','active'),
  ('01220000-0000-0000-0000-0000000000a2','01220000-0000-0000-0000-000000000001','A Engineer','ent001-a-engineer@example.com','Engineer','active'),
  ('01220000-0000-0000-0000-0000000000b1','01220000-0000-0000-0000-000000000002','B Admin','ent001-b-admin@example.com','Admin','active'),
  ('01220000-0000-0000-0000-0000000000f1','01220000-0000-0000-0000-000000000001','Operator','ent001-operator@example.com','Admin','active');
insert into platform_operators (user_id) values
  ('01220000-0000-0000-0000-0000000000f1');

-- Seed entitlement rows AS TABLE OWNER (bypassing RLS): org A has incidents=enabled and crm=disabled;
-- org B has incidents=disabled. Both rows visible only to their own members + the Operator writer.
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('01220000-0000-0000-0000-000000000001','incidents',true, '01220000-0000-0000-0000-0000000000a1'),
  ('01220000-0000-0000-0000-000000000001','crm',false,     '01220000-0000-0000-0000-0000000000a1'),
  ('01220000-0000-0000-0000-000000000002','incidents',false,'01220000-0000-0000-0000-0000000000b1');

-- ════════════════════════════════════════════════════════════════════════════
-- (a) READ: org-A Admin AND org-A Engineer each read ONLY org A's rows (2 rows). The flip: an
--     Engineer is not excluded — entitlements are not intra-org secrets.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01220000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from org_features), 2,
  'AC-ENT-001 org-A Admin reads own-org entitlements (2 rows)');
select is((select count(*)::int from org_features where feature_key = 'incidents' and enabled), 1,
  'AC-ENT-001 org-A Admin sees incidents=enabled');

set local request.jwt.claims = '{"sub":"01220000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from org_features), 2,
  'AC-ENT-001 org-A Engineer ALSO reads own-org entitlements (not intra-org secrets)');

-- Cross-org deny: org-B Admin reads org B's single row, NOT org A's.
set local request.jwt.claims = '{"sub":"01220000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from org_features), 1,
  'AC-ENT-001 org-B Admin reads ONLY org B (no cross-org leak)');

-- ════════════════════════════════════════════════════════════════════════════
-- (b) WRITE-deny for an org member (Admin or Engineer): INSERT is REJECTED (42501 — no matching
--     FOR INSERT WITH CHECK for a non-Operator); UPDATE/DELETE silently affect 0 rows (USING
--     filters rows out — Operator-only). The Operator is the sole writer; everyone else is
--     append-only-by-omission. (Mirrors the 0125 write-deny pattern.)
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"01220000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into org_features (org_id, feature_key, enabled) values ('01220000-0000-0000-0000-000000000001','timesheets',false) $$,
  '42501', null,
  'AC-ENT-001 org-A Admin INSERT denied (Operator-only WITH CHECK)');
with upd as (
  update org_features set enabled = true where feature_key = 'crm' returning feature_key)
select is((select count(*)::int from upd), 0,
  'AC-ENT-001 org-A Admin UPDATE affects 0 rows (Operator-only USING)');
with del as (
  delete from org_features where feature_key = 'incidents' returning feature_key)
select is((select count(*)::int from del), 0,
  'AC-ENT-001 org-A Admin DELETE affects 0 rows (Operator-only USING)');

-- ════════════════════════════════════════════════════════════════════════════
-- (c) OPERATOR writes any org's row via the policy (INSERT into a fresh org-B key) AND via the
--     operator_toggle_feature RPC (upsert + core-key rejection is in 0123).
-- ════════════════════════════════════════════════════════════════════════════
set local request.jwt.claims = '{"sub":"01220000-0000-0000-0000-0000000000f1","role":"authenticated"}';
insert into org_features (org_id, feature_key, enabled) values
  ('01220000-0000-0000-0000-000000000002','crm',true);
select is((select count(*)::int from org_features where org_id = '01220000-0000-0000-0000-000000000002'), 2,
  'AC-ENT-001 Operator cross-org INSERT via policy succeeds');

-- The Operator reads ALL orgs (no org_id filter in the SELECT policy — wait, the policy pins
-- org_id = auth_org_id(); so the Operator reads their HOME org only via direct SELECT, but writes
-- any org via the FOR ALL policy. Cross-org reads go via operator_usage_summary (0069), not here.
-- Confirm the Operator's direct SELECT returns their home-org rows (A) only:
select is((select count(*)::int from org_features where org_id = '01220000-0000-0000-0000-000000000001'), 2,
  'AC-ENT-001 Operator reads HOME org entitlements via direct SELECT');
-- ...and the cross-org toggle RPC works (writes B) even though direct SELECT is home-only:
select lives_ok(
  $$ select operator_toggle_feature('01220000-0000-0000-0000-000000000002','timesheets',false) $$,
  'AC-ENT-001 Operator operator_toggle_feature cross-org upsert succeeds');

select finish();
rollback;
