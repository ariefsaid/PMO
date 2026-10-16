-- 0301 (S-06 RF-030/031): receipt allocation coverage — cardinality, unknown-vs-none, org scope, read-only mirror.
begin;
select plan(7);
insert into organizations(id,name) values
 ('07630000-0000-0000-0000-000000000001','Allocation fixture A'),
 ('07630000-0000-0000-0000-000000000002','Allocation fixture B');
insert into auth.users(id,email) values
 ('07630000-0000-0000-0000-0000000000a1','alloc-a@example.test'),
 ('07630000-0000-0000-0000-0000000000b1','alloc-b@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('07630000-0000-0000-0000-0000000000a1','07630000-0000-0000-0000-000000000001','Fixture A','alloc-a@example.test','Finance','active'),
 ('07630000-0000-0000-0000-0000000000b1','07630000-0000-0000-0000-000000000002','Fixture B','alloc-b@example.test','Finance','active');
set local request.jwt.claims='{"role":"service_role"}';
insert into incoming_payments(id,org_id,amount,received_amount,withheld_amount,status,allocation_details) values
 ('07630000-0000-0000-0000-0000000000c1','07630000-0000-0000-0000-000000000001',75000,75000,0,'Paid',
  '[{"invoice_id":null,"invoice_number":"INV-A","amount":"25000.00","currency":"IDR"},{"invoice_id":null,"invoice_number":"INV-B","amount":"30000.00","currency":"IDR"}]'),
 ('07630000-0000-0000-0000-0000000000c2','07630000-0000-0000-0000-000000000001',500,500,0,'Paid','[]'),
 ('07630000-0000-0000-0000-0000000000c3','07630000-0000-0000-0000-000000000001',500,500,0,'Paid',null);
select is((select jsonb_array_length(allocation_details) from incoming_payments where id='07630000-0000-0000-0000-0000000000c1'),2,
 'RF-030 a multi-invoice receipt keeps every allocation');
select is((select allocation_details->1->>'amount' from incoming_payments where id='07630000-0000-0000-0000-0000000000c1'),'30000.00',
 'RF-030 allocation amounts are preserved exactly as decimal strings');
select is((select jsonb_array_length(allocation_details) from incoming_payments where id='07630000-0000-0000-0000-0000000000c2'),0,
 'RF-031 an empty array is a reported on-account receipt');
select is((select allocation_details from incoming_payments where id='07630000-0000-0000-0000-0000000000c3'),null,
 'RF-030 absent coverage stays null (unknown), never an empty list');
select throws_ok($$update incoming_payments set allocation_details='{"a":1}'
 where id='07630000-0000-0000-0000-0000000000c3'$$,'23514',null,
 'RF-030 allocation details must be an array');
set local role authenticated;
set local request.jwt.claims='{"sub":"07630000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::integer from incoming_payments where org_id='07630000-0000-0000-0000-000000000001'),0,
 'RF-034 another organization cannot read the receipt allocations');
reset role;
insert into external_domain_ownership(org_id,external_tier,domain) values ('07630000-0000-0000-0000-000000000001','erpnext','revenue');
set local role authenticated;
set local request.jwt.claims='{"sub":"07630000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$update incoming_payments set allocation_details='[]'
 where id='07630000-0000-0000-0000-0000000000c1'$$,'42501',null,
 'RF-030 a user cannot rewrite ERP-authored allocations while revenue is externally owned');
select * from finish();
rollback;
