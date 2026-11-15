-- AC-ROP-063 / AC-ROP-064: the capture revision is a fingerprint of the facts that decide a capture.
-- A hourly feed rewrite that changes nothing leaves it alone; every deciding fact moves it.
begin;
select plan(43);
insert into organizations (id, name, default_currency) values
  ('21950630-0000-0000-0000-000000000001','Revision test','USD');
insert into auth.users (id, email) values ('21950630-0000-0000-0000-000000000002','revision-admin@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21950630-0000-0000-0000-000000000002','21950630-0000-0000-0000-000000000001','Admin','revision-admin@example.test','Admin','active');
insert into projects (id, org_id, name, status) values
  ('21950630-0000-0000-0000-000000000004','21950630-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('21950630-0000-0000-0000-000000000005','21950630-0000-0000-0000-000000000001','Supplier','Vendor'),
  ('21950630-0000-0000-0000-000000000007','21950630-0000-0000-0000-000000000001','Second supplier','Vendor');
insert into external_org_bindings (id, org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('21950630-0000-0000-0000-000000000003','21950630-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"21950630-0000-0000-0000-000000000004":"PROJECT"}}',now(),'active');
select upsert_erp_purchase_documents('21950630-0000-0000-0000-000000000001', $$[
 {"erp_doctype":"Purchase Order","erp_name":"ORDER-1","supplier":"SUP-1","currency":"USD","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","currency":"USD","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"}
]$$::jsonb);
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21950630-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21950630-0000-0000-0000-000000000006');
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950630-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',100,0,false,'2026-02-01');
insert into procurements(id,org_id,title,requested_by_id,project_id,currency,total_value,status) values
 ('21950630-0000-0000-0000-000000000010','21950630-0000-0000-0000-000000000001','Ordinary','21950630-0000-0000-0000-000000000002','21950630-0000-0000-0000-000000000004','USD',0,'Draft'),
 ('21950630-0000-0000-0000-000000000011','21950630-0000-0000-0000-000000000001','Second','21950630-0000-0000-0000-000000000002','21950630-0000-0000-0000-000000000004','USD',0,'Draft');
set local request.jwt.claims = '{"sub":"21950630-0000-0000-0000-000000000002","role":"authenticated"}';

-- Runs one statement and says whether the revision moved. The page is read as the Admin caller.
create function pg_temp.moved(p_sql text, p_service boolean default false) returns boolean language plpgsql as $f$
declare v_before text; v_after text;
begin
  v_before := public.purchase_capture_source_page(null,null,1)->>'revision';
  if p_service then perform set_config('request.jwt.claims','{"role":"service_role"}',true); end if;
  execute p_sql;
  perform set_config('request.jwt.claims','{"sub":"21950630-0000-0000-0000-000000000002","role":"authenticated"}',true);
  v_after := public.purchase_capture_source_page(null,null,1)->>'revision';
  return v_before is distinct from v_after;
end $f$;

-- AC-ROP-063: nothing that the hourly feed rewrites without a real change moves the revision.
select ok(not pg_temp.moved($$select public.replace_erp_account_chart('21950630-0000-0000-0000-000000000001','Example',
  jsonb_build_array(jsonb_build_object('org_id','21950630-0000-0000-0000-000000000001','company','Example','erp_name','Cost','account_name','Cost',
    'root_type','Expense','report_type','Profit and Loss','parent_account',null,'is_group',false,'account_number',null,'account_currency','USD',
    'lft',1,'rgt',2,'account_type',null,'include_in_gross',false,'disabled',false,'erp_modified',null,
    'as_of',now()+interval '1 hour','refresh_id','21950630-0000-0000-0000-000000000099')))$$),
  'AC-ROP-063 a chart replace with a new refresh id and as-of time is not a change');
select ok(not pg_temp.moved($$insert into erp_actuals_snapshot(org_id,project_id,account,debit,credit,net,snapshot_id,as_of)
  values ('21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000004','Cost',1,0,1,'21950630-0000-0000-0000-000000000090',now())$$),
  'AC-ROP-063 an actuals refresh is not a change');
select ok(not pg_temp.moved($$insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
  values ('21950630-0000-0000-0000-000000000001','Example','21950630-0000-0000-0000-000000000091','21950630-0000-0000-0000-000000000092','trial_balance','company','account_breakdown','month','2026-01-01','2026-01-31','2025-01-01','2025-01-31','IDR',now(),now(),now(),now(),'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output')$$),
  'AC-ROP-063 a statement snapshot is not a change');
select ok(not pg_temp.moved($$insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
  values ('21950630-0000-0000-0000-000000000001','Example','21950630-0000-0000-0000-000000000091','21950630-0000-0000-0000-000000000092','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}')$$),
  'AC-ROP-063 publishing a statement is not a change');
select ok(not pg_temp.moved($$select public.record_capture_feed_start('21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000003','purchases',now(),'21950630-0000-0000-0000-000000000093')$$,true),
  'AC-ROP-063 a feed start is not a change');
select ok(not pg_temp.moved($$update erp_capture_feed_witnesses set completed=true where org_id='21950630-0000-0000-0000-000000000001'$$),
  'AC-ROP-063 a feed completion is not a change');
select ok(not pg_temp.moved($$update external_org_bindings set statement_last_attempt_at=now() where id='21950630-0000-0000-0000-000000000003'$$),
  'AC-ROP-063 the statement attempt stamp is not a change');
select ok(not pg_temp.moved($$update erp_purchase_documents set updated_at=now()+interval '1 hour' where org_id='21950630-0000-0000-0000-000000000001'$$),
  'AC-ROP-063 a document re-stamp is not a change');
select ok(not pg_temp.moved($$update erp_gl_entry_mirror set as_of=now()+interval '1 hour' where org_id='21950630-0000-0000-0000-000000000001'$$),
  'AC-ROP-063 a ledger line re-stamp is not a change');
select is(public.purchase_capture_source_page(null,null,500)->>'revision',
  (select public.purchase_capture_source_page(null,null,1)->>'revision'),'AC-ROP-063 the revision does not depend on the page size');

-- AC-ROP-064: one assertion per deciding fact.
select ok(pg_temp.moved($$update erp_purchase_documents set erp_status='Paid' where erp_name='INVOICE-1'$$),'AC-ROP-064 a source document change moves it');
select ok(pg_temp.moved($$insert into procurement_erp_links(id,org_id,procurement_id,erp_purchase_document_id)
  select '21950630-0000-0000-0000-000000000020',org_id,'21950630-0000-0000-0000-000000000010',id from erp_purchase_documents where erp_name='ORDER-1'$$),'AC-ROP-064 a purchase link moves it');
select ok(pg_temp.moved($$insert into erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at)
  select id,org_id,now() from erp_purchase_documents where erp_name='ORDER-1'$$),'AC-ROP-064 a set-aside mark moves it');
select ok(pg_temp.moved($$update erp_gl_entry_mirror set debit=101 where erp_name='GL-1'$$),'AC-ROP-064 a ledger amount moves it');
select ok(pg_temp.moved($$update erp_account_mirror set root_type='Asset' where erp_name='Cost'$$),'AC-ROP-064 an account classification moves it');
select ok(pg_temp.moved($$insert into budget_category_account_map(org_id,category,erp_account) values ('21950630-0000-0000-0000-000000000001','Materials','Cost')$$),'AC-ROP-064 the budget account map moves it');
select ok(pg_temp.moved($$insert into erp_journal_line_links(org_id,procurement_id,erp_doctype,voucher_no,project_id,account)
  values ('21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000010','Journal Entry','JV-1','21950630-0000-0000-0000-000000000004','Cost')$$),'AC-ROP-064 a journal link moves it');
select ok(pg_temp.moved($$update external_org_bindings set config=jsonb_set(config,'{project_map}','{"21950630-0000-0000-0000-000000000004":"OTHER"}') where id='21950630-0000-0000-0000-000000000003'$$),'AC-ROP-064 a project map change moves it');
select ok(pg_temp.moved($$update external_org_bindings set config=jsonb_set(config,'{company}','"Other"') where id='21950630-0000-0000-0000-000000000003'$$),'AC-ROP-064 a company change moves it');
select ok(pg_temp.moved($$insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
  values ('21950630-0000-0000-0000-000000000001','companies','21950630-0000-0000-0000-000000000005','erpnext','Supplier:SUP-1')$$),'AC-ROP-064 a vendor mapping moves it');
select ok(pg_temp.moved($$update companies set archived_at=now() where id='21950630-0000-0000-0000-000000000005'$$),'AC-ROP-064 an archived vendor moves it');
select ok(pg_temp.moved($$update companies set name='Supplier renamed' where id='21950630-0000-0000-0000-000000000005'$$),'AC-ROP-064 a vendor name moves it (linking compares supplier names)');
select ok(pg_temp.moved($$update companies set erp_supplier_name='SUP-1' where id='21950630-0000-0000-0000-000000000005'$$),'AC-ROP-064 a vendor accounting-system name moves it (linking compares it)');
select ok(pg_temp.moved($$insert into projects(id,org_id,name,status) values ('21950630-0000-0000-0000-000000000030','21950630-0000-0000-0000-000000000001','Second','Ongoing Project')$$),'AC-ROP-064 a new project moves it');
select ok(pg_temp.moved($$update procurements set status='Cancelled' where id='21950630-0000-0000-0000-000000000010'$$),'AC-ROP-064 a purchase status moves it');
select ok(pg_temp.moved($$insert into purchase_orders(id,org_id,procurement_id) values ('21950630-0000-0000-0000-000000000040','21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000010')$$),'AC-ROP-064 a PMO purchase order moves it');
select ok(pg_temp.moved($$insert into procurement_receipts(id,org_id,procurement_id,status) values ('21950630-0000-0000-0000-000000000041','21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000010','Complete')$$),'AC-ROP-064 a PMO receipt moves it');
select ok(pg_temp.moved($$insert into procurement_invoices(id,org_id,procurement_id,status,amount,currency,tax_treatment,tax_amount)
  values ('21950630-0000-0000-0000-000000000042','21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000010','Received',1,'USD','exclusive',0)$$),'AC-ROP-064 a PMO invoice moves it');
select ok(pg_temp.moved($$insert into payments(id,org_id,procurement_id) values ('21950630-0000-0000-0000-000000000043','21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000010')$$),'AC-ROP-064 a PMO payment moves it');
select ok(pg_temp.moved($$insert into erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by)
  values ('21950630-0000-0000-0000-000000000010','21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000003','21950630-0000-0000-0000-000000000050','{}','order','ordered','21950630-0000-0000-0000-000000000002')$$),'AC-ROP-064 a capture record moves it');
select ok(pg_temp.moved($$insert into external_domain_ownership(org_id,external_tier,domain) values ('21950630-0000-0000-0000-000000000001','erpnext','purchases')$$),'AC-ROP-064 domain ownership moves it');
-- AC-ROP-064: an id moved from one id list to the next is a change (each list is one JSON array).
-- A lower order id stays behind, so both lists stay non-empty and the bare-id text would be identical before and after.
insert into purchase_orders(id,org_id,procurement_id) values ('21950630-0000-0000-0000-00000000003f','21950630-0000-0000-0000-000000000001','21950630-0000-0000-0000-000000000010');
select ok(pg_temp.moved($$with d as (delete from purchase_orders where id='21950630-0000-0000-0000-000000000040' returning id,org_id,procurement_id)
  insert into procurement_receipts(id,org_id,procurement_id,status) select id,org_id,procurement_id,'Complete' from d$$),'AC-ROP-064 an id moved from the order list to the receipt list moves it');
-- Runs one statement, says whether the revision moved, then undoes the statement so each case starts from the same state.
create function pg_temp.moved_alone(p_sql text) returns boolean language plpgsql as $f$
declare v_moved boolean;
begin
  begin
    v_moved := pg_temp.moved(p_sql);
    raise exception using errcode = 'RV195', message = v_moved::text;
  exception when sqlstate 'RV195' then return sqlerrm::boolean;
  end;
end $f$;
-- AC-ROP-064: one case per column that 0873 names in a column-list section.
select ok(pg_temp.moved_alone(c.statement), 'AC-ROP-064 a ' || c.label || ' change moves it') from (values
  ($c$update external_org_bindings set status='disconnected' where id='21950630-0000-0000-0000-000000000003'$c$,'binding status'),
  ($c$update external_org_bindings set activated_at=activated_at-interval '1 day' where id='21950630-0000-0000-0000-000000000003'$c$,'binding activation time'),
  ($c$update external_org_bindings set external_tier='odoo' where id='21950630-0000-0000-0000-000000000003'$c$,'binding accounting tier'),
  ($c$update companies set type='Client' where id='21950630-0000-0000-0000-000000000007'$c$,'company type'),
  ($c$update procurements set project_id='21950630-0000-0000-0000-000000000030' where id='21950630-0000-0000-0000-000000000011'$c$,'purchase project'),
  ($c$update procurements set vendor_id='21950630-0000-0000-0000-000000000007' where id='21950630-0000-0000-0000-000000000011'$c$,'purchase vendor'),
  ($c$update procurements set currency='EUR' where id='21950630-0000-0000-0000-000000000011'$c$,'purchase currency'),
  ($c$update procurements set record_only=true where id='21950630-0000-0000-0000-000000000011'$c$,'purchase record-only flag'),
  ($c$update procurements set record_only_stage='ordered' where id='21950630-0000-0000-0000-000000000011'$c$,'purchase record-only stage'),
  ($c$update procurements set origin='erp_link' where id='21950630-0000-0000-0000-000000000011'$c$,'purchase origin')
) c(statement,label);
select ok(pg_temp.moved($$update organizations set default_currency='IDR' where id='21950630-0000-0000-0000-000000000001'$$),'AC-ROP-064 the organization currency moves it');
select * from finish();
rollback;
