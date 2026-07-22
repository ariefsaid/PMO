-- budget_projection_rpc.test.sql (P3c slice 6) — OWNS AC-BUD-053.
-- get_budget_projection(project_id, fiscal_year): PMO's FORWARD VIEW (FR-BUD-151/153), org-scoped under
-- the CALLER'S RLS (SECURITY INVOKER), at PMO grain (category), derived on read, never stored. The RPC's
-- SQL `numeric` arithmetic must match the unit oracle (src/lib/budget/budgetProjection.ts) exactly —
-- AC-BUD-050/051 and this file assert the SAME numbers. Inline fixture idiom (set local role +
-- request.jwt.claims), modelled on budget_version_activated_at.test.sql / budget_category_account_map_rls
-- .test.sql. Namespaced 0b3e UUIDs (valid hex, not seed-colliding).
begin;
select plan(26);

-- ── Fixtures (inserted as table owner, bypassing RLS) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('0b3e0000-0000-0000-0000-000000000001','AC-BUD projection Org A'),
  ('0b3e0000-0000-0000-0000-000000000002','AC-BUD projection Org B');

insert into auth.users (id, email) values
  ('0b3e0000-0000-0000-0000-0000000000a1','proj-admin-a@example.com'),
  ('0b3e0000-0000-0000-0000-0000000000a2','proj-finance-a@example.com'),
  ('0b3e0000-0000-0000-0000-0000000000b1','proj-finance-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('0b3e0000-0000-0000-0000-0000000000a1','0b3e0000-0000-0000-0000-000000000001','A Admin','proj-admin-a@example.com','Admin','active'),
  ('0b3e0000-0000-0000-0000-0000000000a2','0b3e0000-0000-0000-0000-000000000001','A Finance','proj-finance-a@example.com','Finance','active'),
  ('0b3e0000-0000-0000-0000-0000000000b1','0b3e0000-0000-0000-0000-000000000002','B Finance','proj-finance-b@example.com','Finance','active');

insert into projects (id, org_id, name, status) values
  ('0b3e1111-0000-0000-0000-000000000001','0b3e0000-0000-0000-0000-000000000001','AC-BUD Projection Project','Ongoing Project');

-- An Active budget_version for project A with a 'Labor' line of 100000.00 (PMO SoT, OD-BUDGET-1).
-- Line items may only be authored while Draft (the shipped guard) — insert as Draft, THEN flip Active.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0b3e2222-0000-0000-0000-000000000001','0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001',1,'Active Budget','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000001','Labor','Team costs',100000.00,0);
update budget_versions set status = 'Active' where id = '0b3e2222-0000-0000-0000-000000000001';

-- ERP GL actuals on the MAPPED account (P2's shipped ledger-sourced snapshot — machine-written).
-- Both rows inserted here, as table owner: erp_actuals_snapshot has NO insert policy for `authenticated`
-- (machine-only, 0101) — a user-JWT insert of it would itself be a modelling error.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',40000.00,0,40000.00,gen_random_uuid()),
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',500.00,0,500.00,gen_random_uuid());

-- ── Structure: the read RPC exists and is SECURITY INVOKER (RLS is the org filter, not a hand-rolled where) ──
select has_function('public','get_budget_projection', array['uuid','text'], 'AC-BUD-053 the read RPC exists');
select is(p.prosecdef, false, 'AC-BUD-053 SECURITY INVOKER (org isolation comes from the underlying tables'' RLS)')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_budget_projection';

-- ── Admin maps Labor → the account the actuals snapshot uses ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values ('Labor','5100 - Direct Costs - PSC');

-- ── Finance (OD-BUDGET-3) authors a PMO ETC ──────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
  values ('0b3e1111-0000-0000-0000-000000000001','2026','Labor',35000.00);

-- ── The RPC derives EAC/variance matching the unit oracle, at PMO category grain ─────────────────
select results_eq(
  $$select category::text, pmo_budget_amount, actuals_to_date, pmo_etc, projected_final_cost, projected_variance
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')$$,
  $$values ('Labor'::text, 100000.00::numeric, 40000.00::numeric, 35000.00::numeric, 75000.00::numeric, 25000.00::numeric)$$,
  'AC-BUD-053 the RPC derives EAC/variance matching the unit oracle, at PMO category grain');

select is(
  (select projected_utilization from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')
    where category = 'Labor'),
  0.75::numeric,
  'AC-BUD-053 utilization = EAC / pmo_budget_amount (matches AC-BUD-050''s oracle)');

-- ── A category with no ETC and no budget line still surfaces its actuals, never silently dropped ──
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values ('Materials','5200 - Materials - PSC');
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select category::text, pmo_budget_amount, actuals_to_date
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026') where category = 'Materials'$$,
  $$values ('Materials'::text, null::numeric, 500.00::numeric)$$,
  'AC-BUD-053 a category with actuals but no PMO budget line still surfaces (never inner-joined away)');

-- ── HIGH-C (Luna re-audit round 2): an ACTIVE, ACTIVATED version with NO mirror row at all ───────
-- Every writer of `budget_version_erp_mirror` lives inside `adapter-dispatch`. A dispatch that never
-- REACHES the function (dropped connection, tab closed mid-request, platform 502) therefore leaves no
-- row — and the sweep backstop's work queue IS that mirror, so nothing re-drives it. `push_state` came
-- back NULL, which the UI renders as a perfectly clean screen while ERPNext enforces the previous
-- budget (or none) indefinitely. The RPC must name that state.
set local role postgres;
update budget_versions set activated_at = now() where id = '0b3e2222-0000-0000-0000-000000000001';
insert into external_domain_ownership (org_id, domain, external_tier)
  values ('0b3e0000-0000-0000-0000-000000000001','budget','erpnext');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select distinct push_state from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')),
  'never-pushed',
  'HIGH-C an Active+activated version with NO mirror row at all reports never-pushed, not NULL');

-- A REAL mirror row for the fiscal year always wins — the never-pushed state is only ever the absence.
set local role postgres;
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error, unmapped_categories)
  values ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000001','2026','failed','budget-category-unmapped',
          array['Materials','Subcontract']::text[]);
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select distinct push_state from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')),
  'failed',
  'HIGH-C a recorded push state always wins over the never-pushed inference');

-- ── NEW-6 (audit round 4, 2026-07-22): `unmapped_categories` was WRITE-ONLY ──────────────────────
-- `recordBudgetGateFailure` (adapter-dispatch) persists the NAMES of the categories that blocked the
-- push — FR-BUD-113 collected them precisely so the operator gets a to-do list, not just a red banner.
-- The read RPC returned only `push_state`/`push_error`, so the screen could render nothing but the bare
-- code `budget-category-unmapped` and the actionable names were never read by anything, ever.
-- The CODE stays in `push_error` (other logic matches on it); the NAMES ride alongside.
select is(
  (select distinct unmapped_categories from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')),
  array['Materials','Subcontract']::text[],
  'NEW-6 the RPC returns the recorded unmapped_categories so the operator can be told WHICH categories to map');

select is(
  (select distinct push_error from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')),
  'budget-category-unmapped',
  'NEW-6 the machine-matchable CODE is retained in push_error (the names are additive, never a replacement)');

-- A push that failed for a reason unrelated to the map carries NO category names — an honest NULL, never
-- an empty list the UI would have to special-case into "nothing to do".
set local role postgres;
update budget_version_erp_mirror set push_error = 'external-unreachable', unmapped_categories = null
  where budget_version_id = '0b3e2222-0000-0000-0000-000000000001' and fiscal_year = '2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select distinct unmapped_categories from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')),
  null,
  'NEW-6 a failure with no unmapped categories reports NULL, not a fabricated empty list');

-- Restore the fixture the following HIGH-C assertions were written against.
set local role postgres;
update budget_version_erp_mirror set push_error = 'budget-category-unmapped'
  where budget_version_id = '0b3e2222-0000-0000-0000-000000000001' and fiscal_year = '2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- A DIFFERENT fiscal year is NOT "never pushed": the version has a mirror row, just not for this year.
select is(
  (select distinct push_state from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2027')),
  null,
  'HIGH-C a fiscal year the push does not cover stays NULL — never a false alarm');

-- An org that never handed `budget` to ERPNext has nothing to push, so it is never "never-pushed".
set local role postgres;
delete from budget_version_erp_mirror where budget_version_id = '0b3e2222-0000-0000-0000-000000000001';
delete from external_domain_ownership where org_id = '0b3e0000-0000-0000-0000-000000000001' and domain = 'budget';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select distinct push_state from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')),
  null,
  'HIGH-C a NON-employing org never sees a push banner (there is no ERP to push to)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- H-4 (Luna audit round 3) — the fiscal year is the CLIENT'S, and it is READ, never synthesized.
--
-- `fiscal_year` on both `erp_actuals_snapshot` and `budget_version_erp_mirror` carries the ERPNext
-- `Fiscal Year` NAME (the round-2 OQ-BUD-3b ruling: a fiscal year is whatever the client declares).
-- A Jul-Jun client's is named '2025-2026'. A surface that asks for a CALENDAR year ('2026') therefore
-- joins nothing: zero actuals, a NULL push state, and no way to reach the real data — every figure on
-- the primary money screen silently wrong. `list_budget_fiscal_years` is what makes the selector
-- offerable-only-what-exists, for ANY fiscal calendar.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role postgres;
insert into projects (id, org_id, name, status) values
  ('0b3e1111-0000-0000-0000-000000000002','0b3e0000-0000-0000-0000-000000000001','AC-BUD Jul-Jun Project','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0b3e2222-0000-0000-0000-000000000002','0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000002',1,'FY25/26 Budget','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000002','Labor','Team costs',500000.00,0);
update budget_versions set status = 'Active', activated_at = now() where id = '0b3e2222-0000-0000-0000-000000000002';
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000002','5100 - Direct Costs - PSC','2025-2026',400000.00,0,400000.00,gen_random_uuid());
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000002','2025-2026','pushed',null);
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select has_function('public','list_budget_fiscal_years', array['uuid'], 'H-4 the fiscal-year source exists');
select is(p.prosecdef, false, 'H-4 SECURITY INVOKER (org isolation comes from the underlying tables'' RLS)')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='list_budget_fiscal_years';

select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0b3e1111-0000-0000-0000-000000000002')$$,
  $$values ('2025-2026'::text, true)$$,
  'H-4 the offerable fiscal years are the client''s OWN (ERPNext Fiscal Year names), flagging the Active version''s push year');

select results_eq(
  $$select actuals_to_date, push_state
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2025-2026') where category='Labor'$$,
  $$values (400000.00::numeric, 'pushed'::text)$$,
  'H-4 read with the CLIENT''S fiscal-year name, the ERP ledger actuals and the push state are there');

-- The defect's signature, pinned: the calendar year the old UI synthesized joins NOTHING. This is why
-- the selector must never be able to offer it.
select results_eq(
  $$select actuals_to_date, push_state
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2026') where category='Labor'$$,
  $$values (0::numeric, null::text)$$,
  'H-4 a synthesized CALENDAR year returns zero actuals and no push state — never offerable');

set local role postgres;
insert into projects (id, org_id, name, status) values
  ('0b3e1111-0000-0000-0000-000000000003','0b3e0000-0000-0000-0000-000000000001','AC-BUD Fresh Project','Ongoing Project');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.list_budget_fiscal_years('0b3e1111-0000-0000-0000-000000000003')), 0,
          'H-4 a project with no fiscal year on record offers NONE — an honest empty state, not a guess');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- H-3 (Luna audit round 3) — an Active version that carries NO activation stamp.
--
-- `0139` added `activated_at` nullable with no backfill, so every version already Active at migration
-- time has NULL. That version cannot be pushed (`budgetPushKey` AND the server-side budget gate both
-- refuse an unstamped version — correctly: an invented stamp would key a money command on a fiction),
-- and the round-2 `never-pushed` alarm required `activated_at is not null`, so it stayed SILENT: a
-- clean screen while ERPNext enforced nothing at all. Visible-and-honest beats silent-and-clean.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role postgres;
delete from budget_version_erp_mirror where budget_version_id = '0b3e2222-0000-0000-0000-000000000002';
update budget_versions set activated_at = null where id = '0b3e2222-0000-0000-0000-000000000002';
insert into external_domain_ownership (org_id, domain, external_tier)
  values ('0b3e0000-0000-0000-0000-000000000001','budget','erpnext');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select distinct push_state from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2025-2026')),
  'unstamped-activation',
  'H-3 an Active version with NO activation stamp is NAMED as such, never a clean screen');

set local role postgres;
update budget_versions set activated_at = now() where id = '0b3e2222-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select distinct push_state from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2025-2026')),
  'never-pushed',
  'H-3 a STAMPED Active version with no mirror row is the re-drivable never-pushed state (unchanged)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ NEW-1 (Luna audit round 4, 2026-07-22) — THE DIMENSIONS THAT MAKE A SNAPSHOT ROW VISIBLE.
--
-- Every `erp_actuals_snapshot` fixture ABOVE is hand-inserted with a `project_id` and a `fiscal_year`
-- already filled in, so those assertions only ever proved that the RPC joins a WELL-FORMED row. They
-- could not — and did not — notice that the sole production writer of that table (`refreshActuals`,
-- called by `erpnext-sweep`) stamped `project_id` from a caller-supplied scope the sweep always left
-- empty. Every real row therefore carried `project_id = NULL`, this RPC's `s.project_id =
-- p_project_id` never matched, and "Actuals to date" was structurally 0.00 for every project with real
-- posted GL spend — variance = the entire budget, on the primary money screen, silently, through four
-- audit rounds of a green suite.
--
-- pgTAP cannot invoke the TypeScript writer, so it pins the OTHER half of the contract: exactly which
-- row shapes this RPC can and cannot see. The production-shaped (NULL-dimension) row is asserted
-- INVISIBLE here, and the writer that must never produce one is bound by
-- `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.test.ts` +
-- `supabase/functions/erpnext-sweep/actualsProjectAttribution.test.ts` (which drive the shipped code).
-- Together the two layers close the gap that each alone left open.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role postgres;
-- The row exactly as production wrote it BEFORE the fix: right org, right (mapped) account, right
-- fiscal year — and a NULL project dimension.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0b3e0000-0000-0000-0000-000000000001', null, '5100 - Direct Costs - PSC','2026',777.00,0,777.00,gen_random_uuid());
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000003','2026')), 0,
          'NEW-1 a snapshot row with a NULL project_id is INVISIBLE to every project — the defect''s exact DB signature');

-- The identical row, attributed: `project_id` is the load-bearing dimension, so stamping it is the
-- difference between 0.00 and the real spend.
set local role postgres;
update erp_actuals_snapshot set project_id = '0b3e1111-0000-0000-0000-000000000003'
 where org_id = '0b3e0000-0000-0000-0000-000000000001' and net = 777.00;
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select category::text, actuals_to_date
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000003','2026')$$,
  $$values ('Labor'::text, 777.00::numeric)$$,
  'NEW-1 the SAME row, attributed from the GL project dimension, surfaces its real spend');

-- The UNDATED half of the same class: `erp_actuals_snapshot.fiscal_year` is nullable (0101) and both
-- readers match it by EQUALITY, so a GL row whose fiscal year ERPNext never stated is invisible under
-- EVERY year and is never offered as a selectable one. PMO does not own the client's fiscal calendar
-- and must not invent a year for it — so the row keeps its honest NULL, and `erpnext-sweep` raises an
-- `erp-actuals-undated-fiscal-year` action-required instead of the screen quietly under-reporting.
set local role postgres;
update erp_actuals_snapshot set fiscal_year = null
 where org_id = '0b3e0000-0000-0000-0000-000000000001' and net = 777.00;
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000003','2026')), 0,
          'NEW-1 an UNDATED snapshot row (fiscal_year NULL) is invisible under every year — surfaced by the sweep, never guessed');
select is((select count(*)::int from public.list_budget_fiscal_years('0b3e1111-0000-0000-0000-000000000003')), 0,
          'NEW-1 a NULL fiscal year is never OFFERED as a selectable year (it would return nothing)');

set local role postgres;
delete from erp_actuals_snapshot where org_id = '0b3e0000-0000-0000-0000-000000000001' and net = 777.00;
set local role authenticated;

-- ── Cross-org: org B''s Finance reads zero rows (RLS, not a hand-rolled org filter) ────────────────
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')), 0,
          'AC-BUD-053 cross-org read returns zero rows (RLS)');
select is((select count(*)::int from public.list_budget_fiscal_years('0b3e1111-0000-0000-0000-000000000002')), 0,
          'H-4 cross-org fiscal-year read returns zero rows (RLS)');

select finish();
rollback;
