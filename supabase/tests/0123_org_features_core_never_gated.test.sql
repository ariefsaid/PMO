-- 0123_org_features_core_never_gated.test.sql
-- AC-ENT-002 [pgTAP]: a core key ('projects','dashboard','approvals','administration') is NEVER
-- gatable. TWO defense layers are proven:
--   (a) the CHECK constraint REJECTS a core-key insert at the table level (23514 — so a backdoor
--       row can never exist), AND
--   (b) org_has_feature returns true for every core key regardless (defense in depth — even a
--       hypothetical row would be ignored by the fn's core-key short-circuit), and a gated key
--       with no row = included = true (FR-ENT-004 absence default).
-- operator_toggle_feature rejects a core key with 'core_not_gated' (P0001). Pins FR-ENT-001/004/007.
begin;
select plan(9);

-- ── Fixtures: one org + an Operator (the sole writer). ──
insert into organizations (id, name) values
  ('01230000-0000-0000-0000-000000000001','AC-ENT-002 Org');
insert into auth.users (id, email) values
  ('01230000-0000-0000-0000-0000000000f1','ent002-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('01230000-0000-0000-0000-0000000000f1','01230000-0000-0000-0000-000000000001','Operator','ent002-operator@example.com','Admin','active');
insert into platform_operators (user_id) values
  ('01230000-0000-0000-0000-0000000000f1');

-- ════════════════════════════════════════════════════════════════════════════
-- (a) Defense layer 1: the CHECK constraint on org_features REJECTS a core-key row at INSERT
--     (23514) — a backdoor disabling row can never exist, regardless of who writes it. (Run AS
--     TABLE OWNER to prove the CHECK binds even the owner — defense in depth.)
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into org_features (org_id, feature_key, enabled) values ('01230000-0000-0000-0000-000000000001','projects',false) $$,
  '23514', null,
  'AC-ENT-002 CHECK rejects core key "projects" insert (backdoor-proof)');
select throws_ok(
  $$ insert into org_features (org_id, feature_key, enabled) values ('01230000-0000-0000-0000-000000000001','administration',false) $$,
  '23514', null,
  'AC-ENT-002 CHECK rejects core key "administration" insert');

-- ════════════════════════════════════════════════════════════════════════════
-- (b) Defense layer 2: org_has_feature returns true for every core key (absence = true — the fn
--     short-circuits core keys), AND a gated key with no row defaults to included (FR-ENT-004).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01230000-0000-0000-0000-0000000000f1","role":"authenticated"}';

select is(public.org_has_feature('01230000-0000-0000-0000-000000000001','projects'), true,
  'AC-ENT-002 core key "projects" NEVER gated (absence = true)');
select is(public.org_has_feature('01230000-0000-0000-0000-000000000001','dashboard'), true,
  'AC-ENT-002 core key "dashboard" NEVER gated (absence = true)');
select is(public.org_has_feature('01230000-0000-0000-0000-000000000001','approvals'), true,
  'AC-ENT-002 core key "approvals" NEVER gated (absence = true)');
select is(public.org_has_feature('01230000-0000-0000-0000-000000000001','incidents'), true,
  'AC-ENT-002 gated key with no row = included (true, FR-ENT-004)');

-- ════════════════════════════════════════════════════════════════════════════
-- (c) operator_toggle_feature REJECTS a core key with 'core_not_gated' (P0001). A gated-key
--     toggle flips org_has_feature from the absence-default to the row's value.
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ select operator_toggle_feature('01230000-0000-0000-0000-000000000001','projects',false) $$,
  'P0001', null,
  'AC-ENT-002 operator_toggle_feature rejects core key "projects" (core_not_gated)');

-- A gated key toggle flips org_has_feature from the absence-default to the row's value.
select lives_ok(
  $$ select operator_toggle_feature('01230000-0000-0000-0000-000000000001','incidents',false) $$,
  'AC-ENT-002 operator_toggle_feature accepts a gated key');
select is(public.org_has_feature('01230000-0000-0000-0000-000000000001','incidents'), false,
  'AC-ENT-002 gated key now reads false after a disabling toggle');

select finish();
rollback;
