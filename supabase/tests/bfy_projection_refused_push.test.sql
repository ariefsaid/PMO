-- bfy_projection_refused_push.test.sql (BFY T8) — OWNS AC-BFY-013 (FR-BFY-050). Closes FR-BUD-152.
--
-- ⚑ THE FACT UNDER TEST: **F-C** — PMO's OWN Active line items name this fiscal year. A phased year's
-- budget is stated from PMO's own facts REGARDLESS OF PUSH HEALTH. 0149 could only answer "which year
-- is this budget filed under?" from the ERP mirror, so a project whose push was REFUSED had its own
-- budget suppressed on a year with real GL actuals (FR-BUD-152). Once a line carries a fiscal year,
-- PMO has its own in-database answer and does not need ERP's permission to state it.
--
-- ⚑ AND THE FENCE (spec §1.1): the refused variant below carries a `failed` mirror row — the state the
-- SHIPPED refusal writer actually produces (`recordBudgetGateFailure` stamps `push_state='failed'` with
-- the fiscal year on a multi-FY rejection). Round 1's spec assumed "a refused push leaves NO mirror
-- row"; that premise was false, and it is why the round-1 predicate (`exists(mirror row)`) was wrong.
-- So this file seeds the REAL, CHECK-valid, writer-producible state, not the fictional absence — and
-- the never-dispatched variant (genuinely no row) is asserted BESIDE it.
--
-- ⚑ HOW `on_record` IS OBSERVED. It is not an OUT column, so it is read through the one behaviour that
-- distinguishes it: a category with actuals but NO budget line prints `-EAC` ("every cent spent here is
-- unbudgeted") only when the year IS on record, and NULL otherwise (0149's HIGH-1 branch). A `-EAC` on
-- Materials therefore PROVES `on_record` is true — and the never-dispatched variant proves it came
-- from F-C, because that project has no mirror row of any kind to have come from.
--
-- Mutations: (a) make `on_record` bare mirror existence (F-B) → the never-dispatched variant's
-- Materials variance goes NULL → red; (b) make the phased sum depend on push health → the refused
-- variant's Labor budget goes NULL → red.
begin;
select plan(8);

insert into organizations (id, name) values
  ('0bf80000-0000-0000-0000-000000000001','BFY refused-push Org A');
insert into auth.users (id, email) values
  ('0bf80000-0000-0000-0000-0000000000a1','bfy-rp-admin@example.com'),
  ('0bf80000-0000-0000-0000-0000000000a2','bfy-rp-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bf80000-0000-0000-0000-0000000000a1','0bf80000-0000-0000-0000-000000000001','A Admin','bfy-rp-admin@example.com','Admin','active'),
  ('0bf80000-0000-0000-0000-0000000000a2','0bf80000-0000-0000-0000-000000000001','A Finance','bfy-rp-finance@example.com','Finance','active');

-- TWO projects with the IDENTICAL PMO-side shape, differing ONLY in push history. Both span two client
-- fiscal years (Jul–Jun client: 2025-2026 and 2026-2027 — named here '2026'/'2027' for brevity, since
-- the name is opaque client data either way).
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bf81111-0000-0000-0000-000000000001','0bf80000-0000-0000-0000-000000000001','BFY Refused Push','Ongoing Project',date '2025-08-01',date '2027-03-31'),
  ('0bf81111-0000-0000-0000-000000000002','0bf80000-0000-0000-0000-000000000001','BFY Never Dispatched','Ongoing Project',date '2025-08-01',date '2027-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bf82222-0000-0000-0000-000000000001','0bf80000-0000-0000-0000-000000000001','0bf81111-0000-0000-0000-000000000001',1,'Phased v1','Draft'),
  ('0bf82222-0000-0000-0000-000000000002','0bf80000-0000-0000-0000-000000000001','0bf81111-0000-0000-0000-000000000002',1,'Phased v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bf80000-0000-0000-0000-000000000001','0bf82222-0000-0000-0000-000000000001','Labor','Year-1 crew',90000.00,0,'2026'),
  ('0bf80000-0000-0000-0000-000000000001','0bf82222-0000-0000-0000-000000000002','Labor','Year-1 crew',90000.00,0,'2026');
update budget_versions set status = 'Active', activated_at = now()
 where id in ('0bf82222-0000-0000-0000-000000000001','0bf82222-0000-0000-0000-000000000002');

-- ⚑ THE REFUSAL, in the shape production writes it. `recordBudgetGateFailure` (adapter-dispatch) inserts
-- exactly this row when the gate refuses: push_state='failed' (CHECK-valid, 0137), the classified error
-- code, and the fiscal year the rejection named. ERP holds NOTHING for this project.
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error) values
  ('0bf80000-0000-0000-0000-000000000001','0bf82222-0000-0000-0000-000000000001','2026','failed','budget-multi-fiscal-year-unphased');
-- Project 2 was NEVER dispatched: no mirror row at all.

-- ERP GL truth for BOTH projects in FY '2026' (one generation, as a real sweep pass writes it).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bf80000-0000-0000-0000-000000000001','0bf81111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',10000.00,0,10000.00,'0bf85555-0000-0000-0000-000000000001'),
  ('0bf80000-0000-0000-0000-000000000001','0bf81111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',4000.00,0,4000.00,'0bf85555-0000-0000-0000-000000000001'),
  ('0bf80000-0000-0000-0000-000000000001','0bf81111-0000-0000-0000-000000000002','5100 - Direct Costs - PSC','2026',10000.00,0,10000.00,'0bf85555-0000-0000-0000-000000000001'),
  ('0bf80000-0000-0000-0000-000000000001','0bf81111-0000-0000-0000-000000000002','5200 - Materials - PSC','2026',4000.00,0,4000.00,'0bf85555-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bf80000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'), ('Materials','5200 - Materials - PSC');
set local request.jwt.claims = '{"sub":"0bf80000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── VARIANT A — the push was REFUSED (a real `failed` mirror row exists for FY2026) ──────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bf81111-0000-0000-0000-000000000001','2026') where category='Labor'),
  90000.00::numeric,
  'AC-BFY-013 [F-C] a PHASED year states PMO''s own budget even though the push was REFUSED — closing FR-BUD-152');

select is(
  (select projected_variance from public.get_budget_projection('0bf81111-0000-0000-0000-000000000001','2026') where category='Labor'),
  80000.00::numeric,
  'AC-BFY-013 [F-C] and the variance derived from it is stated in full (90000 − 10000 spent)');

-- Materials has actuals and NO line: `-EAC` here is only honest when the YEAR is on record, so it is
-- the observable proof that `on_record` is true.
select is(
  (select projected_variance from public.get_budget_projection('0bf81111-0000-0000-0000-000000000001','2026') where category='Materials'),
  -4000.00::numeric,
  'AC-BFY-013 [F-C] on_record is TRUE for the phased year — an unbudgeted category''s spend prints -EAC');

-- ── VARIANT B — the push was NEVER DISPATCHED (no mirror row of ANY kind) ────────────────────────
-- This is the variant that kills the round-1 predicate: there is no mirror row to be "existent".
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bf81111-0000-0000-0000-000000000002','2026') where category='Labor'),
  90000.00::numeric,
  'AC-BFY-013 [F-C] a never-dispatched phased year states its budget too — no mirror row is consulted at all');

select is(
  (select projected_variance from public.get_budget_projection('0bf81111-0000-0000-0000-000000000002','2026') where category='Labor'),
  80000.00::numeric,
  'AC-BFY-013 [F-C] never-dispatched: the variance is stated in full');

select is(
  (select projected_variance from public.get_budget_projection('0bf81111-0000-0000-0000-000000000002','2026') where category='Materials'),
  -4000.00::numeric,
  'AC-BFY-013 [F-C] never-dispatched: on_record is TRUE via the PHASED LINE ALONE (mutation: a bare-mirror-existence predicate would NULL this)');

-- The two variants are byte-identical on every money column — push health is NOT an input to PMO's own
-- budget figure. Asserted as one comparison so a divergence anywhere in the grid fails.
select results_eq(
  $$select category::text, pmo_budget_amount, actuals_to_date, pmo_etc, projected_final_cost, projected_variance, projected_utilization
      from public.get_budget_projection('0bf81111-0000-0000-0000-000000000001','2026') order by category::text$$,
  $$select category::text, pmo_budget_amount, actuals_to_date, pmo_etc, projected_final_cost, projected_variance, projected_utilization
      from public.get_budget_projection('0bf81111-0000-0000-0000-000000000002','2026') order by category::text$$,
  'AC-BFY-013 [F-C] the refused and never-dispatched projects project IDENTICALLY — the ERP mirror is not an input to PMO''s own budget');

-- …and the fence holds in the other direction: the `failed` row did not put FY2027 on record either.
select is(
  (select count(*)::int from public.get_budget_projection('0bf81111-0000-0000-0000-000000000001','2027')),
  0,
  'AC-BFY-013 [F-B excluded] the FY2026 `failed` row makes no claim about FY2027 — no budget, no actuals, no row');

select finish();
rollback;
