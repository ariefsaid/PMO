begin;
select plan(17);
insert into organizations(id,name,default_currency) values ('03490000-0000-0000-0000-000000000001','Ceiling Org','IDR');
insert into auth.users(id,email) values
 ('03490000-0000-0000-0000-000000000011','ceiling-requester@example.com'),
 ('03490000-0000-0000-0000-000000000012','ceiling-approver@example.com'),
 ('03490000-0000-0000-0000-000000000013','ceiling-finance@example.com');
insert into companies(id,org_id,name,type) values ('03490000-0000-0000-0000-000000000021','03490000-0000-0000-0000-000000000001','Ceiling Vendor','Vendor');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03490000-0000-0000-0000-000000000011','03490000-0000-0000-0000-000000000001','Requester','ceiling-requester@example.com','Project Manager','active'),
 ('03490000-0000-0000-0000-000000000012','03490000-0000-0000-0000-000000000001','Approver','ceiling-approver@example.com','Project Manager','active'),
 ('03490000-0000-0000-0000-000000000013','03490000-0000-0000-0000-000000000001','Finance','ceiling-finance@example.com','Finance','active');
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency) values
 ('03490000-0000-0000-0000-000000000101','03490000-0000-0000-0000-000000000001','High quote','03490000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03490000-0000-0000-0000-000000000102','03490000-0000-0000-0000-000000000001','Low quote','03490000-0000-0000-0000-000000000011','Requested',1000,'IDR'),
 ('03490000-0000-0000-0000-000000000103','03490000-0000-0000-0000-000000000001','Bill ceiling','03490000-0000-0000-0000-000000000011','Requested',1000,'IDR');
set local role authenticated;
set local request.jwt.claims='{"sub":"03490000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select transition_procurement('03490000-0000-0000-0000-000000000101','Approved')$$,'AC-SEC-203: approval records its approved amount');
select is((select approved_total_value from procurements where id='03490000-0000-0000-0000-000000000101'),1000::numeric,'AC-SEC-203: approved amount is server stamped');
select throws_ok($$update procurements set approved_total_value=1 where id='03490000-0000-0000-0000-000000000101'$$,'42501',null,'AC-SEC-203: clients cannot change the server-approved amount');
select lives_ok($$select transition_procurement('03490000-0000-0000-0000-000000000102','Approved')$$,'AC-SEC-203: lower quote request is approved');
select lives_ok($$select transition_procurement('03490000-0000-0000-0000-000000000103','Approved')$$,'AC-SEC-203: invoice request is approved');
reset role;
-- Set up quote owners as postgres, then exercise the real selection RPC as Finance.
insert into procurement_quotations(id,org_id,procurement_id,vendor_id,total_amount) values
 ('03490000-0000-0000-0000-000000000201','03490000-0000-0000-0000-000000000001','03490000-0000-0000-0000-000000000101','03490000-0000-0000-0000-000000000021',900000),
 ('03490000-0000-0000-0000-000000000202','03490000-0000-0000-0000-000000000001','03490000-0000-0000-0000-000000000102','03490000-0000-0000-0000-000000000021',900);
set local role authenticated;
set local request.jwt.claims='{"sub":"03490000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$select transition_procurement('03490000-0000-0000-0000-000000000101','Vendor Quoted')$$,'AC-SEC-203: approved request enters quote stage');
select lives_ok($$select transition_procurement('03490000-0000-0000-0000-000000000102','Vendor Quoted')$$,'AC-SEC-203: second request enters quote stage');
select lives_ok($$select transition_procurement('03490000-0000-0000-0000-000000000103','Vendor Quoted')$$,'AC-SEC-203: invoice request enters quote stage');
select lives_ok($$select select_procurement_quote('03490000-0000-0000-0000-000000000201')$$,'AC-SEC-203: over-ceiling quote enters re-approval');
select is((select status::text from procurements where id='03490000-0000-0000-0000-000000000101'),'Requested','AC-SEC-203: 900000 quote cannot retain old approval');
select is((select total_value from procurements where id='03490000-0000-0000-0000-000000000101'),900000::numeric,'AC-SEC-203: re-route uses the new quote amount');
set local request.jwt.claims='{"sub":"03490000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select transition_procurement('03490000-0000-0000-0000-000000000101','Approved')$$,'42501','separation of duties: requester cannot approve/reject own procurement','AC-SEC-203: requester cannot approve the re-routed amount');
set local request.jwt.claims='{"sub":"03490000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select transition_procurement('03490000-0000-0000-0000-000000000101','Approved')$$,'AC-SEC-203: eligible approver re-approves through the existing route');
select is((select approved_total_value from procurements where id='03490000-0000-0000-0000-000000000101'),900000::numeric,'AC-SEC-203: re-approval stamps the revised amount as the ceiling');
set local request.jwt.claims='{"sub":"03490000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$select select_procurement_quote('03490000-0000-0000-0000-000000000202')$$,'AC-SEC-203: lower quote is selected normally');
reset role;
select is((select status::text from procurements where id='03490000-0000-0000-0000-000000000102'),'Quote Selected','AC-SEC-203: 900 quote remains Quote Selected');
-- Bill amount ceiling is enforced when the status transition attempts settlement.
update procurements set status='Vendor Invoiced' where id='03490000-0000-0000-0000-000000000103';
insert into procurement_invoices(id,org_id,procurement_id,status,amount,tax_treatment,tax_amount) values ('03490000-0000-0000-0000-000000000301','03490000-0000-0000-0000-000000000001','03490000-0000-0000-0000-000000000103','Received',1200,'inclusive',0);
set local role authenticated;
set local request.jwt.claims='{"sub":"03490000-0000-0000-0000-000000000013","role":"authenticated"}';
select throws_ok($$select transition_procurement('03490000-0000-0000-0000-000000000103','Paid')$$,'23514',null,'AC-SEC-203: vendor bill above approved amount cannot be paid');
reset role;
select finish();
rollback;
