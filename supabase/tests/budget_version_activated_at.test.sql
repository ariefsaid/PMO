-- budget_version_activated_at.test.sql — OQ-BUD-2(a), owner-ratified 2026-07-20 (P3c Part A).
--
-- `budget_versions.activated_at` is the ADR-0059 §4 deterministic-key STATE STAMP: the push key is
-- '<prefix>:<budget_version_id>:<activated_at>', so two originators (the activation consequence and the
-- sweep backstop) derive the SAME key from DB truth, while a LATER activation of the same version id is a
-- DISTINCT command rather than a 23505 that is silently suppressed (which would leave ERP enforcing a
-- budget PMO no longer holds).
--
-- ⚑ The column is a WITNESS, not a rule. This file proves BOTH halves:
--   (1) the witness is stamped on activation and is null before it;
--   (2) EVERY shipped behaviour of activate_budget_version + get_project_budget is preserved
--       byte-for-byte — the Draft-only guard, the archive-the-previous-Active step, the single-Active
--       invariant, the OD-BUDGET-3 role gate, and the KPI figure itself.
-- The shipped budget suite (0008-0012, 0060, 0075) is the other half of that proof and must stay green.

--
-- MEDIUM-F (Luna re-audit round 2, 2026-07-21): the re-created body was missing `is_active_member()`.
-- 0139 rewrote this SECURITY DEFINER function, preserving 0005's body verbatim — which preserved
-- 0005's pre-offboarding gap. `auth_role()` reads `profiles.role` with NO status filter, and the
-- function is `grant execute … to authenticated` (reachable directly over PostgREST), so a deactivated
-- or raw-banned PM/Finance holding an unexpired JWT could archive the Active version, make a version of
-- their choosing Active (moving every budget KPI) and — new in P3c — TRIGGER A REAL ERPNext Budget push
-- that changes the client's GL overspend controls. Same class as 0128/0129/0130 and 0148. A plain
-- conjunct (not 0138's resolved-actor form) is correct here: this RPC has NO service-role caller —
-- every caller is a user JWT via `budgets.ts`.

begin;
select plan(13);

-- ── Fixtures (inserted as table owner, bypassing RLS) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('e0000000-0000-0000-0000-000000000001','Activated-At Test Org');

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000a1','pm-actat@example.com'),
  ('e0000000-0000-0000-0000-0000000000a2','fin-offboarded@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000001','PM ActAt','pm-actat@example.com','Project Manager'),
  -- MEDIUM-F: an OD-BUDGET-3 role who has been DEACTIVATED but still holds a valid JWT.
  ('e0000000-0000-0000-0000-0000000000a2','e0000000-0000-0000-0000-000000000001','Finance Offboarded','fin-offboarded@example.com','Finance');
update profiles set status = 'disabled' where id = 'e0000000-0000-0000-0000-0000000000a2';

insert into projects (id, org_id, name, status) values
  ('e1111111-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','ActAt Project','Ongoing Project');

-- v1 Active (the incumbent), v2 Draft (the one we activate).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('e2222222-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','e1111111-0000-0000-0000-000000000001',1,'Initial Budget','Active'),
  ('e2222222-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001','e1111111-0000-0000-0000-000000000001',2,'Revised Budget','Draft');

insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('e0000000-0000-0000-0000-000000000001','e2222222-0000-0000-0000-000000000002','Labor','Team costs',500000,0);

-- ── (1) the witness column itself ────────────────────────────────────────────────────────────────
select has_column('public','budget_versions','activated_at',
                  'OQ-BUD-2 budget_versions carries the activated_at witness');
select col_type_is('public','budget_versions','activated_at','timestamp with time zone',
                   'OQ-BUD-2 activated_at is timestamptz');
select is((select activated_at from budget_versions where id = 'e2222222-0000-0000-0000-000000000002'),
          null::timestamptz,
          'OQ-BUD-2 a never-activated Draft version has a NULL activated_at (additive + nullable)');

-- ── MEDIUM-F: a DEACTIVATED Finance user with a live JWT may not activate anything ───────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ select activate_budget_version('e2222222-0000-0000-0000-000000000002') $$,
  '42501', null,
  'MEDIUM-F a DEACTIVATED user holding a valid JWT cannot activate a budget version (the offboarding gate)');

reset role;
-- Read back as the table owner: a DEACTIVATED member cannot SELECT under RLS either (is_active_member),
-- so this assertion has to run outside their session to observe the real row state.
select is((select status::text from budget_versions where id = 'e2222222-0000-0000-0000-000000000001'),
          'Active',
          'MEDIUM-F the refused call changed NOTHING — the incumbent Active version is untouched');

-- ── Become the PM (OD-BUDGET-3) ──────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select activate_budget_version('e2222222-0000-0000-0000-000000000002') $$,
  'OQ-BUD-2 activate_budget_version still succeeds for an OD-BUDGET-3 role on a Draft version');

-- ── (2) the witness is stamped ───────────────────────────────────────────────────────────────────
select isnt((select activated_at from budget_versions where id = 'e2222222-0000-0000-0000-000000000002'),
            null::timestamptz,
            'OQ-BUD-2 activation STAMPS activated_at on the activated version');
select ok(
  (select activated_at from budget_versions where id = 'e2222222-0000-0000-0000-000000000002')
    between now() - interval '1 minute' and now() + interval '1 minute',
  'OQ-BUD-2 the stamp is the transaction clock, not an arbitrary value');

-- ── (3) EVERY shipped behaviour is byte-for-byte preserved ───────────────────────────────────────
select is((select status::text from budget_versions where id = 'e2222222-0000-0000-0000-000000000002'),
          'Active',
          'OQ-BUD-2 PRESERVED: the activated version becomes Active');
select is((select status::text from budget_versions where id = 'e2222222-0000-0000-0000-000000000001'),
          'Archived',
          'OQ-BUD-2 PRESERVED: the previously-Active version is archived');
select is((select count(*)::int from budget_versions
            where project_id = 'e1111111-0000-0000-0000-000000000001' and status = 'Active'),
          1,
          'OQ-BUD-2 PRESERVED: exactly one Active version per project (the single-Active invariant)');

-- ⚑ The KPI oracle: get_project_budget is Σ the Active version''s line items — unchanged by the stamp
-- (margin / at-risk / S-curve / finance-review all read this one function).
select is((select get_project_budget('e1111111-0000-0000-0000-000000000001')),
          500000::numeric,
          'OQ-BUD-2 PRESERVED: get_project_budget still returns the Active version Σ (KPIs untouched)');

-- PRESERVED: the Draft-only guard still refuses a non-Draft version (this is ALSO why a roll-back
-- re-activation cannot reuse a version id — a rollback clones to a NEW Draft version).
select throws_ok(
  $$ select activate_budget_version('e2222222-0000-0000-0000-000000000002') $$,
  'P0001', null,
  'OQ-BUD-2 PRESERVED: only a Draft version can be activated (the shipped status guard)');

reset role;
select * from finish();
rollback;
