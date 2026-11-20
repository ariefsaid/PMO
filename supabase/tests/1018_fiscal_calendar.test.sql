-- 1018_fiscal_calendar.test.sql — #2329: a fiscal calendar in PMO for an organization with no accounting system.
-- The organization sets the month its fiscal year starts; PMO places each payment in a fiscal year by its date and the
-- Budget tab's comparison cuts recorded spending by that year. An organization that reads an accounting system keeps
-- that system's calendar: the setting is refused there and never read.
--
-- Mutation commitments (each turns this file red, then is restored):
--   M1 role      — let any role through set_org_fiscal_year_start_month: AC-FCAL-003 → red.
--   M2 basis     — drop the ledger refusal in set_org_fiscal_year_start_month: AC-FCAL-004 → red.
--   M3 placement — make the window start exclusive in procurement_paid_pre_tax_between: AC-FCAL-005 → red.
begin;
create extension if not exists pgtap;
select plan(47);

-- O1 no accounting system (the subject) · O2 another org · O3 reads a ledger · O4 no accounting system, no start month.
insert into public.organizations (id, name, default_currency, default_timezone) values
  ('10180000-0000-0000-0000-000000000001', 'FCAL subject', 'USD', 'UTC'),
  ('10180000-0000-0000-0000-000000000002', 'FCAL other org', 'USD', 'UTC'),
  ('10180000-0000-0000-0000-000000000003', 'FCAL ledger org', 'USD', 'UTC'),
  ('10180000-0000-0000-0000-000000000004', 'FCAL unset org', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('10180000-0000-0000-0000-0000000000a1', 'fcal-admin@example.test'),
  ('10180000-0000-0000-0000-0000000000a2', 'fcal-finance@example.test'),
  ('10180000-0000-0000-0000-0000000000a3', 'fcal-engineer@example.test'),
  ('10180000-0000-0000-0000-0000000000b1', 'fcal-other-admin@example.test'),
  ('10180000-0000-0000-0000-0000000000c1', 'fcal-ledger-admin@example.test'),
  ('10180000-0000-0000-0000-0000000000d1', 'fcal-unset-finance@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('10180000-0000-0000-0000-0000000000a1', '10180000-0000-0000-0000-000000000001', 'FCAL Admin', 'fcal-admin@example.test', 'Admin', 'active'),
  ('10180000-0000-0000-0000-0000000000a2', '10180000-0000-0000-0000-000000000001', 'FCAL Finance', 'fcal-finance@example.test', 'Finance', 'active'),
  ('10180000-0000-0000-0000-0000000000a3', '10180000-0000-0000-0000-000000000001', 'FCAL Engineer', 'fcal-engineer@example.test', 'Engineer', 'active'),
  ('10180000-0000-0000-0000-0000000000b1', '10180000-0000-0000-0000-000000000002', 'FCAL Other Admin', 'fcal-other-admin@example.test', 'Admin', 'active'),
  ('10180000-0000-0000-0000-0000000000c1', '10180000-0000-0000-0000-000000000003', 'FCAL Ledger Admin', 'fcal-ledger-admin@example.test', 'Admin', 'active'),
  ('10180000-0000-0000-0000-0000000000d1', '10180000-0000-0000-0000-000000000004', 'FCAL Unset Finance', 'fcal-unset-finance@example.test', 'Finance', 'active');
insert into public.external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('10180000-0000-0000-0000-000000000003', 'erpnext', 'https://erp.example.test', 'test-ref', 'active',
        '10180000-0000-0000-0000-0000000000c1', now());

-- P1 spans two April-start years; P2 has an undated paid payment; P3 is open-ended; P4 sits in the unset org;
-- P5 in the ledger org; P6 has no start date.
insert into public.projects (id, org_id, name, status, currency, start_date, end_date) values
  ('10180000-0000-0000-0000-0000000000e1', '10180000-0000-0000-0000-000000000001', 'FCAL two years', 'Ongoing Project', 'USD', '2026-06-01', '2027-08-31'),
  ('10180000-0000-0000-0000-0000000000e2', '10180000-0000-0000-0000-000000000001', 'FCAL undated', 'Ongoing Project', 'USD', '2026-06-01', '2027-08-31'),
  ('10180000-0000-0000-0000-0000000000e3', '10180000-0000-0000-0000-000000000001', 'FCAL open', 'Ongoing Project', 'USD', '2026-06-01', null),
  ('10180000-0000-0000-0000-0000000000e4', '10180000-0000-0000-0000-000000000004', 'FCAL unset', 'Ongoing Project', 'USD', '2026-06-01', '2027-08-31'),
  ('10180000-0000-0000-0000-0000000000e5', '10180000-0000-0000-0000-000000000003', 'FCAL ledger', 'Ongoing Project', 'USD', '2026-06-01', '2027-08-31'),
  ('10180000-0000-0000-0000-0000000000e6', '10180000-0000-0000-0000-000000000001', 'FCAL undated project', 'Ongoing Project', 'USD', null, null);

insert into public.budget_versions (id, org_id, project_id, version, name, status, currency, budget_mode) values
  ('10180000-0000-0000-0000-0000000000f1', '10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-0000000000e1', 1, 'v1', 'Draft', 'USD', 'per_year'),
  ('10180000-0000-0000-0000-0000000000f2', '10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-0000000000e2', 1, 'v1', 'Draft', 'USD', 'per_year'),
  ('10180000-0000-0000-0000-0000000000f4', '10180000-0000-0000-0000-000000000004', '10180000-0000-0000-0000-0000000000e4', 1, 'v1', 'Draft', 'USD', 'per_year'),
  ('10180000-0000-0000-0000-0000000000f5', '10180000-0000-0000-0000-000000000003', '10180000-0000-0000-0000-0000000000e5', 1, 'v1', 'Draft', 'USD', 'per_year');
insert into public.budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, fiscal_year) values
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-0000000000f1', 'Labor', 'labor y1', 3000, '2026-2027'),
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-0000000000f1', 'Labor', 'labor y2', 2000, '2027-2028'),
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-0000000000f1', 'Subcontractors', 'subs y2', 800, '2027-2028'),
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-0000000000f1', 'Overheads', 'free-text year', 100, 'FY26'),
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-0000000000f2', 'Labor', 'labor y1', 500, '2026-2027'),
  ('10180000-0000-0000-0000-000000000004', '10180000-0000-0000-0000-0000000000f4', 'Labor', 'labor y1', 500, '2026-2027'),
  ('10180000-0000-0000-0000-000000000003', '10180000-0000-0000-0000-0000000000f5', 'Labor', 'labor y1', 500, '2026-2027');
update public.budget_versions set status = 'Active', activated_at = now()
 where id in ('10180000-0000-0000-0000-0000000000f1', '10180000-0000-0000-0000-0000000000f2',
              '10180000-0000-0000-0000-0000000000f4', '10180000-0000-0000-0000-0000000000f5');

-- P1: Labor paid 1,000 on the last day of FY 2026-2027 and 400 on the first day of 2027-2028; Materials a taxed purchase
-- (1,000 + 100 tax) paid 550 in each year, so 500 pre-tax in each. P2: Labor paid 300 with no date. P4/P5: Labor 250.
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('10180000-0000-0000-0000-000000000101', '10180000-0000-0000-0000-000000000001', 'Labor paid', 'Paid', 1400, '10180000-0000-0000-0000-0000000000e1', 'USD', 'Labor', null),
  ('10180000-0000-0000-0000-000000000102', '10180000-0000-0000-0000-000000000001', 'Taxed materials', 'Paid', 1100, '10180000-0000-0000-0000-0000000000e1', 'USD', 'Materials', null),
  ('10180000-0000-0000-0000-000000000103', '10180000-0000-0000-0000-000000000001', 'Undated labor', 'Paid', 300, '10180000-0000-0000-0000-0000000000e2', 'USD', 'Labor', null),
  ('10180000-0000-0000-0000-000000000104', '10180000-0000-0000-0000-000000000004', 'Unset labor', 'Paid', 250, '10180000-0000-0000-0000-0000000000e4', 'USD', 'Labor', null),
  ('10180000-0000-0000-0000-000000000105', '10180000-0000-0000-0000-000000000003', 'Ledger labor', 'Paid', 250, '10180000-0000-0000-0000-0000000000e5', 'USD', 'Labor', null);
insert into public.procurement_invoices (id, org_id, procurement_id, status, amount, currency, tax_treatment, tax_amount)
values ('10180000-0000-0000-0000-000000000201', '10180000-0000-0000-0000-000000000001',
        '10180000-0000-0000-0000-000000000102', 'Paid', 1000, 'USD', 'exclusive', 100);
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('10180000-0000-0000-0000-000000000301', '10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000101', 'Paid', '2027-03-31', 1000, 'USD'),
  ('10180000-0000-0000-0000-000000000302', '10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000101', 'Paid', '2027-04-01', 400, 'USD'),
  ('10180000-0000-0000-0000-000000000303', '10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000102', 'Paid', '2026-12-01', 550, 'USD'),
  ('10180000-0000-0000-0000-000000000304', '10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000102', 'Paid', '2027-05-01', 550, 'USD'),
  ('10180000-0000-0000-0000-000000000306', '10180000-0000-0000-0000-000000000004', '10180000-0000-0000-0000-000000000104', 'Paid', '2026-10-10', 250, 'USD'),
  ('10180000-0000-0000-0000-000000000307', '10180000-0000-0000-0000-000000000003', '10180000-0000-0000-0000-000000000105', 'Paid', '2026-10-10', 250, 'USD');
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('10180000-0000-0000-0000-000000000305', '10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000103', 'Paid', '2026-10-10', 300, 'USD');
update public.payments set date = null where id = '10180000-0000-0000-0000-000000000305';

-- P1 hire usage: 4 hours at 50 in March 2027 (200, FY 2026-2027) and 2 hours in April 2027 (100, FY 2027-2028).
insert into public.equipment_assets (id, org_id, code, name, default_unit) values
  ('10180000-0000-0000-0000-000000000401', '10180000-0000-0000-0000-000000000001', 'FCAL-GEN', 'FCAL generator', 'hours');
insert into public.equipment_costing_settings (org_id, asset_id, setting_key, version, basis, work_rate, rate_unit,
                                                charge_category, effective_from) values
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000401',
   '10180000-0000-0000-0000-000000000402', 1, 'hire_rate', 50, 'hours', 'Equipment', '2026-01-01');
insert into public.equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status,
                                             author_id, approver_id, approved_at) values
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000401', '10180000-0000-0000-0000-0000000000e1',
   '2027-03-15', 4, 'hours', 'work', 'Approved', '10180000-0000-0000-0000-0000000000a3', '10180000-0000-0000-0000-0000000000a1', now()),
  ('10180000-0000-0000-0000-000000000001', '10180000-0000-0000-0000-000000000401', '10180000-0000-0000-0000-0000000000e1',
   '2027-04-15', 2, 'hours', 'work', 'Approved', '10180000-0000-0000-0000-0000000000a3', '10180000-0000-0000-0000-0000000000a1', now());

-- The ledger org's ledger: Labor 700 in its own fiscal year 2026-2027. A stored start month there must never be read.
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
insert into public.budget_category_account_map (org_id, category, erp_account, is_push_target)
values ('10180000-0000-0000-0000-000000000003', 'Labor', '1018-LABOR', true);
insert into public.erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at)
values ('10180000-0000-0000-0000-000000000003', '10180000-0000-0000-0000-0000000000e5', '1018-LABOR', '2026-2027', 700,
        '2027-01-01', '10180000-0000-0000-0000-000000000501', '2027-01-02');
reset role;
update public.organizations set fiscal_year_start_month = 4 where id = '10180000-0000-0000-0000-000000000003';

-- AC-FCAL-001 ─ a date's fiscal year.
select is((select name from public.pmo_fiscal_year_for_date('2027-03-31', 4)), '2026-2027',
  'AC-FCAL-001 with an April start 2027-03-31 is in 2026-2027');
select is((select array[start_date, end_date] from public.pmo_fiscal_year_for_date('2027-03-31', 4)),
  array['2026-04-01'::date, '2027-03-31'::date], 'AC-FCAL-001 2026-2027 runs 2026-04-01 to 2027-03-31');
select is((select name from public.pmo_fiscal_year_for_date('2027-04-01', 4)), '2027-2028',
  'AC-FCAL-001 2027-04-01 starts 2027-2028');
select is((select name from public.pmo_fiscal_year_for_date('2027-03-31', 1)), '2027',
  'AC-FCAL-001 with a January start 2027-03-31 is in 2027');
select is((select array[start_date, end_date] from public.pmo_fiscal_year_for_date('2027-03-31', 1)),
  array['2027-01-01'::date, '2027-12-31'::date], 'AC-FCAL-001 2027 is the calendar year');

-- AC-FCAL-002 ─ a budget-year label is a fiscal year only when it is that year's exact name.
select is((select array[start_date, end_date] from public.pmo_fiscal_year_by_name('2026-2027', 4)),
  array['2026-04-01'::date, '2027-03-31'::date], 'AC-FCAL-002 2026-2027 is a fiscal year under an April start');
select is((select count(*)::int from public.pmo_fiscal_year_by_name('2026', 4)), 0,
  'AC-FCAL-002 2026 is not a fiscal year under an April start');
select is((select count(*)::int from public.pmo_fiscal_year_by_name('FY26', 4)), 0, 'AC-FCAL-002 FY26 is not a fiscal year');
select is((select count(*)::int from public.pmo_fiscal_year_by_name('2026-2028', 4)), 0,
  'AC-FCAL-002 2026-2028 is not a fiscal year');
select is((select array[start_date, end_date] from public.pmo_fiscal_year_by_name('2027', 1)),
  array['2027-01-01'::date, '2027-12-31'::date], 'AC-FCAL-002 2027 is a fiscal year under a January start');

-- AC-FCAL-003 ─ only an active Admin of an organization with no accounting system sets it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.set_org_fiscal_year_start_month(4)$$, '42501', null,
  'AC-FCAL-003 a Finance user cannot set the start month');
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027') where category = 'Labor'),
  null::numeric, 'AC-FCAL-003 before the Admin sets it, a year scope has no recorded figure');
select throws_ok($$select public.set_org_fiscal_year_start_month(13)$$, '22023', null,
  'AC-FCAL-003 month 13 is refused');
select is(public.set_org_fiscal_year_start_month(4), 4::smallint, 'AC-FCAL-003 the Admin sets April');
select is((select fiscal_year_start_month from public.organizations where id = '10180000-0000-0000-0000-000000000001'),
  4::smallint, 'AC-FCAL-003 the setting is stored');
select is((select count(*)::int from public.audit_events
            where action = 'org.fiscal_year_start.change' and org_id = '10180000-0000-0000-0000-000000000001'
              and detail = '{"from": null, "to": 4}'::jsonb), 1,
  'AC-FCAL-003 the change is audited with its before and after');
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.set_org_fiscal_year_start_month(7), 7::smallint, 'AC-FCAL-003 another org''s Admin sets their own org');
reset role;
select is((select fiscal_year_start_month from public.organizations where id = '10180000-0000-0000-0000-000000000001'),
  4::smallint, 'AC-FCAL-003 the other org''s change leaves this org untouched');
select ok(not has_function_privilege('anon', 'public.set_org_fiscal_year_start_month(integer)', 'execute'),
  'AC-FCAL-003 anon cannot call the setter');

-- AC-FCAL-004 ─ an organization that reads an accounting system keeps its calendar.
set local role authenticated;
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok($$select public.set_org_fiscal_year_start_month(1)$$, 'P0001', null,
  'AC-FCAL-004 a ledger org''s Admin cannot set a PMO start month');
select is(public.org_pmo_fiscal_start_month(), null::smallint, 'AC-FCAL-004 a stored start month is not read in a ledger org');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e5', '2026-2027') where category = 'Labor'),
  700::numeric, 'AC-FCAL-004 the ledger org still records its ledger figure for the year, not its PMO purchase');
select is(public.get_pmo_fiscal_calendar('10180000-0000-0000-0000-0000000000e5')->>'status', 'binding-unavailable',
  'AC-FCAL-004 the PMO calendar is not served in a ledger org');

-- AC-FCAL-005 ─ the ticket's done-when: the payment of 2027-03-31 counts in the year that started April 2026.
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027') where category = 'Labor'),
  1000::numeric, 'AC-FCAL-005 Labor in 2026-2027 is the 1,000 paid on 2027-03-31');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2027-2028') where category = 'Labor'),
  400::numeric, 'AC-FCAL-005 Labor in 2027-2028 is the 400 paid on 2027-04-01');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', null) where category = 'Labor'),
  1400::numeric, 'AC-FCAL-005 Labor in All years is 1,400');
select is((select remaining from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027') where category = 'Labor'),
  2000::numeric, 'AC-FCAL-005 Labor 2026-2027 remaining is its 3,000 budget less 1,000');
select is((select has_ledger from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027') where category = 'Labor'),
  true, 'AC-FCAL-005 the year row has paid spending behind it');
select is((select recorded_as_of::date from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027') where category = 'Labor'),
  '2027-03-31'::date, 'AC-FCAL-005 the year row is as of its latest payment in the year');
select is(
  (select sum(recorded) from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027'))
  + (select sum(recorded) from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2027-2028')),
  (select sum(recorded) from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', null)),
  'AC-FCAL-005 the two years add up to All years');

-- AC-FCAL-006 ─ a year with nothing paid is a known 0; a label that is not a fiscal year, or no calendar, stays unknown.
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2027-2028') where category = 'Subcontractors'),
  0::numeric, 'AC-FCAL-006 Subcontractors with nothing paid in 2027-2028 is a known 0');
select is((select budget_total from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', 'FY26') where category = 'Overheads'),
  100::numeric, 'AC-FCAL-006 the FY26 budget line keeps its budget');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', 'FY26') where category = 'Overheads'),
  null::numeric, 'AC-FCAL-006 FY26 is not a fiscal year, so its recorded is unknown');
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e4', '2026-2027') where category = 'Labor'),
  null::numeric, 'AC-FCAL-006 with no start month a year scope stays unknown');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e4', null) where category = 'Labor'),
  250::numeric, 'AC-FCAL-006 and All years is unchanged');

-- AC-FCAL-007 ─ a taxed purchase paid across two years: each year counts its pre-tax share.
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027') where category = 'Materials'),
  500::numeric, 'AC-FCAL-007 Materials 2026-2027 is 550 paid less its tax share: 500');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2027-2028') where category = 'Materials'),
  500::numeric, 'AC-FCAL-007 Materials 2027-2028 is 500');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', null) where category = 'Materials'),
  1000::numeric, 'AC-FCAL-007 the shares add up to the all-years pre-tax 1,000');

-- AC-FCAL-008 ─ the hire charge sits in the year of its work month.
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2026-2027') where category = 'Equipment'),
  200::numeric, 'AC-FCAL-008 March 2027 hire (200) is in 2026-2027');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e1', '2027-2028') where category = 'Equipment'),
  100::numeric, 'AC-FCAL-008 April 2027 hire (100) is in 2027-2028');

-- AC-FCAL-009 ─ a paid payment with no date cannot be placed.
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e2', '2026-2027') where category = 'Labor'),
  null::numeric, 'AC-FCAL-009 an undated paid payment makes its category unknown in a year');
select is((select recorded from public.get_budget_comparison('10180000-0000-0000-0000-0000000000e2', null) where category = 'Labor'),
  300::numeric, 'AC-FCAL-009 and it still counts in All years');

-- AC-FCAL-010 ─ the project's PMO calendar, in the shape the Budget tab reads from an accounting system.
select is(public.get_pmo_fiscal_calendar('10180000-0000-0000-0000-0000000000e1'),
  '{"status":"resolved","project":{"start":"2026-06-01","end":"2027-08-31"},"years":[
     {"name":"2026-2027","start":"2026-04-01","end":"2027-03-31"},
     {"name":"2027-2028","start":"2027-04-01","end":"2028-03-31"}]}'::jsonb,
  'AC-FCAL-010 a project across two April-start years resolves to both years');
select is(public.get_pmo_fiscal_calendar('10180000-0000-0000-0000-0000000000e3'),
  '{"status":"resolved","project":{"start":"2026-06-01","end":null},"years":[
     {"name":"2026-2027","start":"2026-04-01","end":"2027-03-31"}]}'::jsonb,
  'AC-FCAL-010 an open-ended project holds only its start year');
select is(public.get_pmo_fiscal_calendar('10180000-0000-0000-0000-0000000000e6')->>'status', 'bad-project-dates',
  'AC-FCAL-010 a project with no start date has no calendar');
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select is(public.get_pmo_fiscal_calendar('10180000-0000-0000-0000-0000000000e4')->>'status', 'unresolved',
  'AC-FCAL-010 with no start month the calendar is unresolved');
set local request.jwt.claims = '{"sub":"10180000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.get_pmo_fiscal_calendar('10180000-0000-0000-0000-0000000000e1'), null::jsonb,
  'AC-FCAL-010 another organization''s project returns nothing');

select * from finish();
rollback;
