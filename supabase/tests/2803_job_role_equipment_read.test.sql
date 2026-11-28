begin;
create extension if not exists pgtap;
select plan(2);
insert into organizations (id, name, default_currency, built_in_roles_enabled) values ('28030000-0000-0000-0000-000000000005', 'Equipment rights', 'IDR', true);
insert into auth.users (id, email) values ('28030000-0000-0000-0000-000000000101', 'equipment-pa@example.com'), ('28030000-0000-0000-0000-000000000102', 'equipment-store@example.com'), ('28030000-0000-0000-0000-000000000103', 'equipment-author@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
 ('28030000-0000-0000-0000-000000000101', '28030000-0000-0000-0000-000000000005', 'Administrator', 'equipment-pa@example.com', 'Engineer', 'active', 'project_administrator'),
 ('28030000-0000-0000-0000-000000000102', '28030000-0000-0000-0000-000000000005', 'Store', 'equipment-store@example.com', 'Engineer', 'active', 'storekeeper'),
 ('28030000-0000-0000-0000-000000000103', '28030000-0000-0000-0000-000000000005', 'Author', 'equipment-author@example.com', 'Engineer', 'active', 'equipment_officer');
insert into projects (id, org_id, name, status) values ('28030000-0000-0000-0000-000000000111', '28030000-0000-0000-0000-000000000005', 'Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values ('28030000-0000-0000-0000-000000000112', '28030000-0000-0000-0000-000000000005', '28030000-0000-0000-0000-000000000111', 'Order', 'Issued', 0, 'exclusive', 0);
insert into equipment_assets (id, org_id, code, name) values ('28030000-0000-0000-0000-000000000113', '28030000-0000-0000-0000-000000000005', 'E1', 'Excavator');
insert into equipment_usage_entries (org_id, asset_id, project_id, work_order_id, work_date, quantity, unit, author_id) values ('28030000-0000-0000-0000-000000000005', '28030000-0000-0000-0000-000000000113', '28030000-0000-0000-0000-000000000111', '28030000-0000-0000-0000-000000000112', current_date, 6.5, 'hours', '28030000-0000-0000-0000-000000000103');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-000000000101","role":"authenticated"}', true);
select is((select sum(quantity) from equipment_usage_entries where work_order_id = '28030000-0000-0000-0000-000000000112'), 6.5::numeric, 'AC-RR-008 project administrator reads equipment hours on an order');
select set_config('request.jwt.claims', '{"sub":"28030000-0000-0000-0000-000000000102","role":"authenticated"}', true);
select is((select count(*)::int from equipment_usage_entries where author_id <> auth.uid()), 0, 'unrelated role still reads only own usage');
select * from finish();
rollback;
