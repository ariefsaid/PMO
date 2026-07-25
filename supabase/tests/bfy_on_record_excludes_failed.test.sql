-- bfy_on_record_excludes_failed.test.sql (BFY T8) — OWNS AC-BFY-024 (FR-BFY-050, 052).
--
-- ⚑ THE FACT UNDER TEST: `on_record` = **F-C ∨ F-A**, and explicitly **NOT F-B**. A year whose ONLY
-- mirror row is `failed` means PMO tried and ERP holds NOTHING for it. Counting that as "PMO has a
-- budget on record" is round-1 finding 1, and its most expensive consequence is not the budget column
-- at all — it is `-EAC`: 0149 prints `-(actuals + etc)` for a category with no budget line WHEN the
-- year is on record, i.e. it asserts "every cent spent here is unbudgeted". Against a year PMO merely
-- FAILED to file, that is a confident accusation derived from a failure.
--
-- This file asserts the predicate in BOTH directions on ONE fixture, changing exactly one byte of
-- state: `push_state` 'failed' → 'pushed'. Nothing else moves. So a predicate that ignores `push_state`
-- cannot satisfy both halves.
--
-- Mutation: include F-B in `on_record` and the `failed` half's variance becomes -6000 → red.
begin;
select plan(8);

insert into organizations (id, name) values
  ('0bfa0000-0000-0000-0000-000000000001','BFY on-record Org A');
insert into auth.users (id, email) values
  ('0bfa0000-0000-0000-0000-0000000000a1','bfy-or-admin@example.com'),
  ('0bfa0000-0000-0000-0000-0000000000a2','bfy-or-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfa0000-0000-0000-0000-0000000000a1','0bfa0000-0000-0000-0000-000000000001','A Admin','bfy-or-admin@example.com','Admin','active'),
  ('0bfa0000-0000-0000-0000-0000000000a2','0bfa0000-0000-0000-0000-000000000001','A Finance','bfy-or-finance@example.com','Finance','active');

-- A SINGLE-fiscal-year project whose budget is entirely un-phased (the ordinary pre-this-issue shape),
-- so there is NO F-C anywhere: the only thing that could put FY2026 on record is the mirror row.
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfa1111-0000-0000-0000-000000000001','0bfa0000-0000-0000-0000-000000000001','BFY Failed Only','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfa2222-0000-0000-0000-000000000001','0bfa0000-0000-0000-0000-000000000001','0bfa1111-0000-0000-0000-000000000001',1,'Un-phased v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bfa0000-0000-0000-0000-000000000001','0bfa2222-0000-0000-0000-000000000001','Labor','Crew',30000.00,0,null);
update budget_versions set status='Active', activated_at=now() where id='0bfa2222-0000-0000-0000-000000000001';

-- The ONLY mirror row is a FAILURE: PMO attempted FY2026 and ERP enforces nothing.
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error) values
  ('0bfa0000-0000-0000-0000-000000000001','0bfa2222-0000-0000-0000-000000000001','2026','failed','external-unreachable');

-- 'Equipment' spends in FY2026 and has NO budget line — the category `-EAC` speaks about.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bfa0000-0000-0000-0000-000000000001','0bfa1111-0000-0000-0000-000000000001','5300 - Equipment - PSC','2026',6000.00,0,6000.00,'0bfa5555-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfa0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'), ('Equipment','5300 - Equipment - PSC');
set local request.jwt.claims = '{"sub":"0bfa0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── HALF 1 — `failed` only ⇒ NOT on record ──────────────────────────────────────────────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-024 [NOT F-B] a year whose only mirror row is `failed` states NO budget — the un-phased line attributes nowhere');

select is(
  (select projected_variance from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  null,
  'AC-BFY-024 [NOT F-B] …and an unbudgeted category''s spend prints NO variance — never -EAC off the back of a FAILURE');

select is(
  (select projected_utilization from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  null,
  'AC-BFY-024 [NOT F-B] …and no utilization');

select is(
  (select actuals_to_date from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  6000.00::numeric,
  'AC-BFY-024 the ERP actuals are STILL stated — excluding F-B suppresses a budget claim, never a fact');

-- ── HALF 2 — the SAME fixture with the push SUCCEEDED (one byte: 'failed' → 'pushed') ────────────
set local role postgres;
update budget_version_erp_mirror set push_state = 'pushed', push_error = null
 where budget_version_id = '0bfa2222-0000-0000-0000-000000000001' and fiscal_year = '2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfa0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  30000.00::numeric,
  'AC-BFY-024 [F-A] a SUCCESSFUL push puts the year on record — the un-phased budget attributes to it (FR-BFY-070 backward compat)');

select is(
  (select attribution_known from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  true,
  'AC-BFY-024 [F-D] …and that attribution is KNOWN');

select is(
  (select projected_variance from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  -6000.00::numeric,
  'AC-BFY-024 [F-A] …and NOW -EAC is honest: the year IS on record and Equipment genuinely has no line');

-- The `held` half of the same class: the sweep parks a mirror row at `held` when it may not re-drive
-- it. ERP holds nothing then either, so `held` is F-B exactly like `failed`.
set local role postgres;
update budget_version_erp_mirror set push_state = 'held', push_error = 'budget-push-attempts-exhausted'
 where budget_version_id = '0bfa2222-0000-0000-0000-000000000001' and fiscal_year = '2026';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfa0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(
  (select projected_variance from public.get_budget_projection('0bfa1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  null,
  'AC-BFY-024 [NOT F-B] `held` is an attempt too — it never puts a year on record');

select finish();
rollback;
