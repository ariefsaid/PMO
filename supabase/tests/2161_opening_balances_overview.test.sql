-- 2161_opening_balances_overview.test.sql — docs/specs/opening-balances-screen.spec.md. Migration under test: 2161_opening_balances_overview.sql.
-- AC-OBS-001 Admin and Finance read it, nobody else · AC-OBS-002 the load date, who loaded and the per-line figures are returned ·
-- AC-OBS-003 another organisation's openings and reversed openings are not shown.
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, default_timezone) values
  ('21610000-0000-0000-0000-000000000001', 'OBS Org',   'USD', 'UTC'),
  ('21610000-0000-0000-0000-000000000002', 'OBS Other', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('21610000-0000-0000-0000-0000000000a1', 'obs-admin@example.invalid'),
  ('21610000-0000-0000-0000-0000000000a2', 'obs-fin@example.invalid'),
  ('21610000-0000-0000-0000-0000000000a3', 'obs-pm@example.invalid'),
  ('21610000-0000-0000-0000-0000000000b1', 'obs-xadmin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21610000-0000-0000-0000-0000000000a1', '21610000-0000-0000-0000-000000000001', 'OBS Admin', 'obs-admin@example.invalid', 'Admin', 'active'),
  ('21610000-0000-0000-0000-0000000000a2', '21610000-0000-0000-0000-000000000001', 'OBS Fin',   'obs-fin@example.invalid',   'Finance', 'active'),
  ('21610000-0000-0000-0000-0000000000a3', '21610000-0000-0000-0000-000000000001', 'OBS PM',    'obs-pm@example.invalid',    'Project Manager', 'active'),
  ('21610000-0000-0000-0000-0000000000b1', '21610000-0000-0000-0000-000000000002', 'OBS XAdm',  'obs-xadmin@example.invalid', 'Admin', 'active');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency) values
  ('21610000-0000-0000-0000-0000000000c1', '21610000-0000-0000-0000-000000000001', 'OBS Project', 'Ongoing Project', 100000, 'exclusive', 0, 'USD');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('21610000-0000-0000-0000-0000000000e1', '21610000-0000-0000-0000-000000000001', '21610000-0000-0000-0000-0000000000c1', 'L1', 'Line one', 'm', 20, 1000);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('21610000-0000-0000-0000-000000000031', '21610000-0000-0000-0000-000000000001', '21610000-0000-0000-0000-0000000000c1', 'OBS WO A', 'Issued', 20000, 'exclusive', 0, 'USD');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('21610000-0000-0000-0000-000000000001', '21610000-0000-0000-0000-000000000031', '21610000-0000-0000-0000-0000000000e1', 20);
insert into stock_units (id, org_id, code, name, whole_only) values ('21610000-0000-0000-0000-0000000000d1', '21610000-0000-0000-0000-000000000001', 'pc', 'Piece', true);
insert into stock_items (id, org_id, code, name, unit_id) values ('21610000-0000-0000-0000-000000001001', '21610000-0000-0000-0000-000000000001', 'BOLT', 'Bolt', '21610000-0000-0000-0000-0000000000d1');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('21610000-0000-0000-0000-000000002001', '21610000-0000-0000-0000-000000000001', 'CEN', 'Central', 'central');

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
select set_config('obs.golive', (current_date - 3)::text, true);

-- The CLI loaders write the rows the screen reads; the Admin loads one work-order opening and one stock opening.
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.load_work_order_opening('21610000-0000-0000-0000-000000000031', current_setting('obs.golive')::date,
  '[{"boq_item_id":"21610000-0000-0000-0000-0000000000e1","certified_quantity":4,"claimed_quantity":3}]', 'source row 12')$$, 'setup: Admin loads a work-order opening');
select lives_ok($$select public.load_stock_opening('21610000-0000-0000-0000-000000002001', current_setting('obs.golive')::date,
  '[{"item_id":"21610000-0000-0000-0000-000000001001","counted_quantity":10,"unit_cost":5}]')$$, 'setup: Admin loads a stock opening');

-- AC-OBS-001 / 002
select is((select count(*)::int from public.opening_balances_overview()), 2, 'AC-OBS-001 an Admin reads both openings');
select is((select loaded_by_name from public.opening_balances_overview() where kind = 'stock'), 'OBS Admin', 'AC-OBS-002 who loaded is returned');
select is((select as_of from public.opening_balances_overview() where kind = 'stock'), current_date - 3, 'AC-OBS-002 the go-live date is returned');
select is((select stock_value from public.opening_balances_overview() where kind = 'stock'), 50::numeric, 'AC-OBS-002 the stock value is the quantity times the cost');
select is((select lines->0->>'item_code' from public.opening_balances_overview() where kind = 'stock'), 'BOLT', 'AC-OBS-002 the item is named per location');
select is((select certified_value from public.opening_balances_overview() where kind = 'work_order'), 4000::numeric, 'AC-OBS-002 the certified value is the quantity times the rate');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.opening_balances_overview()), 2, 'AC-OBS-001 Finance reads the openings');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a3');
select throws_ok($$select * from public.opening_balances_overview()$$, '42501', 'only Admin and Finance read the opening balances', 'AC-OBS-001 a Project Manager is refused');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.opening_balances_overview()), 0, 'AC-OBS-003 another organisation sees none of these');
reset role;
select is(has_function_privilege('anon', 'public.opening_balances_overview()', 'EXECUTE'), false, 'AC-OBS-001 anon cannot execute it');

select * from finish();
rollback;
