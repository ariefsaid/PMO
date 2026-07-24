-- bfy_map_edit_reinterprets_history.test.sql (BFY T, review finding 8 / OQ-BFY-5) — OWNS AC-BFY-029.
--
-- ⚑ A DOCUMENTING REGRESSION SENTINEL, NOT A GUARD. The category→account map (`budget_category_account_map`)
-- has NO fiscal-year history: `get_budget_projection` snapshots nothing about which account a category
-- mapped to WHEN a prior year's actuals were booked — it joins the CURRENT map against every year's
-- ledger. So an Admin editing the map re-interprets prior years' actuals retroactively. Multi-FY phasing
-- makes this materially worse (one edit re-interprets N years), which is why the spec names it a non-goal
-- (OQ-BFY-5) and asks for THIS sentinel: a test that pins the CURRENT (defective) behaviour so the
-- follow-up cannot land the map-history machinery while silently leaving the projection unchanged.
--
-- ⚑ THIS AC ASSERTS THE CURRENT DEFECT ON PURPOSE. When the follow-up ships effective-dated map history,
-- FY2026's actuals at account A must STILL attribute to Labor after the edit — at which point THIS test
-- goes red and is replaced by the fail-closed/effective-dated assertion. That red is the signal, not a
-- regression: the sentinel exists to force the follow-up to touch this file.
begin;
select plan(3);

insert into organizations (id, name) values
  ('0bfd0000-0000-0000-0000-000000000001','BFY Map-edit Org');
insert into auth.users (id, email) values
  ('0bfd0000-0000-0000-0000-0000000000a1','bfy-me-admin@example.com'),
  ('0bfd0000-0000-0000-0000-0000000000a2','bfy-me-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfd0000-0000-0000-0000-0000000000a1','0bfd0000-0000-0000-0000-000000000001','ME Admin','bfy-me-admin@example.com','Admin','active'),
  ('0bfd0000-0000-0000-0000-0000000000a2','0bfd0000-0000-0000-0000-000000000001','ME Finance','bfy-me-finance@example.com','Finance','active');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfd1111-0000-0000-0000-000000000001','0bfd0000-0000-0000-0000-000000000001','BFY Map-edit Project','Ongoing Project',date '2025-08-01',date '2026-12-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfd2222-0000-0000-0000-000000000001','0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000001',1,'v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd2222-0000-0000-0000-000000000001','Labor','FY2026 crew',60000.00,0,'2026');
update budget_versions set status='Active', activated_at=now() where id='0bfd2222-0000-0000-0000-000000000001';

set local role postgres;
-- FY2026 actuals sit at account A (5100). The ledger has been read (actuals_as_of non-NULL below).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, snapshot_id) values
  ('0bfd0000-0000-0000-0000-000000000001','0bfd1111-0000-0000-0000-000000000001','5100 - Direct Costs - PSC','2026',25000.00,0,25000.00,'0bfd5555-0000-0000-0000-000000000001');

-- The Admin maps Labor → account A (5100).
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.budget_category_account_map (category, erp_account) values ('Labor','5100 - Direct Costs - PSC');

-- Read as Finance (no write authority — proves the read path, not a writer side effect).
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select isnt(
  (select actuals_as_of from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  null,
  'AC-BFY-029 precondition: FY2026''s ledger HAS been read (so any later change is about the MAP, not the reading)');

-- ── BEFORE the edit: Labor picks up account A''s FY2026 actuals ────────────────────────────────────
select is(
  (select actuals_to_date from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  25000.00::numeric,
  'AC-BFY-029 BEFORE the map edit: FY2026 Labor actuals attribute account A''s $25,000');

-- ── the Admin RE-MAPS Labor → account B (5200); account A is now unmapped ──────────────────────────
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update public.budget_category_account_map set erp_account='5200 - Subcontractors - PSC' where category='Labor';
set local request.jwt.claims = '{"sub":"0bfd0000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── AFTER the edit: FY2026''s actuals at A are silently RE-INTERPRETED — Labor no longer joins A, and
--    account B has no FY2026 snapshot, so Labor''s prior-year actuals VANISH (become NULL). This is the
--    CURRENT DEFECT the sentinel documents (finding 8 / OQ-BFY-5). ────────────────────────────────
-- Labor is STILL mapped (now to account B, which has no FY2026 ledger), so the cells CTE coalesces its
-- missing join to 0 — account A's $25,000 has silently vanished from Labor. (A mapped account with no
-- ledger reads 0; an UNMAPPED category reads NULL — AC-BFY-028. Either way the prior year is rewritten.)
select is(
  (select actuals_to_date from public.get_budget_projection('0bfd1111-0000-0000-0000-000000000001','2026') where category='Labor'),
  0.00::numeric,
  'AC-BFY-029 [SENTINEL — documents the CURRENT defect] AFTER the map edit, FY2026 Labor drops account A''s $25,000 to $0: the map has no fiscal-year history, so a present-day edit re-interprets a prior year. The map-history follow-up (OQ-BFY-5) must turn THIS assertion red.');

select finish();
rollback;
