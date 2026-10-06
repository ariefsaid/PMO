begin;
select plan(22);

select is(public.calculate_standalone_tax_amount(1000, 'exclusive', 12, 11, 12), 110::numeric,
  'AC-DPP-001 nominal 12 percent on an 11/12 exclusive base');
select is(public.calculate_standalone_tax_amount(1110, 'inclusive', 12, 11, 12), 110::numeric,
  'AC-DPP-001 inclusive tax is extracted from the gross ceiling');
select is(public.calculate_standalone_tax_amount(1.15, 'exclusive', 10, 1, 1), 0.12::numeric,
  'AC-DPP-001 final half-cent rounds up');
select is(public.calculate_standalone_tax_amount(0.05, 'inclusive', 100, 1, 1), 0.03::numeric,
  'AC-DPP-001 inclusive half-cent rounds up');
select is(public.calculate_standalone_tax_amount(425917589.99, 'exclusive', 12, 2147483646, 2147483647),
  51110110.77::numeric, 'AC-DPP-001 intermediate division cannot round a sub-half-cent rational up');

insert into organizations(id, name) values ('02270000-0000-0000-0000-000000000001', 'Reduced Base Test');
insert into auth.users(id, email) values ('02270000-0000-0000-0000-0000000000a1', 'fixture@tax0227.example');
insert into profiles(id, org_id, full_name, email, role, status) values
  ('02270000-0000-0000-0000-0000000000a1', '02270000-0000-0000-0000-000000000001',
   'Tax Fixture', 'fixture@tax0227.example', 'Finance', 'active');
insert into projects(id, org_id, name, status, contract_value, tax_treatment, tax_amount) values
  ('02270000-0000-0000-0000-0000000000b1', '02270000-0000-0000-0000-000000000001',
   'DPP project', 'Leads', 1000, 'exclusive', 37);

select is((select tax_amount from projects where id='02270000-0000-0000-0000-0000000000b1'),
  37::numeric, 'AC-DPP-001 unknown rate keeps the authored amount');
select is((select tax_base_numerator::text || '/' || tax_base_denominator::text from projects
  where id='02270000-0000-0000-0000-0000000000b1'), '1/1', 'AC-DPP-001 omitted fraction defaults to 1/1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02270000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_project_contract_value('02270000-0000-0000-0000-0000000000b1',
  1110, 'inclusive', 110, 12, null, 11, 12)$$, 'AC-DPP-001 witnessed contract writer accepts the fraction');
select is((select tax_rate::text || ':' || tax_base_numerator::text || '/' || tax_base_denominator::text
  from projects where id='02270000-0000-0000-0000-0000000000b1'), '12.000:11/12',
  'AC-DPP-001 nominal rate and exact fraction round-trip through the RPC');
select is((select tax_amount from projects where id='02270000-0000-0000-0000-0000000000b1'),
  110::numeric, 'AC-DPP-001 inclusive contract tax persists');
select is((select contract_value_set_by from projects where id='02270000-0000-0000-0000-0000000000b1'),
  '02270000-0000-0000-0000-0000000000a1'::uuid, 'AC-DPP-001 tax changes retain the authorship witness');
select lives_ok($$select public.set_project_contract_value('02270000-0000-0000-0000-0000000000b1',
  1110, 'inclusive', 123.45, null, null, 11, 12)$$,
  'AC-DPP-001 explicit unknown rate can restore manual tax entry');
select is((select coalesce(tax_rate::text,'unknown') || ':' || tax_amount::text from projects
  where id='02270000-0000-0000-0000-0000000000b1'), 'unknown:123.45',
  'AC-DPP-001 clearing a rate preserves the newly stated manual amount');
select throws_ok($$select public.set_project_contract_value('02270000-0000-0000-0000-0000000000b1',
  1000, 'exclusive', 110, 12, null, 11, 0)$$, '23514', 'tax base must be a positive fraction no greater than 1',
  'AC-DPP-001 zero denominator is refused');
select ok(not has_column_privilege('authenticated','public.projects','tax_base_numerator','UPDATE'),
  'AC-DPP-001 contract tax fraction changes use the witnessed writer');
select ok(not has_column_privilege('authenticated','public.work_orders','tax_base_numerator','UPDATE'),
  'AC-DPP-001 work order tax fraction changes use the witnessed writer');
reset role;

insert into procurements(id, org_id, title, status, requested_by_id) values
  ('02270000-0000-0000-0000-0000000000c1', '02270000-0000-0000-0000-000000000001',
   'DPP case', 'Received', '02270000-0000-0000-0000-0000000000a1');
set local role authenticated;
select lives_ok($$select public.create_procurement_invoice('02270000-0000-0000-0000-0000000000c1',
  'Received', current_date, p_amount=>1000, p_tax_treatment=>'exclusive', p_tax_amount=>110,
  p_tax_rate=>12, p_tax_base_numerator=>11, p_tax_base_denominator=>12)$$,
  'AC-DPP-001 vendor invoice RPC carries nominal rate and fraction');
select is((select tax_amount from procurement_invoices where procurement_id='02270000-0000-0000-0000-0000000000c1'),
  110::numeric, 'AC-DPP-001 vendor invoice persists reduced-base tax');
select is((select tax_base_numerator::text || '/' || tax_base_denominator::text from procurement_invoices
  where procurement_id='02270000-0000-0000-0000-0000000000c1'), '11/12',
  'AC-DPP-001 vendor invoice persists the authored fraction');
reset role;
insert into work_orders(id,org_id,project_id,title,order_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator)
values ('02270000-0000-0000-0000-0000000000d1','02270000-0000-0000-0000-000000000001',
  '02270000-0000-0000-0000-0000000000b1','DPP order',1000,'exclusive',110,12,11,12);
select is((select tax_amount from work_orders where id='02270000-0000-0000-0000-0000000000d1'),
  110::numeric, 'AC-DPP-001 work order persists reduced-base tax');
update work_orders set status='Issued' where id='02270000-0000-0000-0000-0000000000d1';
select throws_ok($$update work_orders set tax_base_numerator=10 where id='02270000-0000-0000-0000-0000000000d1'$$,
  '42501','work order tax base is frozen after issue','AC-DPP-001 issued work order base remains frozen');
set local request.jwt.claims = '{"role":"service_role"}';
insert into sales_invoices(id,org_id,amount,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator)
values ('02270000-0000-0000-0000-0000000000e1','02270000-0000-0000-0000-000000000001',
  1110.03,'inclusive',110.03,12,11,12);
select is((select tax_amount from sales_invoices where id='02270000-0000-0000-0000-0000000000e1'),
  110.03::numeric,'AC-DPP-003 ERP mirror tax remains verbatim even when nominal metadata exists');
select * from finish();
rollback;
