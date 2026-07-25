-- budget_non_employing_no_push.test.sql — AC-BUD-001 (spec §8, FR-BUD-004 / FR-BUD-005).
--
-- ⚑ THE INVARIANT: a NON-employing org (no activated `erpnext` binding — the shipped default for every
-- existing client) stays BYTE-FOR-BYTE the pre-P3c system when a budget version is activated: no ERP
-- call, no `external_command_outbox` row, no `budget_version_erp_mirror` row, and `get_project_budget()`
-- is unchanged (Σ the Active version's line items).
--
-- WHY THIS LAYER (spec marks AC-BUD-001 [unit]; this is pgTAP — the layer that makes the assertion REAL
-- without a mock): the "is this org employing?" decision is `orgEmploysErpnext()` in
-- `supabase/functions/adapter-dispatch/index.ts` (~L460) — an inline helper in a `Deno.serve` entrypoint
-- module that binds a listener on import, so it is not cleanly unit-importable, and mocking a fake
-- Supabase client would test the mock, not the employment ground truth. `orgEmploysErpnext` reads exactly
-- one DB fact — `external_org_bindings.activated_at IS NOT NULL` for the `erpnext` tier — and its whole
-- purpose is to SHORT-CIRCUIT the push to a benign no-op (index.ts:775-780) BEFORE the gate / adapter /
-- outbox / any ERP fetch / the side-mirror writer. This pgTAP asserts that ground-truth predicate on the
-- REAL DB and the byte-for-byte DB consequence (no outbox row, no side-mirror row, KPI unchanged). The
-- one clause pgTAP cannot observe — the literal ERP HTTP call — is guarded by that same short-circuit and
-- is exercised at the served boundary by AC-BUD-030; here the outbox/mirror rows are the durable DB
-- artefacts any regression (e.g. a future trigger giving the new tables a write path — the very thing
-- FR-BUD-004 forbids) would produce, so this test fails RED if that byte-for-byte guarantee ever breaks.
--
-- Namespaced fixture UUIDs (b0d1…). begin/rollback; select finish(); AC id leads each description.
begin;
select plan(5);

-- ── Fixtures (inserted as table owner, bypassing RLS) — a fresh org with NO erpnext binding at all,
-- which IS a non-employing org by construction (FR-BUD-004's "shipped default"). ─────────────────────
insert into organizations (id, name) values
  ('b0d10000-0000-0000-0000-000000000001','AC-BUD-001 Non-Employing Org');
insert into auth.users (id, email) values
  ('b0d10000-0000-0000-0000-0000000000a1','fin-noemp@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('b0d10000-0000-0000-0000-0000000000a1','b0d10000-0000-0000-0000-000000000001',
   'Finance NoEmp','fin-noemp@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('b0d10000-0000-0000-0000-0000000000c1','b0d10000-0000-0000-0000-000000000001','NoEmp Project','Ongoing Project');
-- v1 Draft with two line items (inserted as owner while Draft so the draft-guard trigger passes).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('b0d10000-0000-0000-0000-0000000000d1','b0d10000-0000-0000-0000-000000000001',
   'b0d10000-0000-0000-0000-0000000000c1',1,'v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('b0d10000-0000-0000-0000-000000000001','b0d10000-0000-0000-0000-0000000000d1','Labor','Team',500000.00,0),
  ('b0d10000-0000-0000-0000-000000000001','b0d10000-0000-0000-0000-0000000000d1','Materials','Steel',250000.00,0);

-- ── T1: the employment ground truth `orgEmploysErpnext` reads — false for a non-employing org ────────
-- This is the EXACT predicate the dispatch gate evaluates (activated_at IS NOT NULL for the erpnext
-- tier). No binding ⇒ false ⇒ the push short-circuits to a benign no-op before any dispatch work.
select is(
  coalesce((select activated_at is not null
            from external_org_bindings
            where org_id = 'b0d10000-0000-0000-0000-000000000001' and external_tier = 'erpnext'), false),
  false,
  'AC-BUD-001: a non-employing org has no activated erpnext binding (orgEmploysErpnext ⇒ false, the push is a no-op)');

-- ── T2: the activation itself always succeeds (FR-BUD-008) ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0d10000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select activate_budget_version('b0d10000-0000-0000-0000-0000000000d1') $$,
  'AC-BUD-001: activating a budget version in a non-employing org succeeds (the user is never blocked)');
reset role;

-- ── T3: no budget command is enqueued — no `external_command_outbox` row (no ERP call path) ──────────
select is(
  (select count(*)::int from external_command_outbox
   where domain = 'budget' and pmo_record_id = 'b0d10000-0000-0000-0000-0000000000d1'),
  0,
  'AC-BUD-001: activation creates NO budget external_command_outbox row (the new tables add no write path — FR-BUD-004)');

-- ── T4: no ADR-0059 §6 side-mirror row is created ────────────────────────────────────────────────────
select is(
  (select count(*)::int from budget_version_erp_mirror
   where budget_version_id = 'b0d10000-0000-0000-0000-0000000000d1'),
  0,
  'AC-BUD-001: activation creates NO budget_version_erp_mirror row (no side-mirror for a non-employing org)');

-- ── T5: get_project_budget() is unchanged — Σ the Active version's line items (KPI identical) ────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0d10000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(
  get_project_budget('b0d10000-0000-0000-0000-0000000000c1'),
  750000.00::numeric,
  'AC-BUD-001: get_project_budget() = Σ the Active version line items (500000 + 250000) — the KPI is identical to pre-P3c');
reset role;

select finish();
rollback;
