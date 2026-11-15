-- #2195 B1 round 5: undoing a placed purchase deactivates its decision, restores the invoice's earlier mark and keeps the audit trail.
begin;
select plan(26);
insert into organizations(id,name,default_currency) values ('21951005-0000-0000-0000-000000000001','Evidence org','USD');
insert into auth.users(id,email) values ('21951005-0000-0000-0000-000000000002','assignment-c@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21951005-0000-0000-0000-000000000002','21951005-0000-0000-0000-000000000001','Admin C','assignment-c@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('21951005-0000-0000-0000-000000000003','21951005-0000-0000-0000-000000000001','Project C','Ongoing Project');
insert into companies(id,org_id,name,type) values ('21951005-0000-0000-0000-000000000004','21951005-0000-0000-0000-000000000001','Supplier C','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21951005-0000-0000-0000-000000000001','companies','21951005-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21951005-0000-0000-0000-000000000005','21951005-0000-0000-0000-000000000001','erpnext','https://example.test','test','{"company":"Example"}',now(),'active');
insert into budget_category_account_map(org_id,category,erp_account) values ('21951005-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21951005-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21951005-0000-0000-0000-000000000099'),
 ('21951005-0000-0000-0000-000000000001','Example','Misc','Misc','Expense','Profit and Loss',false,'USD',3,4,'21951005-0000-0000-0000-000000000099'),
 ('21951005-0000-0000-0000-000000000001','Example','Fixed Assets','Fixed Assets','Asset','Balance Sheet',false,'USD',5,6,'21951005-0000-0000-0000-000000000099'),
 ('21951005-0000-0000-0000-000000000001','Example','Creditors','Creditors','Liability','Balance Sheet',false,'USD',7,8,'21951005-0000-0000-0000-000000000099');
create or replace function public.purchase_capture_feed_health() returns jsonb language sql stable as $$ select jsonb_build_object('caught_up',true,'ledger_currency','USD') $$;
-- the organization's latest tagged snapshot is newer than every ledger row seeded below, so a placement is not held back by the freshness guard
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-0000000000e1',now()+interval '1 day',now());
create function pg_temp.inv(n integer,p_supplier text default 'SUP-1',p_currency text default 'USD',p_status smallint default 1,p_return boolean default false,p_project text default null,p_bill text default null,p_ids uuid[] default '{}') returns void language sql as $$
 insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,grand_total,net_total,erp_status,erp_docstatus,is_return,erp_project,project_ids,bill_no,erp_modified)
 values (('21951005-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'21951005-0000-0000-0000-000000000001','Purchase Invoice','INV-'||n,p_supplier,'Supplier C',p_currency,100,100,'Unpaid',p_status,p_return,p_project,p_ids,p_bill,'1') $$;
create function pg_temp.gl(n integer,p_account text,p_debit numeric,p_credit numeric default 0,p_company text default 'Example',p_project text default null) returns void language sql as $$
 insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
 values ('21951005-0000-0000-0000-000000000001','GL-'||n||'-'||p_account||'-'||p_debit||'-'||p_company,p_company,p_account,p_project,'Purchase Invoice','INV-'||n,'2026-02-01',p_debit,p_credit,false,'1') $$;
create function pg_temp.call(n integer,p_decision text,p_dry boolean,p_extra jsonb default '{}',p_request uuid default gen_random_uuid(),p_revision text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 select public.assign_capture_invoices(jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('request_id',p_request,'source_id',('21951005-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'decision',p_decision,
   'project_id',case when p_decision='project' then '21951005-0000-0000-0000-000000000003' end) || p_extra)),
   coalesce(p_revision,public.purchase_capture_source_page(null,null,1)->>'revision'),p_dry) into v;
 return v;
end $$;
create function pg_temp.reason(n integer,p_decision text default 'project',p_extra jsonb default '{}') returns text language sql as $$ select pg_temp.call(n,p_decision,true,p_extra)#>>'{results,0,reason}' $$;

-- five invoices: unmarked, set aside with a note, set aside without a note, note only, and one whose mark is edited after the placement
select pg_temp.inv(1); select pg_temp.gl(1,'Cost',100);
select pg_temp.inv(2); select pg_temp.gl(2,'Cost',100);
select pg_temp.inv(3); select pg_temp.gl(3,'Cost',100);
select pg_temp.inv(4); select pg_temp.gl(4,'Cost',100);
select pg_temp.inv(5); select pg_temp.gl(5,'Cost',100);
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-0000000000e1',now()+interval '1 day',now());
-- a rule gives every untagged Cost line to project R, so a placement on C visibly takes cost off R and an undo must give it back
insert into projects(id,org_id,name,status) values ('21951005-0000-0000-0000-0000000000a1','21951005-0000-0000-0000-000000000001','Project R','Ongoing Project');
insert into cost_attribution_rules(id,org_id,rule_key,version,name,match_account,effective_from,specificity) values ('21951005-0000-0000-0000-0000000000d1','21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-0000000000d2',1,'Cost rule','Cost','2026-01-01',2);
insert into cost_attribution_rule_targets(rule_id,org_id,position,project_id,percent) values ('21951005-0000-0000-0000-0000000000d1','21951005-0000-0000-0000-000000000001',0,'21951005-0000-0000-0000-0000000000a1',100);
insert into erp_actuals_snapshot(org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-0000000000a1','Cost','2026',0,now()+interval '1 day','21951005-0000-0000-0000-0000000000e1',now()),('21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-000000000003','Cost','2026',0,now()+interval '1 day','21951005-0000-0000-0000-0000000000e1',now());
create function pg_temp.act(p_project uuid) returns numeric language sql as $$ select actuals_to_date from public.project_mapped_actuals(p_project) where category='Materials' $$;
insert into erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at,set_aside_by,note,updated_at,updated_by) values
 ('21951005-1000-0000-0000-000000000002','21951005-0000-0000-0000-000000000001','2026-01-01','21951005-0000-0000-0000-000000000002','keep this note','2026-01-02','21951005-0000-0000-0000-000000000002'),
 ('21951005-1000-0000-0000-000000000003','21951005-0000-0000-0000-000000000001','2026-01-01','21951005-0000-0000-0000-000000000002',null,'2026-01-03','21951005-0000-0000-0000-000000000002'),
 ('21951005-1000-0000-0000-000000000004','21951005-0000-0000-0000-000000000001',null,null,'just a note','2026-01-04',null),
 ('21951005-1000-0000-0000-000000000005','21951005-0000-0000-0000-000000000001','2026-01-01','21951005-0000-0000-0000-000000000002','original','2026-01-05','21951005-0000-0000-0000-000000000002');
create temp table before_marks on commit drop as select * from erp_purchase_document_marks;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951005-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.act('21951005-0000-0000-0000-0000000000a1'),500::numeric,'AC-ROP-009 before any placement the rule gives project R the five invoices');
select pg_temp.call(n,'project',false,'{"accept_set_aside":true}') from generate_series(1,5) n;
select is(pg_temp.act('21951005-0000-0000-0000-0000000000a1'),0::numeric,'AC-ROP-009 after the placements R has none of the five');
select is(pg_temp.act('21951005-0000-0000-0000-000000000003'),500::numeric,'AC-ROP-009 and the chosen project has all five');
create function pg_temp.proc(n integer) returns uuid language sql as $$ select procurement_id from erp_capture_invoice_assignments where source_document_id=('21951005-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
select is(public.undo_captured_purchase(pg_temp.proc(1),'wrong project',true)->>'outcome','undo','AC-ROP-009 a dry-run undo reports the undo');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments a join procurements p on p.id=a.procurement_id join procurement_erp_links l on l.procurement_id=p.id where a.source_document_id='21951005-1000-0000-0000-000000000001' and a.undone_at is null and p.status<>'Cancelled'),1,'AC-ROP-009 a dry-run undo changes nothing');
set local role authenticated;
select is(public.undo_captured_purchase(pg_temp.proc(1),'wrong project')->>'outcome','undo','AC-ROP-009 undo cancels the wrapper');
select is(pg_temp.act('21951005-0000-0000-0000-0000000000a1'),100::numeric,'AC-ROP-009 the undone invoice goes back to where the rule had it');
select is(pg_temp.act('21951005-0000-0000-0000-000000000003'),400::numeric,'AC-ROP-009 and leaves the chosen project');
reset role;
select is((select sum(debit-credit) from erp_gl_entry_mirror where org_id='21951005-0000-0000-0000-000000000001' and account='Cost'),500::numeric,'AC-ROP-009 the organization ledger total is still the independently summed 500');
select is((select detail->'placement_before'->0->>'amount' from audit_events where action='procurement.record_only_undo' and detail->>'reason'='wrong project'),'100','AC-ROP-009 the undo audit records the placement it removed');
select is((select detail->'placement_after'->0->>'project_id' from audit_events where action='procurement.record_only_undo' and detail->>'reason'='wrong project'),'21951005-0000-0000-0000-0000000000a1','AC-ROP-009 and the placement it returned the invoice to');
select is((select detail ? 'actuals_delta' from audit_events where action='procurement.record_only_undo' and detail->>'reason'='wrong project'),false,'AC-ROP-009 a placement undo does not claim a zero change');
select is((select detail->'prior_placement'->0->>'project_id' from audit_events where action='procurement.record_only_create' and detail->>'decision_id'=(select id::text from erp_capture_invoice_assignments where source_document_id='21951005-1000-0000-0000-000000000001')),'21951005-0000-0000-0000-0000000000a1','AC-ROP-009 the create audit stores the placement that lost the cost');
select is((select count(*)::int from erp_capture_invoice_assignments a join procurements p on p.id=a.procurement_id
  where a.source_document_id='21951005-1000-0000-0000-000000000001' and a.undone_at is not null and a.undone_reason='wrong project' and a.undone_by='21951005-0000-0000-0000-000000000002' and p.status='Cancelled'),1,'AC-ROP-009 one undo deactivates the decision with its reason and actor and cancels the wrapper');
select is((select count(*)::int from procurement_erp_links where erp_purchase_document_id='21951005-1000-0000-0000-000000000001')+(select count(*)::int from erp_purchase_captures c join procurements p on p.id=c.procurement_id where p.id=(select procurement_id from erp_capture_invoice_assignments where source_document_id='21951005-1000-0000-0000-000000000001') and c.undone_at is null),0,'AC-ROP-009 the link is gone and the capture is marked undone');
select is((select count(*)::int from capture_assigned_gl('21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-000000000003') where gl_id in (select id from erp_gl_entry_mirror where voucher_no='INV-1')),0,'AC-ROP-009 the ledger placement is gone');
select is((select count(*)::int from audit_events where action='procurement.record_only_undo' and detail->>'assignment_origin'='pmo_assignment' and detail->>'reason'='wrong project'),1,'AC-ROP-009 the undo is audited with its origin');
select is((select count(*)::int from erp_capture_invoice_assignments where source_document_id='21951005-1000-0000-0000-000000000001'),1,'AC-ROP-009 the decision row survives for audit');
set local role authenticated;
select is(public.undo_captured_purchase((select procurement_id from erp_capture_invoice_assignments where source_document_id='21951005-1000-0000-0000-000000000001'),'again')#>>'{reason}','already_undone','AC-ROP-009 a second undo is a no-op');
reset role;
select is((select count(*)::int from audit_events where action='procurement.record_only_undo'),1,'AC-ROP-009 the second undo writes no second audit row');
select is((select count(*)::int from erp_purchase_document_marks where erp_purchase_document_id='21951005-1000-0000-0000-000000000001'),0,'AC-ROP-009 an invoice that had no mark still has none');
-- the previous marks come back exactly
set local role authenticated;
select public.undo_captured_purchase(pg_temp.proc(2),'undo 2'); select public.undo_captured_purchase(pg_temp.proc(3),'undo 3'); select public.undo_captured_purchase(pg_temp.proc(4),'undo 4');
reset role;
select is((select count(*)::int from erp_purchase_document_marks m join before_marks b using (erp_purchase_document_id) where m.erp_purchase_document_id in ('21951005-1000-0000-0000-000000000002','21951005-1000-0000-0000-000000000003','21951005-1000-0000-0000-000000000004')
  and (to_jsonb(m)=to_jsonb(b))),3,'AC-ROP-015 undo restores the previous mark exactly: set aside with a note, set aside without one, and a note alone');
select is((select count(*)::int from erp_purchase_document_marks where erp_purchase_document_id in ('21951005-1000-0000-0000-000000000002','21951005-1000-0000-0000-000000000003','21951005-1000-0000-0000-000000000004')),3,'AC-ROP-015 and no other mark appears');
-- someone changed the mark after the placement: nothing is undone
update erp_purchase_document_marks set note='edited since' where erp_purchase_document_id='21951005-1000-0000-0000-000000000005';
set local role authenticated;
select throws_ok($q$select public.undo_captured_purchase(pg_temp.proc(5),'changed')$q$,'55000','assignment_mark_changed','AC-ROP-015 a mark changed since the placement refuses the undo');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments a join procurements p on p.id=a.procurement_id join procurement_erp_links l on l.procurement_id=p.id join erp_purchase_captures c on c.procurement_id=p.id
  where a.source_document_id='21951005-1000-0000-0000-000000000005' and a.undone_at is null and p.status<>'Cancelled' and c.undone_at is null),1,'AC-ROP-015 the refused undo changed nothing: one transaction');
select is((select note from erp_purchase_document_marks where erp_purchase_document_id='21951005-1000-0000-0000-000000000005'),'edited since','AC-ROP-015 and the later edit is untouched');
select * from finish();
rollback;
