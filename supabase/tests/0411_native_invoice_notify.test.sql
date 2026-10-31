-- 0411_native_invoice_notify.test.sql — #1595 AC-AIN-NAT-002: a PMO customer invoice raised as a Draft tells every
-- other active Admin/Finance (the people who may approve it) with a link to it; never the author, never anyone else.
-- AC-AIN-NAT-003: an ERP-path Draft (pmo_native = false) tells nobody.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name) values ('04110000-0000-0000-0000-000000000001', 'NIN Org');
insert into auth.users (id, email) values
  ('04110000-0000-0000-0000-0000000000a1', 'nin-fin1@example.com'),
  ('04110000-0000-0000-0000-0000000000a2', 'nin-fin2@example.com'),
  ('04110000-0000-0000-0000-0000000000a3', 'nin-admin@example.com'),
  ('04110000-0000-0000-0000-0000000000a4', 'nin-pm@example.com'),
  ('04110000-0000-0000-0000-0000000000a5', 'nin-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04110000-0000-0000-0000-0000000000a1', '04110000-0000-0000-0000-000000000001', 'NIN Fin One', 'nin-fin1@example.com', 'Finance', 'active'),
  ('04110000-0000-0000-0000-0000000000a2', '04110000-0000-0000-0000-000000000001', 'NIN Fin Two', 'nin-fin2@example.com', 'Finance', 'active'),
  ('04110000-0000-0000-0000-0000000000a3', '04110000-0000-0000-0000-000000000001', 'NIN Admin', 'nin-admin@example.com', 'Admin', 'active'),
  ('04110000-0000-0000-0000-0000000000a4', '04110000-0000-0000-0000-000000000001', 'NIN PM', 'nin-pm@example.com', 'Project Manager', 'active'),
  ('04110000-0000-0000-0000-0000000000a5', '04110000-0000-0000-0000-000000000001', 'NIN Off', 'nin-off@example.com', 'Finance', 'disabled');
insert into companies (id, org_id, name, type) values
  ('04110000-0000-0000-0000-0000000000c1', '04110000-0000-0000-0000-000000000001', 'NIN Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('04110000-0000-0000-0000-0000000000d1', '04110000-0000-0000-0000-000000000001', 'NIN project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, null, 1, 1, false, '04110000-0000-0000-0000-0000000000c1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"04110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.create_native_sales_invoice('04110000-0000-0000-0000-0000000000d1', '04110000-0000-0000-0000-0000000000c1',
  '[{"description":"Notify me","qty":1,"rate":500000}]'::jsonb) $$, 'AC-AIN-NAT-002 Finance one raises a native invoice');   -- 1
reset role;

select is((select count(*)::int from notifications where owner_id = '04110000-0000-0000-0000-0000000000a2'
            and title = 'Customer invoice awaiting your approval'), 1,
  'AC-AIN-NAT-002 another active Finance user is told');                                                                   -- 2
select is((select count(*)::int from notifications where owner_id = '04110000-0000-0000-0000-0000000000a3'
            and title = 'Customer invoice awaiting your approval'), 1,
  'AC-AIN-NAT-002 the Admin is told');                                                                                      -- 3
select is((select count(*)::int from notifications where owner_id = '04110000-0000-0000-0000-0000000000a1'), 0,
  'AC-AIN-NAT-002 the author is not');                                                                                      -- 4
select is((select count(*)::int from notifications where owner_id in
            ('04110000-0000-0000-0000-0000000000a4', '04110000-0000-0000-0000-0000000000a5')), 0,
  'AC-AIN-NAT-002 a Project Manager and a disabled Finance user are not');                                                  -- 5
select is(
  (select metadata->'entity' from notifications where owner_id = '04110000-0000-0000-0000-0000000000a2'),
  (select jsonb_build_object('type', 'sales_invoice', 'id', si.id, 'label', 'NIN Client')
     from sales_invoices si where si.native_lines @> '[{"description":"Notify me"}]'),
  'AC-AIN-NAT-002 it links to the invoice');                                                                                -- 6

-- Created by the table owner (no acting user), the author is still never told.
insert into sales_invoices (id, org_id, project_id, customer_id, amount, currency, tax_treatment, tax_rate, tax_amount,
                            status, pmo_native, author_user_id, native_lines) values
  ('04110000-0000-0000-0000-0000000000f1', '04110000-0000-0000-0000-000000000001', '04110000-0000-0000-0000-0000000000d1',
   '04110000-0000-0000-0000-0000000000c1', 1000, 'IDR', 'exclusive', 0, 0, 'Draft', true,
   '04110000-0000-0000-0000-0000000000a3', '[{"description":"Admin authored","qty":1,"rate":1000,"amount":1000}]');
select is((select count(*)::int from notifications where owner_id = '04110000-0000-0000-0000-0000000000a3'
            and metadata->'entity'->>'id' = '04110000-0000-0000-0000-0000000000f1'), 0,
  'AC-AIN-NAT-002 an Admin author is not told of their own draft');                                                         -- 7
select is((select count(*)::int from notifications where owner_id = '04110000-0000-0000-0000-0000000000a2'
            and metadata->'entity'->>'id' = '04110000-0000-0000-0000-0000000000f1'), 1,
  'AC-AIN-NAT-002 the Finance user is');                                                                                    -- 8

-- AC-AIN-NAT-003: the ERP path writes pmo_native = false and its approvers are told elsewhere (ERP), not here.
insert into sales_invoices (id, org_id, project_id, customer_id, amount, currency, tax_treatment, tax_rate, tax_amount,
                            status, pmo_native, author_user_id) values
  ('04110000-0000-0000-0000-0000000000f2', '04110000-0000-0000-0000-000000000001', '04110000-0000-0000-0000-0000000000d1',
   '04110000-0000-0000-0000-0000000000c1', 1000, 'IDR', 'exclusive', 0, 0, 'Draft', false,
   '04110000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from notifications where metadata->'entity'->>'id' = '04110000-0000-0000-0000-0000000000f2'), 0,
  'AC-AIN-NAT-003 an ERP-path Draft tells nobody');                                                                         -- 9

select * from finish();
rollback;
