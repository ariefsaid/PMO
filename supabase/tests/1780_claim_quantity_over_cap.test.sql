-- 1780_claim_quantity_over_cap.test.sql — survey-cap-stop (part B): the database stop on a claim line over its ceiling,
-- behind organizations.claim_quantity_over_cap ('warn' default | 'block'). AC-SCS-001..009.
begin;
create extension if not exists pgtap;
select plan(34);
create function pg_temp.err(q text) returns text language plpgsql as $f$ begin execute q; return null; exception when others then return sqlerrm; end $f$;

insert into organizations(id,name) values ('17800000-0000-0000-0000-000000000001','Cap Org A'),('17800000-0000-0000-0000-000000000002','Cap Org B');
insert into auth.users(id,email) values ('17800000-0000-0000-0000-000000000011','cap-a-admin@example.invalid');
insert into auth.users(id,email) values ('17800000-0000-0000-0000-000000000012','cap-a-fin@example.invalid');
insert into auth.users(id,email) values ('17800000-0000-0000-0000-000000000013','cap-a-pm@example.invalid');
insert into auth.users(id,email) values ('17800000-0000-0000-0000-000000000014','cap-b-admin@example.invalid');
insert into auth.users(id,email) values ('17800000-0000-0000-0000-000000000015','cap-b-fin@example.invalid');
insert into auth.users(id,email) values ('17800000-0000-0000-0000-000000000016','cap-a-fin2@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('17800000-0000-0000-0000-000000000011','17800000-0000-0000-0000-000000000001','Cap a-admin','cap-a-admin@example.invalid','Admin','active');
insert into profiles(id,org_id,full_name,email,role,status) values ('17800000-0000-0000-0000-000000000012','17800000-0000-0000-0000-000000000001','Cap a-fin','cap-a-fin@example.invalid','Finance','active');
insert into profiles(id,org_id,full_name,email,role,status) values ('17800000-0000-0000-0000-000000000013','17800000-0000-0000-0000-000000000001','Cap a-pm','cap-a-pm@example.invalid','Project Manager','active');
insert into profiles(id,org_id,full_name,email,role,status) values ('17800000-0000-0000-0000-000000000014','17800000-0000-0000-0000-000000000002','Cap b-admin','cap-b-admin@example.invalid','Admin','active');
insert into profiles(id,org_id,full_name,email,role,status) values ('17800000-0000-0000-0000-000000000016','17800000-0000-0000-0000-000000000001','Cap a-fin2','cap-a-fin2@example.invalid','Finance','active');
insert into profiles(id,org_id,full_name,email,role,status) values ('17800000-0000-0000-0000-000000000015','17800000-0000-0000-0000-000000000002','Cap b-fin','cap-b-fin@example.invalid','Finance','active');
insert into companies(id,org_id,name,type) values ('17800000-0000-0000-0000-000000000051','17800000-0000-0000-0000-000000000001','Cap Customer','Client');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,currency,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,client_id) values ('17800000-0000-0000-0000-000000000021','17800000-0000-0000-0000-000000000001','Cap Project A','Ongoing Project',1000000,'exclusive',0,'USD',null,1,1,false,'17800000-0000-0000-0000-000000000051'),('17800000-0000-0000-0000-000000000022','17800000-0000-0000-0000-000000000002','Cap Project B','Ongoing Project',1000000,'exclusive',0,'USD',null,1,1,false,null);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount,currency) values ('17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','Cap WO1','Issued',50000,'exclusive',0,'USD'),('17800000-0000-0000-0000-000000000032','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','Cap WO2','Issued',50000,'exclusive',0,'USD'),('17800000-0000-0000-0000-000000000033','17800000-0000-0000-0000-000000000002','17800000-0000-0000-0000-000000000022','Cap WOB','Issued',50000,'exclusive',0,'USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('17800000-0000-0000-0000-000000000041','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','CAP1','Cap line 1','unit',100,10),
 ('17800000-0000-0000-0000-000000000042','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','CAP2','Cap line 2','unit',100,10),
 ('17800000-0000-0000-0000-000000000043','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','CAP3','Cap line 3','unit',100,10),
 ('17800000-0000-0000-0000-000000000044','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','CAP4','Cap line 4','unit',100,10),
 ('17800000-0000-0000-0000-000000000045','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','CAP5','Cap line 5','unit',100,10),
 ('17800000-0000-0000-0000-000000000046','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','CAP6','Cap line 6','unit',100,10),
 ('17800000-0000-0000-0000-000000000047','17800000-0000-0000-0000-000000000002','17800000-0000-0000-0000-000000000022','CAP7','Cap line 7','unit',100,10);
insert into project_documents(id,org_id,project_id,category,title,status,author_id,file_path) values ('17800000-0000-0000-0000-000000000081','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','Contract','Cap evidence','Approved','17800000-0000-0000-0000-000000000012','17800000-0000-0000-0000-000000000001/17800000-0000-0000-0000-000000000021/17800000-0000-0000-0000-000000000081/cap.pdf');
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000041',10),('17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000042',10),('17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000043',10),('17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000044',10),('17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000045',10),('17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000032','17800000-0000-0000-0000-000000000046',10),('17800000-0000-0000-0000-000000000002','17800000-0000-0000-0000-000000000033','17800000-0000-0000-0000-000000000047',10);
insert into work_order_acceptances(id,org_id,project_id,work_order_id,acceptance_date,status,prepared_by,confirmed_by,confirmed_at,confirm_basis)
 values ('17800000-0000-0000-0000-000000000061','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000021','17800000-0000-0000-0000-000000000031','2026-11-01','Confirmed','17800000-0000-0000-0000-000000000012','17800000-0000-0000-0000-000000000011',now(),'standard');
insert into work_order_acceptance_lines(acceptance_id,boq_item_id,quantity) values ('17800000-0000-0000-0000-000000000061','17800000-0000-0000-0000-000000000043',6),('17800000-0000-0000-0000-000000000061','17800000-0000-0000-0000-000000000045',0);
insert into opening_balances(id,org_id,kind,as_of,work_order_id,currency,claimed_amount,loaded_by) values ('17800000-0000-0000-0000-000000000071','17800000-0000-0000-0000-000000000001','work_order','2026-10-31','17800000-0000-0000-0000-000000000032','USD',40,'17800000-0000-0000-0000-000000000011');
insert into opening_balance_lines(opening_id,org_id,boq_item_id,certified_quantity,claimed_quantity,claimed_amount) values ('17800000-0000-0000-0000-000000000071','17800000-0000-0000-0000-000000000001','17800000-0000-0000-0000-000000000046',4,4,40);

-- AC-SCS-001 the SQL twin mirrors the TypeScript cases in progressBilling.test.ts exactly
select ok((select ceiling = 6 and basis = 'accepted' and headroom = 3 and signed_headroom = 3 from claimable_headroom(10, 3, 6, null)), 'AC-SCS-001 accepted 6, claimed 3: headroom 3 on the accepted basis');
select ok((select basis = 'ordered' and headroom = 6 from claimable_headroom(10, 4, null, null)), 'AC-SCS-001 nothing accepted: ordered minus claimed');
select ok((select basis = 'accepted' and headroom = 0 from claimable_headroom(10, 0, 0, null)), 'AC-SCS-001 a BAST of zero is a BAST');
select ok((select headroom = 0 and signed_headroom = -2 from claimable_headroom(10, 7, 5, null)), 'AC-SCS-001 past the ceiling: headroom 0, signed -2');
select ok((select headroom = 0.2 from claimable_headroom(1, 0.1, 0.3, null)), 'AC-SCS-001 exact in milli-units');
select ok((select basis = 'surveyed' and ceiling = 4 and headroom = 3 from claimable_headroom(10, 1, 8, 4)), 'AC-SCS-001 a surveyed figure takes precedence');
select is(survey_quantity_for_line('17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000041'), null::numeric, 'AC-SCS-003 the survey seam returns null until the survey record exists');
select ok(position('lock_work_order_billing' in prosrc) > 0 and position('lock_work_order_billing' in prosrc) < position('work_order_line_headroom' in prosrc), 'AC-SCS-008 the trigger takes the work-order billing lock before it reads claimed totals') from pg_proc where proname = 'enforce_claim_line_cap';
select is((select claim_quantity_over_cap from organizations where id = '17800000-0000-0000-0000-000000000001'), 'warn', 'AC-SCS-002 the default is warn');

set local role authenticated;
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000041","quantity":15}]'::jsonb)$q$,'AC-SCS-002 on the default (warn) a claim over the ordered quantity is created as before');
-- AC-SCS-007 only an Admin changes the setting
update organizations set claim_quantity_over_cap = 'block' where id = '17800000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000013","role":"authenticated"}';
update organizations set claim_quantity_over_cap = 'block' where id = '17800000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000014","role":"authenticated"}';
update organizations set claim_quantity_over_cap = 'block' where id = '17800000-0000-0000-0000-000000000001';
reset role;
select is((select claim_quantity_over_cap from organizations where id = '17800000-0000-0000-0000-000000000001'), 'warn', 'AC-SCS-007 Finance, a Project Manager and another organisation Admin change nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000011","role":"authenticated"}';
update organizations set claim_quantity_over_cap = 'block' where id = '17800000-0000-0000-0000-000000000001';
reset role;
select is((select claim_quantity_over_cap from organizations where id = '17800000-0000-0000-0000-000000000001'), 'block', 'AC-SCS-007 the Admin sets block');
select is((select detail::text from audit_events where action = 'org.claim_quantity_over_cap.change' and entity_id = '17800000-0000-0000-0000-000000000001'), '{"to": "block", "from": "warn"}', 'AC-SCS-007 the audit row holds the before and after');
select throws_ok($q$update organizations set claim_quantity_over_cap = 'maybe' where id = '17800000-0000-0000-0000-000000000001'$q$, '23514', null, 'AC-SCS-007 only warn or block are values');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((select count(*)::int from progress_claims), 1, 'AC-SCS-003 one claim so far (the warn-mode one)');
select alike(pg_temp.err($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000042","quantity":10.001}]'::jsonb)$q$),'CLM\_OVER\_CAP:%','AC-SCS-003 block: a line over the ordered quantity is refused');
select is((select count(*)::int from progress_claims), 1, 'AC-SCS-003 the refused claim left no claim row');
select lives_ok($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000042","quantity":10}]'::jsonb)$q$,'AC-SCS-003 block: a line exactly at the headroom is allowed');
select alike(pg_temp.err($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000042","quantity":0.001}]'::jsonb)$q$),'CLM\_OVER\_CAP:%','AC-SCS-008 race: a second claim for headroom the first took is refused');
select alike(pg_temp.err($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000043","quantity":6.001}]'::jsonb)$q$),'CLM\_OVER\_CAP:%','AC-SCS-004 block: accepted 6 is the ceiling, not ordered 10');
select lives_ok($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000043","quantity":6}]'::jsonb)$q$,'AC-SCS-004 block: exactly the accepted quantity is allowed');
select alike(pg_temp.err($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000045","quantity":0.001}]'::jsonb)$q$),'CLM\_OVER\_CAP:%','AC-SCS-004 block: a BAST of zero is a ceiling of zero');
select alike(pg_temp.err($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000032',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000046","quantity":6.001}]'::jsonb)$q$),'CLM\_OVER\_CAP:%','AC-SCS-005 block: a live opening balance of 4 counts as claimed');
select lives_ok($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000032',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000046","quantity":6}]'::jsonb)$q$,'AC-SCS-005 block: the rest after the opening balance is allowed');
-- withdrawn and Cancelled-invoice claims do not count
create temp table ids(k text, v uuid);
grant all on ids to authenticated;
insert into ids select 'w1', create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000044","quantity":10}]'::jsonb);
select alike(pg_temp.err($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000044","quantity":0.001}]'::jsonb)$q$),'CLM\_OVER\_CAP:%','AC-SCS-005 a live claim counts');
select lives_ok($q$select withdraw_progress_claim((select v from ids where k='w1'))$q$,'AC-SCS-005 the claim is withdrawn');
insert into ids select 'w2', create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000044","quantity":10}]'::jsonb);
-- the app's path to a Cancelled invoice: Finance evidences the claim, another Finance raises its invoice, an Admin cancels it
select lives_ok($q$select attach_claim_evidence((select v from ids where k='w2'), '17800000-0000-0000-0000-000000000081')$q$,'AC-SCS-005 evidence attached to the claim');
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000016","role":"authenticated"}';
select lives_ok($q$select create_native_progress_claim_invoice((select v from ids where k='w2'))$q$,'AC-SCS-005 the invoice is raised from the claim');
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($q$select transition_native_sales_invoice((select v from ids where k='w2'), 'Cancelled')$q$,'AC-SCS-005 the Admin cancels the invoice');
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($q$select create_progress_claim('17800000-0000-0000-0000-000000000021','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000044","quantity":10}]'::jsonb)$q$,'AC-SCS-005 withdrawn and Cancelled-invoice claims leave the headroom free');
-- the facts are the same ones the Billing tab reads (get_project_billing)
select is((select claimed from (select (al->>'claimed_quantity')::numeric claimed from jsonb_array_elements(get_project_billing('17800000-0000-0000-0000-000000000021')->'boq') bq, jsonb_array_elements(bq->'allocations') al where (al->>'boq_item_id')::uuid = '17800000-0000-0000-0000-000000000046' and (al->>'work_order_id')::uuid = '17800000-0000-0000-0000-000000000032') x), work_order_line_claimed_quantity('17800000-0000-0000-0000-000000000032','17800000-0000-0000-0000-000000000046'), 'AC-SCS-005 the claimed figure equals the Billing tab for a line with a claim and an opening balance');
select is((select claimed from (select (al->>'claimed_quantity')::numeric claimed from jsonb_array_elements(get_project_billing('17800000-0000-0000-0000-000000000021')->'boq') bq, jsonb_array_elements(bq->'allocations') al where (al->>'boq_item_id')::uuid = '17800000-0000-0000-0000-000000000044' and (al->>'work_order_id')::uuid = '17800000-0000-0000-0000-000000000031') x), work_order_line_claimed_quantity('17800000-0000-0000-0000-000000000031','17800000-0000-0000-0000-000000000044'), 'AC-SCS-005 the claimed figure equals the Billing tab with a withdrawn and a Cancelled claim');
-- AC-SCS-006 another organisation on the default is unaffected
set local request.jwt.claims = '{"sub":"17800000-0000-0000-0000-000000000015","role":"authenticated"}';
select lives_ok($q$select create_progress_claim('17800000-0000-0000-0000-000000000022','progress',p_work_order_id=>'17800000-0000-0000-0000-000000000033',p_lines=>'[{"boq_item_id":"17800000-0000-0000-0000-000000000047","quantity":15}]'::jsonb)$q$,'AC-SCS-006 organisation B (warn) may still claim over the ordered quantity');
-- AC-SCS-009 claim lines still cannot be updated
reset role;
select throws_ok($q$update progress_claim_lines set quantity = 1$q$, '42501', null, 'AC-SCS-009 claim lines stay immutable');
select * from finish();
rollback;
