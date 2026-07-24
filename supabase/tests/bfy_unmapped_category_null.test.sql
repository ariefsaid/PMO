-- bfy_unmapped_category_null.test.sql (BFY T8) — OWNS AC-BFY-028 (re-asserts C-1 across MULTIPLE YEARS).
--
-- ⚑ THE FACT UNDER TEST: `actuals_to_date` is KNOWN only when the category has a mapped ERP account.
-- With no `budget_category_account_map` row there is no account to ask the ledger about, so the figure
-- is UNOBTAINABLE — NULL, never `0`. C-1 pinned this at one year; phasing makes a project span N years,
-- and a per-year regression of the coalesce-to-zero defect would hide real spend on every year at once
-- while the SAME screen banners the category as unmapped (review finding 8's neighbourhood).
--
-- This is deliberately asserted on a MULTI-YEAR project with the ledger READ for both years — so
-- `actuals_as_of` is non-NULL and the NULL below can only come from the missing map row, not from
-- "nobody has looked yet" (NEW-4's separate state).
--
-- Mutation: restore `coalesce(a.actuals_to_date, 0)` in the `cells` CTE and Equipment reports $0.00
-- spent with a full-budget variance on BOTH years → red.
begin;
select plan(8);

insert into organizations (id, name) values
  ('0bfc0000-0000-0000-0000-000000000001','BFY unmapped Org A');
insert into auth.users (id, email) values
  ('0bfc0000-0000-0000-0000-0000000000a1','bfy-um-admin@example.com'),
  ('0bfc0000-0000-0000-0000-0000000000a2','bfy-um-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfc0000-0000-0000-0000-0000000000a1','0bfc0000-0000-0000-0000-000000000001','A Admin','bfy-um-admin@example.com','Admin','active'),
  ('0bfc0000-0000-0000-0000-0000000000a2','0bfc0000-0000-0000-0000-000000000001','A Finance','bfy-um-finance@example.com','Finance','active');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfc1111-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','BFY Two-Year Project','Ongoing Project',date '2025-08-01',date '2027-03-31');

-- Fully PHASED across both years (F-C), so both years are on record from PMO's own facts and the grid
-- has a row for Equipment in each — the row on which the actuals column must read NULL.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfc2222-0000-0000-0000-000000000001','0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001',1,'Phased v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','Labor','Y1 crew',60000.00,0,'2026'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','Labor','Y2 crew',40000.00,0,'2027'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','Equipment','Y1 rigs',20000.00,0,'2026'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc2222-0000-0000-0000-000000000001','Equipment','Y2 rigs',15000.00,0,'2027');
update budget_versions set status='Active', activated_at=now() where id='0bfc2222-0000-0000-0000-000000000001';

-- The ledger HAS been read for both years (so `actuals_as_of` is non-NULL and NEW-4's "nobody looked"
-- state is excluded), and Equipment DOES have real spend at 5300 — which no category maps.
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',25000.00,0,25000.00,'0bfc5555-0000-0000-0000-000000000001'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001','5300 - Equipment - PSC','2026',8000.00,0,8000.00,'0bfc5555-0000-0000-0000-000000000001'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2027',12000.00,0,12000.00,'0bfc5555-0000-0000-0000-000000000001'),
  ('0bfc0000-0000-0000-0000-000000000001','0bfc1111-0000-0000-0000-000000000001','5300 - Equipment - PSC','2027',5000.00,0,5000.00,'0bfc5555-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfc0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
-- ONLY Labor is mapped. Equipment has NO map row — the whole point.
insert into public.budget_category_account_map (category, erp_account) values ('Labor','5100 - Direct Costs - PSC');
set local request.jwt.claims = '{"sub":"0bfc0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- Precondition: the ledger WAS read for both years, so a NULL below is about the MAP, not the reading.
select isnt(
  (select actuals_as_of from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-028 precondition: FY2026''s ledger HAS been read (so a NULL actual is about the map, not the reading)');
select isnt(
  (select actuals_as_of from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2027') where category='Labor'),
  null,
  'AC-BFY-028 precondition: FY2027''s ledger HAS been read too');

-- ── The unmapped category reads NULL on BOTH years ──────────────────────────────────────────────
select is(
  (select actuals_to_date from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  null,
  'AC-BFY-028 FY2026: an UNMAPPED category''s actuals are NULL — unobtainable, never a confident $0');
select is(
  (select actuals_to_date from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2027') where category='Equipment'),
  null,
  'AC-BFY-028 FY2027: the SAME category is NULL on the second year too — the defect cannot hide in a per-year branch');

select is(
  (select projected_variance from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  null,
  'AC-BFY-028 FY2026: nothing derived from an unobtainable actual is stated — never "the entire $20,000 is still available"');
select is(
  (select projected_variance from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2027') where category='Equipment'),
  null,
  'AC-BFY-028 FY2027: likewise');

-- …while its PMO-OWNED half is stated per year: the budget never depended on the ERP map (F-C).
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2026') where category='Equipment'),
  20000.00::numeric,
  'AC-BFY-028 [F-C] the PHASED budget is still stated per year — an unmapped account never suppresses PMO''s own fact');
select is(
  (select pmo_budget_amount from public.get_budget_projection('0bfc1111-0000-0000-0000-000000000001','2027') where category='Equipment'),
  15000.00::numeric,
  'AC-BFY-028 [F-C] …and the SECOND year states its OWN phased amount, not the project total');

select finish();
rollback;
