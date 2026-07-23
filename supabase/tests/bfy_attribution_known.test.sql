-- bfy_attribution_known.test.sql (BFY T8) — OWNS AC-BFY-023 (FR-BFY-054, 055). Review finding 2.
--
-- ⚑ THE FACT UNDER TEST: **F-D** — `attribution_known`. There are TWO ways `pmo_budget_amount` can be
-- NULL on a year that IS on record, and 0149 could not tell them apart:
--
--   X  the category HAS a budget line, but PMO cannot place it in this year (its only line is
--      un-phased and the push-time span witness has DRIFTED) ⇒ attribution SUPPRESSED ⇒ say NOTHING.
--   Y  the category genuinely has NO line in a year PMO does have a budget for ⇒ every cent spent
--      here is unbudgeted ⇒ `-EAC` is the honest, deliberately loud answer.
--
-- Round 1 collapsed them: after drift it suppressed the budget AMOUNT but left `on_record` true, so
-- 0149's `-EAC` branch fired and the screen said "$100,000 entirely unbudgeted" when the honest fact
-- was "the attribution is unknown after the project's dates changed". A confident negative variance is
-- not a safer error than a confident positive one — it is the same class of lie about money.
--
-- ⚑ HOW THE DRIFT IS REACHED. Only ONE byte of the fixture changes between the two halves: the
-- project's `end_date`. The mirror row is `pushed` with a NON-NULL push-time span witness throughout,
-- so `on_record` (F-A) is TRUE in both halves — which is precisely what makes the `-EAC` trap live.
-- (The witness is stamped by the mirror writer at the served boundary — T13/AC-BFY-019 owns proving
-- the WRITER produces it; this file owns proving the READER honours it.)
--
-- Mutation: collapse the two NULL-budget states (drop the `attribution_known` branch) and X prints
-- -EAC → assertions 6/7 red. Ignore drift and X prints the whole $100,000 in FY2026 → assertion 5 red.
begin;
select plan(10);

insert into organizations (id, name) values
  ('0bfb0000-0000-0000-0000-000000000001','BFY attribution Org A');
insert into auth.users (id, email) values
  ('0bfb0000-0000-0000-0000-0000000000a1','bfy-ak-admin@example.com'),
  ('0bfb0000-0000-0000-0000-0000000000a2','bfy-ak-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfb0000-0000-0000-0000-0000000000a1','0bfb0000-0000-0000-0000-000000000001','A Admin','bfy-ak-admin@example.com','Admin','active'),
  ('0bfb0000-0000-0000-0000-0000000000a2','0bfb0000-0000-0000-0000-000000000001','A Finance','bfy-ak-finance@example.com','Finance','active');

-- SINGLE fiscal year AT PUSH TIME: 2025-08-01 → 2026-03-31 (one Jul–Jun year).
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfb1111-0000-0000-0000-000000000001','0bfb0000-0000-0000-0000-000000000001','BFY Drifted Project','Ongoing Project',date '2025-08-01',date '2026-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfb2222-0000-0000-0000-000000000001','0bfb0000-0000-0000-0000-000000000001','0bfb1111-0000-0000-0000-000000000001',1,'Un-phased v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bfb0000-0000-0000-0000-000000000001','0bfb2222-0000-0000-0000-000000000001','Labor','Whole crew',100000.00,0,null);
update budget_versions set status='Active', activated_at=now() where id='0bfb2222-0000-0000-0000-000000000001';

-- A SUCCESSFUL push (F-A) carrying the push-time span witness — the project's dates exactly as the
-- gate read them at push time.
insert into budget_version_erp_mirror
  (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name, pushed_at,
   pushed_project_start_date, pushed_project_end_date) values
  ('0bfb0000-0000-0000-0000-000000000001','0bfb2222-0000-0000-0000-000000000001','2026','pushed','BUDGET-2026-0001',now(),
   date '2025-08-01', date '2026-03-31');

-- FY2026 ledger: Labor $40,000 (the category with the un-phased line) and Equipment $9,000 (no line).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bfb0000-0000-0000-0000-000000000001','0bfb1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',40000.00,0,40000.00,'0bfb5555-0000-0000-0000-000000000001'),
  ('0bfb0000-0000-0000-0000-000000000001','0bfb1111-0000-0000-0000-000000000001','5300 - Equipment - PSC','2026',9000.00,0,9000.00,'0bfb5555-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfb0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values
  ('Labor','5100 - Direct Costs - PSC'), ('Equipment','5300 - Equipment - PSC');
set local request.jwt.claims = '{"sub":"0bfb0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
-- Finance authors an ETC on Equipment, so the -EAC oracle below is not trivially the actual.
insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
  values ('0bfb1111-0000-0000-0000-000000000001','2026','Equipment',1500.00);

-- ── HALF 1 — the witness still MATCHES the project's dates: everything is stated ─────────────────
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  100000.00::numeric,
  'AC-BFY-023 [F-A + witness match] before any drift the un-phased budget attributes to its pushed year');
select is(
  (select attribution_known from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  true,
  'AC-BFY-023 [F-D] …and the attribution is KNOWN');
select is(
  (select projected_variance from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  60000.00::numeric,
  'AC-BFY-023 …so its variance is stated in full (100000 − 40000)');

-- ── THE DRIFT — one byte: the project is extended into a SECOND fiscal year ──────────────────────
-- Nothing about the budget or the push changes. What changed is the world: "this project is single-FY"
-- was true at push time and is not true now, so the year an un-phased line belongs to is no longer
-- knowable. PMO must not pick one, and must not invent a split (ADR-0048).
set local role postgres;
update public.projects set end_date = date '2027-03-31' where id = '0bfb1111-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfb0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- X — the category whose only line is the now-unplaceable un-phased one.
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-023 [X] after drift the un-phased budget attributes to NO year — FY2026 no longer claims the whole $100,000');
select is(
  (select attribution_known from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  false,
  'AC-BFY-023 [X, F-D] and the RPC SAYS the attribution is unknown — the surface can explain itself');
select is(
  (select projected_variance from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-023 [X] a SUPPRESSED attribution prints NO variance — never -$40,000 "entirely unbudgeted" (review finding 2)');
select is(
  (select projected_utilization from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-023 [X] …and no utilization');
select is(
  (select projected_final_cost from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  40000.00::numeric,
  'AC-BFY-023 [X] the EAC is untouched — it never depended on the budget');

-- Y — the genuinely-unbudgeted category in the SAME (still on-record) year. `-EAC` must survive: the
-- fix narrows the claim, it does not delete the alarm. Recomputed by an INDEPENDENT oracle over the
-- base tables so a wrong-but-consistent RPC cannot agree with a hard-coded literal.
select is(
  (select projected_variance from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  (select -( (select sum(s.net) from public.erp_actuals_snapshot s
               where s.project_id='0bfb1111-0000-0000-0000-000000000001' and s.fiscal_year='2026'
                 and s.account='5300 - Equipment - PSC')
           + (select bp.pmo_etc from public.budget_projections bp
               where bp.project_id='0bfb1111-0000-0000-0000-000000000001' and bp.fiscal_year='2026'
                 and bp.category='Equipment') )),
  'AC-BFY-023 [Y] a category with NO line in an on-record year still prints -EAC (independent oracle) — the two NULL-budget states do NOT collapse');
select is(
  (select projected_utilization from public.get_budget_projection('0bfb1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  null,
  'AC-BFY-023 [Y] …with no utilization (there is no budget to divide by — 0149''s nullif, unchanged)');

select finish();
rollback;
