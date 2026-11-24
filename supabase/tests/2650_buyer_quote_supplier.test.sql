begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20450000-0000-0000-0000-00000000000a', 'RR PU Org', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20450000-0000-0000-0000-0000000000' || k)::uuid, 'rrpu-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20450000-0000-0000-0000-0000000000a1', '20450000-0000-0000-0000-00000000000a', 'Admin',     'rrpu-a1@example.com', 'Admin', 'active', null),
  ('20450000-0000-0000-0000-0000000000a2', '20450000-0000-0000-0000-00000000000a', 'Buyer',     'rrpu-a2@example.com', 'Engineer', 'active', 'buyer'),
  ('20450000-0000-0000-0000-0000000000a3', '20450000-0000-0000-0000-00000000000a', 'Store',     'rrpu-a3@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20450000-0000-0000-0000-0000000000a4', '20450000-0000-0000-0000-00000000000a', 'Engineer',  'rrpu-a4@example.com', 'Engineer', 'active', null),
  ('20450000-0000-0000-0000-0000000000a5', '20450000-0000-0000-0000-00000000000a', 'Field',     'rrpu-a5@example.com', 'Engineer', 'active', 'field_user'),
  ('20450000-0000-0000-0000-0000000000a6', '20450000-0000-0000-0000-00000000000a', 'PM',        'rrpu-a6@example.com', 'Project Manager', 'active', null),
  ('20450000-0000-0000-0000-0000000000a7', '20450000-0000-0000-0000-00000000000a', 'Proc mgr',  'rrpu-a7@example.com', 'Project Manager', 'active', 'procurement_manager'),
  ('20450000-0000-0000-0000-0000000000a8', '20450000-0000-0000-0000-00000000000a', 'Qual mgr',  'rrpu-a8@example.com', 'Project Manager', 'active', 'quality_manager'),
  ('20450000-0000-0000-0000-0000000000a9', '20450000-0000-0000-0000-00000000000a', 'Inspector', 'rrpu-a9@example.com', 'Engineer', 'active', 'quality_inspector'),
  ('20450000-0000-0000-0000-0000000000b1', '20450000-0000-0000-0000-00000000000a', 'Safety',    'rrpu-b1@example.com', 'Engineer', 'active', 'safety_officer');
insert into companies (id, org_id, name, type) values
  ('20450000-0000-0000-0000-0000000000d1', '20450000-0000-0000-0000-00000000000a', 'RRPU Supplier', 'Vendor'),
  ('20450000-0000-0000-0000-0000000000d2', '20450000-0000-0000-0000-00000000000a', 'RRPU Lab', 'Vendor');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20450000-0000-0000-0000-0000000000c1', '20450000-0000-0000-0000-00000000000a', 'RRPU project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20450000-0000-0000-0000-0000000000a6');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20450000-0000-0000-0000-000000000031', '20450000-0000-0000-0000-00000000000a', '20450000-0000-0000-0000-0000000000c1', 'RRPU WO', 'Issued', 1000, 'exclusive', 0);
insert into procurements (id, org_id, title, status, currency, requested_by_id, vendor_id) values
  ('20450000-0000-0000-0000-000000000041', '20450000-0000-0000-0000-00000000000a', 'Quoting',        'Vendor Quoted', 'IDR', '20450000-0000-0000-0000-0000000000a6', null),
  ('20450000-0000-0000-0000-000000000042', '20450000-0000-0000-0000-00000000000a', 'Approved bare',  'Approved',      'IDR', '20450000-0000-0000-0000-0000000000a6', null),
  ('20450000-0000-0000-0000-000000000043', '20450000-0000-0000-0000-00000000000a', 'Approved named', 'Approved',      'IDR', '20450000-0000-0000-0000-0000000000a6', '20450000-0000-0000-0000-0000000000d1'),
  ('20450000-0000-0000-0000-000000000044', '20450000-0000-0000-0000-00000000000a', 'Requested',      'Requested',     'IDR', '20450000-0000-0000-0000-0000000000a6', '20450000-0000-0000-0000-0000000000d1');
insert into third_party_inspections (id, org_id, work_order_id, project_id, title, planned_date, vendor_id, status, created_by) values
  ('20450000-0000-0000-0000-000000000051', '20450000-0000-0000-0000-00000000000a', '20450000-0000-0000-0000-000000000031', '20450000-0000-0000-0000-0000000000c1',
   'Hydrotest', current_date + 7, '20450000-0000-0000-0000-0000000000d2', 'requested', '20450000-0000-0000-0000-0000000000a9'),
  ('20450000-0000-0000-0000-000000000052', '20450000-0000-0000-0000-00000000000a', '20450000-0000-0000-0000-000000000031', '20450000-0000-0000-0000-0000000000c1',
   'NDT', current_date + 7, '20450000-0000-0000-0000-0000000000d2', 'requested', '20450000-0000-0000-0000-0000000000a9');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20450000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.quote(p_amount int) returns text language sql as $$
  select format('select create_procurement_quotation(%L, %L, %s, current_date)',
                '20450000-0000-0000-0000-000000000041', '20450000-0000-0000-0000-0000000000d1', p_amount) $$;
create function pg_temp.supplier(p_proc text) returns text language sql as $$
  select format('select set_procurement_supplier(%L, %L)', '20450000-0000-0000-0000-0000000000' || p_proc, '20450000-0000-0000-0000-0000000000d1') $$;
create function pg_temp.risk() returns text language sql as $$
  select $r$select set_vendor_supply_status('20450000-0000-0000-0000-0000000000d1', 'at_risk', 'late deliveries')$r$ $$;

select is(pg_temp.err('a1', $$select po_set_order_job_roles(array['buyer'])$$), 'ok', 'RR-PU-00 an Admin names the Buyer as the job role that orders purchases');


select is(pg_temp.err('a2', $$select transition_procurement('20450000-0000-0000-0000-000000000042','Vendor Quoted')$$), 'ok', 'AC-BQS-001 Buyer starts quotations');
select matches(pg_temp.err('a2', $$select transition_procurement('20450000-0000-0000-0000-000000000044','Approved')$$), '^42501', 'AC-BQS-002 Buyer cannot approve');
select is(pg_temp.err('a2', $$select create_procurement_quotation('20450000-0000-0000-0000-000000000042','20450000-0000-0000-0000-0000000000d1',8500,current_date)$$), 'ok', 'AC-BQS-003 Buyer adds quotation');
select is(pg_temp.err('a2', $$select select_procurement_quote((select id from procurement_quotations where procurement_id = '20450000-0000-0000-0000-000000000042'))$$), 'ok', 'AC-BQS-003 Buyer selects quotation');
select is(pg_temp.err('a2', $$select transition_procurement('20450000-0000-0000-0000-000000000042','Ordered')$$), 'ok', 'AC-BQS-003 Buyer records order');
select is((select amount from purchase_orders where procurement_id = '20450000-0000-0000-0000-000000000042'),8500::numeric,'AC-BQS-003 Order carries selected amount');
update organizations set hide_prices_from_requesters=true where id='20450000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"20450000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select is((select vendor_id from procurements_masked where id='20450000-0000-0000-0000-000000000043'),'20450000-0000-0000-0000-0000000000d1'::uuid,'AC-BQS-004 Price viewer keeps supplier');
reset role;
update procurements set requested_by_id='20450000-0000-0000-0000-0000000000a4' where id='20450000-0000-0000-0000-000000000043';
set local role authenticated;
set local request.jwt.claims = '{"sub":"20450000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select vendor_id from procurements_masked where id='20450000-0000-0000-0000-000000000043'),null::uuid,'AC-BQS-005 Requester supplier follows prices');
reset role;
insert into organizations(id,name) values ('26500000-0000-0000-0000-000000000001','Other org');
insert into procurements(id,org_id,title,status) values ('26500000-0000-0000-0000-000000000002','26500000-0000-0000-0000-000000000001','Other request','Approved');
select is(pg_temp.err('a2', $$select transition_procurement('26500000-0000-0000-0000-000000000002','Vendor Quoted')$$), '42501 not authorized', 'AC-BQS-006 Buyer cannot source another org');
select * from finish();
rollback;
