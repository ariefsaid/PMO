-- On the PMO paid-purchase basis a paid purchase with no budget category is its own row whose category amount is
-- unknown. Every category that was read keeps its figure; a by-category total that would include the uncategorized
-- money is NULL (incomplete), never a partial sum, and actuals.uncategorized states what was paid with no category.
begin;
create extension if not exists pgtap;
select plan(22);

insert into public.organizations (id, name, default_currency) values
  ('09090000-0000-0000-0000-000000000001', 'Category unknown org', 'USD');
insert into auth.users (id, email) values
  ('09090000-0000-0000-0000-0000000000a1', 'budget-category-unknown@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('09090000-0000-0000-0000-0000000000a1', '09090000-0000-0000-0000-000000000001', 'Category Admin',
   'budget-category-unknown@example.test', 'Admin', 'active');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount,
                             tax_rate, tax_base_numerator, tax_base_denominator, subject_to_vat) values
  ('09090000-0000-0000-0000-0000000000d1', '09090000-0000-0000-0000-000000000001', 'One uncategorized', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('09090000-0000-0000-0000-0000000000d2', '09090000-0000-0000-0000-000000000001', 'All categorized', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false),
  ('09090000-0000-0000-0000-0000000000d3', '09090000-0000-0000-0000-000000000001', 'Uncategorized other currency', 'Ongoing Project', 'USD', 1000, 'exclusive', 0, 0, 1, 1, false);

set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
insert into public.procurements (id, org_id, title, status, total_value, project_id, currency, budget_category, origin) values
  ('09090000-0000-0000-0000-0000000000f1', '09090000-0000-0000-0000-000000000001', 'Labor buy', 'Paid', 100,
   '09090000-0000-0000-0000-0000000000d1', 'USD', 'Labor', null),
  ('09090000-0000-0000-0000-0000000000f2', '09090000-0000-0000-0000-000000000001', 'Materials buy', 'Paid', 200,
   '09090000-0000-0000-0000-0000000000d1', 'USD', 'Materials', null),
  ('09090000-0000-0000-0000-0000000000f3', '09090000-0000-0000-0000-000000000001', 'Subcontract buy', 'Paid', 300,
   '09090000-0000-0000-0000-0000000000d1', 'USD', 'Subcontractors', null),
  ('09090000-0000-0000-0000-0000000000f4', '09090000-0000-0000-0000-000000000001', 'Uncategorized buy', 'Paid', 50,
   '09090000-0000-0000-0000-0000000000d1', 'USD', null, null),
  ('09090000-0000-0000-0000-0000000000f5', '09090000-0000-0000-0000-000000000001', 'Labor buy two', 'Paid', 70,
   '09090000-0000-0000-0000-0000000000d2', 'USD', 'Labor', null),
  ('09090000-0000-0000-0000-0000000000f6', '09090000-0000-0000-0000-000000000001', 'Materials buy two', 'Paid', 30,
   '09090000-0000-0000-0000-0000000000d2', 'USD', 'Materials', null),
  ('09090000-0000-0000-0000-0000000000f7', '09090000-0000-0000-0000-000000000001', 'Labor buy three', 'Paid', 40,
   '09090000-0000-0000-0000-0000000000d3', 'USD', 'Labor', null),
  ('09090000-0000-0000-0000-0000000000f8', '09090000-0000-0000-0000-000000000001', 'Uncategorized EUR buy', 'Paid', 90,
   '09090000-0000-0000-0000-0000000000d3', 'EUR', null, null);
insert into public.payments (id, org_id, procurement_id, status, date, amount, currency) values
  ('09090000-0000-0000-0000-0000000000c1', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f1', 'Paid', '2026-10-10', 100, 'USD'),
  ('09090000-0000-0000-0000-0000000000c2', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f2', 'Paid', '2026-10-10', 200, 'USD'),
  ('09090000-0000-0000-0000-0000000000c3', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f3', 'Paid', '2026-10-10', 300, 'USD'),
  ('09090000-0000-0000-0000-0000000000c4', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f4', 'Paid', '2026-10-10', 50, 'USD'),
  ('09090000-0000-0000-0000-0000000000c5', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f5', 'Paid', '2026-10-10', 70, 'USD'),
  ('09090000-0000-0000-0000-0000000000c6', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f6', 'Paid', '2026-10-10', 30, 'USD'),
  ('09090000-0000-0000-0000-0000000000c7', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f7', 'Paid', '2026-10-10', 40, 'USD'),
  ('09090000-0000-0000-0000-0000000000c8', '09090000-0000-0000-0000-000000000001', '09090000-0000-0000-0000-0000000000f8', 'Paid', '2026-10-10', 90, 'EUR');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"09090000-0000-0000-0000-0000000000a1","role":"authenticated"}';

create temp table fin1 on commit drop as
  select public.get_project_finances('09090000-0000-0000-0000-0000000000d1')->'actuals' as a;
create temp table fin2 on commit drop as
  select public.get_project_finances('09090000-0000-0000-0000-0000000000d2')->'actuals' as a;
create temp table fin3 on commit drop as
  select public.get_project_finances('09090000-0000-0000-0000-0000000000d3')->'actuals' as a;

-- One unreadable (uncategorized) amount among three read categories keeps the three.
select is((select (c->>'amount')::numeric from fin1, jsonb_array_elements(a->'categories') c where c->>'category' = 'Labor'),
  100::numeric, 'AC-2330-001 a read category keeps its figure beside an uncategorized paid purchase (Labor)');
select is((select (c->>'amount')::numeric from fin1, jsonb_array_elements(a->'categories') c where c->>'category' = 'Materials'),
  200::numeric, 'AC-2330-001 a read category keeps its figure beside an uncategorized paid purchase (Materials)');
select is((select (c->>'amount')::numeric from fin1, jsonb_array_elements(a->'categories') c where c->>'category' = 'Subcontractors'),
  300::numeric, 'AC-2330-001 a read category keeps its figure beside an uncategorized paid purchase (Subcontractors)');
select is((select count(*)::int from fin1, jsonb_array_elements(a->'categories') c where not (c->>'mapped')::boolean),
  0, 'AC-2330-001 no read category is marked unknown because another purchase has no category');
select is((select (c->>'amount')::numeric from fin1, jsonb_array_elements(a->'categories') c where c->>'category' = 'Equipment'),
  0::numeric, 'AC-2330-001 a category with no paid purchases stays a known zero');
select is((select (c->>'tagged_amount')::numeric from fin1, jsonb_array_elements(a->'categories') c where c->>'category' = 'Labor'),
  100::numeric, 'AC-2330-001 a read category keeps its purchase (tagged) figure');

-- The uncategorized amount is its own unknown row, not one of the categories.
select is((select count(*)::int from public.project_finance_actuals('09090000-0000-0000-0000-0000000000d1') where category is null),
  1, 'AC-2330-002 the uncategorized paid spend is one row of its own');
select ok((select actuals_to_date is null and mapped from public.project_finance_actuals('09090000-0000-0000-0000-0000000000d1') where category is null),
  'AC-2330-002 the uncategorized row is an unknown amount that totals must count');
select is((select count(*)::int from fin1, jsonb_array_elements(a->'categories') c where jsonb_typeof(c->'category') <> 'string'),
  0, 'AC-2330-002 the categories list names only real budget categories');

-- Totals that depend on the uncategorized amount are incomplete, never the partial 600.
select is(a->>'total', null, 'AC-2330-003 the spending total including an uncategorized purchase is incomplete') from fin1;
select is(a->>'tagged_total', null, 'AC-2330-003 the purchase total including an uncategorized purchase is incomplete') from fin1;
-- The reason the by-category total is incomplete: what was paid with no category, so the categories account for it.
select is((a->'uncategorized'->>'amount')::numeric, 50::numeric,
  'AC-2330-003 the uncategorized paid amount is stated beside the categories (600 + 50 = what was paid)') from fin1;
select is((select (a->'uncategorized'->>'amount')::numeric + sum((c->>'amount')::numeric)
             from fin1, jsonb_array_elements(a->'categories') c group by a),
  650::numeric, 'AC-2330-003 the categories and the uncategorized amount together account for every paid purchase');
select ok((select a ? 'uncategorized' and a->'uncategorized' ? 'amount' and a->'uncategorized'->>'amount' is null from fin3),
  'AC-2330-003 an uncategorized purchase in another currency is stated with an unknown amount');
select is((select (c->>'amount')::numeric from fin3, jsonb_array_elements(a->'categories') c where c->>'category' = 'Labor'),
  40::numeric, 'AC-2330-003 a read category keeps its figure beside an uncategorized purchase in another currency');
-- Parts of the total that the uncategorized purchase does not touch stay known.
select is((a->>'attributed_total')::numeric, 0::numeric,
  'AC-2330-003 the attributed total stays known beside an uncategorized purchase (PMO basis attributes nothing)') from fin1;
select is((a->>'equipment_charge_total')::numeric, 0::numeric,
  'AC-2330-003 the equipment charge total stays known beside an uncategorized purchase') from fin1;
select is((a->>'equipment_charge_total')::numeric, 0::numeric,
  'AC-2330-003 the equipment charge total stays known beside an uncategorized purchase in another currency') from fin3;

-- All readable: none unknown, totals complete.
select is((select count(*)::int from public.project_finance_actuals('09090000-0000-0000-0000-0000000000d2') where category is null or not mapped),
  0, 'AC-2330-004 with every purchase categorized no category is unknown');
select is((a->>'total')::numeric, 100::numeric, 'AC-2330-004 with every purchase categorized the total is complete') from fin2;
select is((select (c->>'amount')::numeric from fin2, jsonb_array_elements(a->'categories') c where c->>'category' = 'Labor'),
  70::numeric, 'AC-2330-004 with every purchase categorized each category keeps its figure');
select ok(not (a ? 'uncategorized'), 'AC-2330-004 with every purchase categorized nothing is stated as uncategorized') from fin2;
reset role;

select * from finish();
rollback;
