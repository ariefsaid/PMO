-- budget_no_flip_invariant.test.sql — AC-BUD-003 (spec §7/§8, FR-BUD-006 / FR-BUD-007).
--
-- ⚑ THE INVARIANT (the owner's one-authority ruling made STRUCTURAL): budget is Posture B — PMO is SoT
-- and there is NO RLS FLIP. ADR-0055 §6 + ADR-0059 §7 assign `budget` to PMO; a future migration that
-- tried to flip `budget` to external ownership (as P2/P3a/P3b legitimately flip companies / procurement /
-- timesheets) must FAIL this test. Concretely and checkably (spec §8 AC-BUD-003 THEN):
--   (a) NO `external_domain_ownership` row for domain 'budget' exists;
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

-- ── (a) NO external_domain_ownership row flips 'budget' — assert budget's ABSENCE positively ──────────
select is(
  (select count(*)::int from external_domain_ownership where domain = 'budget'),
  0,
  'AC-BUD-003: no external_domain_ownership row assigns the budget domain to any external tier (no flip)');

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
