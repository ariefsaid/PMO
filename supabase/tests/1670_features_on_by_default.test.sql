-- 1670_features_on_by_default.test.sql — migration under test: 1670. New organisations get every pile-1 switch ON, five module switches ON,
-- the seven settings rows and the starter rows; the seeders are the ones the setters call (idempotent); the module backfill turns a
-- module OFF for an organisation without rows in the module's own tables and ON with them; the audit trigger covers the module columns.
-- Mutation check: change `default true` of organizations.module_stock to false, or drop the seed_purchase_types call from
-- apply_org_switch_defaults: the defaults and starter-row cases go red.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('16700000-0000-0000-0000-00000000000a', 'Defaults A', 'IDR', 'UTC'),
  ('16700000-0000-0000-0000-00000000000b', 'Defaults B', 'IDR', 'UTC'),
  ('16700000-0000-0000-0000-00000000000c', 'Defaults C', 'IDR', 'UTC');
insert into auth.users (id, email) values ('16700000-0000-0000-0000-0000000000c1', 'defaults-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16700000-0000-0000-0000-0000000000c1', '16700000-0000-0000-0000-00000000000c', 'Defaults Admin', 'defaults-admin@example.com', 'Admin', 'active');

-- ── a new organisation: every pile-1 switch and module is ON ───────────────────────────────────────────────────────────────
select is((select built_in_roles_enabled and clearance_checklist_enabled and leave_requests_enabled and crew_loans_enabled
                  and discipline_profit_enabled and performance_indices_enabled and stock_wo_transfers and stock_reservations
                  and purchase_line_planning and safety_records_enabled
             from organizations where id = '16700000-0000-0000-0000-00000000000a'), true,
  'a new organisation has the ten organisation-column switches on');
select is((select module_people_crews and module_site_day and module_stock and module_purchasing_extras and module_billing_extras
             from organizations where id = '16700000-0000-0000-0000-00000000000a'), true, 'a new organisation has all five modules on');
select is((select (select enabled from idle_cost_settings where org_id = o.id)
              and (select enabled from org_revenue_plan_settings where org_id = o.id)
              and (select enabled from org_purchase_type_settings where org_id = o.id)
              and (select enabled from org_payment_channel_settings where org_id = o.id)
              and (select enabled from issue_closing_report_settings where org_id = o.id)
              and (select print_enabled from purchase_order_settings where org_id = o.id)
              and (select delivery_note_enabled from material_request_settings where org_id = o.id)
             from organizations o where o.id = '16700000-0000-0000-0000-00000000000a'), true,
  'a new organisation has the seven settings-table switches on');
select is((select count(*)::int from purchase_line_categories where org_id = '16700000-0000-0000-0000-00000000000a'), 2, 'new organisation: 2 line categories');
select is((select count(*)::int from purchase_types where org_id = '16700000-0000-0000-0000-00000000000a'), 3, 'new organisation: 3 purchase types');
select is((select count(*)::int from org_payment_channels where org_id = '16700000-0000-0000-0000-00000000000a'), 4, 'new organisation: 4 payment channels');

-- ── seeded once: running the defaults again changes nothing ─────────────────────────────────────────────────────────────────
select apply_org_switch_defaults('16700000-0000-0000-0000-00000000000a');
select is((select (select count(*) from purchase_line_categories where org_id = o.id) * 10000 + (select count(*) from purchase_types where org_id = o.id) * 100
                  + (select count(*) from org_payment_channels where org_id = o.id)
             from organizations o where o.id = '16700000-0000-0000-0000-00000000000a'), 20304::bigint, 'running the defaults again seeds nothing twice');
select is((select count(*)::int from org_payment_channel_settings where org_id = '16700000-0000-0000-0000-00000000000a'), 1, 'and keeps one settings row');

-- ── the setters call the same seeders: same rows as the trigger gave organisation A ────────────────────────────────────────
delete from purchase_line_categories where org_id = '16700000-0000-0000-0000-00000000000c';
delete from purchase_types where org_id = '16700000-0000-0000-0000-00000000000c';
delete from org_payment_channels where org_id = '16700000-0000-0000-0000-00000000000c';
create function public.d1670_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
select d1670_as('16700000-0000-0000-0000-0000000000c1');
select set_purchase_line_planning(true);
select set_purchase_types_enabled(true);
select set_payment_channel_settings(true);
reset role;
select is((select array_agg(name order by position) from purchase_line_categories where org_id = '16700000-0000-0000-0000-00000000000c'),
          (select array_agg(name order by position) from purchase_line_categories where org_id = '16700000-0000-0000-0000-00000000000a'),
  'the line planning setter seeds the same categories as a new organisation');
select is((select array_agg(name || is_rental::text order by position) from purchase_types where org_id = '16700000-0000-0000-0000-00000000000c'),
          (select array_agg(name || is_rental::text order by position) from purchase_types where org_id = '16700000-0000-0000-0000-00000000000a'),
  'the purchase types setter seeds the same types as a new organisation');
select is((select array_agg(name order by sort_order) from org_payment_channels where org_id = '16700000-0000-0000-0000-00000000000c'),
          (select array_agg(name order by sort_order) from org_payment_channels where org_id = '16700000-0000-0000-0000-00000000000a'),
  'the payment channels setter seeds the same channels as a new organisation');
select d1670_as('16700000-0000-0000-0000-0000000000c1');
select set_purchase_types_enabled(false);
select set_purchase_types_enabled(true);
reset role;
select is((select count(*)::int from purchase_types where org_id = '16700000-0000-0000-0000-00000000000c'), 3, 'turning a switch off and on again seeds nothing twice');

-- ── the module backfill: no rows = off, rows = on ──────────────────────────────────────────────────────────────────────────────
delete from purchase_line_categories where org_id = '16700000-0000-0000-0000-00000000000b';
delete from purchase_types where org_id = '16700000-0000-0000-0000-00000000000b';
delete from org_payment_channels where org_id = '16700000-0000-0000-0000-00000000000b';
select backfill_org_modules('16700000-0000-0000-0000-00000000000b');
select is((select not (module_people_crews or module_site_day or module_stock or module_purchasing_extras or module_billing_extras)
             from organizations where id = '16700000-0000-0000-0000-00000000000b'), true,
  'an existing organisation with no rows in any module table gets every module off');
insert into leave_types (org_id, name) values ('16700000-0000-0000-0000-00000000000b', 'Annual');
insert into purchase_types (org_id, name, is_rental, position) values ('16700000-0000-0000-0000-00000000000b', 'Goods', false, 1);
select backfill_org_modules('16700000-0000-0000-0000-00000000000b');
select is((select array[module_people_crews, module_site_day, module_stock, module_purchasing_extras, module_billing_extras]
             from organizations where id = '16700000-0000-0000-0000-00000000000b'), array[true, false, false, true, false],
  'an organisation with leave and purchase type rows gets exactly those two modules on');

-- ── audit: a module change by an Admin writes one event; an unchanged write none ─────────────────────────────────────────────
select d1670_as('16700000-0000-0000-0000-0000000000c1');
update organizations set module_stock = false where id = '16700000-0000-0000-0000-00000000000c';
update organizations set module_stock = false where id = '16700000-0000-0000-0000-00000000000c';
reset role;
select is((select count(*)::int from audit_events where action = 'org.setting.change' and org_id = '16700000-0000-0000-0000-00000000000c'
             and detail ->> 'setting' = 'organizations.module_stock'), 1, 'a module change is audited once, an unchanged write not at all');

select * from finish();
rollback;
