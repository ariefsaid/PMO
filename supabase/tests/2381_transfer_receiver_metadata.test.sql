begin;
create extension if not exists pgtap;
select plan(4);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26920000-0000-0000-0000-00000000000a', 'TST Org', 'IDR', 'UTC'),
  ('26920000-0000-0000-0000-00000000000b', 'TST Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('26920000-0000-0000-0000-0000000000a1', 'tst-admin@example.com'),
  ('26920000-0000-0000-0000-0000000000a2', 'tst-src@example.com'),
  ('26920000-0000-0000-0000-0000000000a3', 'tst-dst@example.com'),
  ('26920000-0000-0000-0000-0000000000a4', 'tst-plain@example.com'),
  ('26920000-0000-0000-0000-0000000000b1', 'tst-other-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26920000-0000-0000-0000-0000000000a1', '26920000-0000-0000-0000-00000000000a', 'TST Admin', 'tst-admin@example.com', 'Admin', 'active'),
  ('26920000-0000-0000-0000-0000000000a2', '26920000-0000-0000-0000-00000000000a', 'TST Source Keeper', 'tst-src@example.com', 'Engineer', 'active'),
  ('26920000-0000-0000-0000-0000000000a3', '26920000-0000-0000-0000-00000000000a', 'TST Dest Keeper', 'tst-dst@example.com', 'Engineer', 'active'),
  ('26920000-0000-0000-0000-0000000000a4', '26920000-0000-0000-0000-00000000000a', 'TST Plain Member', 'tst-plain@example.com', 'Engineer', 'active'),
  ('26920000-0000-0000-0000-0000000000b1', '26920000-0000-0000-0000-00000000000b', 'TST Other Admin', 'tst-other-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('26920000-0000-0000-0000-0000000000f1', '26920000-0000-0000-0000-00000000000a', 'TST Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('26920000-0000-0000-0000-0000000000c1', '26920000-0000-0000-0000-00000000000a', 'TST Job One', 'Ongoing Project', 1000000, 'exclusive', 0, '26920000-0000-0000-0000-0000000000f1', '26920000-0000-0000-0000-0000000000a1'),
  ('26920000-0000-0000-0000-0000000000c2', '26920000-0000-0000-0000-00000000000a', 'TST Job Two', 'Ongoing Project', 1000000, 'exclusive', 0, '26920000-0000-0000-0000-0000000000f1', '26920000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26920000-0000-0000-0000-000000000401', '26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-0000000000c1', 'TST WO one', 'Issued', 10000, 'exclusive', 0),
  ('26920000-0000-0000-0000-000000000403', '26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-0000000000c2', 'TST WO other job', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26920000-0000-0000-0000-0000000000d1', '26920000-0000-0000-0000-00000000000a', 'pc', 'Piece', false);
insert into stock_tags (id, org_id, name, zero_cost, paper_required) values
  ('26920000-0000-0000-0000-000000003001', '26920000-0000-0000-0000-00000000000a', 'Client supplied', true, false),
  ('26920000-0000-0000-0000-000000003002', '26920000-0000-0000-0000-00000000000a', 'Plain tag', false, false);
insert into stock_items (id, org_id, code, name, unit_id, tag_id, needs_quality_check) values
  ('26920000-0000-0000-0000-000000001001', '26920000-0000-0000-0000-00000000000a', 'PIPE', 'Pipe', '26920000-0000-0000-0000-0000000000d1', null, false),
  ('26920000-0000-0000-0000-000000001002', '26920000-0000-0000-0000-00000000000a', 'FREE', 'Free issue valve', '26920000-0000-0000-0000-0000000000d1', '26920000-0000-0000-0000-000000003001', false),
  ('26920000-0000-0000-0000-000000001003', '26920000-0000-0000-0000-00000000000a', 'QC', 'Checked valve', '26920000-0000-0000-0000-0000000000d1', null, true),
  ('26920000-0000-0000-0000-000000001004', '26920000-0000-0000-0000-00000000000a', 'CONF', 'Confirmed item', '26920000-0000-0000-0000-0000000000d1', '26920000-0000-0000-0000-000000003002', false);
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-00000000000a', 'CEN',   'Central', 'central', null),
  ('26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-00000000000a', 'SITE1', 'Site one', 'site', '26920000-0000-0000-0000-0000000000c1'),
  ('26920000-0000-0000-0000-000000002003', '26920000-0000-0000-0000-00000000000a', 'YARD1', 'Yard one', 'yard', '26920000-0000-0000-0000-0000000000c1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-000000002001', '26920000-0000-0000-0000-0000000000a2'),
  ('26920000-0000-0000-0000-00000000000a', '26920000-0000-0000-0000-000000002002', '26920000-0000-0000-0000-0000000000a3');


update profiles set built_in_role='field_user' where id in ('26920000-0000-0000-0000-0000000000a3','26920000-0000-0000-0000-0000000000a4');
insert into stock_transfers(id,org_id,number,from_warehouse_id,to_warehouse_id,transit_warehouse_id,to_user_id,sent_by)
values('26920000-0000-0000-0000-000000009001','26920000-0000-0000-0000-00000000000a','METADATA','26920000-0000-0000-0000-000000002001','26920000-0000-0000-0000-000000002002','26920000-0000-0000-0000-000000002003','26920000-0000-0000-0000-0000000000a3','26920000-0000-0000-0000-0000000000a2');
insert into stock_transfer_lines(org_id,transfer_id,line_no,item_id,qty_sent) values('26920000-0000-0000-0000-00000000000a','26920000-0000-0000-000000009001',1,'26920000-0000-0000-000000001003',10);
select set_config('request.jwt.claims','{"sub":"26920000-0000-0000-0000-0000000000a3","role":"authenticated"}',true);
set local role authenticated;
select is((select item_name from stock_transfer_receiving_items('26920000-0000-0000-0000-000000009001')),'Checked valve','AC-SITE-009 field recipient reads goods identity');
select ok((select needs_quality_check from stock_transfer_receiving_items('26920000-0000-0000-0000-000000009001')),'AC-SITE-009 field recipient sees required quality input');
reset role;
select set_config('request.jwt.claims','{"sub":"26920000-0000-0000-0000-0000000000a4","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from stock_transfer_receiving_items('26920000-0000-0000-0000-000000009001')),0::bigint,'AC-SITE-009 another field account cannot read transfer metadata');
reset role;
select set_config('request.jwt.claims','{"sub":"26920000-0000-0000-0000-0000000000b1","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from stock_transfer_receiving_items('26920000-0000-0000-0000-000000009001')),0::bigint,'AC-SITE-009 other organisation cannot read metadata');
select * from finish();
rollback;
