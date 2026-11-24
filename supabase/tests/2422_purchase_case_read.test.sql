-- Purchase-case inspection is a read-only product scope, independent of action grants.
begin;
select plan(22);
insert into organizations (id,name,built_in_roles_enabled,hide_prices_from_requesters) values
 ('24220000-0000-0000-0000-000000000001','Rental reader A',true,true),
 ('24220000-0000-0000-0000-000000000002','Rental reader B',true,true);
insert into auth.users (id,email) select ('24220000-0000-0000-0000-0000000000'||n)::uuid, 'rental-'||n||'@example.test' from unnest(array['a1','a2','a3','b1']) n;
insert into profiles (id,org_id,full_name,email,role,status,built_in_role) values
 ('24220000-0000-0000-0000-0000000000a1','24220000-0000-0000-0000-000000000001','Admin','rental-a1@example.test','Admin','active',null),
 ('24220000-0000-0000-0000-0000000000a2','24220000-0000-0000-0000-000000000001','Requester','rental-a2@example.test','Engineer','active',null),
 ('24220000-0000-0000-0000-0000000000a3','24220000-0000-0000-0000-000000000001','Manager','rental-a3@example.test','Project Manager','active','procurement_manager'),
 ('24220000-0000-0000-0000-0000000000b1','24220000-0000-0000-0000-000000000002','Other admin','rental-b1@example.test','Admin','active',null);

insert into companies(id,org_id,name,type) values ('24220000-0000-0000-0000-000000000020','24220000-0000-0000-0000-000000000001','Test supplier','Vendor');
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency,vendor_id) values
 ('24220000-0000-0000-0000-000000000011','24220000-0000-0000-0000-000000000001','Other requester order','24220000-0000-0000-0000-0000000000a2','Draft',120,'IDR','24220000-0000-0000-0000-000000000020');
insert into procurement_quotations(id,org_id,procurement_id,vendor_id,vq_number,total_amount,currency) values
 ('24220000-0000-0000-0000-000000000012','24220000-0000-0000-0000-000000000001','24220000-0000-0000-0000-000000000011','24220000-0000-0000-0000-000000000020','VQ-READ',120,'IDR');
insert into purchase_orders(id,org_id,procurement_id,po_number,status,amount,currency) values
 ('24220000-0000-0000-0000-000000000013','24220000-0000-0000-0000-000000000001','24220000-0000-0000-0000-000000000011','PO-READ','Issued',120,'IDR');
insert into procurement_receipts(id,org_id,procurement_id,gr_number,receipt_date,status) values
 ('24220000-0000-0000-0000-000000000014','24220000-0000-0000-0000-000000000001','24220000-0000-0000-0000-000000000011','GR-READ','2026-11-01','Partial');
insert into procurement_invoices(id,org_id,procurement_id,vi_number,invoice_date,status,amount,currency,tax_treatment,tax_amount) values
 ('24220000-0000-0000-0000-000000000015','24220000-0000-0000-0000-000000000001','24220000-0000-0000-0000-000000000011','VI-READ','2026-11-01','Received',120,'IDR','exclusive',0);
-- Independent approval authority is unchanged; a requester still cannot decide their own request.
set local session_replication_role=replica;
insert into procurements(id,org_id,title,requested_by_id,status,total_value,currency) values
 ('24220000-0000-0000-0000-000000000016','24220000-0000-0000-0000-000000000001','Manager own request','24220000-0000-0000-0000-0000000000a3','Requested',10,'IDR');
set local session_replication_role=origin;
set local role authenticated;
set local request.jwt.claims='{"sub":"24220000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select ok(actor_may_read_purchase_cases(),'AC-PURCHASE-READ held procurement manager has inspection scope');
select is((select total_value from procurements_masked where id='24220000-0000-0000-0000-000000000011'),120::numeric,'AC-PURCHASE-READ existing price view remains the read path');
select throws_ok($$select transition_procurement('24220000-0000-0000-0000-000000000016','Approved')$$,'42501','separation of duties: requester cannot approve/reject own procurement','AC-PURCHASE-READ inspection does not grant self-approval');
select is((select title from procurements where id='24220000-0000-0000-0000-000000000011'),'Other requester order','AC-PURCHASE-READ reads another requester case');
select is((select vq_number from procurement_quotations where id='24220000-0000-0000-0000-000000000012'),'VQ-READ','AC-PURCHASE-READ reads displayed quote');
select is((select po_number from purchase_orders where id='24220000-0000-0000-0000-000000000013'),'PO-READ','AC-PURCHASE-READ reads displayed order');
select is((select gr_number from procurement_receipts where id='24220000-0000-0000-0000-000000000014'),'GR-READ','AC-PURCHASE-READ reads displayed receipt');
select is((select vi_number from procurement_invoices where id='24220000-0000-0000-0000-000000000015'),'VI-READ','AC-PURCHASE-READ reads displayed bill');
select ok(not actor_may_order_purchases(),'AC-PURCHASE-READ inspection adds no ordering role');
select throws_ok($$update procurements set title='Changed' where id='24220000-0000-0000-0000-000000000011'$$,'42501',null,'AC-PURCHASE-READ cannot edit another requester header');
select throws_ok($$select transition_procurement('24220000-0000-0000-0000-000000000011','Requested')$$,'42501','not authorized for transition Draft -> Requested','AC-PURCHASE-READ inspection does not let the manager submit another requester case');
-- The base Project Manager already orders through its access level, independently of actor_may_order_purchases.
-- Do not turn this read-only scope into a change to that existing rule.
select lives_ok($$select transition_procurement('24220000-0000-0000-0000-000000000011','Ordered')$$,'AC-PURCHASE-READ existing base-level ordering rule is unchanged');
select throws_ok($$select transition_procurement('24220000-0000-0000-0000-000000000011','Paid')$$,'42501',null,'AC-PURCHASE-READ inspection does not grant Finance transition authority');
select is((select title from procurements where id='24220000-0000-0000-0000-000000000011'),'Other requester order','AC-PURCHASE-READ denied actions leave case unchanged');
set local request.jwt.claims='{"sub":"24220000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select ok(not actor_may_read_purchase_cases(),'AC-PURCHASE-READ an ordinary engineer gains no inspection scope');
reset role;
set local request.jwt.claims='{}';
update profiles set role='Project Manager' where id='24220000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims='{"sub":"24220000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select ok(not actor_may_read_purchase_cases(),'AC-PURCHASE-READ a manager without the job role gains no inspection scope');
reset role;
set local request.jwt.claims='{}';
update profiles set role='Project Manager', built_in_role='procurement_manager' where id='24220000-0000-0000-0000-0000000000b1';
set local role authenticated;
set local request.jwt.claims='{"sub":"24220000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select ok(actor_may_read_purchase_cases(),'AC-PURCHASE-READ foreign manager has its own organisation scope');
select is((select count(*) from procurements where id='24220000-0000-0000-0000-000000000011'),0::bigint,'AC-PURCHASE-READ foreign manager reads no case');
select is((select count(*) from procurement_quotations where id='24220000-0000-0000-0000-000000000012')+(select count(*) from purchase_orders where id='24220000-0000-0000-0000-000000000013')+(select count(*) from procurement_receipts where id='24220000-0000-0000-0000-000000000014')+(select count(*) from procurement_invoices where id='24220000-0000-0000-0000-000000000015'),0::bigint,'AC-PURCHASE-READ foreign manager reads no quote order receipt or bill');
reset role;
set local request.jwt.claims='{}';
update profiles set role='Engineer',built_in_role='field_user' where id='24220000-0000-0000-0000-0000000000a3';
set local role authenticated;
set local request.jwt.claims='{"sub":"24220000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select ok(not actor_may_read_purchase_cases(),'AC-PURCHASE-READ a field account has no inspection scope');
select is((select count(*) from procurements where id='24220000-0000-0000-0000-000000000011'),0::bigint,'AC-PURCHASE-READ field account reads no purchase');
reset role;
set local request.jwt.claims='{}';
update profiles set role='Project Manager',built_in_role='procurement_manager',status='disabled' where id='24220000-0000-0000-0000-0000000000a3';
set local role authenticated;
set local request.jwt.claims='{"sub":"24220000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select ok(not actor_may_read_purchase_cases(),'AC-PURCHASE-READ disabled manager gains no inspection scope');
reset role;
select * from finish(); rollback;
