-- budget_projection_rpc.test.sql (P3c slice 6) — OWNS AC-BUD-053.
-- get_budget_projection(project_id, fiscal_year): PMO's FORWARD VIEW (FR-BUD-151/153), org-scoped under
-- the CALLER'S RLS (SECURITY INVOKER), at PMO grain (category), derived on read, never stored. The RPC's
-- SQL `numeric` arithmetic must match the unit oracle (src/lib/budget/budgetProjection.ts) exactly —
-- AC-BUD-050/051 and this file assert the SAME numbers. Inline fixture idiom (set local role +
-- request.jwt.claims), modelled on budget_version_activated_at.test.sql / budget_category_account_map_rls
-- .test.sql. Namespaced 0b3e UUIDs (valid hex, not seed-colliding).
--
-- ⚑ THE MONEY-HONESTY INVARIANT (audit round 6 + rendered re-verification, 2026-07-22).
-- The same class has now been found at three scopes — project (f9b48500), category (93827008) and
-- fiscal-year/never-synced (this round). It is pinned here as ONE rule, asserted per INPUT rather than
-- per symptom:
--
--     A money figure may be rendered only when its INPUTS ARE KNOWN. Otherwise it is NULL —
--     "unobtainable" — and every figure derived from it is NULL too. `0` is a CLAIM, and PMO may only
--     make it when it actually looked.
--
-- `get_budget_projection` has exactly three money inputs, and each has exactly one knowability test:
--     pmo_budget_amount  KNOWN ⇔ the ACTIVE version is ON RECORD as covering p_fiscal_year
--                                (budget_version_erp_mirror.fiscal_year — the only in-DB authority for
--                                "which year was this budget filed under"; budget_versions has no year
--                                column and OQ-BUD-3 defers giving it one, so none is invented).
--     actuals_to_date    KNOWN ⇔ the category has a mapped ERP account (C-1) AND the ERP ledger has
--                                been READ for this (project, fiscal_year) at all (`actuals_as_of`).
--     pmo_etc            ALWAYS KNOWN (PMO authors it; an absent row is a real 0).
-- Each of the three is asserted below in BOTH directions — unknown ⇒ NULL everywhere downstream, and
-- known ⇒ the real figure — so a FOURTH scope of this class cannot be added without failing here.
--
begin;
select plan(50);

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
--
-- ⚑ HIGH-1 (audit round 10) — ONE `snapshot_id` FOR THE WHOLE FIXTURE, DELIBERATELY. Every snapshot
-- row this file seeds used to carry its own `gen_random_uuid()`, which modelled a state production
-- cannot produce: `erp_actuals_snapshot` is GENERATIONAL, and a sweep pass publishes exactly one
-- `snapshot_id` per org (atomically, since 0150). Seeding a fresh id per row meant no two rows ever
-- shared a generation — so the RPC's total blindness to `snapshot_id` (it summed ACROSS generations,
-- doubling a category's ERP spend) could not be exercised in either direction by any assertion here.
-- The real two-generation case is owned by erp_snapshot_generation_honesty.test.sql; this file now
-- models the shape production actually writes.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',40000.00,0,40000.00,'0b3e5555-0000-0000-0000-000000000001'),
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',500.00,0,500.00,'0b3e5555-0000-0000-0000-000000000001');

-- ⚑ HIGH-1 (audit round 6) — the ACTIVE version is ON RECORD as covering FY '2026'.
-- `budget_versions` carries no fiscal year of its own (OQ-BUD-3 defers giving it one), so the ONLY
-- in-DB authority for "which year was this budget filed under" is the year it was actually pushed for.
-- Without this row the budget column is honestly unknowable for every year — see the wrong-year and
-- never-pushed assertions further down, which delete it on purpose.
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000001','2026','pushed');

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
-- The whole point of this state is that NO mirror row exists — drop the on-record row the fixture
-- staged above (it is re-inserted a few assertions below, which restores FY '2026' as on-record).
delete from budget_version_erp_mirror where budget_version_id = '0b3e2222-0000-0000-0000-000000000001';
update budget_versions set activated_at = now() where id = '0b3e2222-0000-0000-0000-000000000001';
insert into external_domain_ownership (org_id, domain, external_tier)
  values ('0b3e0000-0000-0000-0000-000000000001','budget','erpnext');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ⚑ C-3/C-5 (rendered Discover pass, 2026-07-22): the push state moved OUT of `get_budget_projection`
-- into its own PROJECT-GRAINED function. It was never a property of a category cell — the component's
-- own comment said so ("one banner per project, not per category") and read it off `rows[0]`, which
-- made the alarm hostage to the money grid having rows at all. It must survive the grid being empty
-- (C-3 makes the empty grid REACHABLE), and it carries facts the cell grain has no room for
-- (`erp_budget_name`, the year the push covers).
select has_function('public','get_budget_push_status', array['uuid'], 'C-5 the push-status read exists at PROJECT grain');
select is(p.prosecdef, false, 'C-5 SECURITY INVOKER (org isolation comes from the underlying tables'' RLS)')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_budget_push_status';

select is(
  (select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
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
  (select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
  'failed',
  'HIGH-C a recorded push state always wins over the never-pushed inference');

-- ── NEW-6 (audit round 4, 2026-07-22): `unmapped_categories` was WRITE-ONLY ──────────────────────
-- `recordBudgetGateFailure` (adapter-dispatch) persists the NAMES of the categories that blocked the
-- push — FR-BUD-113 collected them precisely so the operator gets a to-do list, not just a red banner.
-- The read RPC returned only `push_state`/`push_error`, so the screen could render nothing but the bare
-- code `budget-category-unmapped` and the actionable names were never read by anything, ever.
-- The CODE stays in `push_error` (other logic matches on it); the NAMES ride alongside.
select is(
  (select unmapped_categories from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
  array['Materials','Subcontract']::text[],
  'NEW-6 the RPC returns the recorded unmapped_categories so the operator can be told WHICH categories to map');

select is(
  (select push_error from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
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
  (select unmapped_categories from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
  null,
  'NEW-6 a failure with no unmapped categories reports NULL, not a fabricated empty list');

-- Restore the fixture the following HIGH-C assertions were written against.
set local role postgres;
update budget_version_erp_mirror set push_error = 'budget-category-unmapped'
  where budget_version_id = '0b3e2222-0000-0000-0000-000000000001' and fiscal_year = '2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ⚑ CONTRACT CHANGE (rendered Discover pass, C-5). The alarm used to be scoped to the fiscal year the
-- user happened to be LOOKING AT, so a failed push was hidden the moment they changed the selector —
-- the alarm's own visibility was made contingent on an unrelated navigation choice. The push state is a
-- property of the PROJECT'S ACTIVE VERSION, so it is now reported once, project-wide, and NAMES the year
-- it covers (so it is never mistaken for a statement about the year on screen). The original intent —
-- "viewing another year is not a false alarm" — is preserved by that name, not by suppression.
select is(
  (select fiscal_year from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
  '2026',
  'C-5 the project-wide push status NAMES the fiscal year it covers, rather than hiding on any other year');
select is(
  (select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
  'failed',
  'C-5 a failed push stays visible while the user browses a fiscal year it does not cover');

-- An org that never handed `budget` to ERPNext has nothing to push, so it is never "never-pushed".
set local role postgres;
delete from budget_version_erp_mirror where budget_version_id = '0b3e2222-0000-0000-0000-000000000001';
delete from external_domain_ownership where org_id = '0b3e0000-0000-0000-0000-000000000001' and domain = 'budget';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
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
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000002','5100 - Direct Costs - PSC','2025-2026',400000.00,0,400000.00,'0b3e5555-0000-0000-0000-000000000001');
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error, erp_budget_name) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000002','2025-2026','pushed',null,'BUDGET-2025-2026-0007');
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
  $$select actuals_to_date from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2025-2026') where category='Labor'$$,
  $$values (400000.00::numeric)$$,
  'H-4 read with the CLIENT''S fiscal-year name, the ERP ledger actuals are there');
select results_eq(
  $$select push_state, fiscal_year, erp_budget_name from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000002')$$,
  $$values ('pushed'::text, '2025-2026'::text, 'BUDGET-2025-2026-0007'::text)$$,
  'C-5 a SUCCESSFUL push is reportable — state, the year it covers, and the ERP document it created');

-- The defect's signature, pinned. ⚑ This assertion USED to select `actuals_to_date` alone and assert
-- `0` — the ONE column that was right — on a row it had itself just proved was a wrong-year row, and
-- defended the gap in a comment ("never offerable"). It was green while the wrong-year Budget /
-- Variance / Utilization triple shipped underneath it (audit round 6, HIGH-1). A wrong-year read must
-- now be asserted on EVERY money column, and there is nothing to assert them ON: with no budget filed
-- for that year, no ledger reading for it and no ETC, the row cannot exist at all.
select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2026')), 0,
          'HIGH-1 a synthesized CALENDAR year projects NOTHING — no budget, no actuals, no row to state money on');

-- ⚑ HIGH-1, the concrete failure, reproduced end to end: the wrong-year row IS reachable by an
-- ORDINARY route. One late supplier invoice posts against the project's dimension in the NEXT fiscal
-- year; `list_budget_fiscal_years` unions the actuals' years, so the selector OFFERS that year; the PM
-- picks it to see what posted. Before the fix the grid answered Budget $500,000 / Variance $500,000 /
-- Utilization 0.1% — three false statements about a year that has no budget at all, in tabular-nums
-- beside a correct actual.
set local role postgres;
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000002','5100 - Direct Costs - PSC','2026',12000.00,0,12000.00,'0b3e5555-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0b3e1111-0000-0000-0000-000000000002') order by fiscal_year$$,
  $$values ('2025-2026'::text, true), ('2026'::text, false)$$,
  'HIGH-1 a late GL posting in another fiscal year IS offered by the selector — the wrong-year read is an ordinary route, not a hypothetical');

select results_eq(
  $$select pmo_budget_amount, actuals_to_date, pmo_etc, projected_final_cost, projected_variance, projected_utilization
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2026') where category='Labor'$$,
  $$values (null::numeric, 12000.00::numeric, 0::numeric, 12000.00::numeric, null::numeric, null::numeric)$$,
  'HIGH-1 on a year the ACTIVE version is NOT on record as covering, EVERY budget-derived figure is NULL — the correct actual is still stated');

-- …and the year the version IS on record for still states its budget in full: the guard scopes, it
-- does not suppress.
select results_eq(
  $$select pmo_budget_amount, projected_variance
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000002','2025-2026') where category='Labor'$$,
  $$values (500000.00::numeric, 100000.00::numeric)$$,
  'HIGH-1 the fiscal year the ACTIVE version IS on record for states its budget and variance in full');

set local role postgres;
delete from erp_actuals_snapshot
 where project_id = '0b3e1111-0000-0000-0000-000000000002' and fiscal_year = '2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

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
  (select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000002')),
  'unstamped-activation',
  'H-3 an Active version with NO activation stamp is NAMED as such, never a clean screen');

set local role postgres;
update budget_versions set activated_at = now() where id = '0b3e2222-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000002')),
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
  ('0b3e0000-0000-0000-0000-000000000001', null, '5100 - Direct Costs - PSC','2026',777.00,0,777.00,'0b3e5555-0000-0000-0000-000000000001');
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ C-1 / C-2 (rendered Discover pass, 2026-07-22) — MONEY HONESTY AT CATEGORY SCOPE.
--
-- `f9b48500` fixed "Actuals to date is structurally 0.00" at PROJECT scope. The identical class was
-- still alive one grain down: `coalesce(a.actuals_to_date, 0)` collapsed THREE different facts into one
-- byte-identical `$0` —
--   (a) a real, computed zero (the account is mapped; the GL genuinely holds nothing yet);
--   (b) no GL rows for that account this year; and
--   (c) NO ERP ACCOUNT MAPPED AT ALL, i.e. the figure is UNOBTAINABLE.
-- (a) and (b) are the same statement and are honestly 0. (c) is not a zero — it is an absence of
-- knowledge, and reporting it as 0 also fabricates a full-budget variance and a 0% utilization. Worse,
-- the SAME screen banners the category as unmapped two inches above. It must be NULL, so the surface
-- can render it as unavailable.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role postgres;
insert into projects (id, org_id, name, status) values
  ('0b3e1111-0000-0000-0000-000000000004','0b3e0000-0000-0000-0000-000000000001','AC-BUD Money Honesty','Ongoing Project');
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0b3e2222-0000-0000-0000-000000000004','0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000004',1,'MH Budget','Draft');
-- 'Labor' IS mapped (to 5100) and has NO GL rows for 2026 on this project  -> a REAL zero.
-- 'Equipment' is NOT mapped at all                                          -> UNKNOWABLE.
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000004','Labor','Team',10000.00,0),
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000004','Equipment','Rigs',20000.00,0);
update budget_versions set status='Active', activated_at=now() where id='0b3e2222-0000-0000-0000-000000000004';
-- HIGH-1: the version is on record as covering FY '2026', so its budget column is knowable here.
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000004','2026','pushed');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ NEW-4 (rendered re-verification, 2026-07-22) — MONEY HONESTY AT NEVER-SYNCED SCOPE.
--
-- C-1 asked "is there an ACCOUNT to look at?". It never asked "has anyone LOOKED?". A project whose GL
-- has never been synced has no `erp_actuals_snapshot` row for the (project, fiscal_year) at all — and
-- rendered `$0.00` actuals, a full-budget variance and 0% utilization under a green "Enforced by
-- ERPNext" pill. `as_of` was stored on every snapshot row since 0101 and read by NOTHING, so the
-- operator could not even date the zero.
--
-- The reading is the input, so its presence is the knowability test — and `actuals_as_of` is returned
-- so the surface can both explain the absence and date the presence. Three distinguishable states, not
-- two: unmapped category (C-1) ≠ unread ledger (this) ≠ a real, computed zero.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select results_eq(
  $$select pmo_budget_amount, actuals_to_date, actuals_as_of, projected_final_cost, projected_variance, projected_utilization
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Labor'$$,
  $$values (10000.00::numeric, null::numeric, null::timestamptz, null::numeric, null::numeric, null::numeric)$$,
  'NEW-4 a project-year whose ERP ledger has NEVER been read states NO actuals and NO figure derived from them — the PMO-owned budget is still stated');

-- The ledger is read for this project-year. The reading covers an account this project spends on that
-- no category maps (LOW-2's bucket) — so `Labor` still has no rows of its own, and the ONLY thing that
-- changed is that PMO has now actually looked.
set local role postgres;
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id) values
  ('0b3e0000-0000-0000-0000-000000000001','0b3e1111-0000-0000-0000-000000000004','9100 - Bank - PSC','2026',42.00,0,42.00,
   timestamptz '2026-03-04 09:00:00+00', '0b3e5555-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select actuals_as_of from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Labor'),
  timestamptz '2026-03-04 09:00:00+00',
  'NEW-4 a project-year that HAS been read reports WHEN — the operator can date the figures instead of trusting an undated zero');

select results_eq(
  $$select actuals_to_date, projected_final_cost, projected_variance, projected_utilization
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Labor'$$,
  $$values (0::numeric, 0::numeric, 10000.00::numeric, 0::numeric)$$,
  'C-1 a MAPPED category with no GL rows is a REAL zero — 0.00 spent, full budget remaining, 0% used');

select is(
  (select actuals_to_date from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Equipment'),
  null,
  'C-1 an UNMAPPED category reports NULL actuals — the figure is unobtainable, never a confident 0');

select is(
  (select projected_final_cost from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Equipment'),
  null,
  'C-2 an unobtainable actual propagates: no projected final cost is derivable from it');

select is(
  (select projected_variance from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Equipment'),
  null,
  'C-2 an unmapped category reports NO variance — never "the entire budget is still available"');

select is(
  (select projected_utilization from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Equipment'),
  null,
  'C-2 an unmapped category reports NO utilization — never a confident 0%');

-- The moment the Admin maps it, the same category becomes a real, computed zero. The distinction is
-- the MAP, not the presence of ledger rows.
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values ('Equipment','5300 - Equipment - PSC');
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$select actuals_to_date, projected_utilization
      from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','2026') where category='Equipment'$$,
  $$values (0::numeric, 0::numeric)$$,
  'C-1 mapping the category turns the unobtainable figure into a real, computed zero');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ C-3 — with NO FISCAL YEAR on record the screen rendered a complete, plausible, FABRICATED money
-- grid: the whole PMO budget as "budgeted", $0 spent, 0% utilized, for a project with no ERP linkage
-- whatsoever. The `rows.length === 0` empty state was UNREACHABLE because `pmo_budget` was not
-- year-scoped, so the grid always had rows. This function's entire grain is (project x fiscal year):
-- with no year there is nothing to project, and saying so is the only honest answer.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role postgres;
-- Back to "no push on record at all", so the alarm below is the real never-pushed state again.
delete from budget_version_erp_mirror where budget_version_id = '0b3e2222-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004','')), 0,
          'C-3 with NO fiscal year the projection is EMPTY — the honest empty state, never a fabricated grid');
select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000004',null)), 0,
          'C-3 a NULL fiscal year is the same honest emptiness, not a grid');
-- ...and the alarm still survives it: the push status is project-grained, so C-3's empty grid can never
-- silence a real "ERPNext is enforcing nothing" (the exact trade that made the two findings one fix).
select is((select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000004')),
          'never-pushed',
          'C-3/C-5 an EMPTY projection grid never silences the push alarm — it is read at project grain');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ MEDIUM-1 (money-safety audit round 7) — `push_state='held'` HAS TWO PRODUCERS, AND ONLY ONE LEAVES
-- A RELEASABLE COMMAND. The dispatch's real `command-held` outcome leaves the `external_command_outbox`
-- row `held` (releasing it is the operator's only route out). The SWEEP also parks a mirror row at
-- `held` when it may not re-drive it (`budget-push-attempts-exhausted` /
-- `budget-push-no-outbox-candidate`) — and there the outbox row is `failed`/absent, so there is nothing
-- to release. The mirror row is IDENTICAL in both, so the surface offered "Release the hold" in both and
-- the second could only ever throw, on the screen reporting that ERPNext is enforcing the wrong budget
-- or none. `hold_releasable` is the distinction, asserted here in BOTH directions.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role postgres;
-- (the C-5 block above DELETED this version's mirror row to exercise the never-pushed state, so the
-- sweep-parked hold is INSERTED here rather than updated — an update would match nothing and the
-- assertions below would pass vacuously against 'never-pushed'.)
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error)
  values ('0b3e0000-0000-0000-0000-000000000001','0b3e2222-0000-0000-0000-000000000001','2026',
          'held','budget-push-attempts-exhausted')
  on conflict (org_id, budget_version_id, fiscal_year)
  do update set push_state = excluded.push_state, push_error = excluded.push_error;
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
          'held', 'MEDIUM-1 precondition: the mirror row reads held');
select is((select hold_releasable from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
          false,
          'MEDIUM-1 a SWEEP-PARKED hold is NOT releasable — no held outbox command exists, so the button would only throw');

-- The dispatch's real hold: the outbox row genuinely IS held.
set local role postgres;
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('0b3e0000-0000-0000-0000-000000000001','budget','0b3e2222-0000-0000-0000-000000000001',
          'bud:0b3e2222-0000-0000-0000-000000000001:1','erpnext','create','held');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select hold_releasable from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
          true,
          'MEDIUM-1 a REAL dispatch hold IS releasable — the affordance is narrowed, never removed');

-- A NON-held outbox row for the same version does not make it releasable (only `held` wedges the index).
set local role postgres;
update external_command_outbox set state='failed' where pmo_record_id = '0b3e2222-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select hold_releasable from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
          false,
          'MEDIUM-1 only a `held` outbox row counts — a failed one leaves nothing to release');

-- ── Cross-org: org B''s Finance reads zero rows (RLS, not a hand-rolled org filter) ────────────────
set local request.jwt.claims = '{"sub":"0b3e0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from public.get_budget_projection('0b3e1111-0000-0000-0000-000000000001','2026')), 0,
          'AC-BUD-053 cross-org read returns zero rows (RLS)');
select is((select count(*)::int from public.list_budget_fiscal_years('0b3e1111-0000-0000-0000-000000000002')), 0,
          'H-4 cross-org fiscal-year read returns zero rows (RLS)');
select is((select push_state from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')), null,
          'C-5 cross-org push status leaks nothing — no state, no ERP document name (RLS)');
-- MEDIUM-1: and it never advertises another org's releasable hold either (the outbox read is under the
-- caller's own RLS, so org B cannot even see the row).
select is((select hold_releasable from public.get_budget_push_status('0b3e1111-0000-0000-0000-000000000001')),
          false, 'MEDIUM-1 cross-org: another org''s held command is never reported as releasable (RLS)');

select finish();
rollback;
