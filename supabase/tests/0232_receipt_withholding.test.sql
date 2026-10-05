begin;
select plan(12);
insert into organizations(id,name) values
 ('07620000-0000-0000-0000-000000000001','Receipt withholding fixture'),
 ('07620000-0000-0000-0000-000000000002','Other receipt fixture');
insert into auth.users(id,email) values
 ('07620000-0000-0000-0000-0000000000a1','receipt-admin@example.test'),
 ('07620000-0000-0000-0000-0000000000a2','receipt-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('07620000-0000-0000-0000-0000000000a1','07620000-0000-0000-0000-000000000001','Fixture Admin','receipt-admin@example.test','Admin','active'),
 ('07620000-0000-0000-0000-0000000000a2','07620000-0000-0000-0000-000000000001','Fixture Finance','receipt-finance@example.test','Finance','active');
set local role authenticated;
set local request.jwt.claims='{"sub":"07620000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$update organizations set tax_prepaid_account='Tax Prepaid - DEMO'
 where id='07620000-0000-0000-0000-000000000001'$$,
 'AC-WHT-004 Admin configures the own-org tax-prepaid account');
select is((select tax_prepaid_account from organizations where id='07620000-0000-0000-0000-000000000001'),
 'Tax Prepaid - DEMO','AC-WHT-004 configured account persists');
select is((select count(*)::integer from organizations where id='07620000-0000-0000-0000-000000000002'),0,
 'AC-WHT-004 account settings remain scoped to the caller organization');
set local request.jwt.claims='{"sub":"07620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
with changed as (update organizations set tax_prepaid_account='Other - DEMO'
 where id='07620000-0000-0000-0000-000000000001' returning id)
select is(count(*)::integer,0,
 'AC-WHT-004 Finance cannot change the tax-prepaid account') from changed;
reset role;
set local request.jwt.claims='{"role":"service_role"}';
insert into incoming_payments(id,org_id,amount,received_amount,withheld_amount,withholding_slip_number,status)
 values('07620000-0000-0000-0000-0000000000b1','07620000-0000-0000-0000-000000000001',1000,980,20,'WHT-001','Paid');
select is((select received_amount from incoming_payments where id='07620000-0000-0000-0000-0000000000b1'),980::numeric,
 'AC-WHT-003 receipt cash round-trips exactly');
select is((select withheld_amount from incoming_payments where id='07620000-0000-0000-0000-0000000000b1'),20::numeric,
 'AC-WHT-003 receipt withheld amount round-trips exactly');
select is((select withholding_slip_number from incoming_payments where id='07620000-0000-0000-0000-0000000000b1'),'WHT-001',
 'AC-WHT-003 receipt slip round-trips independently of the command anchor');
select throws_ok($$update incoming_payments set received_amount=979.99
 where id='07620000-0000-0000-0000-0000000000b1'$$,'23514',
 'new row for relation "incoming_payments" violates check constraint "incoming_payments_withholding_balance"',
 'AC-WHT-001 positive withholding preserves cash plus tax equals allocation');
select throws_ok($$update incoming_payments set withholding_slip_number=null
 where id='07620000-0000-0000-0000-0000000000b1'$$,'23514',
 'new row for relation "incoming_payments" violates check constraint "incoming_payments_withholding_slip"',
 'AC-WHT-001 positive withholding requires its slip');
select throws_ok($$update incoming_payments set withheld_amount=-1
 where id='07620000-0000-0000-0000-0000000000b1'$$,'23514',null,
 'AC-WHT-001 withheld tax cannot be negative');
insert into external_domain_ownership(org_id,external_tier,domain)
 values('07620000-0000-0000-0000-000000000001','erpnext','revenue');
set local role authenticated;
set local request.jwt.claims='{"sub":"07620000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$update incoming_payments set received_amount=970,withheld_amount=30,withholding_slip_number='WHT-002'
 where id='07620000-0000-0000-0000-0000000000b1'$$,'42501',
 'permission denied for table incoming_payments',
 'AC-WHT-003 receipt metadata UPDATE remains withheld from authenticated clients');
-- Exercise the independent mirror guard with a transaction-local fixture grant; production grants stay unchanged.
reset role;
grant update(received_amount,withheld_amount,withholding_slip_number) on incoming_payments to authenticated;
set local role authenticated;
select throws_ok($$update incoming_payments set received_amount=970,withheld_amount=30,withholding_slip_number='WHT-002'
 where id='07620000-0000-0000-0000-0000000000b1'$$,'42501',
 'incoming_payments native fields are read-only while revenue is externally-owned',
 'AC-WHT-003 ERP-owned receipt withholding metadata is read-only to client writes');
select * from finish();
rollback;
