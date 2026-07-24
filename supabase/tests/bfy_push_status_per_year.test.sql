-- bfy_push_status_per_year.test.sql (BFY T10) — OWNS AC-BFY-025 (FR-BFY-056). Review finding 6.
--
-- ⚑ THE FACT UNDER TEST: the expected-year set includes **F-B rows AS STATUS ROWS** — a `failed`/`held`
-- year IS something the operator must see. Attribution is NOT consulted here; that is §3a's job. The
-- fence still applies in the other direction: the expected set is derived from PMO's OWN phased lines
-- (**F-C**) LEFT-JOINed to the mirror, so a year the process never got as far as writing a mirror row
-- for is an explicit `never-pushed` ROW, not a silent omission.
--
-- 0149 did `limit 1` on the mirror, ordered by `pushed_at desc`. On a partial fan-out failure — FY2026
-- pushed, FY2027 failed — that ordering commonly selects the PUSHED row (it is the one with a
-- `pushed_at`), so the screen reports "pushed" while ERPNext enforces nothing at all for FY2027. And if
-- the process died before writing FY2027's mirror row, FY2027 vanished entirely. Either way the
-- operator sees a healthy screen over a year with no overspend control.
--
-- Mutations: restore `limit 1` → FY2027 is omitted → assertions 1/2 red; derive the expected set from
-- the mirror alone → the never-pushed year disappears → assertion 2 red.
begin;
select plan(11);

insert into organizations (id, name) values
  ('0bfe0000-0000-0000-0000-000000000001','BFY push-status Org A');
insert into auth.users (id, email) values
  ('0bfe0000-0000-0000-0000-0000000000a1','bfy-ps-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0bfe0000-0000-0000-0000-0000000000a1','0bfe0000-0000-0000-0000-000000000001','A Finance','bfy-ps-finance@example.com','Finance','active');
insert into external_domain_ownership (org_id, domain, external_tier) values
  ('0bfe0000-0000-0000-0000-000000000001','budget','erpnext');

insert into projects (id, org_id, name, status, start_date, end_date) values
  ('0bfe1111-0000-0000-0000-000000000001','0bfe0000-0000-0000-0000-000000000001','BFY Partial Fan-out','Ongoing Project',date '2025-08-01',date '2027-03-31');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('0bfe2222-0000-0000-0000-000000000001','0bfe0000-0000-0000-0000-000000000001','0bfe1111-0000-0000-0000-000000000001',1,'Phased v1','Draft');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year) values
  ('0bfe0000-0000-0000-0000-000000000001','0bfe2222-0000-0000-0000-000000000001','Labor','Y1 crew',90000.00,0,'2026'),
  ('0bfe0000-0000-0000-0000-000000000001','0bfe2222-0000-0000-0000-000000000001','Labor','Y2 crew',40000.00,0,'2027');
update budget_versions set status='Active', activated_at=now() where id='0bfe2222-0000-0000-0000-000000000001';

-- ⚑ THE PARTIAL FAN-OUT: FY2026 landed in ERP; FY2027's mirror row was NEVER WRITTEN (the process died
-- between the two years). This is the state finding 6 says the old shape could not report at all.
insert into budget_version_erp_mirror
  (org_id, budget_version_id, fiscal_year, push_state, erp_budget_name, pushed_at,
   pushed_project_start_date, pushed_project_end_date) values
  ('0bfe0000-0000-0000-0000-000000000001','0bfe2222-0000-0000-0000-000000000001','2026','pushed','BUDGET-2026-0031',now(),
   date '2025-08-01', date '2027-03-31');

set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfe0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- ── TWO rows, one per expected year — the failed/absent year is never hidden by ordering ─────────
select is(
  (select count(*)::int from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001')),
  2,
  'AC-BFY-025 the status is reported PER YEAR — two expected years, two rows (never `limit 1`)');

select results_eq(
  $$select fiscal_year, push_state, erp_budget_name
      from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001') order by fiscal_year$$,
  $$values ('2026'::text,'pushed'::text,'BUDGET-2026-0031'::text),
           ('2027'::text,'never-pushed'::text,null::text)$$,
  'AC-BFY-025 the year whose mirror row was never written is an EXPLICIT never-pushed row — not a silent omission');

-- ⚑ INDEPENDENT ORACLE: the expected set is re-derived from `budget_line_items.fiscal_year` over the
-- base tables, so a status query that agrees with a wrong expected-set derivation still fails here.
select results_eq(
  $$select fiscal_year from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001') order by fiscal_year$$,
  $$select distinct li.fiscal_year
      from public.budget_line_items li
      join public.budget_versions v on v.id = li.budget_version_id
     where v.project_id = '0bfe1111-0000-0000-0000-000000000001' and v.status = 'Active'
       and li.fiscal_year is not null
     order by 1$$,
  'AC-BFY-025 the expected-year set equals an INDEPENDENT re-derivation from the Active version''s phased lines');

-- Each row carries its own facts, and `stale_attribution` is present per year (fully phased ⇒ nothing
-- is un-phased to go stale, on either year).
select results_eq(
  $$select fiscal_year, stale_attribution
      from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001') order by fiscal_year$$,
  $$values ('2026'::text,false),('2027'::text,false)$$,
  'AC-BFY-025 every row carries stale_attribution — a fully PHASED budget has nothing to go stale');

-- ── stale_attribution fires on the drift case (§3a''s suppression, named for the surface) ────────
-- An un-phased line + a `pushed` year whose witness no longer matches the project's dates. The
-- operator needs to be TOLD why the budget column went blank, and what to do: phase these lines.
set local role postgres;
-- (the version is Active, so the line is staged by returning it to Draft first — the shipped draft
-- guard is respected, not bypassed: an un-phased line CAN only be authored while Draft, FR-BFY-060.)
update budget_versions set status='Draft' where id='0bfe2222-0000-0000-0000-000000000001';
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount, fiscal_year)
  values ('0bfe0000-0000-0000-0000-000000000001','0bfe2222-0000-0000-0000-000000000001','Materials','UN-PHASED steel',50000.00,0,null);
update budget_versions set status='Active' where id='0bfe2222-0000-0000-0000-000000000001';
-- The project is now extended past the span FY2026's push recorded.
update public.projects set end_date = date '2028-03-31' where id = '0bfe1111-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfe0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select stale_attribution from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001') where fiscal_year='2026'),
  true,
  'AC-BFY-025 stale_attribution is TRUE on the year whose successful push recorded a span the project no longer has');
select is(
  (select stale_attribution from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001') where fiscal_year='2027'),
  false,
  'AC-BFY-025 …and FALSE on a year that never had a successful push to go stale — the reason is per YEAR, not per project');
-- …and it agrees with what the grid actually did (one fact, two surfaces).
select is(
  (select attribution_known from public.get_budget_projection('0bfe1111-0000-0000-0000-000000000001','2026') where category='Materials'),
  false,
  'AC-BFY-025 the flag matches §3a''s suppression — the surface can explain the blank budget cell');

-- ── hold_releasable is PER YEAR, keyed on the year-qualified outbox identity ─────────────────────
-- ⚑ THE ENCODER IS SHARED WITH TYPESCRIPT and pinned here in both directions: the two documented
-- examples from `src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts` must produce the same tokens, or
-- the SQL below silently stops finding held commands the dispatcher created.
select is(public.budget_fiscal_year_token('2026'), '32303236',
  'AC-BFY-025 the SQL fiscal-year token matches fiscalYearEncoding.ts for ''2026'' (its documented example)');
select is(public.budget_fiscal_year_token('A:B 2026'), '413T422032303236',
  'AC-BFY-025 …and for the colon-bearing ''A:B 2026'' (the delimiter case, FR-BFY-031)');

set local role postgres;
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state)
  values ('0bfe0000-0000-0000-0000-000000000001','budget',
          '0bfe2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2027'),
          'bud:0bfe2222-0000-0000-0000-000000000001:' || public.budget_fiscal_year_token('2027') || ':1',
          'erpnext','create','held');
set local role authenticated;
set local request.jwt.claims = '{"sub":"0bfe0000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select hold_releasable from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001') where fiscal_year='2027'),
  true,
  'AC-BFY-025 the year with the genuinely HELD outbox command offers the release affordance');
select is(
  (select hold_releasable from public.get_budget_push_status('0bfe1111-0000-0000-0000-000000000001') where fiscal_year='2026'),
  false,
  'AC-BFY-025 …and the OTHER year does not — a button whose only outcome is an error is worse than no button (MEDIUM-1, now per year)');

select finish();
rollback;
