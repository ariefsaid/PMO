-- #2277: undoing a placed order family. The whole purchase: every decision undone, marks restored, purchase cancelled. One attachment: only its
-- invoices leave, the purchase and its order stay with their earlier stage and status. A later PMO step or a changed mark refuses either undo.
begin;
select plan(48);
insert into organizations(id,name,default_currency) values ('21953003-0000-0000-0000-000000000001','Family undo org','USD');
insert into auth.users(id,email) values ('21953003-0000-0000-0000-000000000002','family-undo@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21953003-0000-0000-0000-000000000002','21953003-0000-0000-0000-000000000001','Admin U','family-undo@example.test','Admin','active');
insert into projects(id,org_id,name,status) values
 ('21953003-0000-0000-0000-00000000000a','21953003-0000-0000-0000-000000000001','Project P','Ongoing Project'),
 ('21953003-0000-0000-0000-00000000000c','21953003-0000-0000-0000-000000000001','Project C','Ongoing Project');
insert into companies(id,org_id,name,type) values ('21953003-0000-0000-0000-000000000004','21953003-0000-0000-0000-000000000001','Supplier U','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21953003-0000-0000-0000-000000000001','companies','21953003-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21953003-0000-0000-0000-000000000005','21953003-0000-0000-0000-000000000001','erpnext','https://example.test','test','{"company":"Example"}',now()-interval '1 hour','active');
insert into erp_capture_feed_witnesses(binding_id,org_id,feed_kind,started_at,completed,ledger_currency) values
 ('21953003-0000-0000-0000-000000000005','21953003-0000-0000-0000-000000000001','purchases',now(),true,null),
 ('21953003-0000-0000-0000-000000000005','21953003-0000-0000-0000-000000000001','ledger',now(),true,'USD');
insert into budget_category_account_map(org_id,category,erp_account) values ('21953003-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21953003-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21953003-0000-0000-0000-000000000099');
insert into cost_attribution_rules(id,org_id,rule_key,version,name,match_account,effective_from,specificity) values ('21953003-0000-0000-0000-0000000000d1','21953003-0000-0000-0000-000000000001','21953003-0000-0000-0000-0000000000d2',1,'Cost rule','Cost','2026-01-01',2);
insert into cost_attribution_rule_targets(rule_id,org_id,position,project_id,percent) values ('21953003-0000-0000-0000-0000000000d1','21953003-0000-0000-0000-000000000001',0,'21953003-0000-0000-0000-00000000000c',100);
insert into erp_actuals_snapshot(org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('21953003-0000-0000-0000-000000000001','21953003-0000-0000-0000-00000000000a','Cost','2026',0,now()+interval '1 day','21953003-0000-0000-0000-0000000000e1',now()),
 ('21953003-0000-0000-0000-000000000001','21953003-0000-0000-0000-00000000000c','Cost','2026',0,now()+interval '1 day','21953003-0000-0000-0000-0000000000e1',now());
create function pg_temp.d(n integer) returns uuid language sql immutable as $$ select ('21953003-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.doc(n integer,p_type text,p_name text,p_orders text[] default '{}',p_net numeric default 100) returns void language sql as $$
 insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,grand_total,net_total,outstanding_amount,erp_status,erp_docstatus,purchase_orders,erp_modified)
 values (pg_temp.d(n),'21953003-0000-0000-0000-000000000001',p_type,p_name,'SUP-1','Supplier U','USD',p_net,p_net,case when p_type='Purchase Invoice' then p_net end,
   case when p_type='Purchase Invoice' then 'Unpaid' else 'To Bill' end,1,p_orders,'1') $$;
create function pg_temp.gl(p_voucher text,p_debit numeric) returns void language sql as $$
 insert into erp_gl_entry_mirror(org_id,erp_name,company,account,fiscal_year,party_type,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
  ('21953003-0000-0000-0000-000000000001','GL-'||p_voucher,'Example','Cost','2026','Supplier','Purchase Invoice',p_voucher,'2026-02-01',p_debit,0,false,'1') $$;
create function pg_temp.family(p_order integer,p_invoices integer[],p_request uuid) returns jsonb language sql as $$
 select jsonb_build_object('request_id',p_request,'decision','order_family','source_id',pg_temp.d(p_order),'project_id','21953003-0000-0000-0000-00000000000a',
   'invoice_ids',(select jsonb_agg(pg_temp.d(i)) from unnest(p_invoices) i),'accept_set_aside',true) $$;
create function pg_temp.apply(p_row jsonb) returns jsonb language sql as $$
 select public.assign_capture_invoices(jsonb_build_array(p_row),public.purchase_capture_source_page(null,null,1)->>'revision',false)#>'{results,0}' $$;
create function pg_temp.act(p_project uuid) returns numeric language sql as $$ select actuals_to_date from public.project_mapped_actuals(p_project) where category='Materials' $$;
create function pg_temp.open(p_purchase uuid) returns numeric language sql as $$ select c.amount from public.procurement_open_commitments(array[p_purchase]) c $$;
create function pg_temp.purchase(n integer) returns uuid language sql as $$ select procurement_id from procurement_erp_links where erp_purchase_document_id=pg_temp.d(n) $$;
create function pg_temp.capture_order(n integer) returns uuid language plpgsql as $$
declare v uuid;
begin
 v := (public.link_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_name',(select erp_name from erp_purchase_documents where id=pg_temp.d(n)),
   'erp_doctype','Purchase Order','project_id','21953003-0000-0000-0000-00000000000a')),false)#>>'{results,0,procurement_id}')::uuid;
 execute 'reset role';
 update procurements set record_only=true,record_only_stage='ordered',record_only_reference=(select erp_name from erp_purchase_documents where id=pg_temp.d(n)) where id=v;
 insert into erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
  values ('21953003-0000-0000-0000-000000000001','21953003-0000-0000-0000-000000000005',gen_random_uuid(),v,jsonb_build_object('source_ids',jsonb_build_array(pg_temp.d(n))),'order','ordered','21953003-0000-0000-0000-000000000002');
 execute 'set local role authenticated';
 return v;
end $$;
-- a captured invoice's payment queued in PMO: the later step that blocks an undo
create function pg_temp.queue_payment(p_purchase uuid,p_invoice uuid) returns void language sql as $$
 insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
 values ('21953003-0000-0000-0000-000000000001','procurement','pay-'||p_invoice::text,'pay-'||p_invoice::text,'erpnext','create','pending',
   jsonb_build_object('procurementId',p_purchase,'erp_doc_kind','payment','capturedInvoiceDocumentId',p_invoice)) $$;

select pg_temp.doc(1,'Purchase Order','PO-1',p_net=>1000);
select pg_temp.doc(2,'Purchase Invoice','PI-1',array['PO-1'],600); select pg_temp.gl('PI-1',600);
select pg_temp.doc(3,'Purchase Invoice','PI-2',array['PO-1'],100); select pg_temp.gl('PI-2',100);
select pg_temp.doc(4,'Purchase Order','PO-W',p_net=>1000);
select pg_temp.doc(5,'Purchase Invoice','PI-W',array['PO-W'],600); select pg_temp.gl('PI-W',600);
select pg_temp.doc(6,'Purchase Order','PO-P',p_net=>1000);
select pg_temp.doc(7,'Purchase Invoice','PI-P',array['PO-P'],600); select pg_temp.gl('PI-P',600);
select pg_temp.doc(8,'Purchase Order','PO-K',p_net=>1000);
select pg_temp.doc(9,'Purchase Invoice','PI-K1',array['PO-K'],100); select pg_temp.gl('PI-K1',100);
select pg_temp.doc(10,'Purchase Invoice','PI-K2',array['PO-K'],100); select pg_temp.gl('PI-K2',100);
select pg_temp.doc(11,'Purchase Order','PO-V',p_net=>1000);
select pg_temp.doc(12,'Purchase Invoice','PI-V',array['PO-V'],600); select pg_temp.gl('PI-V',600);
select pg_temp.doc(13,'Purchase Order','PO-N',p_net=>1000);
select pg_temp.doc(14,'Purchase Invoice','PI-N1',array['PO-N'],100); select pg_temp.gl('PI-N1',100);
-- PI-2 is set aside with a note before the placement; PI-K2 carries a note only
insert into erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at,set_aside_by,note,updated_at,updated_by) values
 (pg_temp.d(3),'21953003-0000-0000-0000-000000000001','2026-01-01','21953003-0000-0000-0000-000000000002','keep this note','2026-01-02','21953003-0000-0000-0000-000000000002'),
 (pg_temp.d(10),'21953003-0000-0000-0000-000000000001',null,null,'a note','2026-01-03',null);
create temp table before_marks on commit drop as select * from erp_purchase_document_marks where org_id='21953003-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"21953003-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('t.p0',pg_temp.act('21953003-0000-0000-0000-00000000000a')::text,true);
select set_config('t.c0',pg_temp.act('21953003-0000-0000-0000-00000000000c')::text,true);
-- AC-011: the whole purchase
select is(pg_temp.apply(pg_temp.family(1,'{2,3}','21953003-0000-0000-0000-0000000000c1'))->>'outcome','create','AC-011 the family is placed');
select set_config('t.x',pg_temp.purchase(1)::text,true);
select is(pg_temp.act('21953003-0000-0000-0000-00000000000a')-current_setting('t.p0')::numeric,700::numeric,'AC-011 P holds both invoices'' 700.00');
select is(public.undo_captured_purchase(current_setting('t.x')::uuid,'wrong project',true)->>'outcome','undo','AC-011 a dry-run undo reports the undo');
select is((select count(*)::int from erp_capture_invoice_assignments where family_request_id='21953003-0000-0000-0000-0000000000c1' and undone_at is null),2,'AC-011 a dry-run undo changes nothing');
select is(public.undo_captured_purchase(current_setting('t.x')::uuid,'wrong project',false)->>'outcome','undo','AC-011 the whole purchase is undone');
select is((select count(*)::int from erp_capture_invoice_assignments where family_request_id='21953003-0000-0000-0000-0000000000c1' and undone_at is null),0,'AC-011 every decision is undone');
select is(pg_temp.act('21953003-0000-0000-0000-00000000000a'),current_setting('t.p0')::numeric,'AC-011 P''s actuals return to their prior value');
select is(pg_temp.act('21953003-0000-0000-0000-00000000000c'),current_setting('t.c0')::numeric,'AC-011 and the rule''s project gets its cost back');
select is(pg_temp.open(current_setting('t.x')::uuid),0::numeric,'AC-011 the cancelled purchase holds nothing open');
select is(public.undo_captured_purchase(current_setting('t.x')::uuid,'again',false)->>'reason','already_undone','AC-011 a second undo returns already_undone');
select is(pg_temp.apply(pg_temp.family(1,'{2,3}','21953003-0000-0000-0000-0000000000c1'))->>'reason','undone','FR-014 the undone request cannot be replayed');
reset role;
select is((select status::text from procurements where id=current_setting('t.x')::uuid),'Cancelled','AC-011 the purchase is cancelled');
select is((select count(*)::int from procurement_erp_links where erp_purchase_document_id in (pg_temp.d(1),pg_temp.d(2),pg_temp.d(3))),0,'AC-011 its links are removed');
select is((select count(*)::int from erp_purchase_document_marks m join before_marks b using (erp_purchase_document_id) where m.erp_purchase_document_id=pg_temp.d(3) and to_jsonb(m)=to_jsonb(b)),1,'AC-011 the set-aside mark is restored exactly');
select is((select count(*)::int from erp_purchase_document_marks where erp_purchase_document_id=pg_temp.d(2)),0,'AC-011 an invoice that had no mark still has none');
select is((select jsonb_array_length(detail->'decision_ids') from audit_events where action='procurement.record_only_undo' and entity_id=current_setting('t.x')::uuid),2,'AC-011 the undo is audited with both decisions');
select is((select detail->'placement_before'->0->>'amount' from audit_events where action='procurement.record_only_undo' and entity_id=current_setting('t.x')::uuid),'700','AC-011 and the placement it removed');

-- AC-012: one attachment
set local role authenticated;
select set_config('t.w',pg_temp.capture_order(4)::text,true);
select set_config('t.p1',pg_temp.act('21953003-0000-0000-0000-00000000000a')::text,true);
select is(pg_temp.apply(pg_temp.family(4,'{5}','21953003-0000-0000-0000-0000000000a1'))->>'outcome','attach','AC-012 the invoice is attached');
select is(pg_temp.open(current_setting('t.w')::uuid),400::numeric,'AC-012 the attachment leaves 400.00 open');
select throws_ok($q$select public.undo_captured_purchase(current_setting('t.w')::uuid,'x',false,'21953003-0000-0000-0000-0000000000ff')$q$,'P0002','attachment_not_found','FR-016 an unknown attachment is not found');
select is(public.undo_captured_purchase(current_setting('t.w')::uuid,'wrong invoice',false,'21953003-0000-0000-0000-0000000000a1')->>'outcome','undo','AC-012 one attachment is undone');
select is((select array_agg(erp_purchase_document_id) from procurement_erp_links where procurement_id=current_setting('t.w')::uuid),array[pg_temp.d(4)],'AC-012 the purchase keeps its order only');
select is(pg_temp.open(current_setting('t.w')::uuid),1000::numeric,'AC-012 its commitment is 1000.00 again');
select is(pg_temp.act('21953003-0000-0000-0000-00000000000a'),current_setting('t.p1')::numeric,'AC-012 P''s actuals fall back by the 600.00');
select is(public.undo_captured_purchase(current_setting('t.w')::uuid,'again',false,'21953003-0000-0000-0000-0000000000a1')->>'reason','already_undone','FR-016 a second undo of the attachment returns already_undone');
reset role;
select is((select record_only::text||'/'||record_only_stage||'/'||status::text||'/'||(vendor_invoiced_at is null)::text from procurements where id=current_setting('t.w')::uuid),'true/ordered/Ordered/true','AC-012 the stage and status before the attachment are back, and it is not cancelled');
select is((select count(*)::int from erp_purchase_captures where procurement_id=current_setting('t.w')::uuid and undone_at is null and kind='order'),1,'AC-012 the order''s own capture row stays');
select is((select count(*)::int from erp_capture_invoice_assignments where family_request_id='21953003-0000-0000-0000-0000000000a1' and undone_at is not null and undone_reason='wrong invoice'),1,'AC-012 the attachment''s decision is undone with its reason');
select is((select count(*)::int from audit_events where action='procurement.erp_family_attach_undo' and entity_id=current_setting('t.w')::uuid and detail->>'commitment_after'='1000.00'),1,'AC-012 the attachment undo is audited with the commitment after');
set local role authenticated;
select is(pg_temp.apply(pg_temp.family(4,'{5}','21953003-0000-0000-0000-0000000000a2'))->>'outcome','attach','AC-012 the invoice can be attached again under a new request');
reset role;

-- FR-016: two attachments undone in the order they were made (not the reverse) still end where the purchase began
set local role authenticated;
select set_config('t.n',pg_temp.capture_order(13)::text,true);
select is(pg_temp.apply(pg_temp.family(13,'{14}','21953003-0000-0000-0000-0000000000b1'))->>'outcome','attach','FR-016 a first attachment');
reset role;
select pg_temp.doc(15,'Purchase Invoice','PI-N2',array['PO-N'],100); select pg_temp.gl('PI-N2',100);
set local role authenticated;
select is(pg_temp.apply(pg_temp.family(13,'{15}','21953003-0000-0000-0000-0000000000b2'))->>'outcome','attach','FR-016 a second attachment, for an invoice that arrived later');
select is(public.undo_captured_purchase(current_setting('t.n')::uuid,'first',false,'21953003-0000-0000-0000-0000000000b1')->>'outcome','undo','FR-016 the first attachment is undone first');
reset role;
select is((select record_only_stage||'/'||status::text from procurements where id=current_setting('t.n')::uuid),'invoiced/Vendor Invoiced','FR-016 while the second attachment stands the purchase stays invoiced');
set local role authenticated;
select is(public.undo_captured_purchase(current_setting('t.n')::uuid,'second',false,'21953003-0000-0000-0000-0000000000b2')->>'outcome','undo','FR-016 then the second');
reset role;
select is((select record_only_stage||'/'||status::text||'/'||(vendor_invoiced_at is null)::text from procurements where id=current_setting('t.n')::uuid),'ordered/Ordered/true',
  'FR-016 with no invoice left the purchase is back to its stage, status and invoiced date before the earliest attachment');
set local role authenticated;
select is(pg_temp.open(current_setting('t.n')::uuid),1000::numeric,'FR-016 and its commitment is the order''s 1000.00 again');
reset role;

-- AC-013: a later PMO step blocks both undos
set local role authenticated;
select is(pg_temp.apply(pg_temp.family(6,'{7}','21953003-0000-0000-0000-0000000000c3'))->>'outcome','create','AC-013 a family is placed');
reset role;
select pg_temp.queue_payment(pg_temp.purchase(6),pg_temp.d(7));
set local role authenticated;
select throws_ok(format($q$select public.undo_captured_purchase(%L,'x',false)$q$,pg_temp.purchase(6)),'55000','has_later_pmo_steps','AC-013 a queued payment blocks the undo');
select set_config('t.v',pg_temp.capture_order(11)::text,true);
select is(pg_temp.apply(pg_temp.family(11,'{12}','21953003-0000-0000-0000-0000000000a3'))->>'outcome','attach','AC-013 an invoice is attached');
reset role;
select pg_temp.queue_payment(current_setting('t.v')::uuid,pg_temp.d(12));
set local role authenticated;
select throws_ok($q$select public.undo_captured_purchase(current_setting('t.v')::uuid,'x',false,'21953003-0000-0000-0000-0000000000a3')$q$,'55000','has_later_pmo_steps','AC-013 a queued payment blocks the attachment undo');
reset role;
select is((select count(*)::int from procurement_erp_links where erp_purchase_document_id in (pg_temp.d(6),pg_temp.d(7),pg_temp.d(11),pg_temp.d(12))),4,'AC-013 nothing changed');

-- FR-017: a mark changed since the placement refuses the undo, for every invoice of the purchase at once
set local role authenticated;
select is(pg_temp.apply(pg_temp.family(8,'{9,10}','21953003-0000-0000-0000-0000000000c4'))->>'outcome','create','FR-017 a family with a noted invoice is placed');
reset role;
update erp_purchase_document_marks set note='edited since' where erp_purchase_document_id=pg_temp.d(10);
set local role authenticated;
select throws_ok(format($q$select public.undo_captured_purchase(%L,'x',false)$q$,pg_temp.purchase(8)),'55000','assignment_mark_changed','FR-017 a changed mark refuses the undo');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where family_request_id='21953003-0000-0000-0000-0000000000c4' and undone_at is null),2,'FR-017 neither decision was undone');
-- only an Admin undoes
update profiles set role='Finance' where id='21953003-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok(format($q$select public.undo_captured_purchase(%L,'x',false)$q$,pg_temp.purchase(8)),'42501',null,'FR-019 Finance cannot undo');
select throws_ok($q$select public.undo_captured_purchase(gen_random_uuid(),'x',false,gen_random_uuid())$q$,'42501',null,'FR-019 the role is checked before anything about the purchase or the attachment is said');
reset role;
update profiles set role='Admin' where id='21953003-0000-0000-0000-000000000002';
select is((select count(*)::int from external_command_outbox where org_id='21953003-0000-0000-0000-000000000001' and payload->>'erp_doc_kind'<>'payment'),0,'FR-012 nothing but the test''s own payments was queued');
select * from finish();
rollback;
