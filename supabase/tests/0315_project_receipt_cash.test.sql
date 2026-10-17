begin;
create extension if not exists pgtap;
select no_plan();

insert into public.organizations (id,name) values
 ('10730000-0000-0000-0000-000000000001','Receipt cash test org'),
 ('10730000-0000-0000-0000-000000000002','Receipt cash foreign test org');
insert into auth.users (id,email) values
 ('10730000-0000-0000-0000-0000000000a1','cash-finance@example.test'),
 ('10730000-0000-0000-0000-0000000000a2','cash-admin@example.test'),
 ('10730000-0000-0000-0000-0000000000a3','cash-executive@example.test'),
 ('10730000-0000-0000-0000-0000000000a4','cash-manager@example.test'),
 ('10730000-0000-0000-0000-0000000000a5','cash-engineer@example.test'),
 ('10730000-0000-0000-0000-0000000000a6','cash-inactive@example.test'),
 ('10730000-0000-0000-0000-0000000000b1','cash-foreign@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('10730000-0000-0000-0000-0000000000a1','10730000-0000-0000-0000-000000000001','Cash Finance','cash-finance@example.test','Finance','active'),
 ('10730000-0000-0000-0000-0000000000a2','10730000-0000-0000-0000-000000000001','Cash Admin','cash-admin@example.test','Admin','active'),
 ('10730000-0000-0000-0000-0000000000a3','10730000-0000-0000-0000-000000000001','Cash Executive','cash-executive@example.test','Executive','active'),
 ('10730000-0000-0000-0000-0000000000a4','10730000-0000-0000-0000-000000000001','Cash Manager','cash-manager@example.test','Project Manager','active'),
 ('10730000-0000-0000-0000-0000000000a5','10730000-0000-0000-0000-000000000001','Cash Engineer','cash-engineer@example.test','Engineer','active'),
 ('10730000-0000-0000-0000-0000000000a6','10730000-0000-0000-0000-000000000001','Cash Inactive','cash-inactive@example.test','Finance','disabled'),
 ('10730000-0000-0000-0000-0000000000b1','10730000-0000-0000-0000-000000000002','Cash Foreign','cash-foreign@example.test','Finance','active');
insert into public.companies (id,org_id,name,type) values
 ('10730000-0000-0000-0000-0000000000c1','10730000-0000-0000-0000-000000000001','Receipt cash client','Client');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                            tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref) values
 ('10730000-0000-0000-0000-0000000000d1','10730000-0000-0000-0000-000000000001','Native cash','Ongoing Project','IDR',10000,'exclusive',0,0,1,1,false,'CASH-NATIVE'),
 ('10730000-0000-0000-0000-0000000000d2','10730000-0000-0000-0000-000000000001','Target allocations','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-TARGET'),
 ('10730000-0000-0000-0000-0000000000d3','10730000-0000-0000-0000-000000000001','Sibling allocations','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-SIBLING'),
 ('10730000-0000-0000-0000-0000000000d4','10730000-0000-0000-0000-000000000001','Incomplete inputs','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-INCOMPLETE'),
 ('10730000-0000-0000-0000-0000000000d5','10730000-0000-0000-0000-000000000001','Known empty','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-EMPTY'),
 ('10730000-0000-0000-0000-0000000000d6','10730000-0000-0000-0000-000000000001','Receipt volume','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-VOLUME'),
 ('10730000-0000-0000-0000-0000000000d7','10730000-0000-0000-0000-000000000001','Invoice lifecycle','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-LIFECYCLE'),
 ('10730000-0000-0000-0000-0000000000d8','10730000-0000-0000-0000-000000000001','Number identity','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-NUMBER'),
 ('10730000-0000-0000-0000-0000000000d9','10730000-0000-0000-0000-000000000001','Before reassignment','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-REASSIGN-FROM'),
 ('10730000-0000-0000-0000-0000000000da','10730000-0000-0000-0000-000000000001','After reassignment','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-REASSIGN-TO'),
 ('10730000-0000-0000-0000-0000000000db','10730000-0000-0000-0000-000000000002','Foreign project','Ongoing Project','USD',10000,'exclusive',0,0,1,1,false,'CASH-FOREIGN');

set local role authenticated;
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('10730000-0000-0000-0000-0000000000d1','10730000-0000-0000-0000-0000000000c1',
    '[{"description":"NATIVE-SETTLEMENT","qty":1,"rate":1000}]'::jsonb);
  perform public.create_native_sales_invoice('10730000-0000-0000-0000-0000000000d1','10730000-0000-0000-0000-0000000000c1',
    '[{"description":"NATIVE-OVERPAY","qty":1,"rate":100}]'::jsonb);
  perform public.create_native_sales_invoice('10730000-0000-0000-0000-0000000000d1','10730000-0000-0000-0000-0000000000c1',
    '[{"description":"NATIVE-CANCEL","qty":1,"rate":100}]'::jsonb);
end $$;
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"NATIVE-SETTLEMENT"}]'),'Unpaid');
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"NATIVE-OVERPAY"}]'),'Unpaid');
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"NATIVE-CANCEL"}]'),'Unpaid');
end $$;
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"NATIVE-SETTLEMENT"}]'),
  1000,980,20,'CASH-WITHHOLD-1',(select invoice_date from public.sales_invoices where native_lines @> '[{"description":"NATIVE-SETTLEMENT"}]'));
select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"NATIVE-OVERPAY"}]'),
  150,150,0,null,(select invoice_date from public.sales_invoices where native_lines @> '[{"description":"NATIVE-OVERPAY"}]'));
select public.record_native_receipt((select id from public.sales_invoices where native_lines @> '[{"description":"NATIVE-CANCEL"}]'),
  100,100,0,null,(select invoice_date from public.sales_invoices where native_lines @> '[{"description":"NATIVE-CANCEL"}]'));
select public.cancel_native_receipt((select id from public.incoming_payments where withholding_slip_number is null
  and sales_invoice_id=(select id from public.sales_invoices where native_lines @> '[{"description":"NATIVE-CANCEL"}]')));

set local role service_role;
set local request.jwt.claims='{}';
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,tax_amount,
                                  currency,status,erp_docstatus) values
 ('10730000-0000-0000-0000-000000000101','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d2','ERP-A1','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-000000000102','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d2','ERP-A2','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-000000000103','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d2','ERP-A-IDR','2026-01-01',1000,0,'exclusive',0,'IDR','Submitted',1),
 ('10730000-0000-0000-0000-000000000104','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d3','ERP-B1','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-000000000105','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d4','ERP-I1','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-000000000106','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d4','ERP-I2','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-000000000107','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d8','ERP-NUMBER','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-000000000108','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d8','ERP-STALE','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-000000000109','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d5','ERP-EMPTY','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-00000000010a','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d6','ERP-VOLUME','2026-01-01',2000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-00000000010b','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d7','ERP-DRAFT','2026-01-01',1000,1000,'exclusive',0,'USD','Draft',0),
 ('10730000-0000-0000-0000-00000000010c','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d7','ERP-CANCELLED','2026-01-01',1000,1000,'exclusive',0,'USD','Cancelled',2),
 ('10730000-0000-0000-0000-00000000010d','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d7','ERP-UNPOSTED','2026-01-01',1000,1000,'exclusive',0,'USD','Unpaid',0),
 ('10730000-0000-0000-0000-00000000010e','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-0000000000d9','ERP-REASSIGN','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1),
 ('10730000-0000-0000-0000-00000000010f','10730000-0000-0000-0000-000000000002','10730000-0000-0000-0000-0000000000db','ERP-FOREIGN','2026-01-01',1000,0,'exclusive',0,'USD','Submitted',1);
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000101','erpnext','ERP-A1'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000102','erpnext','ERP-A2'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000103','erpnext','ERP-A-IDR'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000104','erpnext','ERP-B1'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000105','erpnext','ERP-I1'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000106','erpnext','ERP-I2'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000107','erpnext','ERP-NUMBER'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000108','erpnext','ERP-STALE'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-000000000109','erpnext','ERP-EMPTY'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-00000000010a','erpnext','ERP-VOLUME'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-00000000010b','erpnext','ERP-DRAFT'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-00000000010c','erpnext','ERP-CANCELLED'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-00000000010d','erpnext','ERP-UNPOSTED'),
 ('10730000-0000-0000-0000-000000000001','revenue','10730000-0000-0000-0000-00000000010e','erpnext','ERP-REASSIGN'),
 ('10730000-0000-0000-0000-000000000002','revenue','10730000-0000-0000-0000-00000000010f','erpnext','ERP-FOREIGN-ONLY');

insert into public.incoming_payments (id,org_id,sales_invoice_id,ip_number,date,amount,received_amount,withheld_amount,currency,status,erp_docstatus,allocation_details,erp_cancelled_at) values
 ('10730000-0000-0000-0000-000000000201','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000101','ERP-R-MIX','2026-01-02',50,50,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000101","invoice_number":"ERP-A1","amount":"30.00","currency":"USD"},{"invoice_id":"10730000-0000-0000-0000-000000000104","invoice_number":"ERP-B1","amount":"20.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000202','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000101','ERP-R-WITHHOLD','2026-01-02',1000,980,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000101","invoice_number":"ERP-A1","amount":"600.00","currency":"USD"},{"invoice_id":"10730000-0000-0000-0000-000000000102","invoice_number":"ERP-A2","amount":"400.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000203','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000101','ERP-R-REPEATED','2026-01-02',10,10,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000101","invoice_number":"ERP-A1","amount":"4.00","currency":"USD"},{"invoice_id":"10730000-0000-0000-0000-000000000101","invoice_number":"ERP-A1","amount":"6.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000204','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000103','ERP-R-IDR','2026-01-02',7,7,0,'IDR','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000103","invoice_number":"ERP-A-IDR","amount":"7.00","currency":"IDR"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000205','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000101','ERP-R-REMAINDER','2026-01-02',20,20,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000101","invoice_number":"ERP-A1","amount":"12.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000206','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000104','ERP-R-SIBLING','2026-01-02',20,20,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000104","invoice_number":"ERP-B1","amount":"20.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000207','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-UNREPORTED','2026-01-02',20,20,0,'USD','Paid',1,null,null),
 ('10730000-0000-0000-0000-000000000208','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-AMBIGUOUS','2026-01-02',100,90,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"60.00","currency":"USD"},{"invoice_id":"10730000-0000-0000-0000-000000000107","invoice_number":"ERP-NUMBER","amount":"40.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000209','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-BAD-AMOUNT','2026-01-02',10,10,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"1e2","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000020a','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-BAD-CURRENCY','2026-01-02',10,10,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"10.00","currency":"EUR"}]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000020b','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-MISMATCH','2026-01-02',30,25,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"25.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000020c','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-CONTRADICT','2026-01-02',20,20,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000107","invoice_number":"ERP-NUMBER","amount":"20.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000020d','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-UNKNOWN-POST','2026-01-02',20,20,0,'USD','Paid',null,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"20.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000020e','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-00000000010b','ERP-R-DRAFT-INVOICE','2026-01-02',10,10,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-00000000010b","invoice_number":"ERP-DRAFT","amount":"10.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000020f','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-00000000010c','ERP-R-CANCELLED-INVOICE','2026-01-02',10,10,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-00000000010c","invoice_number":"ERP-CANCELLED","amount":"10.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000210','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-00000000010d','ERP-R-UNPOSTED-INVOICE','2026-01-02',10,10,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-00000000010d","invoice_number":"ERP-UNPOSTED","amount":"10.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000211','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000109','ERP-R-EMPTY','2026-01-02',50,50,0,'USD','Paid',1,'[]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000212','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-00000000010e','ERP-R-REASSIGN','2026-01-02',20,20,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-00000000010e","invoice_number":"ERP-REASSIGN","amount":"20.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000213','10730000-0000-0000-0000-000000000001',null,'ERP-R-NUMBER-NULL-ID','2026-01-02',40,40,0,'USD','Paid',1,
  '[{"invoice_id":null,"invoice_number":"ERP-NUMBER","amount":"40.00","currency":null}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000214','10730000-0000-0000-0000-000000000001',null,'ERP-R-NUMBER-STALE-ID','2026-01-02',40,40,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000106","invoice_number":"ERP-STALE","amount":"40.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000215','10730000-0000-0000-0000-000000000001',null,'ERP-R-UNKNOWN-NUMBER','2026-01-02',40,40,0,'USD','Paid',1,
  '[{"invoice_id":null,"invoice_number":"NO-CURRENT-BINDING","amount":"40.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000216','10730000-0000-0000-0000-000000000001',null,'ERP-R-FOREIGN-NUMBER','2026-01-02',40,40,0,'USD','Paid',1,
  '[{"invoice_id":null,"invoice_number":"ERP-FOREIGN-ONLY","amount":"40.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000217','10730000-0000-0000-0000-000000000001',null,'ERP-R-OTHER-PROJECT','2026-01-02',40,40,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000107","invoice_number":"ERP-NUMBER","amount":"40.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-000000000218','10730000-0000-0000-0000-000000000001',null,'ERP-R-ON-ACCOUNT','2026-01-02',40,40,0,'USD','Paid',1,null,null),
 ('10730000-0000-0000-0000-000000000219','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-00000000010a','ERP-R-VOLUME-EMPTY','2026-01-02',40,40,0,'USD','Paid',1,'[]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000021a','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-ERP-CANCELLED','2026-01-02',40,40,0,'USD','Paid',2,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"40.00","currency":"USD"}]'::jsonb,null),
 ('10730000-0000-0000-0000-00000000021b','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-ERP-STAMP','2026-01-02',40,40,0,'USD','Paid',1,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"40.00","currency":"USD"}]'::jsonb,'2026-02-01'),
 ('10730000-0000-0000-0000-00000000021c','10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-000000000105','ERP-R-SCHEDULED','2026-01-02',40,40,0,'USD','Scheduled',0,
  '[{"invoice_id":"10730000-0000-0000-0000-000000000105","invoice_number":"ERP-I1","amount":"40.00","currency":"USD"}]'::jsonb,null);
update public.incoming_payments set withheld_amount=20, withholding_slip_number='ERP-WITHHOLD-1'
 where id='10730000-0000-0000-0000-000000000202';
update public.incoming_payments set withheld_amount=10, withholding_slip_number='ERP-WITHHOLD-2'
 where id='10730000-0000-0000-0000-000000000208';
insert into public.incoming_payments (id,org_id,sales_invoice_id,ip_number,date,amount,received_amount,withheld_amount,currency,status,erp_docstatus,allocation_details)
select ('10730000-0000-0000-0000-'||lpad((70000+g)::text,12,'0'))::uuid,
       '10730000-0000-0000-0000-000000000001','10730000-0000-0000-0000-00000000010a',
       'ERP-R-VOLUME-'||g,'2026-01-02',1,1,0,'USD','Paid',1,
       jsonb_build_array(jsonb_build_object('invoice_id','10730000-0000-0000-0000-00000000010a','invoice_number','ERP-VOLUME','amount','1.00','currency','USD'))
  from generate_series(1,1001) g;
insert into public.incoming_payments (id,org_id,sales_invoice_id,ip_number,date,amount,received_amount,withheld_amount,currency,status,erp_docstatus,allocation_details)
values ('10730000-0000-0000-0000-00000000021d','10730000-0000-0000-0000-000000000001',null,'ERP-R-FOREIGN-ONLY','2026-01-02',40,40,0,'USD','Paid',1,
  '[{"invoice_id":null,"invoice_number":"ERP-FOREIGN-ONLY","amount":"40.00","currency":"USD"}]'::jsonb);
update public.sales_invoices set project_id='10730000-0000-0000-0000-0000000000da'
 where id='10730000-0000-0000-0000-00000000010e';
reset role;
create temp table receipt_cash_explain_plans (path text primary key, plan json) on commit drop;
grant insert,select on receipt_cash_explain_plans to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
declare v_plan json;
begin
  execute $explain$
    explain (analyze, buffers, format json)
    select ip.id from public.incoming_payments ip
      join public.sales_invoices si on si.id='10730000-0000-0000-0000-000000000101'::uuid and si.org_id=ip.org_id
     where ip.org_id='10730000-0000-0000-0000-000000000001' and si.project_id='10730000-0000-0000-0000-0000000000d2'
       and not ip.pmo_native and ip.allocation_details @> '[{"invoice_id":"10730000-0000-0000-0000-000000000101"}]'::jsonb
  $explain$ into v_plan;
  insert into pg_temp.receipt_cash_explain_plans values ('json-id',v_plan);
  execute $explain$
    explain (analyze, buffers, format json)
    select ip.id from public.incoming_payments ip
      join public.external_refs er on er.org_id=ip.org_id and er.domain='revenue' and er.external_record_id='ERP-NUMBER'
      join public.sales_invoices si on si.org_id=er.org_id and si.id::text=er.pmo_record_id
       and si.project_id='10730000-0000-0000-0000-0000000000d8'
     where ip.org_id='10730000-0000-0000-0000-000000000001' and not ip.pmo_native
       and ip.allocation_details @> '[{"invoice_number":"ERP-NUMBER"}]'::jsonb
  $explain$ into v_plan;
  insert into pg_temp.receipt_cash_explain_plans values ('json-number',v_plan);
end $$;
select diag(path || ': ' || plan::text) from pg_temp.receipt_cash_explain_plans order by path;

select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d1')->'cash_received',
  '{"state":"known","buckets":[{"currency":"IDR","amount":"1130.00"}],"receipt_count":2}'::jsonb,
  'AC-UWC-005 native received cash is counted once, withholding is excluded and overpayment is not capped');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d2')->'cash_received',
  '{"state":"known","buckets":[{"currency":"IDR","amount":"7.00"},{"currency":"USD","amount":"1032.00"}],"receipt_count":5}'::jsonb,
  'AC-UWC-005 allocations split multi-project cash, same-project withheld cash counts once, repeated invoice lines count once, and remainder stays unapplied');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d3')->'cash_received',
  '{"state":"known","buckets":[{"currency":"USD","amount":"40.00"}],"receipt_count":2}'::jsonb,
  'AC-UWC-005 sibling project receives only its exact allocation and no duplicate header cash');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d6')->'cash_received',
  '{"state":"known","buckets":[{"currency":"USD","amount":"1001.00"}],"receipt_count":1001}'::jsonb,
  'AC-UWC-007 server aggregation counts every qualifying receipt beyond one thousand');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000da')->'cash_received',
  '{"state":"known","buckets":[{"currency":"USD","amount":"20.00"}],"receipt_count":1}'::jsonb,
  'AC-UWC-007 attribution follows the current invoice project after reassignment');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d9')->'cash_received',
  '{"state":"known","buckets":[],"receipt_count":0}'::jsonb,
  'AC-UWC-007 reassignment removes receipt cash from the former project');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d5')->'cash_received',
  '{"state":"known","buckets":[],"receipt_count":0}'::jsonb,
  'AC-UWC-006 known on-account, unresolvable, foreign-only, other-project and explicit-empty allocations do not degrade known zero');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d4')->'cash_received'->>'state','incomplete',
  'AC-UWC-006 relevant ambiguous and unsupported receipt facts withhold every cash bucket');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d4')->'cash_received'->'buckets','[]'::jsonb,
  'AC-UWC-006 an incomplete project has no supported subtotal');
select ok((public.get_project_finances('10730000-0000-0000-0000-0000000000d4')->'cash_received'->'reasons') @>
  '["allocation-unreported","ambiguous-withholding","allocation-invalid","currency-mismatch","source-inconsistent","posting-unconfirmed"]'::jsonb,
  'AC-UWC-006 distinct source, allocation, currency, withholding and posting reasons are retained');
select ok((public.get_project_finances('10730000-0000-0000-0000-0000000000d7')->'cash_received'->'reasons') @> '["invoice-lifecycle"]'::jsonb,
  'AC-UWC-007 posted receipts linked to draft, cancelled or unposted invoices make coverage incomplete');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d4')->'cash_received'->>'receipt_count',
  (select count(*)::text from public.incoming_payments where org_id='10730000-0000-0000-0000-000000000001'
     and (id between '10730000-0000-0000-0000-000000000207' and '10730000-0000-0000-0000-00000000020d'
          or id='10730000-0000-0000-0000-000000000214')),
  'AC-UWC-006 relevant incomplete receipts are counted distinctly');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d7')->'cash_received',
  '{"state":"incomplete","buckets":[],"receipt_count":3,"reasons":["invoice-lifecycle"]}'::jsonb,
  'AC-UWC-007 each still-posted receipt to a draft, cancelled or unposted invoice remains visible as incomplete');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d8')->'cash_received'->>'state','incomplete',
  'AC-UWC-007 a null legacy FK with current target invoice-number binding remains relevant and incomplete');
select ok((public.get_project_finances('10730000-0000-0000-0000-0000000000d8')->'cash_received'->'reasons') @> '["allocation-unresolved","currency-mismatch","source-inconsistent"]'::jsonb,
  'AC-UWC-007 null and stale cached invoice ids are not repaired from current number identity');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d8')->'cash_received'->'buckets','[]'::jsonb,
  'AC-UWC-007 known invoice-number relevance never invents an allocated amount or currency');
select is(public.get_project_finances('10730000-0000-0000-0000-0000000000d1')->>'project_id',
  '10730000-0000-0000-0000-0000000000d1','AC-UWC-005 existing project identity remains in the finance payload');
select ok(public.get_project_finances('10730000-0000-0000-0000-0000000000d1') ? 'invoices'
       and public.get_project_finances('10730000-0000-0000-0000-0000000000d1') ? 'actuals'
       and public.get_project_finances('10730000-0000-0000-0000-0000000000d1') ? 'budget'
       and public.get_project_finances('10730000-0000-0000-0000-0000000000d1') ? 'contract_invoiced',
  'AC-UWC-005 receipt cash is additive to existing settlement, Actual, budget and contract fields');
select ok(has_function_privilege('authenticated','public.get_project_finances(uuid)','EXECUTE')
       and not has_function_privilege('anon','public.get_project_finances(uuid)','EXECUTE')
       and not has_table_privilege('anon','public.incoming_payments','SELECT'),
  'AC-UWC-008 existing read execute and raw-data grants are unchanged');

set local role authenticated;
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000d1')$$,'AC-UWC-008 Admin retains the guarded finance read');
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000d1')$$,'AC-UWC-008 Finance retains the guarded finance read');
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000d1')$$,'AC-UWC-008 Executive retains the guarded finance read');
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000d1')$$,'AC-UWC-008 Project Manager retains the guarded finance read');
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000d1')$$,'42501',null,'AC-UWC-008 Engineer cannot obtain a cash result');
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000d1')$$,'42501',null,'AC-UWC-008 inactive Finance cannot obtain a cash result');
set local request.jwt.claims='{"sub":"10730000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000db')$$,'P0002',null,'AC-UWC-008 another organisation''s project yields no readable cash result');
reset role;
set local request.jwt.claims='{}';
select throws_ok($$select public.get_project_finances('10730000-0000-0000-0000-0000000000d1')$$,'42501',null,'AC-UWC-008 anonymous caller receives no apparent zero');

select * from finish();
rollback;
