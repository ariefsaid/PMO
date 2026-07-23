-- bfy_backward_compat.test.sql (BFY T21) — OWNS AC-BFY-001/002 (FR-BFY-070, 050).
--
-- ⚑ THE PROMISE THIS FILE KEEPS. Every budget line that exists on the day this ships has
-- `fiscal_year` NULL, and nothing is backfilled (a fabricated year is a false claim about money).
-- So the whole of this feature must be INVISIBLE to a project that has not adopted phasing: an
-- all-NULL Active version whose push SUCCEEDED reads EXACTLY as it did before the issue — same
-- budget total, same per-category budget, same variance, same utilization, same offered year, same
-- single push-status row.
--
-- The fact that carries it (FR-BFY-070): a pre-issue mirror row has a NULL span witness, and §3a's
-- `attributed_null` treats a NULL witness as "no evidence of drift" — so the un-phased lines still
-- attribute to the year that push SUCCEEDED for (F-A), exactly as 0149 attributed them.
--
-- Every expected figure below is derived by hand from the seeded facts, not read back from the RPC:
--   Labor 100,000 + Materials 40,000 = 140,000 budget; Labor actuals 30,000, Materials 5,000; no ETC.
--   ⇒ Labor variance 70,000, utilization 0.30; Materials variance 35,000, EAC 5,000.
--
-- MUTATION: if `pmo_budget` stopped attributing NULL lines via F-A + witness (e.g. it required F-C, a
-- phased line), assertions 2/4/5/6 go red and every pre-issue project silently loses its budget
-- column. If the NULL witness were treated as DRIFT rather than as no-evidence, the same assertions
-- go red plus `attribution_known` (assertion 3).
--
-- Structurally unable to see: live ERP (AC-BFY-011). The rest of the shipped budget suites
-- (0008–0012, 0060, 0075, budget_projection_rpc) are the wider regression net and run unchanged in
-- the same `supabase test db` sweep.
begin;
select plan(9);

insert into organizations (id, name) values
  ('0bfd0000-0000-0000-0000-000000000001','BFY Backward-compat Org');
insert into auth.users (id, email) values
  ('0bfd0000-0000-0000-0000-0000000000a1','bfy-bc-admin@example.com'),
  ('0bfd0000-0000-0000-0000-0000000000a2','bfy-bc-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfd0000-0000-0000-0000-0000000000a1','0bfd0000-0000-0000-0000-000000000001','BC Admin','bfy-bc-admin@example.com','Admin','active'),
  ('0bfd0000-0000-0000-0000-0000000000a2','0bfd0000-0000-0000-0000-000000000001','BC Finance','bfy-bc-finance@example.com','Finance','active');

-- A single-fiscal-year project, exactly as one looked before this issue existed.
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfd1111-0000-0000-0000-000000000001','0bfd0000-0000-0000-0000-000000000001','BFY Pre-issue Project','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfd2222-0000-0000-0000-000000000001','0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000001',1,'Un-phased, as always','Draft');
-- EVERY line un-phased — the day-one population. No fiscal_year is written anywhere.
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000001','Labor','Crew',100000.00,0),
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000001','Materials','Steel',40000.00,0);
update budget_versions set status='Active', activated_at=now() where id='0bfd2222-0000-0000-0000-000000000001';

-- The pre-issue push: it SUCCEEDED (F-A) and — because it happened BEFORE this release — it recorded
-- NO span witness. That NULL is the backward-compatibility fact, not a defect (FR-BFY-070).
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name, pushed_at) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000001','2026','pushed','BUDGET-PRE-2026',now());

insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',30000.00,0,30000.00,'0bfd5555-0000-0000-0000-000000000001'),
  ('0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',5000.00,0,5000.00,'0bfd5555-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'), ('Materials','5200 - Materials - PSC');
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── get_project_budget: Σ the Active version, untouched by the new column ────────────────────────
select is(
  public.get_project_budget('0bfd1111-0000-0000-0000-000000000001'),
  140000.00::numeric,
  'AC-BFY-001 get_project_budget still returns Σ the Active version''s lines — the new column changes no total');

-- ── get_budget_projection: the un-phased lines still land on the year that was pushed ────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  100000.00::numeric,
  'AC-BFY-001 an un-phased line still attributes to the year its push SUCCEEDED for (F-A + NULL witness = pre-issue behaviour)');

select is(
  (select attribution_known from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  true,
  'AC-BFY-001 …and the attribution is KNOWN — a NULL witness is absence of drift evidence, not drift');

select is(
  (select projected_variance from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  70000.00::numeric,
  'AC-BFY-001 the variance is the pre-issue figure, 100,000 − (30,000 + 0)');

select is(
  (select projected_utilization from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  0.30000000000000000000::numeric,
  'AC-BFY-001 …and the utilization is the pre-issue 30,000 / 100,000');

select is(
  (select projected_variance from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Materials'),
  35000.00::numeric,
  'AC-BFY-001 the SECOND category is equally unaffected — 40,000 − (5,000 + 0)');

-- ── list_budget_fiscal_years: the same single year, still flagged as the active push ─────────────
select results_eq(
  $$select fiscal_year, is_active_push from public.list_budget_fiscal_years('0bfd1111-0000-0000-0000-000000000001')$$,
  $$values ('2026'::text, true)$$,
  'AC-BFY-002 list_budget_fiscal_years offers the one pushed year with is_active_push true, exactly as before');

-- ── get_budget_push_status: ONE row, the pre-issue shape ─────────────────────────────────────────
select results_eq(
  $$select fiscal_year, push_state, stale_attribution, hold_releasable
      from public.get_budget_push_status('0bfd1111-0000-0000-0000-000000000001')$$,
  $$values ('2026'::text, 'pushed'::text, false, false)$$,
  'AC-BFY-002 the per-year status collapses to the SINGLE pre-issue row for an un-phased project — one expected year, pushed, nothing stale, nothing held');

select is(
  (select count(*)::int from public.get_budget_push_status('0bfd1111-0000-0000-0000-000000000001')),
  1,
  'AC-BFY-002 …exactly one row — the per-year fan-out never invents a year for a project that has not phased anything');

select finish();
rollback;
