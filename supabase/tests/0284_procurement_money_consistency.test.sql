-- 0284 procurement money consistency — line totals, settlement evidence, and quote decision.
begin;
select plan(26);

insert into organizations (id, name) values ('02840000-0000-0000-0000-000000000001','PMC Org');
insert into auth.users (id, email) values
 ('02840000-0000-0000-0000-0000000000a1','pmc-requester@example.com'),
 ('02840000-0000-0000-0000-0000000000a2','pmc-approver@example.com'),
 ('02840000-0000-0000-0000-0000000000a3','pmc-payer@example.com'),
 ('02840000-0000-0000-0000-0000000000a4','pmc-admin@example.com');
insert into profiles (id,org_id,full_name,email,role) values
 ('02840000-0000-0000-0000-0000000000a1','02840000-0000-0000-0000-000000000001','PMC Requester','pmc-requester@example.com','Engineer'),
 ('02840000-0000-0000-0000-0000000000a2','02840000-0000-0000-0000-000000000001','PMC Approver','pmc-approver@example.com','Finance'),
 ('02840000-0000-0000-0000-0000000000a3','02840000-0000-0000-0000-000000000001','PMC Payer','pmc-payer@example.com','Finance'),
 ('02840000-0000-0000-0000-0000000000a4','02840000-0000-0000-0000-000000000001','PMC Admin','pmc-admin@example.com','Admin');
insert into companies (id,org_id,name,type) values
 ('02840000-0000-0000-0000-000000000050','02840000-0000-0000-0000-000000000001','PMC Vendor','Vendor');
insert into procurements (id,org_id,title,status,requested_by_id,total_value,currency) values
 ('02840000-0000-0000-0000-000000000010','02840000-0000-0000-0000-000000000001','Priced','Draft','02840000-0000-0000-0000-0000000000a1',0,'USD'),
 ('02840000-0000-0000-0000-000000000011','02840000-0000-0000-0000-000000000001','Header only','Draft','02840000-0000-0000-0000-0000000000a1',300,'USD'),
 ('02840000-0000-0000-0000-000000000012','02840000-0000-0000-0000-000000000001','Scheduled payment','Vendor Invoiced','02840000-0000-0000-0000-0000000000a1',1200,'USD'),
 ('02840000-0000-0000-0000-000000000013','02840000-0000-0000-0000-000000000001','Invoice payable','Vendor Invoiced','02840000-0000-0000-0000-0000000000a1',0,'USD'),
 ('02840000-0000-0000-0000-000000000014','02840000-0000-0000-0000-000000000001','Select quote','Vendor Quoted','02840000-0000-0000-0000-0000000000a1',0,'USD'),
 ('02840000-0000-0000-0000-000000000015','02840000-0000-0000-0000-000000000001','Approved bypass','Approved','02840000-0000-0000-0000-0000000000a1',500,'USD'),
 ('02840000-0000-0000-0000-000000000016','02840000-0000-0000-0000-000000000001','Backfill target','Requested','02840000-0000-0000-0000-0000000000a1',0,'USD'),
 ('02840000-0000-0000-0000-000000000017','02840000-0000-0000-0000-000000000001','Terminal excluded','Cancelled','02840000-0000-0000-0000-0000000000a1',0,'USD'),
 ('02840000-0000-0000-0000-000000000018','02840000-0000-0000-0000-000000000001','No invoice fallback','Vendor Invoiced','02840000-0000-0000-0000-0000000000a1',420,'USD');
update procurements set approved_by_id='02840000-0000-0000-0000-0000000000a2' where id='02840000-0000-0000-0000-000000000012';
insert into procurement_invoices (id,org_id,procurement_id,vi_number,invoice_date,status,amount,currency,tax_treatment,tax_amount,withheld_amount) values
 ('02840000-0000-0000-0000-000000000080','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000013','VI-PMC',current_date,'Received',1000,'USD','exclusive',110,20);
insert into payments (id,org_id,procurement_id,pay_number,status,date,amount,currency) values
 ('02840000-0000-0000-0000-000000000090','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000012','PAY-PMC-SCHED','Scheduled',null,700,'USD'),
 ('02840000-0000-0000-0000-000000000091','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000012','PAY-PMC-SCHED-2','Scheduled','2026-01-01',500,'USD');
insert into procurement_quotations (id,org_id,procurement_id,vendor_id,total_amount) values
 ('02840000-0000-0000-0000-000000000070','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000014','02840000-0000-0000-0000-000000000050',750);
insert into procurement_items (id,org_id,procurement_id,name,quantity,rate) values
 ('02840000-0000-0000-0000-000000000060','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000010','Item A',1,125),
 ('02840000-0000-0000-0000-000000000061','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000010','Item B',1,125),
 ('02840000-0000-0000-0000-000000000062','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000016','Backfill item A',1,125),
 ('02840000-0000-0000-0000-000000000063','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000016','Backfill item B',1,125),
 ('02840000-0000-0000-0000-000000000064','02840000-0000-0000-0000-000000000001','02840000-0000-0000-0000-000000000017','Terminal item',1,125);

select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000010'),250::numeric,'AC-PMC-001 two priced lines roll up to the request total');
update procurement_items set rate=200 where id='02840000-0000-0000-0000-000000000061';
select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000010'),325::numeric,'AC-PMC-001 editing a line refreshes the amount');
delete from procurement_items where id='02840000-0000-0000-0000-000000000060';
select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000010'),200::numeric,'AC-PMC-001 deleting a line refreshes the amount');
select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000011'),300::numeric,'AC-PMC-001 header-priced request without lines retains its value');
select public.reconcile_procurement_line_totals();
select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000016'),250::numeric,'AC-PMC-002 migration reconciliation raises an underpriced submitted header to its line sum');
select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000017'),0::numeric,'AC-PMC-002 terminal cancelled rows are excluded from the backfill');
set local role authenticated;
set local request.jwt.claims='{"sub":"02840000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select transition_procurement('02840000-0000-0000-0000-000000000010','Requested')$$,'AC-PMC-001 submitted line estimate transitions');
reset role;
select is(public.procurement_request_amount('02840000-0000-0000-0000-000000000010'),(select total_value from procurements where id='02840000-0000-0000-0000-000000000010'),'AC-PMC-001 frozen routing amount equals the visible header');
select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000010'),200::numeric,'AC-PMC-001 submitted request retains the line-sum header value');
set local role authenticated;
set local request.jwt.claims='{"sub":"02840000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select transition_procurement('02840000-0000-0000-0000-000000000014','Quote Selected')$$,'P0001','select a quote to move to Quote Selected','AC-PMC-006 bare transition to Quote Selected refuses even for Admin');
select lives_ok($$select select_procurement_quote('02840000-0000-0000-0000-000000000070')$$,'AC-PMC-007 selected quote still advances through the canonical RPC under routing freeze');
select is((select total_value from procurements where id='02840000-0000-0000-0000-000000000014'),750::numeric,'AC-PMC-007 selected quote amount is allowed by the routing-freeze exception');
select lives_ok($$select transition_procurement('02840000-0000-0000-0000-000000000015','Ordered')$$,'AC-PMC-007 Approved-to-Ordered quote bypass remains legal');
set local request.jwt.claims='{"sub":"02840000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select transition_procurement('02840000-0000-0000-0000-000000000012','Paid')$$,'42501',null,'AC-PMC-005 approver-as-payer remains refused');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"02840000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select transition_procurement('02840000-0000-0000-0000-000000000012','Paid')$$,'AC-PMC-003 scheduled payment is settled');
reset role;
select is((select count(*)::int from payments where procurement_id='02840000-0000-0000-0000-000000000012' and status='Paid'),2,'AC-PMC-003 every scheduled payment row changes to Paid');
select is((select date from payments where id='02840000-0000-0000-0000-000000000090'),current_date,'AC-PMC-003 missing scheduled-payment date is filled at settlement');
select is((select date from payments where id='02840000-0000-0000-0000-000000000091'),'2026-01-01'::date,'AC-PMC-003 existing scheduled-payment date is preserved');
select is((select count(*)::int from payments where procurement_id='02840000-0000-0000-0000-000000000012'),2,'AC-PMC-003 settling scheduled payments does not insert another');
set local role authenticated;
set local request.jwt.claims='{"sub":"02840000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select transition_procurement('02840000-0000-0000-0000-000000000013','Paid')$$,'AC-PMC-004 payment evidence is created from the linked invoice');
reset role;
select is((select amount from payments where procurement_id='02840000-0000-0000-0000-000000000013'),1090::numeric,'AC-PMC-004 payable = invoice amount + exclusive VAT - withholding');
select is((select invoice_id from payments where procurement_id='02840000-0000-0000-0000-000000000013'),'02840000-0000-0000-0000-000000000080'::uuid,'AC-PMC-004 exactly one invoice is linked to payment');
set local role authenticated;
set local request.jwt.claims='{"sub":"02840000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select transition_procurement('02840000-0000-0000-0000-000000000018','Paid')$$,'AC-PMC-004 no-invoice settlement is recorded');
reset role;
select is((select amount from payments where procurement_id='02840000-0000-0000-0000-000000000018'),420::numeric,'AC-PMC-004 request total is the fallback only when no invoice exists');
set local role authenticated;
set local request.jwt.claims='{"sub":"02840000-0000-0000-0000-0000000000a3","role":"authenticated"}';
reset role;
update procurements set status='Vendor Invoiced' where id='02840000-0000-0000-0000-000000000013';
set local role authenticated;
select lives_ok($$select transition_procurement('02840000-0000-0000-0000-000000000013','Paid')$$,'AC-PMC-005 replayed Paid transition does not fail');
reset role;
select is((select count(*)::int from payments where procurement_id='02840000-0000-0000-0000-000000000013'),1,'AC-PMC-005 replay cannot duplicate payment evidence');
select * from finish();
rollback;
