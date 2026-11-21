-- #2277: an active Admin places an ERP purchase order and every invoice that bills it on one project. Row shape, the order and family
-- checks, B1's invoice checks inside a family, replay, roles and the reviewed revision. The race section uses committed fixtures in a second session.
begin;
select plan(74);
create extension if not exists dblink with schema extensions;
insert into organizations(id,name,default_currency) values
 ('21953001-0000-0000-0000-000000000001','Family org','USD'),
 ('21953001-0000-0000-0000-000000000002','Other family org','USD');
insert into auth.users(id,email) values
 ('21953001-0000-0000-0000-000000000003','family-a@example.test'),
 ('21953001-0000-0000-0000-000000000004','family-b@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('21953001-0000-0000-0000-000000000003','21953001-0000-0000-0000-000000000001','Admin A','family-a@example.test','Admin','active'),
 ('21953001-0000-0000-0000-000000000004','21953001-0000-0000-0000-000000000002','Admin B','family-b@example.test','Admin','active');
insert into projects(id,org_id,name,status) values
 ('21953001-0000-0000-0000-000000000005','21953001-0000-0000-0000-000000000001','Project P','Ongoing Project'),
 ('21953001-0000-0000-0000-000000000006','21953001-0000-0000-0000-000000000001','Project Q','Ongoing Project'),
 ('21953001-0000-0000-0000-000000000007','21953001-0000-0000-0000-000000000002','Project B','Ongoing Project');
insert into companies(id,org_id,name,type) values
 ('21953001-0000-0000-0000-000000000008','21953001-0000-0000-0000-000000000001','Supplier A','Vendor'),
 ('21953001-0000-0000-0000-000000000009','21953001-0000-0000-0000-000000000001','Supplier Two','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('21953001-0000-0000-0000-000000000001','companies','21953001-0000-0000-0000-000000000008','erpnext','Supplier:SUP-1'),
 ('21953001-0000-0000-0000-000000000001','companies','21953001-0000-0000-0000-000000000009','erpnext','Supplier:SUP-2');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21953001-0000-0000-0000-00000000000a','21953001-0000-0000-0000-000000000001','erpnext','https://example.test','test','{"company":"Example"}',now()-interval '1 hour','active'),
 ('21953001-0000-0000-0000-00000000000b','21953001-0000-0000-0000-000000000002','erpnext','https://example.test','test','{"company":"Example"}',now()-interval '1 hour','active');
-- the feed is current and the ledger currency known: completed witnesses, not a replaced health function
insert into erp_capture_feed_witnesses(binding_id,org_id,feed_kind,started_at,completed,ledger_currency) values
 ('21953001-0000-0000-0000-00000000000a','21953001-0000-0000-0000-000000000001','purchases',now(),true,null),
 ('21953001-0000-0000-0000-00000000000a','21953001-0000-0000-0000-000000000001','ledger',now(),true,'USD');
insert into budget_category_account_map(org_id,category,erp_account) values ('21953001-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21953001-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21953001-0000-0000-0000-000000000099'),
 ('21953001-0000-0000-0000-000000000001','Example','Fixed Assets','Fixed Assets','Asset','Balance Sheet',false,'USD',3,4,'21953001-0000-0000-0000-000000000099'),
 ('21953001-0000-0000-0000-000000000001','Example','Creditors','Creditors','Liability','Balance Sheet',false,'USD',5,6,'21953001-0000-0000-0000-000000000099');
-- the latest tagged snapshot is newer than every ledger row below (one row is made newer on purpose)
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21953001-0000-0000-0000-000000000001','21953001-0000-0000-0000-0000000000e1',now()+interval '1 day',now());
create function pg_temp.d(n integer) returns uuid language sql immutable as $$ select ('21953001-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.doc(n integer,p_type text,p_name text,p_orders text[] default '{}',p_net numeric default 100,p_ids uuid[] default '{}',p_return boolean default false,
  p_supplier text default 'SUP-1',p_currency text default 'USD',p_status smallint default 1,p_erp_project text default null,p_org uuid default '21953001-0000-0000-0000-000000000001') returns void language sql as $$
 insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,grand_total,net_total,erp_status,erp_docstatus,is_return,erp_project,project_ids,purchase_orders,erp_modified)
 values (pg_temp.d(n),p_org,p_type,p_name,p_supplier,'Supplier A',p_currency,p_net,p_net,case when p_type='Purchase Invoice' then 'Unpaid' else 'To Bill' end,p_status,p_return,p_erp_project,p_ids,p_orders,'1') $$;
create function pg_temp.gl(p_voucher text,p_account text,p_debit numeric,p_project text default null) returns void language sql as $$
 insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
 values ('21953001-0000-0000-0000-000000000001','GL-'||p_voucher||'-'||p_account,'Example',p_account,p_project,'Purchase Invoice',p_voucher,'2026-02-01',p_debit,0,false,'1') $$;
-- one family row for Project P (or another project), built from the fixture ids
create function pg_temp.family(p_order integer,p_invoices integer[],p_project uuid default '21953001-0000-0000-0000-000000000005',p_request uuid default gen_random_uuid()) returns jsonb language sql as $$
 select jsonb_build_object('request_id',p_request,'decision','order_family','source_id',pg_temp.d(p_order),'project_id',p_project,
   'invoice_ids',(select coalesce(jsonb_agg(pg_temp.d(i)),'[]'::jsonb) from unnest(p_invoices) i)) $$;
create function pg_temp.rev() returns text language sql as $$ select public.purchase_capture_source_page(null,null,1)->>'revision' $$;
create function pg_temp.run(p_rows jsonb,p_dry boolean,p_revision text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 select public.assign_capture_invoices(p_rows,coalesce(p_revision,pg_temp.rev()),p_dry) into v;
 return v;
end $$;
create function pg_temp.preview_row(p_row jsonb) returns jsonb language sql as $$ select pg_temp.run(jsonb_build_array(p_row),true)#>'{results,0}' $$;
create function pg_temp.apply_row(p_row jsonb) returns jsonb language sql as $$ select pg_temp.run(jsonb_build_array(p_row),false)#>'{results,0}' $$;
-- the outcome, or the error a malformed batch raises
create function pg_temp.preview(p_row jsonb) returns text language plpgsql as $$
declare v jsonb;
begin
 v := pg_temp.run(jsonb_build_array(p_row),true);
 return v#>>'{results,0,outcome}';
exception when others then return sqlstate || ':' || sqlerrm;
end $$;

-- documents (fixture number: kind name, what it is)
select pg_temp.doc(1,'Purchase Order','PO-1',p_net=>1000);
select pg_temp.doc(2,'Purchase Invoice','PI-1',array['PO-1'],600); select pg_temp.gl('PI-1','Cost',600);
select pg_temp.doc(3,'Purchase Invoice','PI-2',array['PO-1'],300); select pg_temp.gl('PI-2','Cost',300);
select pg_temp.doc(4,'Purchase Order','PO-Q',p_ids=>array['21953001-0000-0000-0000-000000000006'::uuid],p_erp_project=>'PROJ-Q');
select pg_temp.doc(5,'Purchase Invoice','PI-Q',array['PO-Q']); select pg_temp.gl('PI-Q','Cost',100);
select pg_temp.doc(6,'Purchase Order','PO-R');
select pg_temp.doc(7,'Purchase Invoice','PI-R',array['PO-R']); select pg_temp.gl('PI-R','Cost',100);
select pg_temp.doc(8,'Purchase Invoice','PI-RR',array['PO-R'],p_return=>true);
select pg_temp.doc(9,'Purchase Order','PO-2');
select pg_temp.doc(10,'Purchase Invoice','PI-X',array['PO-2','PO-3']); select pg_temp.gl('PI-X','Cost',100);
select pg_temp.doc(11,'Purchase Order','PO-3');
select pg_temp.doc(12,'Purchase Order','PO-C');
select pg_temp.doc(13,'Purchase Invoice','PI-C',array['PO-C']); select pg_temp.gl('PI-C','Fixed Assets',100);
select pg_temp.doc(14,'Purchase Order','PO-S');
select pg_temp.doc(15,'Purchase Invoice','PI-S',array['PO-S']); select pg_temp.gl('PI-S','Cost',100);
update erp_gl_entry_mirror set as_of=now()+interval '3 days' where voucher_no='PI-S';
select pg_temp.doc(16,'Purchase Order','PO-M',p_net=>500);
select pg_temp.doc(17,'Purchase Invoice','PI-M1',array['PO-M'],200); select pg_temp.gl('PI-M1','Cost',200);
select pg_temp.doc(18,'Purchase Invoice','PI-M2',array['PO-M'],100,array['21953001-0000-0000-0000-000000000005'::uuid],p_erp_project=>'PROJ-P'); select pg_temp.gl('PI-M2','Cost',100,'PROJ-P');
select pg_temp.doc(19,'Purchase Order','PO-V');
select pg_temp.doc(20,'Purchase Invoice','PI-V',array['PO-V'],p_supplier=>'SUP-2'); select pg_temp.gl('PI-V','Cost',100);
select pg_temp.doc(21,'Purchase Order','PO-E',p_currency=>'EUR');
select pg_temp.doc(22,'Purchase Invoice','PI-E',array['PO-E']); select pg_temp.gl('PI-E','Cost',100);
select pg_temp.doc(23,'Purchase Order','PO-U',p_supplier=>'SUP-9');
select pg_temp.doc(24,'Purchase Invoice','PI-U',array['PO-U'],p_supplier=>'SUP-9'); select pg_temp.gl('PI-U','Cost',100);
select pg_temp.doc(26,'Purchase Order','PO-D',p_status=>2::smallint);
select pg_temp.doc(27,'Purchase Order','PO-N',p_currency=>null);
select pg_temp.doc(28,'Purchase Order','PO-T',p_ids=>array['21953001-0000-0000-0000-000000000005'::uuid,'21953001-0000-0000-0000-000000000006'::uuid]);
select pg_temp.doc(29,'Purchase Order','PO-P',p_ids=>array['21953001-0000-0000-0000-000000000005'::uuid],p_erp_project=>'PROJ-P');
select pg_temp.doc(30,'Purchase Invoice','PI-P',array['PO-P']); select pg_temp.gl('PI-P','Cost',100);
select pg_temp.doc(31,'Purchase Order','PO-B',p_org=>'21953001-0000-0000-0000-000000000002');
select pg_temp.doc(32,'Purchase Order','PO-K');
select pg_temp.doc(33,'Purchase Invoice','PI-K',array['PO-K'],100,array['21953001-0000-0000-0000-000000000006'::uuid],p_erp_project=>'PROJ-Q');
select pg_temp.doc(34,'Purchase Order','PO-L');
select pg_temp.doc(35,'Purchase Invoice','PI-L',array['PO-L'],p_erp_project=>'UNMAPPED'); select pg_temp.gl('PI-L','Cost',100);
select pg_temp.doc(36,'Purchase Invoice','PI-S1'); select pg_temp.gl('PI-S1','Cost',100);
select pg_temp.doc(37,'Purchase Invoice','PI-S2'); select pg_temp.gl('PI-S2','Cost',100);
select pg_temp.doc(38,'Purchase Order','PO-Z');
select pg_temp.doc(39,'Purchase Invoice','PI-Z1',array['PO-Z']); select pg_temp.gl('PI-Z1','Cost',100);
select pg_temp.doc(40,'Purchase Invoice','PI-Z2',array['PO-Z']); select pg_temp.gl('PI-Z2','Cost',100);
select pg_temp.doc(41,'Purchase Order','PO-PMO');
select pg_temp.doc(42,'Purchase Invoice','PI-PMO',array['PO-PMO']); select pg_temp.gl('PI-PMO','Cost',100);
-- PO-PMO is an order PMO itself sent to the ERP: a live PMO order carries its ERP name
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values
 ('21953001-0000-0000-0000-0000000000b1','21953001-0000-0000-0000-000000000001','PMO order','21953001-0000-0000-0000-000000000003','USD',100,'Draft');
insert into purchase_orders(id,org_id,procurement_id,currency) values ('21953001-0000-0000-0000-0000000000b2','21953001-0000-0000-0000-000000000001','21953001-0000-0000-0000-0000000000b1','USD');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21953001-0000-0000-0000-000000000001','procurement','21953001-0000-0000-0000-0000000000b2','erpnext','PO-PMO');
-- PI-Z1 already holds an active placement (written here directly: B1 refuses an invoice that bills an order)
insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,actor_id)
 values ('21953001-0000-0000-0000-000000000001','21953001-0000-0000-0000-00000000000a',pg_temp.d(39),gen_random_uuid(),'x','project','21953001-0000-0000-0000-000000000005','21953001-0000-0000-0000-000000000003');

set local role authenticated;
set local request.jwt.claims = '{"sub":"21953001-0000-0000-0000-000000000003","role":"authenticated"}';
-- FR-001 / FR-002: row shape
select is(pg_temp.preview(pg_temp.family(1,'{2,3}') - 'invoice_ids'),'22023:invalid_assignment_row','FR-001 a family row needs invoice_ids');
select is(pg_temp.preview(pg_temp.family(1,'{2,3}') || '{"allow_capital_as_overhead":true}'::jsonb),'22023:invalid_assignment_row','FR-001 no capital override on a family row');
select is(pg_temp.preview(pg_temp.family(1,'{2,2}')),'22023:invalid_assignment_row','FR-001 invoice ids are distinct');
select is(pg_temp.preview(pg_temp.family(1,'{}')),'22023:invalid_assignment_row','FR-001 a family names at least one invoice');
select is(pg_temp.preview(pg_temp.family(1,(select array_agg(g) from generate_series(100,150) g))),'22023:invalid_assignment_row','FR-001 a family names at most 50 invoices');
select is(pg_temp.preview(pg_temp.family(1,'{2}') || '{"invoice_ids":["not-a-uuid"]}'::jsonb),'22023:invalid_assignment_row','FR-001 every invoice id is a UUID');
select is(pg_temp.preview(pg_temp.family(1,'{2}') - 'project_id'),'22023:invalid_assignment_row','FR-001 a family row names its project');
select is(pg_temp.preview(jsonb_build_object('request_id',gen_random_uuid(),'decision','project','source_id',pg_temp.d(2),'project_id','21953001-0000-0000-0000-000000000005','invoice_ids',jsonb_build_array(pg_temp.d(3)))),
  '22023:invalid_assignment_row','FR-001 only a family row carries invoice_ids');
select throws_ok($$select pg_temp.run(jsonb_build_array(pg_temp.family(1,'{2,3}'),jsonb_build_object('request_id',gen_random_uuid(),'source_id',pg_temp.d(2),'decision','project','project_id','21953001-0000-0000-0000-000000000005')),true)$$,
  '22023','duplicate_assignment_row','FR-002 an invoice of a family row cannot be another row''s source');
-- FR-003: the order
select is(pg_temp.preview_row(pg_temp.family(4,'{5}'))->>'reason','family_project_conflict','AC-006 an order tagged with another project is refused');
select is(pg_temp.preview_row(pg_temp.family(28,'{2}'))->>'reason','document_spans_projects','FR-003 an order on two projects is refused');
select is(pg_temp.preview_row(pg_temp.family(2,'{3}'))->>'reason','source_kind_unsupported','FR-003 the source must be a purchase order');
select is(pg_temp.preview_row(pg_temp.family(26,'{2}'))->>'reason','document_cancelled','FR-003 a cancelled order is refused');
select is(pg_temp.preview_row(pg_temp.family(27,'{2}'))->>'reason','currency_unknown','FR-003 an order with no currency is refused');
select is(pg_temp.preview_row(pg_temp.family(23,'{24}'))->>'reason','supplier_unknown','FR-003 an order whose supplier is no known vendor is refused');
select is(pg_temp.preview_row(pg_temp.family(41,'{42}'))->>'reason','document_recorded_by_pmo','FR-003 an order PMO itself sent to the ERP is refused');
select is(pg_temp.preview_row(pg_temp.family(41,'{36}'))->>'reason','document_recorded_by_pmo','FR-003 the order is checked before its family: a PMO order is refused whatever invoices are named');
select is(pg_temp.preview_row(pg_temp.family(38,'{39,40}'))->>'reason','family_incomplete','FR-004 a named invoice that already has a placement is not part of the open family');
select is(pg_temp.preview_row(pg_temp.family(38,'{39,40}'))->'extra_invoice_ids',jsonb_build_array(pg_temp.d(39)),'FR-004 it is returned as extra');
select is(pg_temp.preview_row(pg_temp.family(38,'{40}'))->>'outcome','create','FR-004 the family without it is complete');
select is(pg_temp.preview_row(pg_temp.family(31,'{2}'))->>'outcome','not_found','AC-015 another organization''s order is not found');
select is(pg_temp.preview_row(pg_temp.family(1,'{2,3}','21953001-0000-0000-0000-000000000007'))->>'outcome','not_found','AC-015 another organization''s project is not found');
-- FR-004 / FR-005: the family
select is(pg_temp.preview_row(pg_temp.family(1,'{2}'))->>'reason','family_incomplete','AC-004 every invoice of the order is named');
select is(pg_temp.preview_row(pg_temp.family(1,'{2}'))->'missing_invoice_ids',jsonb_build_array(pg_temp.d(3)),'AC-004 the missing invoice is returned');
select is(pg_temp.preview_row(pg_temp.family(1,'{2,3,10}'))->'extra_invoice_ids',jsonb_build_array(pg_temp.d(10)),'FR-004 an invoice of another order is returned as extra');
select is(pg_temp.preview_row(pg_temp.family(9,'{10}'))->>'reason','family_ambiguous','AC-005 an invoice billing two orders is refused');
select is(pg_temp.preview_row(pg_temp.family(6,'{7}'))->>'reason','family_has_return','AC-007 a return invoice in the family is refused');
select is(pg_temp.preview_row(pg_temp.family(19,'{20}'))->>'reason','supplier_mismatch','FR-005 an invoice from another supplier is refused');
select is(pg_temp.preview_row(pg_temp.family(21,'{22}'))->>'reason','currency_mismatch','FR-005 an invoice in another currency is refused');
select is(pg_temp.preview_row(pg_temp.family(32,'{33}'))->>'reason','family_project_conflict','FR-007 an invoice the ERP tags with another project is refused');
select is(pg_temp.preview_row(pg_temp.family(34,'{35}'))->>'reason','family_project_conflict','FR-007 an invoice with an unmapped ERP project is refused');
-- guard polarity: the AC-004 refusal is bound to the data, not to the number of invoices named
reset role;
savepoint polarity;
update erp_purchase_documents set purchase_orders='{}' where id=pg_temp.d(3);
set local role authenticated;
select is(pg_temp.preview_row(pg_temp.family(1,'{2}'))->>'outcome','create','AC-004 once PI-2 bills no order, PO-1 with PI-1 alone is complete');
reset role;
rollback to savepoint polarity;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21953001-0000-0000-0000-000000000003","role":"authenticated"}';
-- FR-006: B1's invoice checks, with B1's reasons
select is(pg_temp.preview_row(pg_temp.family(12,'{13}'))->>'reason','capital_spending_not_assignable','AC-008 an all-capital invoice is refused with B1''s reason');
select is(pg_temp.preview_row(pg_temp.family(14,'{15}'))->>'reason','snapshot_refresh_required','AC-008 a ledger newer than the snapshot is refused with B1''s reason');
select is(pg_temp.preview_row(pg_temp.family(16,'{17,18}'))->>'outcome','create','AC-016 a family of an untagged and a same-project tagged invoice previews a create');
select is((select jsonb_agg(i->'tagged' order by i->>'source_id') from jsonb_array_elements(pg_temp.preview_row(pg_temp.family(16,'{17,18}'))->'invoices') i),'[false,true]'::jsonb,'AC-016 the preview says which invoice the ERP already tags');
select is(pg_temp.preview_row(pg_temp.family(29,'{30}'))->>'outcome','create','FR-003 an order tagged with the chosen project is accepted');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where org_id='21953001-0000-0000-0000-000000000001' and source_document_id<>pg_temp.d(39))
  +(select count(*)::int from procurements where org_id='21953001-0000-0000-0000-000000000001' and id<>'21953001-0000-0000-0000-0000000000b1')
  +(select count(*)::int from procurement_erp_links where org_id='21953001-0000-0000-0000-000000000001')
  +(select count(*)::int from erp_purchase_captures where org_id='21953001-0000-0000-0000-000000000001'),0,'AC-010 previews and refusals write no decision, purchase, link or capture');

-- FR-008 / AC-009: apply, then replay
set local role authenticated;
set local request.jwt.claims = '{"sub":"21953001-0000-0000-0000-000000000003","role":"authenticated"}';
select set_config('f.apply',pg_temp.apply_row(pg_temp.family(1,'{2,3}',p_request=>'21953001-0000-0000-0000-0000000000c1'))::text,true);
select is(current_setting('f.apply')::jsonb->>'outcome','create','FR-008 a complete family applies as one new purchase');
select is(current_setting('f.apply')::jsonb->>'erp_write','false','FR-012 the result says nothing was written to the ERP');
select is(pg_temp.apply_row(pg_temp.family(1,'{2,3}',p_request=>'21953001-0000-0000-0000-0000000000c1'))->>'outcome','skip','AC-009 the same request resent unchanged is a skip');
select is(pg_temp.apply_row(pg_temp.family(1,'{2,3}',p_request=>'21953001-0000-0000-0000-0000000000c1'))->>'procurement_id',current_setting('f.apply')::jsonb->>'procurement_id','AC-009 the skip names the purchase');
select is(pg_temp.apply_row(pg_temp.family(1,'{2}',p_request=>'21953001-0000-0000-0000-0000000000c1'))->>'reason','request_conflict','AC-009 the same request with another invoice list is a conflict');
select is(pg_temp.run(jsonb_build_array(pg_temp.family(1,'{2,3}',p_request=>'21953001-0000-0000-0000-0000000000c1')),false,'an old revision')#>>'{results,0,outcome}','skip','AC-009 a batch of family retries needs no current revision');
select is(pg_temp.preview_row(pg_temp.family(1,'{2,3}'))->>'reason','family_incomplete','FR-014 a placed family cannot be placed again under a new request');
select is(pg_temp.preview_row(pg_temp.family(1,'{2,3}'))->'extra_invoice_ids',jsonb_build_array(pg_temp.d(2),pg_temp.d(3)),'FR-004 invoices already linked to the order''s purchase are extra');
-- item 2: a request id belongs to one kind of row; a retry is recognised by its own kind only
select set_config('f.old',pg_temp.rev(),true);
select is(pg_temp.apply_row(jsonb_build_object('request_id','21953001-0000-0000-0000-0000000000c2','source_id',pg_temp.d(36),'decision','project','project_id','21953001-0000-0000-0000-000000000005'))->>'outcome','create','FR-014 a B1 placement is applied');
select is(pg_temp.run(jsonb_build_array(jsonb_build_object('request_id','21953001-0000-0000-0000-0000000000c1','source_id',pg_temp.d(37),'decision','project','project_id','21953001-0000-0000-0000-000000000005')),false,current_setting('f.old'))->>'reason',
  'source_stale','FR-014 a B1 row reusing a family request is not a retry: an old revision stales it');
select is(pg_temp.apply_row(jsonb_build_object('request_id','21953001-0000-0000-0000-0000000000c1','source_id',pg_temp.d(37),'decision','project','project_id','21953001-0000-0000-0000-000000000005'))->>'reason',
  'request_conflict','FR-014 a B1 row reusing a family request is a conflict');
select is(pg_temp.run(jsonb_build_array(pg_temp.family(29,'{30}',p_request=>'21953001-0000-0000-0000-0000000000c2')),false,current_setting('f.old'))->>'reason',
  'source_stale','FR-014 a family row reusing a B1 request is not a retry: an old revision stales it');
select is(pg_temp.apply_row(pg_temp.family(29,'{30}',p_request=>'21953001-0000-0000-0000-0000000000c2'))->>'reason','request_conflict','FR-014 a family row reusing a B1 request is a conflict');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments a
   where a.family_request_id='21953001-0000-0000-0000-0000000000c1' and a.family_order_document_id=pg_temp.d(1) and a.decision='project'
     and a.project_id='21953001-0000-0000-0000-000000000005' and a.procurement_id=(current_setting('f.apply')::jsonb->>'procurement_id')::uuid
     and a.request_id=md5('21953001-0000-0000-0000-0000000000c1:'||a.source_document_id::text)::uuid and a.undone_at is null),2,'FR-008 one B1 project decision per invoice, naming the family request and order');
select is((select count(*)::int from erp_purchase_captures c where c.request_id=md5('21953001-0000-0000-0000-0000000000c1:family')::uuid
   and c.kind='supplier_invoice' and c.payload->>'mode'='create' and c.captured_by='21953001-0000-0000-0000-000000000003'),1,'FR-008 the purchase records its capture row');
select is((select count(*)::int from audit_events where org_id='21953001-0000-0000-0000-000000000001' and action='procurement.record_only_create' and detail->>'family'='true' and detail->>'erp_write'='false'),1,'FR-008 the create is audited as a family placement');
select is((select count(*)::int from external_command_outbox where org_id='21953001-0000-0000-0000-000000000001'),0,'FR-012 nothing is queued for the ERP');
select throws_ok($$update erp_capture_invoice_assignments set family_request_id=gen_random_uuid() where family_request_id='21953001-0000-0000-0000-0000000000c1'$$,'55000','assignment_decision_immutable','FR-008 a decision''s family is fixed at insert');
select throws_ok($$insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,actor_id,family_request_id)
   values ('21953001-0000-0000-0000-000000000001','21953001-0000-0000-0000-00000000000a',pg_temp.d(7),gen_random_uuid(),'x','set_aside','21953001-0000-0000-0000-000000000003',gen_random_uuid())$$,
  '23514',null,'FR-008 a family decision names both its request and its order, and is a project decision');

-- AC-015: only an active Admin
create function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin execute 'reset role'; update profiles set role=p_role::user_role where id='21953001-0000-0000-0000-000000000003'; execute 'set local role authenticated'; end $$;
select pg_temp.as_role('Finance');
select alike(pg_temp.preview(pg_temp.family(16,'{17,18}')),'42501:%','AC-015 Finance cannot place a family');
select pg_temp.as_role('Project Manager');
select alike(pg_temp.preview(pg_temp.family(16,'{17,18}')),'42501:%','AC-015 a Project Manager cannot place a family');
select pg_temp.as_role('Executive');
select alike(pg_temp.preview(pg_temp.family(16,'{17,18}')),'42501:%','AC-015 an Executive cannot place a family');
select pg_temp.as_role('Admin');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21953001-0000-0000-0000-000000000004","role":"authenticated"}';
select is(pg_temp.preview_row(pg_temp.family(16,'{17,18}'))->>'outcome','not_found','AC-015 another organization''s Admin does not find the order');
set local request.jwt.claims = '{"sub":"21953001-0000-0000-0000-000000000003","role":"authenticated"}';
-- AC-017: the reviewed revision
reset role;
set local role authenticated;
select set_config('f.rev',pg_temp.rev(),true);
reset role;
update erp_purchase_documents set erp_modified='2' where id=pg_temp.d(30);
set local role authenticated;
select is(pg_temp.run(jsonb_build_array(pg_temp.family(16,'{17,18}')),false,current_setting('f.rev'))->>'reason','source_stale','AC-017 a source change between preview and apply stales the apply');
select is(pg_temp.apply_row(pg_temp.family(16,'{17,18}'))->>'outcome','create','AC-016 the mixed family applies on a current revision');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where source_document_id in (pg_temp.d(17),pg_temp.d(18)) and undone_at is null),1,'AC-016 only the untagged invoice gets a decision');
select is((select count(distinct procurement_id)::int from procurement_erp_links where erp_purchase_document_id in (pg_temp.d(16),pg_temp.d(17),pg_temp.d(18))),1,'AC-016 the order and both invoices sit in one purchase');
select is((select count(*)::int from procurement_erp_links where erp_purchase_document_id in (pg_temp.d(16),pg_temp.d(17),pg_temp.d(18))),3,'AC-016 all three are linked');
-- FR-019: grants
select ok(has_function_privilege('authenticated','public.undo_captured_purchase(uuid,text,boolean,uuid)','execute')
  and not has_function_privilege('anon','public.undo_captured_purchase(uuid,text,boolean,uuid)','execute'),'FR-019 only signed-in callers may execute the undo');
select ok(not has_function_privilege('authenticated','public.capture_assignment_family(uuid,uuid,uuid,jsonb,text,boolean,jsonb)','execute')
  and not has_function_privilege('anon','public.capture_assignment_family(uuid,uuid,uuid,jsonb,text,boolean,jsonb)','execute')
  and not has_function_privilege('service_role','public.capture_assignment_family(uuid,uuid,uuid,jsonb,text,boolean,jsonb)','execute'),'FR-019 the family helper is not callable by any API role');
select ok(not has_function_privilege('authenticated','public.capture_assignment_validate(uuid,uuid,jsonb,uuid,jsonb,text)','execute')
  and not has_function_privilege('service_role','public.capture_assignment_validate(uuid,uuid,jsonb,uuid,jsonb,text)','execute'),'FR-019 the validator is not callable by any API role');
select is((select count(*)::int from pg_proc where proname='undo_captured_purchase' and pronamespace='public'::regnamespace),1,'FR-019 one undo function, so the API sees one signature');

-- AC-021: two sessions place the same family; the later one waits, then is refused, and the order sits in one purchase
create function pg_temp.race_cleanup() returns text language sql as $f$ select $cleanup$
delete from audit_events where org_id='21953001-2000-0000-0000-000000000001';
delete from procurement_status_events where org_id='21953001-2000-0000-0000-000000000001';
delete from erp_purchase_captures where org_id='21953001-2000-0000-0000-000000000001';
delete from procurement_erp_links where org_id='21953001-2000-0000-0000-000000000001';
delete from erp_capture_invoice_assignments where org_id='21953001-2000-0000-0000-000000000001';
delete from procurements where org_id='21953001-2000-0000-0000-000000000001';
delete from procurement_doc_counters where org_id='21953001-2000-0000-0000-000000000001';
delete from erp_gl_entry_mirror where org_id='21953001-2000-0000-0000-000000000001';
delete from erp_purchase_documents where org_id='21953001-2000-0000-0000-000000000001';
delete from erp_actuals_snapshot where org_id='21953001-2000-0000-0000-000000000001';
delete from erp_account_mirror where org_id='21953001-2000-0000-0000-000000000001';
delete from budget_category_account_map where org_id='21953001-2000-0000-0000-000000000001';
delete from erp_capture_feed_witnesses where org_id='21953001-2000-0000-0000-000000000001';
delete from external_refs where org_id='21953001-2000-0000-0000-000000000001';
delete from external_org_bindings where org_id='21953001-2000-0000-0000-000000000001';
delete from companies where org_id='21953001-2000-0000-0000-000000000001';
delete from projects where org_id='21953001-2000-0000-0000-000000000001';
delete from profiles where org_id='21953001-2000-0000-0000-000000000001';
delete from auth.users where id='21953001-2000-0000-0000-000000000002';
delete from organizations where id='21953001-2000-0000-0000-000000000001';
$cleanup$::text $f$;
select dblink_connect('family_race',format('dbname=%s user=%s password=postgres host=%s port=%s',current_database(),current_user,coalesce(host(inet_server_addr()),'supabase_db_pmo-portal'),coalesce(inet_server_port(),5432)));
-- a run that stopped before its cleanup leaves the committed fixture behind: remove it first
select dblink_exec('family_race',pg_temp.race_cleanup());
select dblink_exec('family_race',$setup$
insert into organizations(id,name,default_currency) values ('21953001-2000-0000-0000-000000000001','Family race','USD');
insert into auth.users(id,email) values ('21953001-2000-0000-0000-000000000002','family-race@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21953001-2000-0000-0000-000000000002','21953001-2000-0000-0000-000000000001','Admin','family-race@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('21953001-2000-0000-0000-000000000003','21953001-2000-0000-0000-000000000001','Race project','Ongoing Project');
insert into companies(id,org_id,name,type) values ('21953001-2000-0000-0000-000000000004','21953001-2000-0000-0000-000000000001','Race supplier','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21953001-2000-0000-0000-000000000001','companies','21953001-2000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21953001-2000-0000-0000-000000000005','21953001-2000-0000-0000-000000000001','erpnext','https://example.test','test','{"company":"Example"}',now()-interval '1 hour','active');
insert into erp_capture_feed_witnesses(binding_id,org_id,feed_kind,started_at,completed,ledger_currency) values
 ('21953001-2000-0000-0000-000000000005','21953001-2000-0000-0000-000000000001','purchases',now(),true,null),
 ('21953001-2000-0000-0000-000000000005','21953001-2000-0000-0000-000000000001','ledger',now(),true,'USD');
insert into budget_category_account_map(org_id,category,erp_account) values ('21953001-2000-0000-0000-000000000001','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values ('21953001-2000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21953001-2000-0000-0000-000000000099');
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21953001-2000-0000-0000-000000000001','21953001-2000-0000-0000-0000000000e1',now()+interval '1 day',now());
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,grand_total,net_total,erp_status,erp_docstatus,purchase_orders,erp_modified) values
 ('21953001-2000-0000-0000-000000000006','21953001-2000-0000-0000-000000000001','Purchase Order','RACE-PO','SUP-1','Race supplier','USD',1000,1000,'To Bill',1,'{}','1'),
 ('21953001-2000-0000-0000-000000000007','21953001-2000-0000-0000-000000000001','Purchase Invoice','RACE-PI','SUP-1','Race supplier','USD',600,600,'Unpaid',1,'{RACE-PO}','1');
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values ('21953001-2000-0000-0000-000000000001','GL-RACE','Example','Cost','Purchase Invoice','RACE-PI','2026-02-01',600,0,false,'1');
$setup$);
create function pg_temp.race_apply(p_request text) returns text language sql as $$
 select format($q$select public.assign_capture_invoices(jsonb_build_array(jsonb_build_object('request_id','%s','decision','order_family','source_id','21953001-2000-0000-0000-000000000006',
   'project_id','21953001-2000-0000-0000-000000000003','invoice_ids',jsonb_build_array('21953001-2000-0000-0000-000000000007'))),
   public.purchase_capture_source_page(null,null,1)->>'revision',false)#>>'{results,0}'$q$,p_request) $$;
select dblink_exec('family_race',$q$begin; set local request.jwt.claims='{"role":"authenticated","sub":"21953001-2000-0000-0000-000000000002"}'; set local role authenticated$q$);
select is((select r::jsonb->>'outcome' from dblink('family_race',pg_temp.race_apply('21953001-2000-0000-0000-000000000011')) as t(r text)),'create','AC-021 the first session places the family');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21953001-2000-0000-0000-000000000002","role":"authenticated"}';
set local lock_timeout='300ms';
select throws_ok(pg_temp.race_apply('21953001-2000-0000-0000-000000000012'),'55P03',null,'AC-021 the second session waits for the first');
set local lock_timeout=0;
reset role;
select dblink_exec('family_race','commit');
select dblink_exec('family_race',$q$begin; set local request.jwt.claims='{"role":"authenticated","sub":"21953001-2000-0000-0000-000000000002"}'; set local role authenticated$q$);
select is((select r::jsonb->>'reason' from dblink('family_race',pg_temp.race_apply('21953001-2000-0000-0000-000000000012')) as t(r text)),'family_incomplete','AC-021 the second session is refused once the first has committed: the invoice is already in a purchase');
select dblink_exec('family_race','rollback');
select is((select count(*)||'/'||count(distinct procurement_id) from procurement_erp_links where erp_purchase_document_id in ('21953001-2000-0000-0000-000000000006','21953001-2000-0000-0000-000000000007')),'2/1','AC-021 the order and its invoice are both linked, to one purchase');
select dblink_exec('family_race',pg_temp.race_cleanup());
select dblink_disconnect('family_race');
select * from finish();
rollback;
