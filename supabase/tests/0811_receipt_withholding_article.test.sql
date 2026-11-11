-- #1275 receipt withholding by tax article: per-article org accounts, receipt article domain, project default.
begin;
select plan(15);
insert into organizations(id,name) values
 ('08110000-0000-0000-0000-000000000001','Article fixture'),('08110000-0000-0000-0000-000000000002','Other article fixture');
insert into auth.users(id,email) values
 ('08110000-0000-0000-0000-0000000000a1','article-admin@example.test'),
 ('08110000-0000-0000-0000-0000000000a2','article-finance@example.test'),
 ('08110000-0000-0000-0000-0000000000a3','article-pm@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('08110000-0000-0000-0000-0000000000a1','08110000-0000-0000-0000-000000000001','Fixture Admin','article-admin@example.test','Admin','active'),
 ('08110000-0000-0000-0000-0000000000a2','08110000-0000-0000-0000-000000000001','Fixture Finance','article-finance@example.test','Finance','active'),
 ('08110000-0000-0000-0000-0000000000a3','08110000-0000-0000-0000-000000000001','Fixture PM','article-pm@example.test','Project Manager','active');
-- A pre-existing receipt and default account: must stay as they are (AC-WHA-008).
update organizations set tax_prepaid_account='Default Prepaid - DEMO' where id='08110000-0000-0000-0000-000000000001';
insert into incoming_payments(id,org_id,amount,status) values('08110000-0000-0000-0000-0000000000b0','08110000-0000-0000-0000-000000000001',500,'Paid');
set local role authenticated;
set local request.jwt.claims='{"sub":"08110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$update organizations set pph23_prepaid_account='PPh 23 Prepaid - DEMO',pph4_2_prepaid_account='PPh 4(2) Prepaid - DEMO'
 where id='08110000-0000-0000-0000-000000000001'$$,'AC-WHA-001 Admin sets the PPh 23 and PPh 4(2) prepaid accounts on the own org');
select is((select pph23_prepaid_account||'/'||pph4_2_prepaid_account from organizations where id='08110000-0000-0000-0000-000000000001'),
 'PPh 23 Prepaid - DEMO/PPh 4(2) Prepaid - DEMO','AC-WHA-001 both article accounts persist');
select is((select count(*)::integer from organizations where id='08110000-0000-0000-0000-000000000002'),0,
 'AC-WHA-001 article accounts stay scoped to the caller organization');
select throws_ok($$update organizations set pph23_prepaid_account='' where id='08110000-0000-0000-0000-000000000001'$$,'23514',null,
 'AC-WHA-001 a blank article account is refused');
select throws_ok($$update organizations set pph4_2_prepaid_account=repeat('x',141) where id='08110000-0000-0000-0000-000000000001'$$,'23514',null,
 'AC-WHA-001 an over-long article account is refused');
reset role;
select is((select count(*)::integer from audit_events where action='org.withholding_account.change'
   and entity_id='08110000-0000-0000-0000-000000000001'
   and detail=jsonb_build_object('column','pph23_prepaid_account','from',null,'to','PPh 23 Prepaid - DEMO')),1,
 'AC-WHA-001 changing an article account is audited with its column, before and after');
set local role authenticated;
set local request.jwt.claims='{"sub":"08110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
with changed as (update organizations set pph23_prepaid_account='Other - DEMO' where id='08110000-0000-0000-0000-000000000001' returning id)
select is(count(*)::integer,0,'AC-WHA-001 a Finance user update of the article accounts reaches no row') from changed;
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$insert into incoming_payments(id,org_id,amount,received_amount,withheld_amount,withholding_slip_number,withholding_article,status) values
 ('08110000-0000-0000-0000-0000000000b1','08110000-0000-0000-0000-000000000001',1000,980,20,'WHT-1','pph4_2','Paid'),
 ('08110000-0000-0000-0000-0000000000b2','08110000-0000-0000-0000-000000000001',1000,980,20,'WHT-2','pph23','Paid'),
 ('08110000-0000-0000-0000-0000000000b3','08110000-0000-0000-0000-000000000001',1000,1000,0,null,null,'Paid')$$,
 'AC-WHA-002 a receipt accepts pph23, pph4_2 or no article');
select throws_ok($$update incoming_payments set withholding_article='pph21' where id='08110000-0000-0000-0000-0000000000b1'$$,'23514',null,
 'AC-WHA-002 a receipt refuses any other article');
select ok(not has_column_privilege('authenticated','public.incoming_payments','withholding_article','INSERT')
  and not has_column_privilege('authenticated','public.incoming_payments','withholding_article','UPDATE'),
 'AC-WHA-002 authenticated holds no insert or update privilege on incoming_payments.withholding_article');
select is((select detail->>'withholding_article' from audit_events
   where action='incoming_payment.create' and entity_id='08110000-0000-0000-0000-0000000000b1'),'pph4_2',
 'AC-WHA-002 the receipt create audit records the article');
select is((select withholding_article from incoming_payments where id='08110000-0000-0000-0000-0000000000b0'),null,
 'AC-WHA-008 an existing receipt keeps no article (not back-filled)');
select is((select tax_prepaid_account from organizations where id='08110000-0000-0000-0000-000000000001'),'Default Prepaid - DEMO',
 'AC-WHA-008 the default account is unchanged');
set local role authenticated;
set local request.jwt.claims='{"sub":"08110000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into projects(id,name,status) values('08110000-0000-0000-0000-0000000000c1','Article project','Internal Project');
select lives_ok($$update projects set receipt_withholding_article='pph4_2' where id='08110000-0000-0000-0000-0000000000c1'$$,
 'AC-WHA-007 a project write role sets the project default receipt article');
select throws_ok($$update projects set receipt_withholding_article='pph21' where id='08110000-0000-0000-0000-0000000000c1'$$,'23514',null,
 'AC-WHA-007 a project default outside pph23, pph4_2 or null is refused');
select * from finish();
rollback;
