-- #1506 C6-T1/T2: service-only revenue page application, atomic cursors, tenancy and census tombstones.
begin;
select plan(35);

insert into organizations (id, name) values
 ('a5130000-0000-0000-0000-000000000001','Revenue A'),
 ('a5130000-0000-0000-0000-000000000002','Revenue B');
insert into auth.users (id, email) values ('a5130000-0000-0000-0000-0000000000a1','a513-a@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a5130000-0000-0000-0000-0000000000a1','a5130000-0000-0000-0000-000000000001','Revenue Finance','a513-a@example.test','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a5130000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','fixture-a','active','{}', now()),
 ('a5130000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','fixture-b','active','{}', now());
insert into external_domain_ownership (org_id, external_tier, domain) values
 ('a5130000-0000-0000-0000-000000000001','odoo','revenue'),
 ('a5130000-0000-0000-0000-000000000002','odoo','revenue');
insert into sales_invoices (id, org_id, status, si_number, amount, tax_treatment, tax_amount, erp_outstanding_amount, erp_docstatus, erp_modified, created_at) values
 ('a5130000-0000-0000-0000-0000000000e1','a5130000-0000-0000-0000-000000000001','Unpaid','INV-A-7',100,'exclusive',0,100,1,'2026-11-01 10:00:00',now()-interval '1 day'),
 ('a5130000-0000-0000-0000-0000000000e2','a5130000-0000-0000-0000-000000000001','Unpaid','INV-A-8',200,'exclusive',0,200,1,'2026-11-01 10:00:00',now()-interval '1 day'),
 ('a5130000-0000-0000-0000-0000000000e3','a5130000-0000-0000-0000-000000000002','Unpaid','INV-B-7',300,'exclusive',0,300,1,'2026-11-01 10:00:00',now()-interval '1 day');
insert into sales_invoices (id, org_id, status, amount, tax_treatment, tax_amount, currency, invoice_date, pmo_native, native_lines, created_at) values
 ('a5130000-0000-0000-0000-0000000000e5','a5130000-0000-0000-0000-000000000001','Draft',100,'exclusive',10,'IDR','2026-11-01',true,
  '[{"item_code":"SVC-ORPHAN","description":"orphan","qty":1,"rate":100,"amount":100}]'::jsonb,now()-interval '1 day');
insert into incoming_payments (id, org_id, status, ip_number, amount, erp_docstatus, erp_modified, created_at) values
 ('a5130000-0000-0000-0000-0000000000e4','a5130000-0000-0000-0000-000000000001','Paid','PAY-A-9',25,1,'2026-11-01 10:00:00',now()-interval '1 day');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id, created_at) values
 ('a5130000-0000-0000-0000-000000000001','revenue','a5130000-0000-0000-0000-0000000000e1','odoo','account.move:7',now()-interval '1 day'),
 ('a5130000-0000-0000-0000-000000000001','revenue','a5130000-0000-0000-0000-0000000000e2','odoo','account.move:8',now()-interval '1 day'),
 ('a5130000-0000-0000-0000-000000000002','revenue','a5130000-0000-0000-0000-0000000000e3','odoo','account.move:7',now()-interval '1 day'),
 ('a5130000-0000-0000-0000-000000000001','revenue','a5130000-0000-0000-0000-0000000000e4','odoo','account.payment:9',now()-interval '1 day');
insert into companies (id, org_id, name, type) values
 ('a5130000-0000-0000-0000-0000000000c1','a5130000-0000-0000-0000-000000000001','Client A','Client');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id, created_at) values
 ('a5130000-0000-0000-0000-000000000001','companies','a5130000-0000-0000-0000-0000000000c1','odoo','Client:41',now()-interval '1 day');
insert into sales_invoices (id, org_id, customer_id, status, amount, tax_treatment, tax_amount, currency, invoice_date, reference_number) values
 ('a5130000-0000-0000-0000-0000000000e6','a5130000-0000-0000-0000-000000000001','a5130000-0000-0000-0000-0000000000c1','Draft',110,'exclusive',20,'IDR','2026-11-01','PO-16');

-- The user JWT cannot write any shipped revenue mirror column.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a5130000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update sales_invoices set erp_docstatus=2 where id='a5130000-0000-0000-0000-0000000000e1'$$,
  '42501', null, 'AC-OCI-070 a user cannot write the sales-invoice mirror fields');
select throws_ok($$update incoming_payments set erp_docstatus=2 where id='a5130000-0000-0000-0000-0000000000e4'$$,
  '42501', null, 'AC-OCI-070 a user cannot write the incoming-payment mirror fields');
select throws_ok($$update revenue_erp_mirror set erp_name='forged' where org_id='a5130000-0000-0000-0000-000000000001'$$,
  '42501', null, 'AC-OCI-070 a user cannot update any revenue side-mirror column');
select throws_ok($$insert into revenue_erp_mirror (org_id,erp_doctype,erp_name,external_ref,erp_status,erp_state,erp_docstatus,erp_modified)
  values ('a5130000-0000-0000-0000-000000000001','Sales Invoice','forged','account.move:99','posted','posted',1,'2026-11-03 10:00:00')$$,
  '42501', null, 'AC-OCI-070 a user cannot insert a revenue side-mirror row');
select throws_ok($$delete from revenue_erp_mirror where org_id='a5130000-0000-0000-0000-000000000001'$$,
  '42501', null, 'AC-OCI-070 a user cannot delete a revenue side-mirror row');
select throws_ok($$select public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','sales-invoice','[]'::jsonb,'blocked')$$,
  '42501', null, 'AC-OCI-070 the page apply is service-role only');
select throws_ok($$select public.mark_odoo_revenue_census_seen('a5130000-0000-0000-0000-000000000001','sales-invoice',now(),array['7'])$$,
  '42501', null, 'AC-OCI-070 census marking is service-role only');
select throws_ok($$select public.finish_odoo_revenue_census('a5130000-0000-0000-0000-000000000001','sales-invoice',now(),'blocked')$$,
  '42501', null, 'AC-OCI-070 census finish is service-role only');
reset role;

-- The verified org is an argument from the binding resolver. A body-supplied org_id is ignored.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','sales-invoice', $$[
  {"external_id":"7","name":"INV-A-7","source_write_date":"2026-11-02 10:00:00","org_id":"a5130000-0000-0000-0000-000000000002",
   "attrs":{"state":"posted","docstatus":1,"status":"Unpaid","partner":"41","partner_name":"Client A","date":"2026-11-01","due_date":"2026-12-01","reference_number":"PO-A","currency":"IDR","amount_total":"100.00","amount_untaxed":"90.00","amount_tax":"10.00","residual":"60.00"}}
]$$::jsonb,'cur-a-1'),1,'AC-OCI-074 a linked invoice page applies');
reset role;
select results_eq($$select status, si_number, amount, tax_amount, tax_treatment, erp_outstanding_amount, erp_docstatus, erp_modified, odoo_state, odoo_attention, odoo_read_at is not null from sales_invoices where id='a5130000-0000-0000-0000-0000000000e1'$$,
  $$values ('Unpaid'::text,'INV-A-7'::text,100.00::numeric,10.00::numeric,'inclusive'::text,60.00::numeric,1::smallint,'2026-11-02 10:00:00'::text,'posted'::text,null::text,true)$$,
  'AC-OCI-074 the linked invoice refreshes the complete money header and Odoo read facts');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5130000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice'),'cur-a-1','AC-OCI-074 the page and cursor are stored together');

-- An incomplete money header cannot replace figures or a derived status, even though its page cursor commits.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','sales-invoice', $$[
  {"external_id":"7","name":"INV-A-7","source_write_date":"2026-11-02 11:00:00","attrs":{"state":"posted","docstatus":1,"status":"Paid","amount_total":"100.00","residual":"0.00"}}
]$$::jsonb,'cur-incomplete'),1,'AC-OCI-082 an incomplete invoice page still advances its durable cursor');
reset role;
select results_eq($$select status, amount, tax_amount, tax_treatment, erp_outstanding_amount from sales_invoices where id='a5130000-0000-0000-0000-0000000000e1'$$,
  $$values ('Unpaid'::text,100.00::numeric,10.00::numeric,'inclusive'::text,60.00::numeric)$$,'AC-OCI-082 an incomplete header changes neither money nor derived status');

-- A page failure after the linked-row write rolls back both the row and the watermark.
create function public.a513_fail_revenue_insert() returns trigger language plpgsql as $$
begin
  if new.external_ref = 'account.move:99' then raise exception 'fixture page apply failure'; end if;
  return new;
end $$;
create trigger a513_fail_revenue_insert before insert on public.revenue_erp_mirror
  for each row execute function public.a513_fail_revenue_insert();
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','sales-invoice', $j$[
  {"external_id":"7","name":"INV-A-7","source_write_date":"2026-11-03 12:00:00","attrs":{"state":"posted","docstatus":1,"status":"Paid","amount_total":"100.00","residual":"0.00"}},
  {"external_id":"99","name":"INV-NATIVE-99","source_write_date":"2026-11-03 10:00:00","attrs":{"state":"posted","docstatus":1,"status":"Unpaid","partner":"99","partner_name":"Client Native","date":"2026-11-03","currency":"IDR","amount_total":"50.00","residual":"50.00"}}
]$j$::jsonb,'cur-failed')$$,'P0001','fixture page apply failure','AC-OCI-074 a failed page rolls back its earlier invoice update');
reset role;
select results_eq($$select status, erp_outstanding_amount, erp_modified from sales_invoices where id='a5130000-0000-0000-0000-0000000000e1'$$,
  $$values ('Unpaid'::text,60.00::numeric,'2026-11-02 11:00:00'::text)$$,'AC-OCI-074 a failed page leaves the mirror unchanged');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5130000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice'),'cur-incomplete','AC-OCI-074 a failed page leaves its cursor unchanged');
select is((select count(*) from revenue_erp_mirror where org_id='a5130000-0000-0000-0000-000000000001' and external_ref='account.move:99'),0::bigint,'AC-OCI-074 no partial native row remains');
drop trigger a513_fail_revenue_insert on public.revenue_erp_mirror;
drop function public.a513_fail_revenue_insert();

-- Org B may hold the same Odoo id, but its page cannot touch A's row or cursor, even with A named in the body.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000002','sales-invoice', $$[
  {"external_id":"7","name":"INV-B-7","source_write_date":"2026-11-03 11:00:00","org_id":"a5130000-0000-0000-0000-000000000001",
   "attrs":{"state":"posted","docstatus":1,"status":"Paid","partner":"42","partner_name":"Client B","date":"2026-11-02","currency":"IDR","amount_total":"300.00","residual":"0.00"}}
]$$::jsonb,'cur-b-1'),1,'AC-OCI-070 org B page applies in org B');
reset role;
select is((select si_number from sales_invoices where id='a5130000-0000-0000-0000-0000000000e1'),'INV-A-7','AC-OCI-070 org B cannot update org A invoice with the same Odoo id');
select is((select amount from sales_invoices where id='a5130000-0000-0000-0000-0000000000e3'),300.00::numeric,'AC-OCI-070 org B updates only its own invoice');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5130000-0000-0000-0000-000000000002' and domain='revenue:sales-invoice'),'cur-b-1','AC-OCI-070 org B cursor advances');
select is((select count(*) from external_sync_watermarks where org_id='a5130000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice'),1::bigint,'AC-OCI-070 org A cursor is unchanged by org B');

-- Invoice, credit note and payment domains stay tier- and org-scoped; the credit amount is negative and its reversed ref is retained.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','credit-note', $$[
   {"external_id":"15","name":"CN-A-15","source_write_date":"2026-11-03 12:00:00","attrs":{"state":"posted","docstatus":1,"status":"Posted","partner":"41","partner_name":"Client A","date":"2026-11-03","currency":"IDR","amount_total":"20.00","residual":"0.00","reversed_entry_ref":"account.move:7"}}
]$$::jsonb,'cur-credit-1');
select public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','incoming-payment', $$[
  {"external_id":"9","name":"PAY-A-9","source_write_date":"2026-11-03 12:00:00","attrs":{"state":"paid","docstatus":1,"status":"Paid","payment_type":"inbound","partner_type":"customer","partner":"41","partner_name":"Client A","date":"2026-11-03","currency":"IDR","amount":"25.00"}}
]$$::jsonb,'cur-payment-1');
reset role;
select results_eq($$select erp_doctype, grand_total, outstanding_amount, reversed_entry_ref, sales_invoice_id is not null from revenue_erp_mirror where org_id='a5130000-0000-0000-0000-000000000001' and external_ref='account.move:15'$$,
  $$values ('Credit Note'::text,-20.00::numeric,0.00::numeric,'account.move:7'::text,true)$$,'AC-OCI-075 a credit note is negative and linked to its reversed invoice');
select is((select erp_outstanding_amount from sales_invoices where id='a5130000-0000-0000-0000-0000000000e1'),60.00::numeric,'AC-OCI-075 invoice outstanding is Odoo residual');
select results_eq($$select status, amount, erp_docstatus from incoming_payments where id='a5130000-0000-0000-0000-0000000000e4'$$,
  $$values ('Paid'::text,25.00::numeric,1::smallint)$$,'AC-OCI-074 an inbound customer payment refreshes its PMO row');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','incoming-payment', $$[
  {"external_id":"9","name":"PAY-A-9","source_write_date":"2026-11-03 13:00:00","attrs":{"state":"in_process","docstatus":1,"status":"Paid","payment_type":"inbound","partner_type":"customer","partner":"41","partner_name":"Client A","date":"2026-11-03","currency":"IDR","amount":"25.00"}}
]$$::jsonb,'cur-payment-in-process');
reset role;
select is((select status from incoming_payments where id='a5130000-0000-0000-0000-0000000000e4'),'Paid','AC-OCI-071 an in-process Odoo receipt remains Paid in PMO');

-- Native invoices listed twice are keyed once at their newest figures; an Odoo row carrying a PMO anchor is proposed for adoption.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_odoo_revenue_page('a5130000-0000-0000-0000-000000000001','sales-invoice', $$[
  {"external_id":"16","name":"INV-NATIVE-16","source_write_date":"2026-11-03 13:01:00","attrs":{"state":"posted","docstatus":1,"status":"Unpaid","partner":"41","partner_name":"Client A","date":"2026-11-01","reference_number":"PO-16","currency":"IDR","amount_total":"120.00","amount_untaxed":"100.00","amount_tax":"20.00","residual":"80.00"}},
  {"external_id":"16","name":"INV-NATIVE-16","source_write_date":"2026-11-03 13:02:00","attrs":{"state":"posted","docstatus":1,"status":"Unpaid","partner":"41","partner_name":"Client A","date":"2026-11-01","reference_number":"PO-16","currency":"IDR","amount_total":"130.00","amount_untaxed":"110.00","amount_tax":"20.00","residual":"90.00"}},
  {"external_id":"17","name":"INV-ORPHAN-17","source_write_date":"2026-11-03 13:03:00","attrs":{"state":"posted","docstatus":1,"status":"Unpaid","partner":"41","partner_name":"Client A","date":"2026-11-01","reference_number":"PO-ORPHAN","currency":"IDR","amount_total":"110.00","amount_untaxed":"100.00","amount_tax":"10.00","residual":"110.00","anchor_key":"si:a5130000-0000-0000-0000-0000000000e5"}}
]$$::jsonb,'cur-native-1'),2,'AC-OCI-072 duplicate Odoo invoice ids collapse to one newest row');
reset role;
select results_eq($$select grand_total, outstanding_amount, erp_modified, pair_candidates from revenue_erp_mirror
  where org_id='a5130000-0000-0000-0000-000000000001' and external_ref='account.move:16'$$,
  $$values (130.00::numeric,90.00::numeric,'2026-11-03 13:02:00'::text,array['a5130000-0000-0000-0000-0000000000e6'::uuid])$$,
  'AC-OCI-072 a duplicated native invoice is mirrored once at its newest figures and pairs with the same client, reference and amount');
select results_eq($$select pmo_owned, adoption_key, sales_invoice_id, pair_candidates, customer_company_id from revenue_erp_mirror
  where org_id='a5130000-0000-0000-0000-000000000001' and external_ref='account.move:17'$$,
  $$values (true,'si:a5130000-0000-0000-0000-0000000000e5'::text,'a5130000-0000-0000-0000-0000000000e5'::uuid,array['a5130000-0000-0000-0000-0000000000e5'::uuid],'a5130000-0000-0000-0000-0000000000c1'::uuid)$$,
  'AC-OCI-072 an anchored orphan is proposed for adoption, never re-created');

-- Census seen IDs are retained; hard-deleted linked invoices are tombstoned and stop counting.
create temporary table a513_revenue_census_run (run_at timestamptz) on commit drop;
insert into a513_revenue_census_run values (now()), (now()+interval '1 second');
grant select on a513_revenue_census_run to service_role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.finish_odoo_revenue_census('a5130000-0000-0000-0000-000000000001','sales-invoice',(select run_at from a513_revenue_census_run order by run_at desc limit 1),'census-empty')$$,
  'P0001','revenue census saw no documents','AC-OCI-073 an empty census refuses before tombstoning eligible invoices');
select is((select status from sales_invoices where id='a5130000-0000-0000-0000-0000000000e2'),'Unpaid','AC-OCI-073 an empty census leaves eligible invoices live');
select public.mark_odoo_revenue_census_seen('a5130000-0000-0000-0000-000000000001','sales-invoice',(select min(run_at) from a513_revenue_census_run),array['7']);
select is(public.finish_odoo_revenue_census('a5130000-0000-0000-0000-000000000001','sales-invoice',(select min(run_at) from a513_revenue_census_run),'census-a-1'),1,'AC-OCI-073 the census tombstones one missing invoice');
reset role;
select results_eq($$select status, erp_docstatus, erp_cancelled_at is not null from sales_invoices where id='a5130000-0000-0000-0000-0000000000e2'$$,
  $$values ('Cancelled'::text,2::smallint,true)$$,'AC-OCI-073 a hard-deleted invoice is tombstoned');
select is((select erp_docstatus from sales_invoices where id='a5130000-0000-0000-0000-0000000000e1'),1::smallint,'AC-OCI-073 a census-seen invoice remains live');
select is((select watermark_cursor from external_sync_watermarks where org_id='a5130000-0000-0000-0000-000000000001' and domain='revenue:sales-invoice'),'census-a-1','AC-OCI-073 census completion commits its cursor');

select * from finish();
rollback;
