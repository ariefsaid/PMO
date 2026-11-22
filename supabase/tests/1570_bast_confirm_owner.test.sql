begin;
create extension if not exists pgtap;
-- fix-billing items 1 and 2: who confirms a delivery record (BAST), the final record's separation of duties,
-- and the waiting-list data. Roles: PM prepares, a different Finance confirms; Executive and the author never confirm.
select plan(32);
insert into organizations(id,name) values ('33570000-0000-0000-0000-000000000001','FB Org');
insert into auth.users(id,email) values ('33570000-0000-0000-0000-000000000011','fb-pm@example.invalid'),('33570000-0000-0000-0000-000000000012','fb-fin@example.invalid'),('33570000-0000-0000-0000-000000000013','fb-fin2@example.invalid'),('33570000-0000-0000-0000-000000000014','fb-exec@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('33570000-0000-0000-0000-000000000011','33570000-0000-0000-0000-000000000001','FB PM','fb-pm@example.invalid','Project Manager','active'),
 ('33570000-0000-0000-0000-000000000012','33570000-0000-0000-0000-000000000001','FB Fin','fb-fin@example.invalid','Finance','active'),
 ('33570000-0000-0000-0000-000000000013','33570000-0000-0000-0000-000000000001','FB Fin2','fb-fin2@example.invalid','Finance','active'),
 ('33570000-0000-0000-0000-000000000014','33570000-0000-0000-0000-000000000001','FB Exec','fb-exec@example.invalid','Executive','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id) values
 ('33570000-0000-0000-0000-000000000021','33570000-0000-0000-0000-000000000001','FB Project','Ongoing Project',10000,'exclusive',0,'33570000-0000-0000-0000-000000000011');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33570000-0000-0000-0000-000000000031','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','FB WO','Issued',10000,'exclusive',0);
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33570000-0000-0000-0000-000000000041','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','LINE','Contract line','km',10,1000);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values ('33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000031','33570000-0000-0000-0000-000000000041',10);
-- Re-seeding keeps a narrowed system category narrowed and leaves a same-named custom category untouched.
delete from document_category_roles where role not in ('Admin','Finance') and category_id = (select id from document_categories where org_id = '33570000-0000-0000-0000-000000000001' and name = 'Report');
select public.seed_document_categories('33570000-0000-0000-0000-000000000001');
select is((select count(*)::int from document_category_roles r join document_categories c on c.id = r.category_id where c.org_id = '33570000-0000-0000-0000-000000000001' and c.name = 'Report'), 2,
  'a system category narrowed to two roles stays narrowed after the seed runs again');
select is((select count(*)::int from document_categories where org_id = '33570000-0000-0000-0000-000000000001' and name = 'Delivery record' and is_system), 1,
  'the seed run again adds no second copy of a system category');
update document_categories set is_system = false, archived_at = null where org_id = '33570000-0000-0000-0000-000000000001' and name = 'Specification';
delete from document_category_roles where category_id = (select id from document_categories where org_id = '33570000-0000-0000-0000-000000000001' and name = 'Specification') and role <> 'Admin';
select public.seed_document_categories('33570000-0000-0000-0000-000000000001');
select is((select is_system from document_categories where org_id = '33570000-0000-0000-0000-000000000001' and name = 'Specification' and archived_at is null), false,
  'a custom category sharing a system name stays custom after the seed runs again');
select is((select count(*)::int from document_category_roles r join document_categories c on c.id = r.category_id where c.org_id = '33570000-0000-0000-0000-000000000001' and c.name = 'Specification'), 1,
  'a custom category sharing a system name keeps its own roles after the seed runs again');
set local role authenticated;
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$insert into project_documents(id,org_id,project_id,category,title,file_path) values
 ('33570000-0000-0000-0000-000000000051','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','Delivery record','Signed delivery record','33570000-0000-0000-0000-000000000001/33570000-0000-0000-0000-000000000021/33570000-0000-0000-0000-000000000051/record.pdf')$$,'FB the PM records the signed delivery record under the Delivery record category');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.transition_document_status('33570000-0000-0000-0000-000000000051','Issued')$$,'FB Finance issues the record document');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('fb.final',public.prepare_work_order_acceptance('33570000-0000-0000-0000-000000000031',current_date,true,'[{"boq_item_id":"33570000-0000-0000-0000-000000000041","quantity":10}]'::jsonb,'33570000-0000-0000-0000-000000000051')::text,true)$$,'FB the project PM may mark the record final when preparing it');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),0,'FB the PM has nothing to confirm in the waiting data');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('fb.final')::uuid)$$,'42501','only Admin or Finance may confirm an acceptance','FB the PM cannot confirm the final record');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000014","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('fb.final')::uuid)$$,'42501','only Admin or Finance may confirm an acceptance','FB the top approver (Executive) cannot confirm either');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),0,'FB an Executive has no confirmation waiting');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),1,'FB Finance sees the waiting record in the waiting data');
select lives_ok($$select set_config('fb.own',public.prepare_work_order_acceptance('33570000-0000-0000-0000-000000000031',current_date,false,'[{"boq_item_id":"33570000-0000-0000-0000-000000000041","quantity":2}]'::jsonb,'33570000-0000-0000-0000-000000000051')::text,true)$$,'FB Finance prepares a record of their own');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('fb.own')::uuid)$$,'42501','separation of duties: the preparer cannot confirm this acceptance','FB the author cannot confirm their own record');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation() where id=current_setting('fb.own')::uuid),0,'FB the author does not see their own record as waiting for them');
-- The final record is the money one (confirming it closes the order and stamps closing_value): the SAME author
-- guard must refuse a final self-confirmation, not only a stage one. A final-only bypass would pass every other
-- assertion in this file, so this is the one that pins it.
select lives_ok($$select set_config('fb.ownfinal',public.prepare_work_order_acceptance('33570000-0000-0000-0000-000000000031',current_date,true,'[{"boq_item_id":"33570000-0000-0000-0000-000000000041","quantity":3}]'::jsonb,'33570000-0000-0000-0000-000000000051')::text,true)$$,'FB Finance prepares a FINAL record of their own');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('fb.ownfinal')::uuid)$$,'42501','separation of duties: the preparer cannot confirm this acceptance','FB the author cannot confirm their own final record either');
select is((select status from public.work_order_acceptances where id=current_setting('fb.ownfinal')::uuid),'Draft','FB the refused final self-confirmation leaves the acceptance a Draft');
select is((select status::text from work_orders where id='33570000-0000-0000-0000-000000000031'),'Issued','FB the refused final self-confirmation leaves the work order Issued, not closed');
select lives_ok($$select public.withdraw_work_order_acceptance(current_setting('fb.ownfinal')::uuid)$$,'FB the author withdraws the final draft they were not allowed to confirm');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000013","role":"authenticated"}';
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),2,'FB another Finance user sees both records waiting');
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('fb.final')::uuid)$$,'FB a different Finance user confirms the final record');
select is((select status::text from work_orders where id='33570000-0000-0000-0000-000000000031'),'Closed','FB the confirmed final record closes the work order');

-- The waiting read is the caller's WHOLE eligible set: 1570 used to cap it at 200, which made the waiting count silently
-- short. No cap now, while the deterministic prepared_at+id order and every original predicate stay exactly as they were:
-- Draft only, Issued order only, Admin/Finance only, the author excluded unless the only active member, own organisation only.
reset role;
insert into organizations(id,name) values ('33570000-0000-0000-0000-000000000002','FB Bulk Org'),('33570000-0000-0000-0000-000000000003','FB Solo Org');
insert into auth.users(id,email) values
 ('33570000-0000-0000-0000-000000000015','fb-bulk-pm@example.invalid'),('33570000-0000-0000-0000-000000000016','fb-bulk-fin@example.invalid'),
 ('33570000-0000-0000-0000-000000000017','fb-bulk-exec@example.invalid'),('33570000-0000-0000-0000-000000000018','fb-solo-fin@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('33570000-0000-0000-0000-000000000015','33570000-0000-0000-0000-000000000002','FB Bulk PM','fb-bulk-pm@example.invalid','Project Manager','active'),
 ('33570000-0000-0000-0000-000000000016','33570000-0000-0000-0000-000000000002','FB Bulk Fin','fb-bulk-fin@example.invalid','Finance','active'),
 ('33570000-0000-0000-0000-000000000017','33570000-0000-0000-0000-000000000002','FB Bulk Exec','fb-bulk-exec@example.invalid','Executive','active'),
 ('33570000-0000-0000-0000-000000000018','33570000-0000-0000-0000-000000000003','FB Solo Fin','fb-solo-fin@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount) values
 ('33570000-0000-0000-0000-000000000022','33570000-0000-0000-0000-000000000002','FB Bulk Project','Ongoing Project',10000,'exclusive',0),
 ('33570000-0000-0000-0000-000000000023','33570000-0000-0000-0000-000000000003','FB Solo Project','Ongoing Project',10000,'exclusive',0);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33570000-0000-0000-0000-000000000032','33570000-0000-0000-0000-000000000002','33570000-0000-0000-0000-000000000022','FB Bulk WO','Issued',10000,'exclusive',0),
 ('33570000-0000-0000-0000-000000000033','33570000-0000-0000-0000-000000000003','33570000-0000-0000-0000-000000000023','FB Solo WO','Issued',10000,'exclusive',0),
 ('33570000-0000-0000-0000-000000000034','33570000-0000-0000-0000-000000000002','33570000-0000-0000-0000-000000000022','FB Closed WO','Closed',10000,'exclusive',0),
 ('33570000-0000-0000-0000-000000000035','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','FB Foreign WO','Issued',10000,'exclusive',0);
-- 205 eligible records (one page is 1000 in the client, so the old 200 cap cut this set after 200).
insert into work_order_acceptances(id,org_id,project_id,work_order_id,acceptance_date,is_final,prepared_by,status)
 select gen_random_uuid(),'33570000-0000-0000-0000-000000000002','33570000-0000-0000-0000-000000000022','33570000-0000-0000-0000-000000000032',current_date,false,'33570000-0000-0000-0000-000000000015','Draft' from generate_series(1,205);
insert into work_order_acceptances(id,org_id,project_id,work_order_id,acceptance_date,is_final,prepared_by,status) values
 -- the author's own eligible draft: excluded for them, visible to another Finance user
 ('33570000-0000-0000-0000-0000000000a1','33570000-0000-0000-0000-000000000002','33570000-0000-0000-0000-000000000022','33570000-0000-0000-0000-000000000032',current_date,false,'33570000-0000-0000-0000-000000000016','Draft'),
 -- a Draft on a non-issued order: not waiting
 ('33570000-0000-0000-0000-0000000000a2','33570000-0000-0000-0000-000000000002','33570000-0000-0000-0000-000000000022','33570000-0000-0000-0000-000000000034',current_date,false,'33570000-0000-0000-0000-000000000015','Draft'),
 -- another organisation's otherwise-eligible Draft: never in this caller's data
 ('33570000-0000-0000-0000-0000000000a3','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','33570000-0000-0000-0000-000000000035',current_date,false,'33570000-0000-0000-0000-000000000011','Draft'),
 -- the solo organisation's only active member prepared this one themselves
 ('33570000-0000-0000-0000-0000000000a4','33570000-0000-0000-0000-000000000003','33570000-0000-0000-0000-000000000023','33570000-0000-0000-0000-000000000033',current_date,false,'33570000-0000-0000-0000-000000000018','Draft');
set local role authenticated;
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000016","role":"authenticated"}';
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),205,'FB the waiting data returns every eligible record past 200, never a truncated page or a hard cap');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation() where prepared_by='33570000-0000-0000-0000-000000000016'),0,'FB the author is still excluded with more than 200 records waiting');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation() where id='33570000-0000-0000-0000-0000000000a1'),0,'FB the author''s own eligible draft is not in their waiting data even past 200');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation() where id='33570000-0000-0000-0000-0000000000a2'),0,'FB a Draft on a non-issued work order is not waiting');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation() where id='33570000-0000-0000-0000-0000000000a3'),0,'FB another organisation''s acceptance is never in this caller''s waiting data');
select is(
  (select id from public.acceptances_awaiting_my_confirmation() limit 1),
  (select a.id from public.work_order_acceptances a join public.work_orders w on w.id=a.work_order_id
    where a.org_id='33570000-0000-0000-0000-000000000002' and a.status='Draft' and w.status='Issued'
      and a.prepared_by<>'33570000-0000-0000-0000-000000000016' order by a.prepared_at,a.id limit 1),
  'FB the waiting data keeps the deterministic prepared_at then id order the client pages on');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000017","role":"authenticated"}';
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),0,'FB an Executive still has no confirmation waiting');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000018","role":"authenticated"}';
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),1,'FB the only active member sees their own draft as waiting (the sole-operator branch is unchanged)');
select is((select prepared_by from public.acceptances_awaiting_my_confirmation() limit 1),'33570000-0000-0000-0000-000000000018'::uuid,'FB that sole-operator waiting record is the author''s own');
select * from finish();
rollback;
