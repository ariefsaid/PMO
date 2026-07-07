-- 0138_feature_flag_write_enforcement.test.sql
-- AC-FEATENF-001..004 [pgTAP]: SERVER-ENFORCE feature entitlements on WRITES (audit HIGH — feature
-- flags were FE-only via useFeature; a direct PostgREST call with a valid JWT could write to a gated
-- feature's tables even when the org had the feature disabled).
--
-- Proves, on representative gated tables across three features —
--   companies (crm), incident_reports (incidents), procurements (procurement) —
-- that with the feature DISABLED (org_features row enabled=false) an otherwise-authorized member's
--   • INSERT is DENIED (42501 — no permissive WITH CHECK admits the row), and
--   • UPDATE affects 0 rows (USING filters the row out);
-- and with the feature ABSENT (FR-ENT-004 default-on) the SAME writes SUCCEED. Also proves a CORE
-- table (projects) write is UNAFFECTED by any feature row, and that SELECT is NOT gated (a disabled
-- feature's existing rows stay readable). Exercises the 0081 RLS wiring end-to-end through real
-- Postgres policy evaluation. Uses the 0133 set-local-role + jwt-claims fixture style.
begin;
select plan(15);

-- ── Fixtures (inserted as the migration runner / superuser → bypasses RLS) ────────────────────
-- Org A (the gated org) + Org B (cross-org function probe). An org-A Admin (in every 4-role write
-- set, so it passes the role/org/parent-org guards — the ONLY variable is the feature flag). A
-- pre-existing company C1 in org A (UPDATE + SELECT-not-gated target).
insert into organizations (id, name) values
  ('0138a000-0000-0000-0000-000000000001','AC-FEATENF Org A'),
  ('0138a000-0000-0000-0000-000000000002','AC-FEATENF Org B');
insert into auth.users (id, email) values
  ('0138a000-0000-0000-0000-0000000000a1','featenf-a-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0138a000-0000-0000-0000-0000000000a1','0138a000-0000-0000-0000-000000000001','A Admin','featenf-a-admin@example.com','Admin','active');

-- Pre-existing company in Org A (the UPDATE / SELECT-not-gated target). Superuser insert.
insert into companies (id, org_id, name, type) values
  ('0138a000-0000-0000-0000-0000000000c1','0138a000-0000-0000-0000-000000000001','C1 exists','Client');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Structural: the non-raising wrapper exists in public.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select has_function('public','org_feature_enabled',
  'AC-FEATENF-000 org_feature_enabled(uuid,text) exists (the non-raising RLS wrapper)');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — features DISABLED (org_features rows crm/incidents/procurement = false for Org A).
-- An otherwise-authorized member's WRITES are DENIED; a CORE write is UNAFFECTED; reads stay open.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
insert into org_features (org_id, feature_key, enabled) values
  ('0138a000-0000-0000-0000-000000000001','crm',false),
  ('0138a000-0000-0000-0000-000000000001','incidents',false),
  ('0138a000-0000-0000-0000-000000000001','procurement',false);

set local role authenticated;
set local request.jwt.claims = '{"sub":"0138a000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- (a) WRITE-deny: INSERT into each gated feature's table is REJECTED (42501 — the conjoined
--     org_feature_enabled(...) makes every permissive WITH CHECK fail, so no policy admits the row).
select throws_ok(
  $$ insert into companies (org_id, name, type) values
       ('0138a000-0000-0000-0000-000000000001','C new (crm disabled)','Client') $$,
  '42501', null,
  'AC-FEATENF-001 crm=DISABLED ⇒ companies INSERT denied (feature gates the write)');
select throws_ok(
  $$ insert into incident_reports (org_id, incident_date, type, severity) values
       ('0138a000-0000-0000-0000-000000000001', current_date, 'Safety', 'Low') $$,
  '42501', null,
  'AC-FEATENF-001 incidents=DISABLED ⇒ incident_reports INSERT denied');
select throws_ok(
  $$ insert into procurements (org_id, title) values
       ('0138a000-0000-0000-0000-000000000001','PR (procurement disabled)') $$,
  '42501', null,
  'AC-FEATENF-001 procurement=DISABLED ⇒ procurements INSERT denied');

-- (b) WRITE-deny: UPDATE affects 0 rows (the conjoined feature check is in USING too, so the
--     existing row is filtered out of the updatable set — silent 0-row deny, no raise).
with upd as (
  update companies set name = 'C1 renamed (blocked)'
    where id = '0138a000-0000-0000-0000-0000000000c1' returning id)
select is((select count(*)::int from upd), 0,
  'AC-FEATENF-002 crm=DISABLED ⇒ companies UPDATE affects 0 rows');

-- (c) CORE write UNAFFECTED: projects is core (never gated); an INSERT succeeds even with the
--     disabling feature rows present. Proves the gate does not bleed into core tables.
select lives_ok(
  $$ insert into projects (org_id, name) values
       ('0138a000-0000-0000-0000-000000000001','Core proj (unaffected)') $$,
  'AC-FEATENF-003 projects (CORE) INSERT succeeds with feature rows present (core never gated)');

-- (d) SELECT NOT gated: with crm disabled, the existing company is STILL READABLE (the feature
--     check is conjoined onto WRITE policies only; reads survive via companies_select). Proves the
--     gate does not break reads of a disabled feature's existing rows.
select is((select count(*)::int from companies where id = '0138a000-0000-0000-0000-0000000000c1'), 1,
  'AC-FEATENF-004 crm=DISABLED ⇒ companies SELECT still returns the existing row (reads NOT gated)');

-- (e) Function unit: the wrapper returns the entitlement value (false=disabled), true for core, and
--     false (NOT a raise) for a cross-org probe — the no-raise property that makes it policy-safe.
select is(public.org_feature_enabled('0138a000-0000-0000-0000-000000000001','crm'), false,
  'AC-FEATENF-000 org_feature_enabled(crm)=false while the disabling row is present');
select is(public.org_feature_enabled('0138a000-0000-0000-0000-000000000001','projects'), true,
  'AC-FEATENF-000 org_feature_enabled(projects)=true (core never gated)');
select is(public.org_feature_enabled('0138a000-0000-0000-0000-000000000002','crm'), false,
  'AC-FEATENF-000 org_feature_enabled(cross-org crm)=false WITHOUT raising (policy-safe)');

reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — features ABSENT (no org_features rows ⇒ FR-ENT-004 default-on). The SAME writes now
-- SUCCEED, and the wrapper reads true. Proves absence = included (the entitlement default).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
delete from org_features where org_id = '0138a000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"0138a000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into companies (org_id, name, type) values
       ('0138a000-0000-0000-0000-000000000001','C new (crm default-on)','Client') $$,
  'AC-FEATENF-001 crm ABSENT ⇒ companies INSERT succeeds (default-on)');
select lives_ok(
  $$ insert into incident_reports (org_id, incident_date, type, severity) values
       ('0138a000-0000-0000-0000-000000000001', current_date, 'Safety', 'Low') $$,
  'AC-FEATENF-001 incidents ABSENT ⇒ incident_reports INSERT succeeds (default-on)');
select lives_ok(
  $$ insert into procurements (org_id, title) values
       ('0138a000-0000-0000-0000-000000000001','PR (procurement default-on)') $$,
  'AC-FEATENF-001 procurement ABSENT ⇒ procurements INSERT succeeds (default-on)');

-- UPDATE now reaches the row (feature check true ⇒ USING admits it).
with upd as (
  update companies set name = 'C1 renamed (allowed)'
    where id = '0138a000-0000-0000-0000-0000000000c1' returning id)
select is((select count(*)::int from upd), 1,
  'AC-FEATENF-002 crm ABSENT ⇒ companies UPDATE affects 1 row (write re-enabled)');

select is(public.org_feature_enabled('0138a000-0000-0000-0000-000000000001','crm'), true,
  'AC-FEATENF-000 org_feature_enabled(crm)=true on absence (FR-ENT-004 default-on)');

reset role;

select * from finish();
rollback;
