-- #2525: three-way match — a vendor bill is checked against the order and the receipt before it can be paid
-- (AC-TWM-001..012). Spec docs/specs/three-way-match.spec.md · Plan docs/plans/2026-11-20-three-way-match.md.
-- Migration under test: 1018_three_way_match.sql. The mutation check is three_way_match_mutation.test.sql.
-- Orgs: A (match on, multi-member), B (match on, purchasing owned by an ERP), N (match never switched on).
-- Bills are recorded through create_procurement_invoice so their create audit carries the real author.
begin;
create extension if not exists pgtap;
select plan(13);

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('25250000-0000-0000-0000-00000000000a', 'TWM Org',       'IDR', true),
  ('25250000-0000-0000-0000-00000000000b', 'TWM ERP Org',   'IDR', true),
  ('25250000-0000-0000-0000-00000000000c', 'TWM Plain Org', 'IDR', true);
insert into auth.users (id, email) values
  ('25250000-0000-0000-0000-0000000000a1', 'twm-admin@example.com'),
  ('25250000-0000-0000-0000-0000000000a2', 'twm-fin1@example.com'),
  ('25250000-0000-0000-0000-0000000000a3', 'twm-fin2@example.com'),
  ('25250000-0000-0000-0000-0000000000a4', 'twm-pm@example.com'),
  ('25250000-0000-0000-0000-0000000000a5', 'twm-eng@example.com'),
  ('25250000-0000-0000-0000-0000000000a6', 'twm-exec@example.com'),
  ('25250000-0000-0000-0000-0000000000b1', 'twm-erp-admin@example.com'),
  ('25250000-0000-0000-0000-0000000000c1', 'twm-plain-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25250000-0000-0000-0000-0000000000a1', '25250000-0000-0000-0000-00000000000a', 'TWM Admin', 'twm-admin@example.com', 'Admin', 'active'),
  ('25250000-0000-0000-0000-0000000000a2', '25250000-0000-0000-0000-00000000000a', 'TWM Fin1',  'twm-fin1@example.com',  'Finance', 'active'),
  ('25250000-0000-0000-0000-0000000000a3', '25250000-0000-0000-0000-00000000000a', 'TWM Fin2',  'twm-fin2@example.com',  'Finance', 'active'),
  ('25250000-0000-0000-0000-0000000000a4', '25250000-0000-0000-0000-00000000000a', 'TWM PM',    'twm-pm@example.com',    'Project Manager', 'active'),
  ('25250000-0000-0000-0000-0000000000a5', '25250000-0000-0000-0000-00000000000a', 'TWM Eng',   'twm-eng@example.com',   'Engineer', 'active'),
  ('25250000-0000-0000-0000-0000000000a6', '25250000-0000-0000-0000-00000000000a', 'TWM Exec',  'twm-exec@example.com',  'Executive', 'active'),
  ('25250000-0000-0000-0000-0000000000b1', '25250000-0000-0000-0000-00000000000b', 'TWM ERP Admin', 'twm-erp-admin@example.com', 'Admin', 'active'),
  ('25250000-0000-0000-0000-0000000000c1', '25250000-0000-0000-0000-00000000000c', 'TWM Plain Fin', 'twm-plain-fin@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status) values
  ('25250000-0000-0000-0000-0000000000d1', '25250000-0000-0000-0000-00000000000a', 'TWM Site',  'Ongoing Project'),
  ('25250000-0000-0000-0000-0000000000d2', '25250000-0000-0000-0000-00000000000b', 'TWM ERP Site', 'Ongoing Project'),
  ('25250000-0000-0000-0000-0000000000d3', '25250000-0000-0000-0000-00000000000c', 'TWM Plain Site', 'Ongoing Project');
insert into org_purchase_type_settings (org_id,enabled) values
 ('25250000-0000-0000-0000-00000000000a',true) on conflict(org_id) do update set enabled=true;
insert into purchase_types (id,org_id,name,is_rental) values
 ('25250000-0000-0000-0000-0000000000e1','25250000-0000-0000-0000-00000000000a','Rental for test',true);
-- p1: the goods purchase under test. p2: a subcontract purchase (its own cap applies). p3: a purchase whose bill has
-- no recorded author. pb: org B's purchase. pn: org N's purchase.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract, purchase_type_id, rental_from, rental_to) values
  ('25250000-0000-0000-0000-0000000000f1', '25250000-0000-0000-0000-00000000000a', 'TWM cement and steel', '25250000-0000-0000-0000-0000000000d1',
   '25250000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 600000, 600000, '25250000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false, '25250000-0000-0000-0000-0000000000e1', current_date, current_date + 1),
  ('25250000-0000-0000-0000-0000000000f2', '25250000-0000-0000-0000-00000000000a', 'TWM subcontract', '25250000-0000-0000-0000-0000000000d1',
   '25250000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true, null, null, null),
  ('25250000-0000-0000-0000-0000000000f3', '25250000-0000-0000-0000-00000000000a', 'TWM unknown author', '25250000-0000-0000-0000-0000000000d1',
   '25250000-0000-0000-0000-0000000000a4', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false, null, null, null),
  ('25250000-0000-0000-0000-0000000000fb', '25250000-0000-0000-0000-00000000000b', 'TWM ERP buy', '25250000-0000-0000-0000-0000000000d2',
   '25250000-0000-0000-0000-0000000000b1', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000b1', 'Materials', 'IDR', false, null, null, null),
  ('25250000-0000-0000-0000-0000000000fc', '25250000-0000-0000-0000-00000000000c', 'TWM plain buy', '25250000-0000-0000-0000-0000000000d3',
   '25250000-0000-0000-0000-0000000000c1', 'Vendor Invoiced', 100000, 100000, '25250000-0000-0000-0000-0000000000c1', 'Materials', 'IDR', false, null, null, null);
-- Ordered items (the order's lines): cement 100 @ 1,000 and steel 10 @ 50,000 on p1; one item on p3.
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('25250000-0000-0000-0000-000000000011', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'Cement', 100, 1000),
  ('25250000-0000-0000-0000-000000000012', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'Steel',   10, 50000),
  ('25250000-0000-0000-0000-000000000031', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f3', 'Sand',    10, 1000);
insert into procurement_receipts (id, org_id, procurement_id, gr_number, status) values
  ('25250000-0000-0000-0000-000000000021', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'GR-TWM-1', 'Partial'),
  ('25250000-0000-0000-0000-000000000022', '25250000-0000-0000-0000-00000000000a', '25250000-0000-0000-0000-0000000000f1', 'GR-TWM-2', 'Partial');
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('25250000-0000-0000-0000-00000000000b', 'erpnext', 'procurement');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- A bill on p1 for p_amount (tax exclusive, zero tax), recorded by whoever is acting.
create or replace function pg_temp.bill(p_amount numeric) returns uuid language sql as $$
  select (create_procurement_invoice(
    p_procurement_id => '25250000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
    p_amount => p_amount, p_tax_treatment => 'exclusive', p_tax_amount => 0)).id
$$;
create or replace function pg_temp.id(k text) returns uuid language sql as $$ select current_setting('twm.' || k)::uuid $$;
create or replace function pg_temp.status(k text) returns text language sql as $$ select get_bill_match(pg_temp.id(k))->>'status' $$;
create or replace function pg_temp.pay(p_amount numeric) returns uuid language sql as $$
  select (create_payment('25250000-0000-0000-0000-0000000000f1', null, null, null, current_date, p_amount)).id
$$;
create or replace function pg_temp.lines(p_item text, p_qty numeric, p_rate numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'rate', p_rate))
$$;


insert into auth.users (id,email) values
  ('25250000-0000-0000-0000-0000000000a7', 'job-equipment@example.com'),
  ('25250000-0000-0000-0000-0000000000a8', 'job-buyer@example.com');
insert into profiles (id,org_id,full_name,email,role,status,built_in_role) values
  ('25250000-0000-0000-0000-0000000000a7', '25250000-0000-0000-0000-00000000000a', 'Equipment', 'job-equipment@example.com', 'Engineer', 'active', 'equipment_officer'),
  ('25250000-0000-0000-0000-0000000000a8', '25250000-0000-0000-0000-00000000000a', 'Buyer', 'job-buyer@example.com', 'Engineer', 'active', 'buyer');
set local role authenticated;
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a1');
select set_three_way_match_settings(true, 5, 2);
select set_config('twm.existing', pg_temp.bill(80000)::text, true);
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a7');
select lives_ok($$select get_bill_match(pg_temp.id('existing'))$$, 'AC-VBJR-001 equipment officer reads the match');
select lives_ok($$select set_config('twm.own', pg_temp.bill(2000)::text, true)$$, 'AC-VBJR-002 equipment officer records a vendor bill');
select is((select count(*) from procurements where id = '25250000-0000-0000-0000-0000000000f1'), 1::bigint, 'AC-VBJR-002 equipment officer reads the rental purchase');
select throws_ok($$select create_procurement_invoice('25250000-0000-0000-0000-0000000000f2','Received',current_date,p_amount=>100,p_tax_treatment=>'exclusive',p_tax_amount=>0)$$, '42501', null, 'AC-VBJR-005 equipment officer cannot record a non-rental bill');
select throws_ok($$select approve_bill_match_exception(pg_temp.id('existing'), 'reason')$$, '42501', null, 'AC-VBJR-003 equipment officer cannot approve the exception');
select throws_ok($$select pg_temp.pay(1)$$, '42501', null, 'AC-VBJR-003 equipment officer cannot record a payment');
reset role;
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a1');
update profiles set role = 'Finance', built_in_role = 'finance_officer' where id = '25250000-0000-0000-0000-0000000000a7';
set local role authenticated;
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a7');
select throws_ok($$select approve_bill_match_exception(pg_temp.id('own'), 'reason')$$, '42501', 'separation of duties: the person who recorded this bill or its lines cannot approve its exception', 'AC-VBJR-003 a bill author cannot approve their exception after a role change');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a8');
select lives_ok($$select get_bill_match(pg_temp.id('existing'))$$, 'AC-VBJR-004 buyer reads the match');
select is((select count(*) from procurement_invoices where id=pg_temp.id('existing')), 1::bigint, 'AC-VBJR-004 buyer reads the bill');
select is((select count(*) from procurements where id='25250000-0000-0000-0000-0000000000f1'), 1::bigint, 'AC-VBJR-004 buyer reads the purchase');
select throws_ok($$select approve_bill_match_exception(pg_temp.id('existing'), 'reason')$$, '42501', null, 'AC-VBJR-003 buyer cannot approve the exception');
select throws_ok($$select pg_temp.pay(1)$$, '42501', null, 'AC-VBJR-003 buyer cannot record a payment');
select pg_temp.act_as('25250000-0000-0000-0000-0000000000a5');
select throws_ok($$select get_bill_match(pg_temp.id('existing'))$$, '42501', null, 'AC-VBJR-005 unrelated engineer cannot read match');
select * from finish();
rollback;
