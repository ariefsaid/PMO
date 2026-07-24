-- bfy_clone_preserves_fiscal_year.test.sql (BFY T7) — OWNS AC-BFY-003 (FR-BFY-001, 062, 071).
--
-- Phasing is authored on a DRAFT version and a Draft is normally reached by CLONING the Active one
-- (the shipped budget UI's only route to a new version — `clone_budget_version`, 0005). If the clone
-- drops `fiscal_year`, every revision of a multi-fiscal-year budget silently un-phases itself: the
-- next activation's push gate then sees NULL lines on a multi-FY project and REFUSES the push
-- (FR-BFY-010), so the operator's phasing work is destroyed by the ordinary act of revising it.
--
-- ⚑ The clone is re-created VERBATIM from 0005 apart from the one added column: its security-definer
-- authz (org + role + the parent-project org guard) is load-bearing (audit HIGH-BV-1) and must survive
-- the re-create. That is asserted here in both directions AND, structurally, by
-- bfy_fiscal_year_rls_and_rpc_security.test.sql (T11).
--
-- Mutation check: drop `fiscal_year` from the INSERT … SELECT column list in 0153 §2 and the clone's
-- phased line comes back NULL → assertion 2 red.
begin;
select plan(8);

-- ── Fixtures (as table owner: bypassing RLS to STAGE, never to assert) ───────────────────────────
insert into organizations (id, name) values
  ('0bf70000-0000-0000-0000-000000000001','BFY clone Org A');

insert into auth.users (id, email) values
  ('0bf70000-0000-0000-0000-0000000000a1','bfy-clone-pm-a@example.com'),
  ('0bf70000-0000-0000-0000-0000000000a2','bfy-clone-engineer-a@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bf70000-0000-0000-0000-0000000000a1','0bf70000-0000-0000-0000-000000000001','A PM','bfy-clone-pm-a@example.com','Project Manager','active'),
  ('0bf70000-0000-0000-0000-0000000000a2','0bf70000-0000-0000-0000-000000000001','A Engineer','bfy-clone-engineer-a@example.com','Engineer','active');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bf71111-0000-0000-0000-000000000001','0bf70000-0000-0000-0000-000000000001','BFY Clone Project','Ongoing Project',
   date '2025-08-01', date '2027-03-31');

-- A Draft version spanning two client fiscal years: one line PHASED to FY2025-2026 (F-C), one line
-- deliberately left un-phased (NULL). Both shapes must survive the clone unchanged.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bf72222-0000-0000-0000-000000000001','0bf70000-0000-0000-0000-000000000001','0bf71111-0000-0000-0000-000000000001',1,'Phased Draft','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bf73333-0000-0000-0000-000000000001','0bf70000-0000-0000-0000-000000000001','0bf72222-0000-0000-0000-000000000001','Labor','Phased crew',90000.00,0,'2025-2026'),
  ('0bf73333-0000-0000-0000-000000000002','0bf70000-0000-0000-0000-000000000001','0bf72222-0000-0000-0000-000000000001','Materials','Un-phased steel',50000.00,0,null);

-- ── The clone runs under a REAL authorized caller (OD-BUDGET-3), never as owner ──────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bf70000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$select public.clone_budget_version('0bf72222-0000-0000-0000-000000000001')$$,
  'AC-BFY-003 a Project Manager may clone a phased Draft (0005''s definer authz survives the re-create)');

-- The clone id is resolved from DB truth (the newest version of the project that is not the source).
create temporary table bfy_clone_id as
  select id from public.budget_versions
   where project_id = '0bf71111-0000-0000-0000-000000000001'
     and id <> '0bf72222-0000-0000-0000-000000000001'
   order by version desc limit 1;

select is((select count(*)::int from bfy_clone_id), 1,
  'AC-BFY-003 precondition: exactly one clone was produced');

-- ⚑ THE ASSERTION THIS FILE EXISTS FOR — the phased line keeps its year.
select is(
  (select li.fiscal_year from public.budget_line_items li
    where li.budget_version_id = (select id from bfy_clone_id) and li.category = 'Labor'),
  '2025-2026',
  'AC-BFY-003 the clone''s PHASED line keeps fiscal_year — revising a budget never silently un-phases it');

-- …and the un-phased line stays un-phased. A clone that "helpfully" filled the NULL in would be
-- inventing a fiscal year for a line the operator deliberately left un-phased (ADR-0048).
select is(
  (select li.fiscal_year from public.budget_line_items li
    where li.budget_version_id = (select id from bfy_clone_id) and li.category = 'Materials'),
  null,
  'AC-BFY-003 the clone''s UN-PHASED line stays NULL — the clone never invents a year');

-- Everything else 0005 copied is still copied (the re-create is verbatim apart from the one column).
select results_eq(
  $$select category::text, description, budgeted_amount, actual_amount
      from public.budget_line_items where budget_version_id = (select id from bfy_clone_id)
     order by category::text$$,
  $$values ('Labor'::text,'Phased crew',90000.00::numeric,0::numeric),
           ('Materials'::text,'Un-phased steel',50000.00::numeric,0::numeric)$$,
  'AC-BFY-003 the clone still copies category/description/amount and resets actual_amount to 0 (0005 behaviour intact)');

select is(
  (select status::text from public.budget_versions where id = (select id from bfy_clone_id)),
  'Draft',
  'AC-BFY-003 the clone is a Draft — the only state in which phasing may be authored (FR-BFY-060)');

-- A brand-new line on the clone needs no fiscal_year at all: the column is optional, so the shipped
-- create path (which does not know about phasing until T16) keeps working unchanged.
select lives_ok(
  $$insert into public.budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount)
    values ((select id from bfy_clone_id),'Equipment','Fresh line',1000.00,0)$$,
  'AC-BFY-003 a brand-new line is insertable with NO fiscal_year — the dimension is additive, never required');

-- The definer authz did NOT loosen: a role outside OD-BUDGET-3 is still refused.
set local request.jwt.claims = '{"sub":"0bf70000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$select public.clone_budget_version('0bf72222-0000-0000-0000-000000000001')$$,
  '42501',
  'not authorized',
  'AC-BFY-003 an Engineer still cannot clone — re-creating the function did not drop 0005''s authz');

select finish();
rollback;
