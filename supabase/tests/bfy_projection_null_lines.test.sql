-- bfy_projection_null_lines.test.sql (BFY T8) — OWNS AC-BFY-014 (FR-BFY-010, 052).
--
-- ⚑ THE FACT UNDER TEST: **NOT F-B.** An un-phased (NULL `fiscal_year`) line attributes to a year ONLY
-- via **F-A** — a push that actually SUCCEEDED for that year. A `failed`/`held` row is an ATTEMPT, and
-- an attempt is not an allocation.
--
-- This is review finding 1, reproduced exactly. A multi-FY project with a $90,000 line phased to FY2026
-- and a $50,000 un-phased line is REFUSED by the gate (FR-BFY-010, "phase these lines"), and the shipped
-- refusal writer stamps a `failed` FY2026 mirror row. Round 1's predicate read that row as "PMO has a
-- budget on record for FY2026" and swept the $50,000 in: the screen stated **$140,000 against FY2026**,
-- $50,000 of which PMO had EXPLICITLY REFUSED to allocate to any year — and that false total then fed
-- variance and utilization.
--
-- The honest answer: the $90,000 is stated (F-C), the $50,000 is stated NOWHERE, and FY2027 — which has
-- neither a phased line nor a successful push — reports NULL, never `0`. `0` is a claim.
--
-- Mutation: attribute NULL lines via `on_record` or bare mirror existence instead of F-A, and Materials'
-- FY2026 budget becomes 50000 → assertion 2 red.
begin;
select plan(9);

insert into organizations (id, name) values
  ('0bf90000-0000-0000-0000-000000000001','BFY null-lines Org A');
insert into auth.users (id, email) values
  ('0bf90000-0000-0000-0000-0000000000a1','bfy-nl-admin@example.com'),
  ('0bf90000-0000-0000-0000-0000000000a2','bfy-nl-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bf90000-0000-0000-0000-0000000000a1','0bf90000-0000-0000-0000-000000000001','A Admin','bfy-nl-admin@example.com','Admin','active'),
  ('0bf90000-0000-0000-0000-0000000000a2','0bf90000-0000-0000-0000-000000000001','A Finance','bfy-nl-finance@example.com','Finance','active');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bf91111-0000-0000-0000-000000000001','0bf90000-0000-0000-0000-000000000001','BFY Partly Phased','Ongoing Project',date '2025-08-01',date '2027-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bf92222-0000-0000-0000-000000000001','0bf90000-0000-0000-0000-000000000001','0bf91111-0000-0000-0000-000000000001',1,'Partly phased','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bf90000-0000-0000-0000-000000000001','0bf92222-0000-0000-0000-000000000001','Labor','Phased crew',90000.00,0,'2026'),
  ('0bf90000-0000-0000-0000-000000000001','0bf92222-0000-0000-0000-000000000001','Materials','UN-PHASED steel',50000.00,0,null);
update budget_versions set status='Active', activated_at=now() where id='0bf92222-0000-0000-0000-000000000001';

-- The refusal, as the shipped writer records it: FY2026 (the START fiscal year), push_state='failed'.
insert into budget_version_erp_mirror (org_id, budget_version_id, fiscal_year, push_state, push_error) values
  ('0bf90000-0000-0000-0000-000000000001','0bf92222-0000-0000-0000-000000000001','2026','failed','budget-multi-fiscal-year-unphased');

-- Ledger readings for BOTH years, so the years are genuinely comparable (a missing reading would make
-- every actual NULL and hide which column the defect lives in).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bf90000-0000-0000-0000-000000000001','0bf91111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',10000.00,0,10000.00,'0bf95555-0000-0000-0000-000000000001'),
  ('0bf90000-0000-0000-0000-000000000001','0bf91111-0000-0000-0000-000000000001','5200 - Materials - PSC','2026',4000.00,0,4000.00,'0bf95555-0000-0000-0000-000000000001'),
  ('0bf90000-0000-0000-0000-000000000001','0bf91111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2027',7000.00,0,7000.00,'0bf95555-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bf90000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'), ('Materials','5200 - Materials - PSC');
set local request.jwt.claims = '{"sub":"0bf90000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── FY2026: the phased line is stated; the un-phased line is stated NOWHERE ──────────────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2026') where category='Labor'),
  90000.00::numeric,
  'AC-BFY-014 [F-C] the PHASED line is stated on its own year');

select is(
  (select pmo_budget_amount from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2026') where category='Materials'),
  null,
  'AC-BFY-014 [NOT F-B] the UN-PHASED $50,000 does NOT land in FY2026 — a `failed` row is an attempt, not an allocation (review finding 1)');

-- …and every figure derived from that suppressed attribution is NULL too — never a confident `-EAC`
-- against a category whose budget PMO simply cannot place (review finding 2, one column deeper).
select is(
  (select attribution_known from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2026') where category='Materials'),
  false,
  'AC-BFY-014 [F-D] Materials'' attribution is KNOWN to be unknown — suppressed, not "no budget"');
select is(
  (select projected_variance from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2026') where category='Materials'),
  null,
  'AC-BFY-014 [F-D] a suppressed attribution prints NO variance — never -EAC, never the full budget');
select is(
  (select projected_utilization from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2026') where category='Materials'),
  null,
  'AC-BFY-014 [F-D] …and no utilization either');

-- The EAC is untouched: it never depended on the budget (0149's C-2 rule, preserved).
select is(
  (select projected_final_cost from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2026') where category='Materials'),
  4000.00::numeric,
  'AC-BFY-014 the EAC is still stated — it is actuals + ETC and never depended on the budget');

-- ── FY2027: no phased line, no `pushed` row ⇒ the budget is UNKNOWABLE there, never 0 ────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2027') where category='Labor'),
  null,
  'AC-BFY-014 a year with no phased line and no `pushed` row reports NULL budget — never 0 (0 is a claim)');
select is(
  (select projected_variance from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2027') where category='Labor'),
  null,
  'AC-BFY-014 …and no variance is derived from it (the year is not on record — not -EAC either)');
select is(
  (select actuals_to_date from public.get_budget_projection('0bf91111-0000-0000-0000-000000000001','2027') where category='Labor'),
  7000.00::numeric,
  'AC-BFY-014 the FACTS PMO does hold for FY2027 — the GL actuals — are still stated in full');

select finish();
rollback;
