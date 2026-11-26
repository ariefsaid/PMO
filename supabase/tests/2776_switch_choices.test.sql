begin;
create extension if not exists pgtap;
select plan(8);

insert into public.organizations (id, name, default_currency, default_timezone)
values ('27760000-0000-0000-0000-000000000001', 'Switch test', 'IDR', 'UTC');
update public.idle_cost_settings set enabled = false where org_id = '27760000-0000-0000-0000-000000000001';
update public.org_revenue_plan_settings set enabled = false where org_id = '27760000-0000-0000-0000-000000000001';
update public.org_purchase_type_settings set enabled = false where org_id = '27760000-0000-0000-0000-000000000001';
update public.org_payment_channel_settings set enabled = false where org_id = '27760000-0000-0000-0000-000000000001';
update public.issue_closing_report_settings set enabled = false where org_id = '27760000-0000-0000-0000-000000000001';
update public.purchase_order_settings set print_enabled = false where org_id = '27760000-0000-0000-0000-000000000001';
update public.material_request_settings set delivery_note_enabled = false where org_id = '27760000-0000-0000-0000-000000000001';
update public.organizations set module_people_crews = false, module_site_day = false, module_stock = false, module_purchasing_extras = false, module_billing_extras = false where id = '27760000-0000-0000-0000-000000000001';
select public.apply_org_switch_defaults('27760000-0000-0000-0000-000000000001');
select is((select enabled from public.idle_cost_settings where org_id = '27760000-0000-0000-0000-000000000001'), false, 'idle cost keeps its off choice');
select is((select enabled from public.org_revenue_plan_settings where org_id = '27760000-0000-0000-0000-000000000001'), false, 'revenue plan keeps its off choice');
select is((select enabled from public.org_purchase_type_settings where org_id = '27760000-0000-0000-0000-000000000001'), false, 'purchase types keep their off choice');
select is((select enabled from public.org_payment_channel_settings where org_id = '27760000-0000-0000-0000-000000000001'), false, 'payment channels keep their off choice');
select is((select enabled from public.issue_closing_report_settings where org_id = '27760000-0000-0000-0000-000000000001'), false, 'closing reports keep their off choice');
select is((select print_enabled from public.purchase_order_settings where org_id = '27760000-0000-0000-0000-000000000001'), false, 'purchase order printing keeps its off choice');
select is((select delivery_note_enabled from public.material_request_settings where org_id = '27760000-0000-0000-0000-000000000001'), false, 'delivery notes keep their off choice');
select is((select array[module_people_crews, module_site_day, module_stock, module_purchasing_extras, module_billing_extras] from public.organizations where id = '27760000-0000-0000-0000-000000000001'), array[false, false, false, false, false], 'all five modules keep their off choices');
select * from finish();
rollback;
