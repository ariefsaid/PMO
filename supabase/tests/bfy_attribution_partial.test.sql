-- bfy_attribution_partial.test.sql (BFY T8b) — OWNS AC-BFY-023b (FR-BFY-054/055). BLOCK 2, FU-2 round 2.
--
-- ⚑ THE FACT UNDER TEST: **F-D is a CONJUNCTION**. `attribution_known` used to be `bool_or` alone —
-- "TRUE iff at least ONE of this category's lines is attributed here" — while the amount is a
-- `filter`ed SUM over the same predicate. A category with BOTH an attributed line and a suppressed one
-- therefore reported a CONFIDENT, PARTIAL total:
--
--   single-FY project, push REFUSED (`budget-category-unmapped` — the shipped, common blocker):
--     Labor $100,000 phased to '2026'  +  Labor $50,000 un-phased
--   ⇒ on_record TRUE via F-C (the phased line names the year), `attributed_null` EMPTY (it needs F-A, a
--     SUCCESSFUL push), so the sum counted only the phased line and `bool_or` said "known".
--   ⇒ the primary money screen STATED $100,000 where PMO holds $150,000, with a variance $50,000 too
--     negative, NO unavailability marker, and `stale_attribution` false (no pushed row) so the
--     FR-BFY-056 explanation never fired. The money-honesty fence, defeated WITHIN one category.
--
-- ⚑ AND THE BEHAVIOUR THAT MUST SURVIVE THE FIX (the Director's ruling, spec §6.2). A category ALL of
-- whose lines are phased to ANOTHER year is ALSO `attribution_known = false`, deliberately — but that
-- FALSE means something entirely different: the fact is fully KNOWN ("budgeted in FY2027"), PMO just
-- refuses to print `-EAC` for an ordinary timing difference. The surface tells the two apart from PMO's
-- own phased years (`fetchActiveBudgetCategoryYears`), so the RPC must keep answering FALSE there —
-- narrowing F-D must not accidentally turn that into TRUE, and must not suppress a category merely
-- because a SIBLING line is phased to a different year.
--
-- Mutations: (a) drop the `bool_and` conjunct → project A prints $100,000 of a $150,000 budget → red;
-- (b) state the amount anyway when the attribution is unknown → A's amount assertion red; (c) let a
-- phased-elsewhere line count as "suppressed" → B's Materials goes NULL → red; (d) make the
-- all-phased-elsewhere case TRUE → B's Subcontractors prints -EAC → red.
begin;
select plan(11);

insert into organizations (id, name) values
  ('0bfc0000-0000-0000-0000-000000000001','BFY partial-attribution Org A');
insert into auth.users (id, email) values
  ('0bfc0000-0000-0000-0000-0000000000a1','bfy-ap-admin@example.com'),
  ('0bfc0000-0000-0000-0000-0000000000a2','bfy-ap-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfc0000-0000-0000-0000-0000000000a1','0bfc0000-0000-0000-0000-000000000001','A Admin','bfy-ap-admin@example.com','Admin','active'),
  ('0bfc0000-0000-0000-0000-0000000000a2','0bfc0000-0000-0000-0000-000000000001','A Finance','bfy-ap-finance@example.com','Finance','active');

-- ── PROJECT A — SINGLE fiscal year, a MIXED category, and a REFUSED push ─────────────────────────
-- 2025-08-01 → 2026-03-31 is one Jul–Jun year, so `buildPlan`'s single-FY branch permits the un-phased
-- line beside the phased one (it refuses only a line phased to a DIFFERENT year).
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfc1111-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','BFY Partly Attributable','Ongoing Project',date '2025-08-01',date '2026-03-31'),
-- ── PROJECT B — MULTI fiscal year, every line PHASED, never dispatched ───────────────────────────
  ('0bfc1111-0000-0000-0000-000000000002','0bfc0000-0000-0000-0000-000000000001','BFY Phased Elsewhere','Ongoing Project',date '2025-08-01',date '2027-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfc2222-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001',1,'Mixed v1','Draft'),
  ('0bfc2222-0000-0000-0000-000000000002','0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000002',1,'Phased v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  -- A: the review's repro, verbatim.
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','Labor','Phased crew',100000.00,0,'2026'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','Labor','Un-phased crew',50000.00,0,null),
  -- B: a category budgeted ENTIRELY in another year, and one budgeted across BOTH years.
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000002','Subcontractors','Year-2 subcontract',70000.00,0,'2027'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000002','Materials','Year-1 steel',60000.00,0,'2026'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000002','Materials','Year-2 steel',30000.00,0,'2027');
update budget_versions set status = 'Active', activated_at = now()
 where id in ('0bfc2222-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000002');

-- ⚑ THE REFUSAL in the shape production writes it (`recordBudgetGateFailure`): `push_state='failed'`
-- with the classified code and the year the rejection named. NOTHING was pushed, so there is no F-A
-- record of which year the un-phased line belongs to — `attributed_null` is empty.
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error) values
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','2026','failed','budget-category-unmapped');

-- FY2026 ledger for both projects (one snapshot generation, as a real sweep pass writes it).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',30000.00,0,30000.00,'0bfc5555-0000-0000-0000-000000000001'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000002','5200 - Materials - PSC','2026',20000.00,0,20000.00,'0bfc5555-0000-0000-0000-000000000001'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000002','5400 - Subcontract - PSC','2026',5000.00,0,5000.00,'0bfc5555-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfc0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'), ('Materials','5200 - Materials - PSC'), ('Subcontractors','5400 - Subcontract - PSC');
set local request.jwt.claims = '{"sub":"0bfc0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── A — the PARTLY attributable category ─────────────────────────────────────────────────────────
select is(
  (select attribution_known from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  false,
  'AC-BFY-023b [BLOCK 2] a category with an attributed line AND a suppressed one is NOT attribution_known — F-D is a conjunction, not bool_or');
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-023b [BLOCK 2] …and the AMOUNT is withheld — never $100,000 stated as fact where PMO holds $150,000');
select is(
  (select projected_variance from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-023b [BLOCK 2] …no variance either — the $50,000-too-negative figure is the money defect itself');
select is(
  (select projected_utilization from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-023b [BLOCK 2] …and no utilization against a partial total');
select is(
  (select projected_final_cost from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  30000.00::numeric,
  'AC-BFY-023b the EAC is untouched — actuals + ETC never depended on the budget');

-- ── B — the ALL-PHASED-ELSEWHERE category: the deliberate FALSE that must SURVIVE ────────────────
select is(
  (select attribution_known from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000002','2026') where category='Subcontractors'),
  false,
  'AC-BFY-023b [preserved] a category budgeted ENTIRELY in FY2027 still answers FALSE for FY2026 — the Director''s ruling, spec §6.2');
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000002','2026') where category='Subcontractors'),
  null,
  'AC-BFY-023b [preserved] …with no FY2026 amount (its $70,000 belongs to FY2027)');
select is(
  (select projected_variance from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000002','2026') where category='Subcontractors'),
  null,
  'AC-BFY-023b [preserved] …and never -EAC: spend landing in FY2026 against FY2027 work is a timing difference, not an overspend');
-- The surface renders THAT false as "budgeted in 2027" rather than "unavailable", from PMO's own phased
-- years — this row is the datum it reads (`fetchActiveBudgetCategoryYears`; the sentence itself is owned
-- by `BudgetProjection.test.tsx`).
select is(
  (select array_agg(distinct li.fiscal_year order by li.fiscal_year)
     from public.budget_line_items li
     join public.budget_versions v on v.id = li.budget_version_id
    where v.project_id = '0bfc1111-0000-0000-0000-000000000002' and v.status = 'Active'
      and li.category = 'Subcontractors' and li.fiscal_year is not null),
  array['2027']::text[],
  'AC-BFY-023b [preserved] …because PMO''s OWN lines name the year to look at — a knowable fact, never an "unavailable"');

-- …and a category with a sibling line in ANOTHER year is not suppressed by it: a phased line is
-- knowably somewhere, so it suppresses nothing. Only the year-scoping applies.
select is(
  (select attribution_known from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000002','2026') where category='Materials'),
  true,
  'AC-BFY-023b [no over-suppression] a category phased across BOTH years is still KNOWN for FY2026 — bool_and must not treat "elsewhere" as "unplaceable"');
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000002','2026') where category='Materials'),
  60000.00::numeric,
  'AC-BFY-023b [no over-suppression] …stating exactly the FY2026 half — the year-scoping is unchanged');

select finish();
rollback;
