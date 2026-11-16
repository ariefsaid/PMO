-- #2277: a placed order family counts its untagged invoices' mapped ledger cost once, on the chosen project, and its open commitment once:
-- the order's value minus the linked invoices, read by the canonical readers. An attach adds to the captured purchase the order already has.
begin;
select plan(54);
insert into organizations(id,name,default_currency) values ('21953002-0000-0000-0000-000000000001','Family ledger org','USD');
insert into auth.users(id,email) values ('21953002-0000-0000-0000-000000000002','family-ledger@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21953002-0000-0000-0000-000000000002','21953002-0000-0000-0000-000000000001','Admin L','family-ledger@example.test','Admin','active');
insert into projects(id,org_id,name,status) values
 ('21953002-0000-0000-0000-00000000000a','21953002-0000-0000-0000-000000000001','Project P','Ongoing Project'),
 ('21953002-0000-0000-0000-00000000000b','21953002-0000-0000-0000-000000000001','Project Q','Ongoing Project'),
 ('21953002-0000-0000-0000-00000000000c','21953002-0000-0000-0000-000000000001','Project C','Ongoing Project');
insert into companies(id,org_id,name,type) values ('21953002-0000-0000-0000-000000000004','21953002-0000-0000-0000-000000000001','Supplier L','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21953002-0000-0000-0000-000000000001','companies','21953002-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21953002-0000-0000-0000-000000000005','21953002-0000-0000-0000-000000000001','erpnext','https://example.test','test',
  '{"company":"Example","project_map":{"21953002-0000-0000-0000-00000000000a":"PROJ-P","21953002-0000-0000-0000-00000000000b":"PROJ-Q"}}',now()-interval '1 hour','active');
insert into erp_capture_feed_witnesses(binding_id,org_id,feed_kind,started_at,completed,ledger_currency) values
 ('21953002-0000-0000-0000-000000000005','21953002-0000-0000-0000-000000000001','purchases',now(),true,null),
 ('21953002-0000-0000-0000-000000000005','21953002-0000-0000-0000-000000000001','ledger',now(),true,'USD');
insert into budget_category_account_map(org_id,category,erp_account) values ('21953002-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21953002-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21953002-0000-0000-0000-000000000099'),
 ('21953002-0000-0000-0000-000000000001','Example','Creditors','Creditors','Liability','Balance Sheet',false,'USD',3,4,'21953002-0000-0000-0000-000000000099');
-- a rule sends every untagged Cost line to Project C, so a placement on P visibly takes the cost off C
insert into cost_attribution_rules(id,org_id,rule_key,version,name,match_account,effective_from,specificity) values ('21953002-0000-0000-0000-0000000000d1','21953002-0000-0000-0000-000000000001','21953002-0000-0000-0000-0000000000d2',1,'Cost rule','Cost','2026-01-01',2);
insert into cost_attribution_rule_targets(rule_id,org_id,position,project_id,percent) values ('21953002-0000-0000-0000-0000000000d1','21953002-0000-0000-0000-000000000001',0,'21953002-0000-0000-0000-00000000000c',100);
-- the published tagged snapshot: P carries the 100 the ERP tags on PI-M2; newer than every ledger row
create function pg_temp.snap(p_id text,p_p numeric,p_q numeric default 0) returns void language sql as $$
 insert into erp_actuals_snapshot(org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
  ('21953002-0000-0000-0000-000000000001','21953002-0000-0000-0000-00000000000a','Cost','2026',p_p,now()+interval '1 day',p_id::uuid,clock_timestamp()),
  ('21953002-0000-0000-0000-000000000001','21953002-0000-0000-0000-00000000000b','Cost','2026',p_q,now()+interval '1 day',p_id::uuid,clock_timestamp()),
  ('21953002-0000-0000-0000-000000000001','21953002-0000-0000-0000-00000000000c','Cost','2026',0,now()+interval '1 day',p_id::uuid,clock_timestamp()) $$;
select pg_temp.snap('21953002-0000-0000-0000-0000000000e1',100);
create function pg_temp.d(n integer) returns uuid language sql immutable as $$ select ('21953002-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.doc(n integer,p_type text,p_name text,p_orders text[] default '{}',p_net numeric default 100,p_ids uuid[] default '{}',p_erp_project text default null) returns void language sql as $$
 insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,grand_total,net_total,erp_status,erp_docstatus,erp_project,project_ids,purchase_orders,erp_modified)
 values (pg_temp.d(n),'21953002-0000-0000-0000-000000000001',p_type,p_name,'SUP-1','Supplier L','USD',p_net,p_net,case when p_type='Purchase Invoice' then 'Unpaid' else 'To Bill' end,1,p_erp_project,p_ids,p_orders,'1') $$;
create function pg_temp.gl(p_voucher text,p_debit numeric,p_project text default null) returns void language sql as $$
 insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,fiscal_year,party_type,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
  ('21953002-0000-0000-0000-000000000001','GL-'||p_voucher||'-Cost','Example','Cost',p_project,'2026','Supplier','Purchase Invoice',p_voucher,'2026-02-01',p_debit,0,false,'1'),
  ('21953002-0000-0000-0000-000000000001','GL-'||p_voucher||'-Cred','Example','Creditors',p_project,'2026','Supplier','Purchase Invoice',p_voucher,'2026-02-01',0,p_debit,false,'1') $$;
create function pg_temp.family(p_order integer,p_invoices integer[],p_project uuid default '21953002-0000-0000-0000-00000000000a',p_request uuid default gen_random_uuid()) returns jsonb language sql as $$
 select jsonb_build_object('request_id',p_request,'decision','order_family','source_id',pg_temp.d(p_order),'project_id',p_project,
   'invoice_ids',(select jsonb_agg(pg_temp.d(i)) from unnest(p_invoices) i)) $$;
create function pg_temp.call(p_row jsonb,p_dry boolean) returns jsonb language sql as $$
 select public.assign_capture_invoices(jsonb_build_array(p_row),public.purchase_capture_source_page(null,null,1)->>'revision',p_dry)#>'{results,0}' $$;
create function pg_temp.act(p_project uuid) returns numeric language sql as $$ select actuals_to_date from public.project_mapped_actuals(p_project) where category='Materials' $$;
create function pg_temp.org_act() returns numeric language sql as $$
 select pg_temp.act('21953002-0000-0000-0000-00000000000a')+pg_temp.act('21953002-0000-0000-0000-00000000000b')+pg_temp.act('21953002-0000-0000-0000-00000000000c') $$;
create function pg_temp.open(p_purchase uuid) returns numeric language sql as $$ select c.amount from public.procurement_open_commitments(array[p_purchase]) c $$;
create function pg_temp.purchase(n integer) returns uuid language sql as $$ select procurement_id from procurement_erp_links where erp_purchase_document_id=pg_temp.d(n) $$;
create function pg_temp.counts() returns text language sql as $$
 select concat_ws('/',(select count(*) from erp_capture_invoice_assignments where org_id='21953002-0000-0000-0000-000000000001'),
   (select count(*) from procurement_erp_links where org_id='21953002-0000-0000-0000-000000000001'),
   (select count(*) from procurements where org_id='21953002-0000-0000-0000-000000000001'),
   (select count(*) from erp_purchase_captures where org_id='21953002-0000-0000-0000-000000000001'),
   (select count(*) from audit_events where org_id='21953002-0000-0000-0000-000000000001' and action like 'procurement.%')) $$;
-- an order that is captured on its own, as the capture route records it: linked, then marked record-only with its capture row
create function pg_temp.capture_order(n integer,p_project uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
 v := (public.link_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_name',(select erp_name from erp_purchase_documents where id=pg_temp.d(n)),
   'erp_doctype','Purchase Order','project_id',p_project)),false)#>>'{results,0,procurement_id}')::uuid;
 execute 'reset role';
 update procurements set record_only=true,record_only_stage='ordered',record_only_reference=(select erp_name from erp_purchase_documents where id=pg_temp.d(n)) where id=v;
 insert into erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
  values ('21953002-0000-0000-0000-000000000001','21953002-0000-0000-0000-000000000005',gen_random_uuid(),v,jsonb_build_object('source_ids',jsonb_build_array(pg_temp.d(n))),'order','ordered','21953002-0000-0000-0000-000000000002');
 execute 'set local role authenticated';
 return v;
end $$;

select pg_temp.doc(1,'Purchase Order','PO-1',p_net=>1000);
select pg_temp.doc(2,'Purchase Invoice','PI-1',array['PO-1'],600); select pg_temp.gl('PI-1',600);
select pg_temp.doc(3,'Purchase Order','PO-W',p_net=>1000);
select pg_temp.doc(4,'Purchase Invoice','PI-W',array['PO-W'],600); select pg_temp.gl('PI-W',600);
select pg_temp.doc(5,'Purchase Order','PO-O',p_net=>1000);
select pg_temp.doc(6,'Purchase Invoice','PI-O',array['PO-O'],100); select pg_temp.gl('PI-O',100);
select pg_temp.doc(7,'Purchase Order','PO-Q2',p_net=>1000);
select pg_temp.doc(8,'Purchase Invoice','PI-Q2',array['PO-Q2'],100); select pg_temp.gl('PI-Q2',100);
select pg_temp.doc(9,'Purchase Order','PO-M',p_net=>500);
select pg_temp.doc(10,'Purchase Invoice','PI-M1',array['PO-M'],200); select pg_temp.gl('PI-M1',200);
select pg_temp.doc(11,'Purchase Invoice','PI-M2',array['PO-M'],100,array['21953002-0000-0000-0000-00000000000a'::uuid],'PROJ-P'); select pg_temp.gl('PI-M2',100,'PROJ-P');
select pg_temp.doc(12,'Purchase Invoice','PI-B',p_net=>50); select pg_temp.gl('PI-B',50);
select pg_temp.doc(20+g,'Purchase Order','PO-F'||g,p_net=>1000), pg_temp.doc(30+g,'Purchase Invoice','PI-F'||g,array['PO-F'||g],100), pg_temp.gl('PI-F'||g,100) from generate_series(1,5) g;
insert into companies(id,org_id,name,type) values ('21953002-0000-0000-0000-000000000006','21953002-0000-0000-0000-000000000001','Other vendor','Vendor');

set local role authenticated;
set local request.jwt.claims = '{"sub":"21953002-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('t.p0',pg_temp.act('21953002-0000-0000-0000-00000000000a')::text,true);
select set_config('t.c0',pg_temp.act('21953002-0000-0000-0000-00000000000c')::text,true);
select set_config('t.org0',pg_temp.org_act()::text,true);
-- AC-010: the preview says what an apply would do, and leaves nothing behind
select set_config('t.counts',pg_temp.counts(),true);
select set_config('t.preview',pg_temp.call(pg_temp.family(1,'{2}'),true)::text,true);
select is(current_setting('t.preview')::jsonb->>'outcome','create','AC-010 the preview shows a create');
select is(current_setting('t.preview')::jsonb->>'procurement_id',null,'AC-010 a new purchase has no id in a preview');
select is(current_setting('t.preview')::jsonb->>'commitment_before','0','AC-010 the commitment before is 0: there is no purchase yet');
select is(current_setting('t.preview')::jsonb->>'commitment_after','400.00','AC-010 the commitment after is the order less the invoice, as the readers give it');
select is(current_setting('t.preview')::jsonb#>>'{invoices,0,mapped_amount}','600','AC-010 the preview gives the invoice''s mapped ledger amount');
select is(current_setting('t.preview')::jsonb#>>'{invoices,0,prior_placement,0,project_id}','21953002-0000-0000-0000-00000000000c','AC-010 and the project the rule places it on now');
select is(pg_temp.counts(),current_setting('t.counts'),'AC-010 afterwards no decision, link, purchase, capture or audit row exists');
-- AC-001 / AC-002: apply
select is(pg_temp.call(pg_temp.family(1,'{2}',p_request=>'21953002-0000-0000-0000-0000000000c1'),false)->>'outcome','create','AC-001 one purchase is created');
select is((select count(*)||'/'||count(distinct l.procurement_id) from procurement_erp_links l where l.erp_purchase_document_id in (pg_temp.d(1),pg_temp.d(2))),'2/1','AC-001 the order and its invoice are both linked, to one purchase');
select is(pg_temp.act('21953002-0000-0000-0000-00000000000a')-current_setting('t.p0')::numeric,600::numeric,'AC-001 P gains the invoice''s ledger cost, 600.00');
select is(pg_temp.open(pg_temp.purchase(1)),400::numeric,'AC-001 P keeps 400.00 open on the purchase');
select is(pg_temp.act('21953002-0000-0000-0000-00000000000c')-current_setting('t.c0')::numeric,-600::numeric,'AC-002 the rule''s project loses the 600.00');
select is(pg_temp.org_act(),current_setting('t.org0')::numeric,'AC-002 the organization''s mapped actuals are unchanged');
reset role;
select is((select record_only::text||'/'||record_only_stage||'/'||project_id::text||'/'||total_value::text||'/'||record_only_reference from procurements where id=pg_temp.purchase(1)),
  'true/invoiced/21953002-0000-0000-0000-00000000000a/1000.00/PO-1','FR-008 the purchase is record-only, invoiced, on P, at the order''s value');
select is((select vendor_id from procurements where id=pg_temp.purchase(1)),'21953002-0000-0000-0000-000000000004'::uuid,'FR-008 the purchase carries the order''s vendor');
select is((select count(*)::int from external_command_outbox where org_id='21953002-0000-0000-0000-000000000001'),0,'AC-001 nothing is queued for the ERP');
-- MC-6: the purchase stays record-only; no forward step, no child record
select throws_ok($$update procurements set status='Paid' where id=pg_temp.purchase(1)$$,'42501',null,'MC-6 a forward status change on the purchase is refused');
select throws_ok($$insert into purchase_orders(org_id,procurement_id) values ('21953002-0000-0000-0000-000000000001',pg_temp.purchase(1))$$,'42501',null,'MC-6 a PMO order on the purchase is refused');

-- AC-003: attach to the captured purchase the order already has
set local role authenticated;
select set_config('t.w',pg_temp.capture_order(3,'21953002-0000-0000-0000-00000000000a')::text,true);
select is(pg_temp.open(current_setting('t.w')::uuid),1000::numeric,'AC-003 before: the captured order holds 1000.00 open');
select set_config('t.p1',pg_temp.act('21953002-0000-0000-0000-00000000000a')::text,true);
select set_config('t.nproc',(select count(*) from procurements where org_id='21953002-0000-0000-0000-000000000001')::text,true);
select set_config('t.attach',pg_temp.call(pg_temp.family(3,'{4}'),true)::text,true);
select is(current_setting('t.attach')::jsonb->>'outcome','attach','AC-003 the preview shows an attach');
select is(current_setting('t.attach')::jsonb->>'procurement_id',current_setting('t.w'),'AC-003 to the captured purchase');
select is((current_setting('t.attach')::jsonb->>'commitment_before')||' -> '||(current_setting('t.attach')::jsonb->>'commitment_after'),'1000.00 -> 400.00','AC-003 the preview gives the commitment before and after, as the readers give them');
select is(pg_temp.call(pg_temp.family(3,'{4}'),false)->>'outcome','attach','AC-003 the invoice is attached');
select is(pg_temp.purchase(4),current_setting('t.w')::uuid,'AC-003 the captured purchase links the order and the invoice');
select is(pg_temp.open(current_setting('t.w')::uuid),400::numeric,'AC-003 its open commitment is 400.00');
select is(pg_temp.act('21953002-0000-0000-0000-00000000000a')-current_setting('t.p1')::numeric,600::numeric,'AC-003 P gains 600.00');
select is((select count(*) from procurements where org_id='21953002-0000-0000-0000-000000000001')::text,current_setting('t.nproc'),'AC-003 no new purchase exists');
reset role;
select is((select record_only::text||'/'||record_only_stage||'/'||status::text from procurements where id=current_setting('t.w')::uuid),'true/invoiced/Vendor Invoiced','AC-003 the purchase stays record-only and is invoiced');
select is((select count(*)::int from audit_events where action='procurement.erp_family_attach' and entity_id=current_setting('t.w')::uuid and detail->>'family'='true'),1,'FR-010 the attach is audited');
-- AC-006: an order in a purchase raised in PMO, or in a purchase on another project
set local role authenticated;
select set_config('t.o',(public.link_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_name','PO-O','erp_doctype','Purchase Order','project_id','21953002-0000-0000-0000-00000000000a')),false)#>>'{results,0,procurement_id}'),true);
select is(pg_temp.call(pg_temp.family(5,'{6}'),true)->>'reason','ordinary_purchase_requires_decision','AC-006 an order in a purchase PMO runs is refused');
select pg_temp.capture_order(7,'21953002-0000-0000-0000-00000000000b');
select is(pg_temp.call(pg_temp.family(7,'{8}'),true)->>'reason','family_conflict','AC-006 an order captured on another project is refused');
select is(pg_temp.call(pg_temp.family(7,'{8}','21953002-0000-0000-0000-00000000000b'),true)->>'outcome','attach','AC-006 the same family attaches on its own project');

-- AC-016 / AC-014: an untagged and a same-project tagged invoice; then the ERP tags the untagged one
select set_config('t.p2',pg_temp.act('21953002-0000-0000-0000-00000000000a')::text,true);
select set_config('t.org2',pg_temp.org_act()::text,true);
select is(pg_temp.call(pg_temp.family(9,'{10,11}',p_request=>'21953002-0000-0000-0000-0000000000c2'),false)->>'outcome','create','AC-016 the mixed family is placed');
select is(pg_temp.act('21953002-0000-0000-0000-00000000000a')-current_setting('t.p2')::numeric,200::numeric,'AC-016 P gains the untagged invoice''s 200.00 only');
select is(pg_temp.org_act(),current_setting('t.org2')::numeric,'AC-016 the organization''s actuals are unchanged: the tagged invoice was already P''s');
select is(pg_temp.open(pg_temp.purchase(9)),200::numeric,'AC-016 the order''s 500.00 less both invoices is open');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where family_request_id='21953002-0000-0000-0000-0000000000c2' and undone_at is null),1,'AC-016 only the untagged invoice has a decision');
update erp_gl_entry_mirror set project='PROJ-P' where voucher_no='PI-M1';
select pg_temp.snap('21953002-0000-0000-0000-0000000000e2',300);
set local role authenticated;
select is(pg_temp.act('21953002-0000-0000-0000-00000000000a')-current_setting('t.p2')::numeric,200::numeric,'AC-014 once the ERP tags it with P, P still counts it once');
reset role;
update erp_gl_entry_mirror set project='PROJ-Q' where voucher_no='PI-M1';
set local role authenticated;
select is((select r->>'tagged_in_erp' from jsonb_array_elements(public.purchase_capture_assignment_report(null)->'assignments') r where r->>'source'='PI-M1'),'true','AC-014 a tag the ERP sets later is reported');
select is((select r->>'erp_project_id' from jsonb_array_elements(public.purchase_capture_assignment_report(null)->'assignments') r where r->>'source'='PI-M1'),'21953002-0000-0000-0000-00000000000b','AC-014 with the PMO project the ERP names');
-- FR-018: the report names the family of a family decision, and none for a B1 decision
select is((select (r->>'family_request_id')||'/'||(r->>'family_order_id') from jsonb_array_elements(public.purchase_capture_assignment_report(null)->'assignments') r where r->>'source'='PI-1'),
  '21953002-0000-0000-0000-0000000000c1/'||pg_temp.d(1)::text,'FR-018 a family decision names its request and order');
select is(public.assign_capture_invoices(jsonb_build_array(jsonb_build_object('request_id',gen_random_uuid(),'source_id',pg_temp.d(12),'decision','project','project_id','21953002-0000-0000-0000-00000000000a')),
  public.purchase_capture_source_page(null,null,1)->>'revision',false)#>>'{results,0,outcome}','create','FR-018 a B1 decision is still placed');
select is((select coalesce(r->>'family_request_id','none')||'/'||coalesce(r->>'family_order_id','none') from jsonb_array_elements(public.purchase_capture_assignment_report(null)->'assignments') r where r->>'source'='PI-B'),
  'none/none','FR-018 a B1 decision names no family');
reset role;

-- FR-009: each way the order's captured purchase can fail to take the invoices is refused family_conflict
set local role authenticated;
select set_config('t.f'||g,pg_temp.capture_order(20+g,'21953002-0000-0000-0000-00000000000a')::text,true) from generate_series(1,5) g;
reset role;
create function pg_temp.unlock(p uuid,p_set text) returns void language plpgsql as $$
begin
 update procurements set record_only=false where id=p;
 execute format('update procurements set %s where id=%L',p_set,p);
 update procurements set record_only=true where id=p;
end $$;
select pg_temp.unlock(current_setting('t.f1')::uuid,'status=''Cancelled''');
select pg_temp.unlock(current_setting('t.f2')::uuid,'currency=''EUR''');
select pg_temp.unlock(current_setting('t.f3')::uuid,'vendor_id=''21953002-0000-0000-0000-000000000006''');
delete from erp_purchase_captures where procurement_id=current_setting('t.f4')::uuid;
insert into erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
 values ('21953002-0000-0000-0000-000000000001','21953002-0000-0000-0000-000000000005',gen_random_uuid(),current_setting('t.f5')::uuid,'{}','journal','paid','21953002-0000-0000-0000-000000000002');
set local role authenticated;
select is(pg_temp.call(pg_temp.family(21,'{31}'),true)->>'reason','family_conflict','FR-009 a cancelled captured purchase takes no invoices');
select is(pg_temp.call(pg_temp.family(22,'{32}'),true)->>'reason','family_conflict','FR-009 a captured purchase in another currency takes no invoices');
select is(pg_temp.call(pg_temp.family(23,'{33}'),true)->>'reason','family_conflict','FR-009 a captured purchase of another vendor takes no invoices');
select is(pg_temp.call(pg_temp.family(24,'{34}'),true)->>'reason','family_conflict','FR-009 a record-only purchase with no capture row takes no invoices');
select is(pg_temp.call(pg_temp.family(25,'{35}'),true)->>'reason','family_conflict','FR-009 a journal capture takes no invoices');
reset role;

-- FR-011: the stage reads paid only when every linked invoice is known to be paid; an unknown status is never paid
select is(public.capture_family_stage('21953002-0000-0000-0000-000000000001',pg_temp.purchase(9)),'invoiced','FR-011 two unpaid invoices: invoiced');
update erp_purchase_documents set erp_status='Paid' where id=pg_temp.d(10);
update erp_purchase_documents set erp_status=null where id=pg_temp.d(11);
select is(public.capture_family_stage('21953002-0000-0000-0000-000000000001',pg_temp.purchase(9)),'part_paid','FR-011 one paid and one of unknown status: part paid, not paid');
update erp_purchase_documents set erp_status='Paid' where id=pg_temp.d(11);
select is(public.capture_family_stage('21953002-0000-0000-0000-000000000001',pg_temp.purchase(9)),'paid','FR-011 both paid: paid');
select is(public.capture_family_stage('21953002-0000-0000-0000-000000000001',current_setting('t.w')::uuid),'invoiced','FR-011 the attached purchase''s unpaid invoice: invoiced');
select is(public.capture_family_stage('21953002-0000-0000-0000-000000000001',current_setting('t.f4')::uuid),null,'FR-011 a purchase with no linked invoice has no invoice stage');
select ok(not has_function_privilege('authenticated','public.capture_family_stage(uuid,uuid)','execute') and not has_function_privilege('anon','public.capture_family_stage(uuid,uuid)','execute'),'FR-019 the stage helper is internal');
select * from finish();
rollback;
