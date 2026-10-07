-- 0265_efaktur_number.test.sql — PMO-owned e-Faktur facts (DD-EFK-1).
begin;
select plan(33);

insert into organizations (id, name) values
  ('11120000-0000-0000-0000-000000002651','eFaktur Org'),
  ('11120000-0000-0000-0000-000000002652','Other eFaktur Org');
insert into auth.users (id, email) values
  ('11120000-0000-0000-0000-0000000026a1','efaktur-finance@example.invalid'),
  ('11120000-0000-0000-0000-0000000026a2','efaktur-admin@example.invalid'),
  ('11120000-0000-0000-0000-0000000026b1','efaktur-pm@example.invalid'),
  ('11120000-0000-0000-0000-0000000026d1','efaktur-disabled@example.invalid'),
  ('11120000-0000-0000-0000-0000000026f1','efaktur-other@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('11120000-0000-0000-0000-0000000026a1','11120000-0000-0000-0000-000000002651','Finance','efaktur-finance@example.invalid','Finance','active'),
  ('11120000-0000-0000-0000-0000000026a2','11120000-0000-0000-0000-000000002651','Admin','efaktur-admin@example.invalid','Admin','active'),
  ('11120000-0000-0000-0000-0000000026b1','11120000-0000-0000-0000-000000002651','PM','efaktur-pm@example.invalid','Project Manager','active'),
  ('11120000-0000-0000-0000-0000000026d1','11120000-0000-0000-0000-000000002651','Disabled','efaktur-disabled@example.invalid','Finance','disabled'),
  ('11120000-0000-0000-0000-0000000026f1','11120000-0000-0000-0000-000000002652','Other Finance','efaktur-other@example.invalid','Finance','active');

insert into sales_invoices (tax_treatment, tax_amount, id, org_id, si_number, invoice_date, amount, status) values
  ('exclusive', 0, '11120000-0000-0000-0000-0000000026e1','11120000-0000-0000-0000-000000002651','DRAFT-1',current_date,100,'Draft'),
  ('exclusive', 0, '11120000-0000-0000-0000-0000000026e2','11120000-0000-0000-0000-000000002651','SUB-1',current_date,100,'Submitted'),
  ('exclusive', 0, '11120000-0000-0000-0000-0000000026e3','11120000-0000-0000-0000-000000002651','CAN-1',current_date,100,'Cancelled'),
  ('exclusive', 0, '11120000-0000-0000-0000-0000000026e4','11120000-0000-0000-0000-000000002651','PAID-1',current_date,100,'Paid'),
  ('exclusive', 0, '11120000-0000-0000-0000-0000000026f1','11120000-0000-0000-0000-000000002652','OTHER-1',current_date,100,'Submitted');
insert into procurements (id, org_id, title, status) values
  ('11120000-0000-0000-0000-0000000026c1','11120000-0000-0000-0000-000000002651','Procurement fixture','Received'),
  ('11120000-0000-0000-0000-0000000026c2','11120000-0000-0000-0000-000000002652','Other procurement fixture','Received');
insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency) values
  ('11120000-0000-0000-0000-0000000026e5','11120000-0000-0000-0000-000000002651','11120000-0000-0000-0000-0000000026c1','VI-RECEIVED',current_date,'Received',100,'exclusive',0,'USD'),
  ('11120000-0000-0000-0000-0000000026e6','11120000-0000-0000-0000-000000002651','11120000-0000-0000-0000-0000000026c1','VI-PAID',current_date,'Paid',100,'exclusive',0,'USD'),
  ('11120000-0000-0000-0000-0000000026e7','11120000-0000-0000-0000-000000002651','11120000-0000-0000-0000-0000000026c1','VI-CANCELLED',current_date,'Paid',100,'exclusive',0,'USD'),
  ('11120000-0000-0000-0000-0000000026f2','11120000-0000-0000-0000-000000002652','11120000-0000-0000-0000-0000000026c2','VI-OTHER',current_date,'Received',100,'exclusive',0,'USD');
update procurement_invoices set erp_docstatus = 2, erp_cancelled_at = now()
 where id = '11120000-0000-0000-0000-0000000026e7';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026a1","role":"authenticated"}';
select is((select (set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e1','  010.001-26.12345678  ',current_date)).efaktur_number),
  '010.001-26.12345678', 'AC-EFK-001 Finance can save a trimmed number and date on Draft');
select is((select (set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e2','010-02',current_date)).efaktur_date),
  current_date, 'AC-EFK-001 Finance can save after issue on Submitted');
select is((select (set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e4','010-03',current_date)).efaktur_number),
  '010-03', 'AC-EFK-001 Finance can save after payment');
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026a2","role":"authenticated"}';
select is((select (set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e4','010-03.1',current_date)).efaktur_number),
  '010-03.1', 'AC-EFK-001 Admin can update the sales e-Faktur facts');
select is((select (set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e1',null,null)).efaktur_number),
  null::text, 'AC-EFK-001 NULL clears the sales-invoice number');
select throws_ok($$ select set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e1','010/03',current_date) $$,
  '23514', null, 'AC-EFK-001 invalid number characters are refused');
select throws_ok($$ select set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e1',repeat('1',33),current_date) $$,
  '23514', null, 'AC-EFK-001 numbers over 32 characters are refused');
select throws_ok($$ select set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e1','010-03',current_date + 1) $$,
  '23514', null, 'AC-EFK-001 future dates are refused');
select throws_ok($$ update sales_invoices set efaktur_number='010-04' where id='11120000-0000-0000-0000-0000000026e1' $$,
  '42501', null, 'AC-EFK-001 direct authenticated writes cannot change PMO e-Faktur facts');
select throws_ok($$ select set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e3','010-05',current_date) $$,
  '23514', null, 'AC-EFK-001 cancelled sales invoices are refused');
select throws_ok($$ select set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026f1','010-06',current_date) $$,
  '42501', null, 'AC-EFK-001 cross-org sales invoice writes are refused');

set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026b1","role":"authenticated"}';
select throws_ok($$ select set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e1','010-07',current_date) $$,
  '42501', null, 'AC-EFK-001 Project Manager is refused');
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026d1","role":"authenticated"}';
select throws_ok($$ select set_sales_invoice_efaktur('11120000-0000-0000-0000-0000000026e1','010-08',current_date) $$,
  '42501', null, 'AC-EFK-001 disabled Finance is refused');

set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026a1","role":"authenticated"}';
select is((select (set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e5','010.001-26.12345678',current_date)).efaktur_number),
  '010.001-26.12345678', 'AC-EFK-002 Finance can save the supplier number on a received vendor bill');
select is((select (set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e6','010-09',current_date)).efaktur_date),
  current_date, 'AC-EFK-002 Finance can update a paid vendor bill');
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026a2","role":"authenticated"}';
select is((select (set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e6','010-09.1',current_date)).efaktur_number),
  '010-09.1', 'AC-EFK-002 Admin can update the supplier e-Faktur facts');
select throws_ok($$ select set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e7','010-10',current_date) $$,
  '23514', null, 'AC-EFK-002 cancelled vendor bills are refused');
select throws_ok($$ select set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026f2','010-11',current_date) $$,
  '42501', null, 'AC-EFK-002 cross-org vendor bill writes are refused');
select throws_ok($$ select set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e5','010/12',current_date) $$,
  '23514', null, 'AC-EFK-002 invalid supplier number characters are refused');
select throws_ok($$ update procurement_invoices set efaktur_number='010-13' where id='11120000-0000-0000-0000-0000000026e5' $$,
  '42501', null, 'AC-EFK-002 direct authenticated writes cannot change PMO e-Faktur facts');
select is((select (set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e5',null,null)).efaktur_number),
  null::text, 'AC-EFK-002 NULL clears the supplier number');
select throws_ok($$ select set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e5',repeat('1',33),current_date) $$,
  '23514', null, 'AC-EFK-002 supplier numbers over 32 characters are refused');
select throws_ok($$ select set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e5','010-14',current_date + 1) $$,
  '23514', null, 'AC-EFK-002 future supplier e-Faktur dates are refused');
select is((select count(*)::int from sales_invoices where id='11120000-0000-0000-0000-0000000026f1'),
  0, 'AC-EFK-001 existing sales invoice RLS hides another organization row');
select is((select count(*)::int from procurement_invoices where id='11120000-0000-0000-0000-0000000026f2'),
  0, 'AC-EFK-002 existing procurement invoice RLS hides another organization row');
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026b1","role":"authenticated"}';
select throws_ok($$ select set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e5','010-15',current_date) $$,
  '42501', null, 'AC-EFK-002 Project Manager is refused');
set local request.jwt.claims = '{"sub":"11120000-0000-0000-0000-0000000026d1","role":"authenticated"}';
select throws_ok($$ select set_procurement_invoice_efaktur('11120000-0000-0000-0000-0000000026e5','010-16',current_date) $$,
  '42501', null, 'AC-EFK-002 disabled Finance is refused');

reset role;
select ok(not has_function_privilege('anon','public.set_sales_invoice_efaktur(uuid,text,date)','EXECUTE'),
  'AC-EFK-001 anonymous role cannot execute the sales setter');
select ok(not has_function_privilege('anon','public.set_procurement_invoice_efaktur(uuid,text,date)','EXECUTE'),
  'AC-EFK-002 anonymous role cannot execute the procurement setter');
select ok(has_function_privilege('authenticated','public.set_sales_invoice_efaktur(uuid,text,date)','EXECUTE'),
  'AC-EFK-001 authenticated members can invoke the sales setter');
select ok(has_function_privilege('authenticated','public.set_procurement_invoice_efaktur(uuid,text,date)','EXECUTE'),
  'AC-EFK-002 authenticated members can invoke the procurement setter');

-- Mirror-shaped service_role updates alter ERP-owned fields but intentionally omit e-Faktur columns.
update sales_invoices set efaktur_number='010-14', efaktur_date=current_date where id='11120000-0000-0000-0000-0000000026e2';
update procurement_invoices set efaktur_number='010-15', efaktur_date=current_date where id='11120000-0000-0000-0000-0000000026e5';
set local role service_role;
update sales_invoices set status='Paid', erp_outstanding_amount=0, erp_docstatus=1 where id='11120000-0000-0000-0000-0000000026e2';
update procurement_invoices set status='Paid', erp_outstanding_amount=0, erp_docstatus=1 where id='11120000-0000-0000-0000-0000000026e5';
reset role;
select is((select efaktur_number from sales_invoices where id='11120000-0000-0000-0000-0000000026e2'),
  '010-14', 'AC-EFK-003 sales-invoice mirror refresh preserves PMO e-Faktur facts');
select is((select efaktur_number from procurement_invoices where id='11120000-0000-0000-0000-0000000026e5'),
  '010-15', 'AC-EFK-003 vendor-bill mirror refresh preserves PMO e-Faktur facts');
select * from finish();
rollback;
