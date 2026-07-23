-- bfy_stale_mirror_after_date_drift.test.sql (BFY, owed item) — OWNS AC-BFY-032 (FR-BFY-057, 053, 055).
--
-- ⚑ THE SCENARIO, AND WHY IT IS ABOUT REAL MONEY. A project ran inside ONE fiscal year, its budget was
-- never phased (every line NULL), and the push SUCCEEDED — so PMO legitimately attributed the whole
-- un-phased budget to that year (F-A + the push-time span witness). Then the project slipped: someone
-- extended `end_date` into a SECOND fiscal year.
--
-- The un-phased lines now belong to… which year? PMO has no basis to say. Splitting them would be an
-- invented accounting allocation (ADR-0048). Leaving them on FY1 would state that the WHOLE budget
-- belongs to a year the work no longer fits in — and then print a confident variance and utilization
-- against it. Both are lies about money; the honest answer is "the attribution is unknown, phase these
-- lines", which is exactly what the mirror's span WITNESS makes detectable: the span recorded at push
-- time no longer matches the project's current span.
--
-- ⚑ NOT A HAND-SEEDED IMPOSSIBLE STATE (the round-2 audit's defect #11). The mirror row here is the
-- state the SHIPPED writer produces: `push_state='pushed'` with `pushed_project_start_date` /
-- `pushed_project_end_date` stamped from the project's dates AS THE GATE READ THEM (FR-BFY-080). The
-- drift is then produced the way production produces it — by updating the PROJECT's dates afterwards,
-- not by writing a witness no push could have written.
--
-- MUTATION (run, not assumed): drop the witness comparison so the NULL lines keep attributing to the
-- recorded year — FY2026 shows the whole 100,000 again and assertions 1, 2, 3, 4 and 8 go red. (9 does
-- not move: `stale_attribution` is the status RPC's own predicate, mutated by its own sibling test.)
-- Split the lines across the two years instead and assertion 6 goes red: a fabricated allocation.
--
-- Structurally unable to see: the live ERP calendar and the sweep replay (the gate/sweep ACs own
-- those), and the SURFACE wording "phase these lines" — owned by `pages/BudgetProjection.test.tsx`,
-- which renders it from the `stale_attribution` flag asserted here.
begin;
select plan(9);

insert into organizations (id, name) values
  ('0bfe1000-0000-0000-0000-000000000001','BFY Drift Org');
insert into auth.users (id, email) values
  ('0bfe1000-0000-0000-0000-0000000000a1','bfy-drift-admin@example.com'),
  ('0bfe1000-0000-0000-0000-0000000000a2','bfy-drift-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfe1000-0000-0000-0000-0000000000a1','0bfe1000-0000-0000-0000-000000000001','Drift Admin','bfy-drift-admin@example.com','Admin','active'),
  ('0bfe1000-0000-0000-0000-0000000000a2','0bfe1000-0000-0000-0000-000000000001','Drift Finance','bfy-drift-finance@example.com','Finance','active');

-- The project AS IT WAS AT PUSH TIME: entirely inside FY2026.
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfe1111-0000-0000-0000-000000000001','0bfe1000-0000-0000-0000-000000000001','BFY Drifting Project','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfe2222-0000-0000-0000-000000000001','0bfe1000-0000-0000-0000-000000000001','0bfe1111-0000-0000-0000-000000000001',1,'Un-phased single-FY','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('0bfe1000-0000-0000-0000-000000000001','0bfe2222-0000-0000-0000-000000000001','Labor','Crew',100000.00,0),
  ('0bfe1000-0000-0000-0000-000000000001','0bfe2222-0000-0000-0000-000000000001','Materials','Steel',40000.00,0);
update budget_versions set status='Active', activated_at=now() where id='0bfe2222-0000-0000-0000-000000000001';

-- The push that SUCCEEDED, with the witness the shipped mirror writer stamps: the project's dates
-- exactly as the gate read them (FR-BFY-080 — a successful push NEVER leaves the witness NULL).
insert into budget_version_erp_mirror
  (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name, pushed_at,
   pushed_project_start_date, pushed_project_end_date) values
  ('0bfe1000-0000-0000-0000-000000000001','0bfe2222-0000-0000-0000-000000000001','2026','pushed','BUDGET-DRIFT-2026',now(),
   date '2025-08-01', date '2026-03-31');

-- Ledger readings for BOTH years, so each year is genuinely comparable and a suppressed budget cannot
-- be mistaken for a missing actual.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bfe1000-0000-0000-0000-000000000001','0bfe1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',30000.00,0,30000.00,'0bfe5555-0000-0000-0000-000000000001'),
  ('0bfe1000-0000-0000-0000-000000000001','0bfe1111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',5000.00,0,5000.00,'0bfe5555-0000-0000-0000-000000000001'),
  ('0bfe1000-0000-0000-0000-000000000001','0bfe1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2027',12000.00,0,12000.00,'0bfe5555-0000-0000-0000-000000000001');

-- ⚑ THE DRIFT — produced the way production produces it: the PROJECT's dates move, months after the
-- push. Nothing about the budget or the mirror row is edited.
update projects set end_date = date '2027-03-31' where id = '0bfe1111-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfe1000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'), ('Materials','5200 - Materials - PSC');
set local request.jwt.claims = '{"sub":"0bfe1000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── FY2026, the recorded year: the un-phased budget is no longer attributable here ───────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-032 after the project''s dates drift into a second year, the un-phased lines STOP attributing to the recorded year — FY2026 states no budget rather than the whole 100,000');

select is(
  (select attribution_known from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  false,
  'AC-BFY-032 …and the projection says WHY: the attribution is known to be unknown (F-D false), not "there is no budget"');

select is(
  (select projected_variance from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-032 no variance is printed against an unknown attribution — not the pre-drift 70,000, and not a confident -EAC');

select is(
  (select projected_utilization from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-032 …and no utilization either');

select is(
  (select projected_final_cost from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  30000.00::numeric,
  'AC-BFY-032 the EAC is still stated in full — it is actuals + ETC and never depended on the budget');

-- ── FY2027, the year the project drifted into: nothing is invented there either ──────────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2027') where category='Labor'),
  null,
  'AC-BFY-032 the lines attribute to NEITHER year — FY2027 gets no share, because a split PMO never authored is an invented allocation (ADR-0048)');

select is(
  (select projected_variance from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2027') where category='Labor'),
  null,
  'AC-BFY-032 …and FY2027 derives no variance from a budget it does not have (the year is not on record — not -EAC)');

-- ── the second category behaves identically — this is a project-level fact, not a category quirk ─
select is(
  (select attribution_known from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2026') where category='Materials'),
  false,
  'AC-BFY-032 every category whose only lines are un-phased is suppressed alike — the drift is a fact about the project, not one category');

-- ── the status surface can EXPLAIN it: this is not a push failure, it is "phase these lines" ─────
select results_eq(
  $$select fiscal_year, push_state, stale_attribution
      from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001')$$,
  $$values ('2026'::text, 'pushed'::text, true)$$,
  'AC-BFY-032 the push is still recorded as SUCCEEDED — what changed is stale_attribution, the flag the surface renders as "phase these lines" (an author action, never a retry)');

select finish();
rollback;
