-- AC-BUPOT-001/003/004/005/008/009/012: gap coverage through shipped RPCs and reader seams.
begin;
select no_plan();

insert into organizations(id,name,default_currency,default_timezone) values
 ('91120000-0000-0000-0000-000000000001','Bupot gap org A','IDR','Pacific/Kiritimati'),
 ('91120000-0000-0000-0000-000000000002','Bupot gap org B','IDR','UTC');
insert into auth.users(id,email) values
 ('91120000-0000-0000-0000-000000000011','gap-finance@example.test'),
 ('91120000-0000-0000-0000-000000000012','gap-admin@example.test'),
 ('91120000-0000-0000-0000-000000000013','gap-manager@example.test'),
 ('91120000-0000-0000-0000-000000000014','gap-executive@example.test'),
 ('91120000-0000-0000-0000-000000000015','gap-disabled@example.test'),
 ('91120000-0000-0000-0000-000000000021','gap-org-b-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('91120000-0000-0000-0000-000000000011','91120000-0000-0000-0000-000000000001','Gap Finance','gap-finance@example.test','Finance','active'),
 ('91120000-0000-0000-0000-000000000012','91120000-0000-0000-0000-000000000001','Gap Admin','gap-admin@example.test','Admin','active'),
 ('91120000-0000-0000-0000-000000000013','91120000-0000-0000-0000-000000000001','Gap Manager','gap-manager@example.test','Project Manager','active'),
 ('91120000-0000-0000-0000-000000000014','91120000-0000-0000-0000-000000000001','Gap Executive','gap-executive@example.test','Executive','active'),
 ('91120000-0000-0000-0000-000000000015','91120000-0000-0000-0000-000000000001','Gap Disabled','gap-disabled@example.test','Finance','disabled'),
 ('91120000-0000-0000-0000-000000000021','91120000-0000-0000-0000-000000000002','Org B Finance','gap-org-b-finance@example.test','Finance','active');
insert into companies(id,org_id,name,type) values
 ('91120000-0000-0000-0000-000000000031','91120000-0000-0000-0000-000000000001','Gap vendor A','Vendor'),
 ('91120000-0000-0000-0000-000000000032','91120000-0000-0000-0000-000000000001','Gap vendor B','Vendor'),
 ('91120000-0000-0000-0000-000000000033','91120000-0000-0000-0000-000000000002','Gap vendor foreign','Vendor');
insert into procurements(id,org_id,title,status,requested_by_id,vendor_id) values
 ('91120000-0000-0000-0000-000000000041','91120000-0000-0000-0000-000000000001','Gap case A','Received','91120000-0000-0000-0000-000000000011','91120000-0000-0000-0000-000000000031'),
 ('91120000-0000-0000-0000-000000000042','91120000-0000-0000-0000-000000000001','Gap case B','Received','91120000-0000-0000-0000-000000000011','91120000-0000-0000-0000-000000000031'),
 ('91120000-0000-0000-0000-000000000043','91120000-0000-0000-0000-000000000001','Gap other vendor','Received','91120000-0000-0000-0000-000000000011','91120000-0000-0000-0000-000000000032'),
 ('91120000-0000-0000-0000-000000000044','91120000-0000-0000-0000-000000000002','Gap foreign case','Received','91120000-0000-0000-0000-000000000021','91120000-0000-0000-0000-000000000033'),
 ('91120000-0000-0000-0000-000000000045','91120000-0000-0000-0000-000000000001','Gap cancelled case','Cancelled','91120000-0000-0000-0000-000000000011','91120000-0000-0000-0000-000000000031');
insert into procurement_invoices(id,org_id,procurement_id,status,invoice_date,amount,currency,tax_treatment,tax_amount,withheld_amount,withheld_pph_type,reference_number) values
 ('91120000-0000-0000-0000-000000000051','91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-000000000041','Paid',current_date,100000,'IDR','exclusive',0,100,'pph23','BUPOT-GAP-A'),
 ('91120000-0000-0000-0000-000000000052','91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-000000000042','Received',current_date,100000,'IDR','exclusive',0,200,'pph23','BUPOT-GAP-B'),
 ('91120000-0000-0000-0000-000000000053','91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-000000000043','Received',current_date,100000,'IDR','exclusive',0,300,'pph23','BUPOT-GAP-OTHER-VENDOR'),
 ('91120000-0000-0000-0000-000000000054','91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-000000000041','Received',current_date,100000,'USD','exclusive',0,400,'pph23','BUPOT-GAP-USD'),
 ('91120000-0000-0000-0000-000000000055','91120000-0000-0000-0000-000000000002','91120000-0000-0000-0000-000000000044','Received',current_date,100000,'IDR','exclusive',0,500,'pph23','BUPOT-GAP-FOREIGN'),
 ('91120000-0000-0000-0000-000000000056','91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-000000000042','Received',current_date,100000,'IDR','exclusive',0,600,null,'BUPOT-GAP-UNKNOWN'),
 ('91120000-0000-0000-0000-000000000057','91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-000000000042','Received',current_date,100000,'IDR','exclusive',0,100,'pph23','BUPOT-GAP-OFFSET'),
 ('91120000-0000-0000-0000-000000000058','91120000-0000-0000-0000-000000000001','91120000-0000-0000-0000-000000000045','Received',current_date,100000,'IDR','exclusive',0,700,'pph23','BUPOT-GAP-CANCELLED');

create function pg_temp.bupot_detail(sql text) returns text language plpgsql as $$
declare state text; detail text;
begin
 execute sql;
 return 'NO_ERROR';
exception when others then
 get stacked diagnostics state = returned_sqlstate, detail = pg_exception_detail;
 return state||'|'||coalesce(detail,'');
end $$;

-- Literal IDs below were inserted as postgres above. They are not looked up under the caller's RLS.
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000061','91120000-0000-0000-0000-000000000031','GAP-BASE',current_date,date_trunc('month',current_date)::date,'pph23',1000,301,array['91120000-0000-0000-0000-000000000051'::uuid,'91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-amount-mismatch','AC-BUPOT-003 exact sum equality rejects an amount mismatch');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000062','91120000-0000-0000-0000-000000000031','GAP-DUP',current_date,date_trunc('month',current_date)::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000051'::uuid,'91120000-0000-0000-0000-000000000051'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-003 duplicate bill IDs are rejected');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000063','91120000-0000-0000-0000-000000000031','GAP-NULL',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['91120000-0000-0000-0000-000000000051'::uuid,null],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-003 null bill IDs are rejected');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000064','91120000-0000-0000-0000-000000000031','GAP-VENDOR',current_date,date_trunc('month',current_date)::date,'pph23',1000,300,array['91120000-0000-0000-0000-000000000051'::uuid,'91120000-0000-0000-0000-000000000053'::uuid],'{}')$$),'23514|bupot-ineligible-bill','AC-BUPOT-003 a bill from another vendor is rejected');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000065','91120000-0000-0000-0000-000000000031','GAP-CURRENCY',current_date,date_trunc('month',current_date)::date,'pph23',1000,500,array['91120000-0000-0000-0000-000000000051'::uuid,'91120000-0000-0000-0000-000000000054'::uuid],'{}')$$),'23514|bupot-ineligible-bill','AC-BUPOT-003 mixed currency is rejected');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000066','91120000-0000-0000-0000-000000000031','GAP-FOREIGN',current_date,date_trunc('month',current_date)::date,'pph23',1000,500,array['91120000-0000-0000-0000-000000000051'::uuid,'91120000-0000-0000-0000-000000000055'::uuid],'{}')$$),'23514|bupot-ineligible-bill','AC-BUPOT-008 foreign organization bill is rejected without exposure');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000075','91120000-0000-0000-0000-000000000031','GAP-CANCELLED',current_date,date_trunc('month',current_date)::date,'pph23',1000,700,array['91120000-0000-0000-0000-000000000058'::uuid],'{}')$$),'23514|bupot-ineligible-bill','AC-BUPOT-003 a bill on a cancelled procurement is rejected');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000076','91120000-0000-0000-0000-000000000031','GAP-TYPE',current_date,date_trunc('month',current_date)::date,'pph4_2',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-ineligible-bill','AC-BUPOT-004 a known PPh type conflict is refused');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000077','91120000-0000-0000-0000-000000000031','GAP-EXTRANEOUS-DECLARATION',current_date,date_trunc('month',current_date)::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],array['91120000-0000-0000-0000-000000000052'::uuid])$$),'23514|bupot-type-confirmation','AC-BUPOT-004 declaration set cannot include a known-type bill');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000067','91120000-0000-0000-0000-000000000031','GAP-BAD-NUMBER',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['91120000-0000-0000-0000-000000000051'::uuid],'{}')$$),'NO_ERROR','AC-BUPOT-003 Paid bills remain eligible');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000068','91120000-0000-0000-0000-000000000031','GAP-BAD-NUMBER',current_date,date_trunc('month',current_date)::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23505|bupot-number-conflict','AC-BUPOT-005 active number is unique after normalization');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000070','91120000-0000-0000-0000-000000000031','GAP-REUSE',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['91120000-0000-0000-0000-000000000051'::uuid],'{}')$$),'23505|bupot-bill-covered','AC-BUPOT-005 active bill reservation refuses a second slip');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000074','91120000-0000-0000-0000-000000000031','GAP-LIMIT',current_date,date_trunc('month',current_date)::date,'pph23',1000,1,array(select gen_random_uuid() from generate_series(1,101)),'{}')$$),'23514|bupot-bill-limit','AC-BUPOT-003 more than 100 selected bill IDs are refused');
reset role;

-- Org B is permitted to act on its own rows, but literal org-A slip and bill identifiers remain opaque.
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000021","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000069','91120000-0000-0000-0000-000000000031','FOREIGN-RECORD',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['91120000-0000-0000-0000-000000000051'::uuid],'{}')$$),'P0002|bupot-not-found','AC-BUPOT-008 record with org-A bill ID is refused for org B');
select is(pg_temp.bupot_detail($$select * from public.correct_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'FOREIGN-CORRECT',current_date,date_trunc('month',current_date)::date,'x')$$),'P0002|bupot-not-found','AC-BUPOT-008 correct with literal org-A slip ID is opaque to org B');
select is(pg_temp.bupot_detail($$select * from public.void_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'x')$$),'P0002|bupot-not-found','AC-BUPOT-008 void with literal org-A slip ID is opaque to org B');
select is((select count(*)::int from public.list_vendor_withholding_slips(null,null,'91120000-0000-0000-0000-000000000051',null,null,50)),0,'AC-BUPOT-008 org-A invoice filter returns no foreign slips');
select is(pg_temp.bupot_detail($$select public.get_vendor_withholding_slip('91120000-0000-0000-0000-000000000067')$$),'P0002|bupot-not-found','AC-BUPOT-008 detail reader refuses foreign slip ID');
reset role;

-- Membership and current-role checks are repeated at call time on each writer.
update profiles set status='disabled' where id='91120000-0000-0000-0000-000000000011';
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000071','91120000-0000-0000-0000-000000000031','DISABLED',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'42501|','AC-BUPOT-008 disabled membership is refused at record time');
select is(pg_temp.bupot_detail($$select * from public.correct_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'DISABLED',current_date,date_trunc('month',current_date)::date,'x')$$),'42501|','AC-BUPOT-008 disabled membership is refused at correct time');
select is(pg_temp.bupot_detail($$select * from public.void_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'x')$$),'42501|','AC-BUPOT-008 disabled membership is refused at void time');
reset role;
update profiles set status='active',role='Project Manager' where id='91120000-0000-0000-0000-000000000011';
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000072','91120000-0000-0000-0000-000000000031','DEMOTED',current_date,date_trunc('month',current_date)::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'42501|bupot-not-permitted','AC-BUPOT-008 role demotion after login applies to record');
select is(pg_temp.bupot_detail($$select * from public.correct_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'DEMOTED',current_date,date_trunc('month',current_date)::date,'x')$$),'42501|bupot-not-permitted','AC-BUPOT-008 Project Manager cannot correct');
select is(pg_temp.bupot_detail($$select * from public.void_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'x')$$),'42501|bupot-not-permitted','AC-BUPOT-008 Project Manager cannot void');
reset role;
update profiles set role='Executive' where id='91120000-0000-0000-0000-000000000011';
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000073','91120000-0000-0000-0000-000000000031','EXEC',current_date,date_trunc('month',current_date)::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'42501|bupot-not-permitted','AC-BUPOT-008 Executive cannot record');
select is(pg_temp.bupot_detail($$select * from public.correct_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'EXEC',current_date,date_trunc('month',current_date)::date,'x')$$),'42501|bupot-not-permitted','AC-BUPOT-008 Executive cannot correct');
select is(pg_temp.bupot_detail($$select * from public.void_vendor_withholding_slip('91120000-0000-0000-0000-000000000067',1,'x')$$),'42501|bupot-not-permitted','AC-BUPOT-008 Executive cannot void');
reset role;
update profiles set role='Finance' where id='91120000-0000-0000-0000-000000000011';

-- Current-vs-snapshot compares each bill, not only the aggregate; offsetting edits keep the sum unchanged.
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000092','91120000-0000-0000-0000-000000000031','GAP-OFFSET',current_date,date_trunc('month',current_date)::date,'pph23',1000,300,array['91120000-0000-0000-0000-000000000052'::uuid,'91120000-0000-0000-0000-000000000057'::uuid],'{}')$$),'NO_ERROR','AC-BUPOT-009 records two exact bill snapshots');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000093','91120000-0000-0000-0000-000000000031','GAP-DECLARED',current_date,date_trunc('month',current_date)::date,'pph23',1000,600,array['91120000-0000-0000-0000-000000000056'::uuid],array['91120000-0000-0000-0000-000000000056'::uuid])$$),'NO_ERROR','AC-BUPOT-004 declared unknown type is accepted for the exact selected set');
select is((select type_source from public.vendor_withholding_slip_bills where slip_id='91120000-0000-0000-0000-000000000093'),'declared','AC-BUPOT-004 explicit unknown-type declaration is snapshotted');
select is((select withheld_pph_type from public.procurement_invoices where id='91120000-0000-0000-0000-000000000056'),null::text,'AC-BUPOT-004 declaration never changes the source bill');
select is((select revision from public.void_vendor_withholding_slip('91120000-0000-0000-0000-000000000093',1,'release declared bill')),2,'AC-BUPOT-007 void releases the bill reservation');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000094','91120000-0000-0000-0000-000000000031',' GAP-DECLARED ',current_date,date_trunc('month',current_date)::date,'pph23',1000,600,array['91120000-0000-0000-0000-000000000056'::uuid],array['91120000-0000-0000-0000-000000000056'::uuid])$$),'NO_ERROR','AC-BUPOT-005 void releases number and bill for replacement');
reset role;
update procurement_invoices set withheld_amount=210 where id='91120000-0000-0000-0000-000000000052';
update procurement_invoices set withheld_amount=90 where id='91120000-0000-0000-0000-000000000057';
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select is((select validation_state from public.vendor_withholding_slip_register where slip_id='91120000-0000-0000-0000-000000000092'),'needs-review','AC-BUPOT-009 offsetting bill edits still require review');
select is((select difference from public.vendor_withholding_slip_register where slip_id='91120000-0000-0000-0000-000000000092'),0::numeric,'AC-BUPOT-009 unchanged aggregate cannot hide individual snapshot differences');
select is((select count(*)::int from public.vendor_withholding_slip_register where slip_id='91120000-0000-0000-0000-000000000092'),1,'AC-BUPOT-012 header register emits a multi-bill slip once');
select is((select withheld_amount from public.vendor_withholding_slip_register where slip_id='91120000-0000-0000-0000-000000000092'),300::numeric,'AC-BUPOT-012 header register retains the complete slip total once');
select ok((select count(*)=1 from public.vendor_withholding_slip_bills where slip_id='91120000-0000-0000-0000-000000000093' and released_at is not null)
      and (select count(*)=1 from public.vendor_withholding_slip_bills where slip_id='91120000-0000-0000-0000-000000000094' and released_at is null),
      'AC-BUPOT-007 retained void link and replacement reservation coexist');
select is((select count(*)::int from public.list_vendor_withholding_slips(null,null,null,null,null,1)),1,'AC-BUPOT-012 first header keyset page returns one row');
select is((select count(*)::int from public.list_vendor_withholding_slips(null,null,null,
  (select tax_period from public.list_vendor_withholding_slips(null,null,null,null,null,1)),
  (select slip_id from public.list_vendor_withholding_slips(null,null,null,null,null,1)),1)),1,
  'AC-BUPOT-012 next keyset page returns the adjacent row once');
select ok((select first_page.slip_id<>second_page.slip_id
  from public.list_vendor_withholding_slips(null,null,null,null,null,1) first_page
  cross join lateral public.list_vendor_withholding_slips(null,null,null,first_page.tax_period,first_page.slip_id,1) second_page),
  'AC-BUPOT-012 adjacent header keyset pages do not duplicate a slip');
reset role;

-- Org-local calendar and pre-cast scalar refusals are verified by the actual writer.
update profiles set role='Finance' where id='91120000-0000-0000-0000-000000000011';
set local request.jwt.claims='{"sub":"91120000-0000-0000-0000-000000000011","role":"authenticated"}';
set local role authenticated;
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000081','91120000-0000-0000-0000-000000000031','',current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 blank number is refused');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000082','91120000-0000-0000-0000-000000000031',repeat('x',101),current_date,date_trunc('month',current_date)::date,'pph23',1000,100,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 overlength number is refused');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000083','91120000-0000-0000-0000-000000000031','GAP-ROUND',current_date,date_trunc('month',current_date)::date,'pph23',1000.001,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 money with excess precision is rejected before numeric cast');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000090','91120000-0000-0000-0000-000000000031',E'BAD\nNUMBER',current_date,date_trunc('month',current_date)::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 control characters in the number are refused');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000091','91120000-0000-0000-0000-000000000031','GAP-WITHHELD-PRECISION',current_date,date_trunc('month',current_date)::date,'pph23',1000,200.001,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 withheld amount with excess precision is refused before cast');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000095','91120000-0000-0000-0000-000000000031','GAP-NEGATIVE',current_date,date_trunc('month',current_date)::date,'pph23',1000,-1,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 negative withheld amount is refused');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000084','91120000-0000-0000-0000-000000000031','GAP-ZERO',current_date,date_trunc('month',current_date)::date,'pph23',1000,0,array['91120000-0000-0000-0000-000000000057'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 zero withholding entry is refused');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000085','91120000-0000-0000-0000-000000000031','GAP-FUTURE',(now() at time zone 'Pacific/Kiritimati')::date+1,date_trunc('month',(now() at time zone 'Pacific/Kiritimati')::date)::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 future slip date uses the org local date');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000086','91120000-0000-0000-0000-000000000031','GAP-PERIOD',current_date,date_trunc('month',current_date)::date+1,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 non-month-start period is refused');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000087','91120000-0000-0000-0000-000000000031','GAP-FUTURE-PERIOD',current_date,(date_trunc('month',(now() at time zone 'Pacific/Kiritimati')::date)::date+interval '1 month')::date,'pph23',1000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 future tax period is refused in org calendar');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000088','91120000-0000-0000-0000-000000000031','GAP-OVERFLOW',current_date,date_trunc('month',current_date)::date,'pph23',1000000000000,200,array['91120000-0000-0000-0000-000000000052'::uuid],'{}')$$),'23514|bupot-invalid-facts','AC-BUPOT-001 overflow is refused before table cast');
select is(pg_temp.bupot_detail($$select * from public.record_vendor_withholding_slip('91120000-0000-0000-0000-000000000089','91120000-0000-0000-0000-000000000031','GAP-UNKNOWN',current_date,date_trunc('month',current_date)::date,'pph23',1000,600,array['91120000-0000-0000-0000-000000000056'::uuid],'{}')$$),'23514|bupot-type-confirmation','AC-BUPOT-004 exact unknown declaration selection is required');
reset role;

select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.vendor_withholding_slip_register'::regclass),'AC-BUPOT-012 register remains invoker RLS');
select * from finish();
rollback;
