-- budget_no_flip_invariant.test.sql — AC-BUD-003 (spec §7/§8, FR-BUD-006 / FR-BUD-007).
--
-- ⚑ THE INVARIANT (the owner's one-authority ruling made STRUCTURAL): budget is Posture B — PMO is SoT
-- and there is NO RLS FLIP. ADR-0055 §6 + ADR-0059 §7 assign `budget` to PMO; a future migration that
-- tried to flip `budget` to external ownership (as P2/P3a/P3b legitimately flip companies / procurement /
-- timesheets) must FAIL this test. Concretely and checkably (spec §8 AC-BUD-003 THEN):
--
-- ⚑ CORRECTED 2026-07-24 (Director, after tracing the shipped design end to end). The original (a)
-- asserted "NO external_domain_ownership row for 'budget' exists". That is WRONG and the shipped code
-- correctly contradicts it: a `budget` ownership row is the deliberate **EMPLOY signal** — the
-- prod-reachable "this org pushes budgets to ERPNext" flag that BOTH the UI panel
-- (BudgetTab.tsx:33) and the projection RPC (get_budget_projection → domain_owned_by_tier, 0149:431)
-- require to render/return anything. It is created in PROD by the operator/admin-connect employ flow
-- (operator_set_domain_ownership, 0087), not only by seed. Removing it would make the entire P3c
-- budget-ERP feature invisible in production. **EMPLOY (an ownership row) is NOT FLIP (an RLS/authority
-- change).** FR-BUD-006(a)/0137's header say "no domain_externally_owned('budget')" but they conflate
-- the two; the real, money-safe invariant is that budget's TABLES are never flipped. So (a) is re-cast:
--   (a) budget MAY be EMPLOYED (an ownership row is permitted, Posture B) and that DOES NOT flip
--       authority — even with a budget ownership row present, get_project_budget() stays PMO-Σ and the
--       budget tables carry no flip policy/trigger (proven by (b)/(c)/(d) below);
--   (b) NO policy on budget_versions / budget_line_items references `domain_externally_owned`;
--   (c) NO `*_native_mirror_guard` trigger exists on budget_versions / budget_line_items;
--   (d) get_project_budget() returns Σ the Active version's line items — PMO is the authority, NOT an
--       ERP read-back.
--
-- Each structural probe is paired with a POSITIVE CONTRAST against a genuinely-flipped domain (companies,
-- flipped by 0097), so the probe is proven to DISCRIMINATE: it finds a flip where one exists and asserts
-- budget's ABSENCE positively, rather than silently passing because the query itself is inert.
--
-- Namespaced fixture UUIDs (b0f1…). begin/rollback; select finish(); AC id leads each description.
begin;
select plan(7);

-- ── Fixtures (owner-inserted, RLS bypassed): a project + a Draft version with line items, activated
-- below so get_project_budget() has an Active version to sum. ─────────────────────────────────────────
insert into organizations (id, name) values
  ('b0f10000-0000-0000-0000-000000000001','AC-BUD-003 No-Flip Org');
insert into auth.users (id, email) values
  ('b0f10000-0000-0000-0000-0000000000a1','fin-noflip@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('b0f10000-0000-0000-0000-0000000000a1','b0f10000-0000-0000-0000-000000000001',
   'Finance NoFlip','fin-noflip@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('b0f10000-0000-0000-0000-0000000000c1','b0f10000-0000-0000-0000-000000000001','NoFlip Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('b0f10000-0000-0000-0000-0000000000d1','b0f10000-0000-0000-0000-000000000001',
   'b0f10000-0000-0000-0000-0000000000c1',1,'v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('b0f10000-0000-0000-0000-000000000001','b0f10000-0000-0000-0000-0000000000d1','Labor','Team',600000.00,0),
  ('b0f10000-0000-0000-0000-000000000001','b0f10000-0000-0000-0000-0000000000d1','Materials','Steel',400000.00,0);

-- ── (a) EMPLOY ≠ FLIP: a budget ownership row is permitted (the employ signal) and does NOT flip ──────
-- Employ this fixture org's budget domain — the exact prod-reachable signal the P3c feature gates on.
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('b0f10000-0000-0000-0000-000000000001','erpnext','budget')
  on conflict (org_id, external_tier, domain) do nothing;
-- The org is now EMPLOYED for budget (the feature would render)…
select ok(
  public.domain_owned_by_tier('b0f10000-0000-0000-0000-000000000001','budget','erpnext'),
  'AC-BUD-003: a budget ownership row is the permitted EMPLOY signal (Posture B) — the feature-gate the '
  'UI panel + get_budget_projection require');
-- …yet that employ does NOT flip authority: get_project_budget still sums the Active version (PMO SoT),
-- proven for THIS employed org below in (d), and no flip policy/trigger exists (b)/(c). Employ ≠ flip.

-- ── (b) NO policy on the budget tables references domain_externally_owned ─────────────────────────────
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and tablename in ('budget_versions','budget_line_items')
     and (coalesce(qual,'') || coalesce(with_check,'')) like '%domain_externally_owned%'),
  0,
  'AC-BUD-003: no RLS policy on budget_versions/budget_line_items references domain_externally_owned (unflipped RLS)');

-- ── (b-contrast) the probe DISCRIMINATES: companies IS flipped (0097) and its policy DOES reference it ─
select cmp_ok(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and tablename = 'companies'
     and (coalesce(qual,'') || coalesce(with_check,'')) like '%domain_externally_owned%'),
  '>', 0,
  'AC-BUD-003: (probe discriminates) a genuinely-flipped domain (companies) DOES reference domain_externally_owned in its RLS');

-- ── (c) NO *_native_mirror_guard trigger exists on the budget tables ─────────────────────────────────
select is(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('budget_versions','budget_line_items')
     and t.tgname like '%native_mirror_guard%'),
  0,
  'AC-BUD-003: no *_native_mirror_guard trigger exists on budget_versions/budget_line_items (Posture A mechanism absent)');

-- ── (c-contrast) the probe DISCRIMINATES: a flipped table (companies) HAS a native_mirror_guard ──────
select cmp_ok(
  (select count(*)::int from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'companies'
     and t.tgname like '%native_mirror_guard%'),
  '>', 0,
  'AC-BUD-003: (probe discriminates) a genuinely-flipped table (companies) DOES carry a *_native_mirror_guard trigger');

-- ── (d) get_project_budget() = Σ the Active version's line items — PMO is the authority ──────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0f10000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select activate_budget_version('b0f10000-0000-0000-0000-0000000000d1') $$,
  'AC-BUD-003: a Finance user activates a budget version under the shipped OD-BUDGET-3 gate (RLS unflipped, still writable)');
select is(
  get_project_budget('b0f10000-0000-0000-0000-0000000000c1'),
  1000000.00::numeric,
  'AC-BUD-003: get_project_budget() = Σ the Active version line items (600000 + 400000) — PMO is the authority, not an ERP read-back');
reset role;

select finish();
rollback;
