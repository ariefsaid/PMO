-- 2161_opening_balances_overview.test.sql — docs/specs/opening-balances-screen.spec.md. Migration under test: 2161_opening_balances_overview.sql.
-- AC-OBS-001 Admin and Finance read it, nobody else · AC-OBS-002 the load date, who loaded and the per-line figures are returned ·
-- AC-OBS-003 another organisation's openings and reversed openings are not shown · AC-OBS-007 history movements net to one item balance.
begin;
create extension if not exists pgtap;
select plan(23);

insert into organizations (id, name, default_currency, default_timezone) values
  ('21610000-0000-0000-0000-000000000001', 'OBS Org',   'USD', 'UTC'),
  ('21610000-0000-0000-0000-000000000002', 'OBS Other', 'USD', 'UTC');
-- The cross-organisation read check needs the function to pass its per-org opt-in gate first.
insert into org_setup_workflow_settings (org_id, enabled)
values ('21610000-0000-0000-0000-000000000002', true);
insert into auth.users (id, email) values
  ('21610000-0000-0000-0000-0000000000a1', 'obs-admin@example.invalid'),
  ('21610000-0000-0000-0000-0000000000a2', 'obs-fin@example.invalid'),
  ('21610000-0000-0000-0000-0000000000a3', 'obs-pm@example.invalid'),
  ('21610000-0000-0000-0000-0000000000a4', 'obs-light@example.invalid'),
  ('21610000-0000-0000-0000-0000000000a5', 'obs-disabled@example.invalid'),
  ('21610000-0000-0000-0000-0000000000b1', 'obs-xadmin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('21610000-0000-0000-0000-0000000000a1', '21610000-0000-0000-0000-000000000001', 'OBS Admin', 'obs-admin@example.invalid', 'Admin', 'active', null),
  ('21610000-0000-0000-0000-0000000000a2', '21610000-0000-0000-0000-000000000001', 'OBS Fin',   'obs-fin@example.invalid',   'Finance', 'active', null),
  ('21610000-0000-0000-0000-0000000000a3', '21610000-0000-0000-0000-000000000001', 'OBS PM',    'obs-pm@example.invalid',    'Project Manager', 'active', null),
  ('21610000-0000-0000-0000-0000000000a4', '21610000-0000-0000-0000-000000000001', 'OBS Field', 'obs-light@example.invalid', 'Engineer', 'active', 'foreman'),
  ('21610000-0000-0000-0000-0000000000a5', '21610000-0000-0000-0000-000000000001', 'OBS Disabled', 'obs-disabled@example.invalid', 'Admin', 'disabled', null),
  ('21610000-0000-0000-0000-0000000000b1', '21610000-0000-0000-0000-000000000002', 'OBS XAdm',  'obs-xadmin@example.invalid', 'Admin', 'active', null);
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
  ('21610000-0000-0000-0000-000000002001', '21610000-0000-0000-0000-000000000001', 'CEN', 'Central', 'central'),
  ('21610000-0000-0000-0000-000000002002', '21610000-0000-0000-0000-000000000001', 'MOV', 'Movement history', 'central');

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
select set_config('obs.golive', (current_date - 3)::text, true);

-- AC-OBS-007: setup workflows are off for existing organisations until their Admin enables them.
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a1');
select throws_ok($$select * from public.opening_balances_overview()$$, '42501', 'setup workflows are disabled for this organisation', 'AC-OBS-007 an existing organisation is off by default');
select lives_ok($$insert into public.org_setup_workflow_settings (enabled) values (true)$$, 'AC-OBS-007 an Admin enables setup workflows for the organisation');

-- The CLI loaders write the rows the screen reads; the Admin loads one work-order opening and two stock openings.
select lives_ok($$select public.load_work_order_opening('21610000-0000-0000-0000-000000000031', current_setting('obs.golive')::date,
  '[{"boq_item_id":"21610000-0000-0000-0000-0000000000e1","certified_quantity":4,"claimed_quantity":3}]', 'source row 12')$$, 'setup: Admin loads a work-order opening');
select lives_ok($$select public.load_stock_opening('21610000-0000-0000-0000-000000002001', current_setting('obs.golive')::date,
  '[{"item_id":"21610000-0000-0000-0000-000000001001","counted_quantity":10,"unit_cost":5}]')$$, 'setup: Admin loads one counted stock opening');
select lives_ok($$select public.load_stock_opening_history(current_setting('obs.golive')::date,
  jsonb_build_array(
    jsonb_build_object('location','MOV','item','BOLT','direction','in','date',(current_date - 4)::text,'quantity',10,'unit_cost',5),
    jsonb_build_object('location','MOV','item','BOLT','direction','out','date',(current_date - 3)::text,'quantity',4)),
  '21610000-0000-0000-0000-0000000000c2', 'history fixture')$$, 'AC-OBS-007 a history opening with repeated item movements loads');

-- AC-OBS-001 / 002
select is((select count(*)::int from public.opening_balances_overview()), 3, 'AC-OBS-001 an Admin reads each live opening');
select is((select loaded_by_name from public.opening_balances_overview() where label = 'CEN'), 'OBS Admin', 'AC-OBS-002 who loaded is returned');
select is((select as_of from public.opening_balances_overview() where label = 'CEN'), current_date - 3, 'AC-OBS-002 the go-live date is returned');
select is((select stock_value from public.opening_balances_overview() where label = 'CEN'), 50::numeric, 'AC-OBS-002 the counted stock value is the quantity times the cost');
select is((select lines->0->>'item_code' from public.opening_balances_overview() where label = 'CEN'), 'BOLT', 'AC-OBS-002 the item is named per location');
select is((select jsonb_array_length(lines) from public.opening_balances_overview() where label = 'MOV'), 1, 'AC-OBS-007 repeated movements render as one item opening');
select is((select (lines->0->>'quantity')::numeric from public.opening_balances_overview() where label = 'MOV'), 6::numeric, 'AC-OBS-007 history detail shows the net quantity');
select is((select (lines->0->>'value')::numeric from public.opening_balances_overview() where label = 'MOV'), 30::numeric, 'AC-OBS-007 history detail shows the net value');
select is((select certified_value from public.opening_balances_overview() where kind = 'work_order'), 4000::numeric, 'AC-OBS-002 the certified value is the quantity times the rate');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.opening_balances_overview()), 3, 'AC-OBS-001 Finance reads the openings');
select throws_ok($$insert into public.org_setup_workflow_settings (enabled) values (false)$$, '42501', null, 'AC-OBS-007 Finance cannot change the organisation opt-in');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a3');
select throws_ok($$select * from public.opening_balances_overview()$$, '42501', 'only Admin and Finance read the opening balances', 'AC-OBS-001 a Project Manager is refused');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.opening_balances_overview()), 0, 'AC-OBS-003 another organisation sees none of these');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a4');
select throws_ok($$select * from public.opening_balances_overview()$$, '42501', 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this', 'AC-OBS-001 a field account is refused');
reset role;
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a5');
select throws_ok($$select * from public.opening_balances_overview()$$, '42501', 'your account is not an active member of this organisation, so it cannot write — an offboarded or suspended account is refused even while its session token is still valid', 'AC-OBS-001 an inactive member is refused');
reset role;
select is(has_function_privilege('anon', 'public.opening_balances_overview()', 'EXECUTE'), false, 'AC-OBS-001 anon cannot execute it');

-- AC-OBS-003: reversing an opening removes it from this read without hiding the other live rows.
select pg_temp.as_user('21610000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.reverse_opening_balance((select id from public.opening_balances where warehouse_id = '21610000-0000-0000-0000-000000002002'))$$, 'AC-OBS-003 an Admin can reverse the history opening');
select is((select count(*)::int from public.opening_balances_overview() where kind = 'stock'), 1, 'AC-OBS-003 the reversed history opening is omitted');

select * from finish();
rollback;
