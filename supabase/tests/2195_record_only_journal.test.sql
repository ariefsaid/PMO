-- Record-only purchases: journal creation is atomic and never changes project actuals.
begin;
select plan(139);
select is((select jsonb_build_object('record_only',captured->'record_only','record_only_stage',captured->'record_only_stage','record_only_date',captured->'record_only_date','record_only_reference',captured->'record_only_reference') from public.record_history_config where table_name='procurements'), '{"record_only":"bool","record_only_stage":"enum","record_only_date":"date","record_only_reference":"text"}'::jsonb, 'AC-CHG-011 record-only purchase attributes are captured with their types');
insert into organizations (id, name, default_currency) values
  ('21950000-0000-0000-0000-00000000000a','JEC A','IDR'), ('21950000-0000-0000-0000-00000000000b','JEC B','IDR');
insert into auth.users (id, email) values
  ('21950000-0000-0000-0000-0000000000a1','rrp-fin@example.com'), ('21950000-0000-0000-0000-0000000000a2','rrp-pm@example.com'),
  ('21950000-0000-0000-0000-0000000000a3','rrp-eng@example.com'), ('21950000-0000-0000-0000-0000000000a4','rrp-admin@example.com'),
  ('21950000-0000-0000-0000-0000000000b1','rrp-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21950000-0000-0000-0000-0000000000a1','21950000-0000-0000-0000-00000000000a','Fin','rrp-fin@example.com','Finance','active'),
  ('21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-00000000000a','PM','rrp-pm@example.com','Project Manager','active'),
  ('21950000-0000-0000-0000-0000000000a3','21950000-0000-0000-0000-00000000000a','Eng','rrp-eng@example.com','Engineer','active'),
  ('21950000-0000-0000-0000-0000000000a4','21950000-0000-0000-0000-00000000000a','Admin','rrp-admin@example.com','Admin','active'),
  ('21950000-0000-0000-0000-0000000000b1','21950000-0000-0000-0000-00000000000b','B Fin','rrp-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('21950000-0000-0000-0000-0000000000d1','21950000-0000-0000-0000-00000000000a','JEC A1','Ongoing Project'),
  ('21950000-0000-0000-0000-0000000000d2','21950000-0000-0000-0000-00000000000a','JEC A2','Ongoing Project'),
  ('21950000-0000-0000-0000-0000000000d3','21950000-0000-0000-0000-00000000000b','JEC B1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('21950000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"21950000-0000-0000-0000-0000000000d1":"ERP-A1","21950000-0000-0000-0000-0000000000d2":"ERP-A2"}}'::jsonb, now(), 'active'),
  ('21950000-0000-0000-0000-00000000000b','erpnext','https://erp-b.example.test','test-ref-b',
   '{"company":"Other Co","project_map":{"21950000-0000-0000-0000-0000000000d3":"ERP-B1"}}'::jsonb, now(), 'active');
insert into budget_category_account_map (org_id, category, erp_account) values
  ('21950000-0000-0000-0000-00000000000a','Subcontractors','Project Subcontractors - X'),
  ('21950000-0000-0000-0000-00000000000a','Materials','Cost of Goods - X'),
  ('21950000-0000-0000-0000-00000000000b','Subcontractors','Project Subcontractors - X');

-- Ledger rows. JV-1 splits one bank payment across A1 (60) and A2 (120); JV-2 is two rows on one line (40+10);
-- JV-3 nets to a credit; JV-PMO is a journal PMO posted itself; JV-B is org B's.
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, remarks, erp_modified) values
  ('21950000-0000-0000-0000-00000000000a','g1a','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-1','2026-03-01',60,0,false,'Vendor Lab inv 7','2026-03-01'),
  ('21950000-0000-0000-0000-00000000000a','g1b','Example Co','Project Subcontractors - X','ERP-A2','Journal Entry','JV-1','2026-03-01',120,0,false,'Vendor Lab inv 7','2026-03-01'),
  ('21950000-0000-0000-0000-00000000000a','g1c','Example Co','Bank - X',null,'Journal Entry','JV-1','2026-03-01',0,180,false,'Vendor Lab inv 7','2026-03-01'),
  ('21950000-0000-0000-0000-00000000000a','g2a','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-2','2026-03-05',40,0,false,null,'2026-03-05'),
  ('21950000-0000-0000-0000-00000000000a','g2b','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-2','2026-03-05',10,0,false,null,'2026-03-05'),
  ('21950000-0000-0000-0000-00000000000a','g3a','Example Co','Cost of Goods - X','ERP-A1','Journal Entry','JV-3','2026-03-09',0,5,false,null,'2026-03-09'),
  ('21950000-0000-0000-0000-00000000000a','gp','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-PMO','2026-03-10',20,0,false,null,'2026-03-10'),
  ('21950000-0000-0000-0000-00000000000a','gu','Example Co','Cost of Goods - X','ERP-A1','Purchase Invoice','PINV-9','2026-03-11',77,0,false,null,'2026-03-11'),
  ('21950000-0000-0000-0000-00000000000b','gb','Other Co','Project Subcontractors - X','ERP-B1','Journal Entry','JV-B','2026-03-02',30,0,false,null,'2026-03-02');
insert into public.erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950000-0000-0000-0000-00000000000a','g4','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-4','2026-03-07',10,0,false,'2026-03-07');
insert into public.erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,party,erp_modified) values
 ('21950000-0000-0000-0000-00000000000a','gunknown1','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-UNKNOWN-1','2026-03-06',10,0,false,'Unmapped A','2026-03-06'),
 ('21950000-0000-0000-0000-00000000000a','gunknown2','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-UNKNOWN-2','2026-03-06',10,0,false,'Unmapped B','2026-03-06');
insert into public.erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,party,erp_modified) values
 ('21950000-0000-0000-0000-00000000000a','gmixp1','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-MIXPARTY','2026-03-06',10,0,false,'Example vendor','2026-03-06'),
 ('21950000-0000-0000-0000-00000000000a','gmixp2','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-MIXPARTY','2026-03-06',10,0,false,'Different supplier','2026-03-06');
insert into public.erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,party,erp_modified) values
 ('21950000-0000-0000-0000-00000000000a','gparty','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-PARTY','2026-03-06',20,0,false,'  Different supplier  ','2026-03-06');
insert into public.erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,party,erp_modified) values
 ('21950000-0000-0000-0000-00000000000a','gcancelparty','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-PARTY','2026-03-06',20,0,true,'Example vendor','2026-03-06'),
 ('21950000-0000-0000-0000-00000000000a','gblankparty1','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-BLANKPARTY','2026-03-06',20,0,false,'Different supplier','2026-03-06'),
 ('21950000-0000-0000-0000-00000000000a','gblankparty2','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-BLANKPARTY','2026-03-06',1,0,false,'','2026-03-06');
insert into public.erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950000-0000-0000-0000-00000000000a','gm1','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-MIX','2026-03-06',100,0,false,'2026-03-06'),
 ('21950000-0000-0000-0000-00000000000a','gm2','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-MIX','2026-03-06',0,20,false,'2026-03-06');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('21950000-0000-0000-0000-000000000501','21950000-0000-0000-0000-00000000000a','claim','21950000-0000-0000-0000-0000000000a3','21950000-0000-0000-0000-0000000000d1','Trip',0,'Approved','EXP-2611050001','21950000-0000-0000-0000-0000000000a2','2026-11-05 02:00:00+00');
insert into expense_posting_erp_mirror (org_id, claim_id, posting, posting_identity, state_stamp, actor_id, erp_name) values
  ('21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-000000000501','approval','21950000-0000-0000-0000-000000000501:approval','2026-11-05 02:00:00+00','21950000-0000-0000-0000-0000000000a2','JV-PMO');
-- The actuals snapshot the project reads (a separate job fills it from the rows above; a fixed value is enough to prove attach never touches it).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at) values
  ('21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-0000000000d1','Project Subcontractors - X','2026',110,now(),'21950000-0000-0000-0000-0000000000f1',now()),
  ('21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-0000000000d2','Project Subcontractors - X','2026',120,now(),'21950000-0000-0000-0000-0000000000f1',now());

insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('21950000-0000-0000-0000-0000000000e1','21950000-0000-0000-0000-00000000000a','P1','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','IDR',100,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e2','21950000-0000-0000-0000-00000000000a','P2','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','IDR',70,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e3','21950000-0000-0000-0000-00000000000a','PX','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','IDR',10,'Cancelled'),
  ('21950000-0000-0000-0000-0000000000e4','21950000-0000-0000-0000-00000000000a','PU','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','USD',10,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e5','21950000-0000-0000-0000-00000000000a','Q1','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d2','IDR',500,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e6','21950000-0000-0000-0000-00000000000b','B purchase','21950000-0000-0000-0000-0000000000b1','21950000-0000-0000-0000-0000000000d3','IDR',90,'Ordered');


insert into companies (id, org_id, name, type) values
 ('21950000-0000-0000-0000-000000000901','21950000-0000-0000-0000-00000000000a','Example vendor','Vendor'),
 ('21950000-0000-0000-0000-000000000902','21950000-0000-0000-0000-00000000000b','B vendor','Vendor'),
 ('21950000-0000-0000-0000-000000000903','21950000-0000-0000-0000-00000000000a','Different supplier','Vendor');

insert into auth.users(id,email) values
 ('21950000-0000-0000-0000-0000000000a5','rrp-exec@example.com'),
 ('21950000-0000-0000-0000-0000000000a6','rrp-view@example.com'),
 ('21950000-0000-0000-0000-0000000000a7','rrp-inactive@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('21950000-0000-0000-0000-0000000000a5','21950000-0000-0000-0000-00000000000a','Exec','rrp-exec@example.com','Executive','active'),
 ('21950000-0000-0000-0000-0000000000a7','21950000-0000-0000-0000-00000000000a','Inactive','rrp-inactive@example.com','Admin','disabled');
create function pg_temp.journal_group() returns jsonb language sql as $$
 select '{"request_id":"21950000-0000-0000-0000-000000000996","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"title":"Another purchase","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-2","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb
$$;
grant execute on function pg_temp.journal_group() to public;

select public.upsert_erp_purchase_documents('21950000-0000-0000-0000-00000000000a',
 '[{"erp_doctype":"Purchase Invoice","erp_name":"PINV-TEST","supplier":"Example vendor","supplier_name":"Example vendor","erp_project":"ERP-A1","currency":"IDR","grand_total":50,"net_total":50,"erp_docstatus":1,"erp_modified":"2026-02-01"}]'::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select set_config('rop.before_actuals',(select coalesce(sum(actuals_to_date),0)::text from public.project_mapped_actuals('21950000-0000-0000-0000-0000000000d1')),true);
select set_config('rop.before_committed',(select coalesce(sum(amount),0)::text from public.project_committed_spend('21950000-0000-0000-0000-0000000000d1') where currency='IDR'),true);
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}',to_jsonb('JV-PARTY'::text)),true)$test$, '22023','supplier_mismatch','AC-ROP-022 cancelled-party companion cannot mask active supplier on preview');
select throws_ok($test$do $body$ begin perform public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}',to_jsonb('JV-PARTY'::text)),false); raise exception 'unexpected_success' using errcode='P0002'; end $body$$test$, '22023','supplier_mismatch','AC-ROP-022 cancelled-party companion cannot mask active supplier on apply');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}',to_jsonb('JV-BLANKPARTY'::text)),true)$test$, '22023','supplier_mismatch','AC-ROP-022 blank-party companion cannot mask active supplier on preview');
select throws_ok($test$do $body$ begin perform public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}',to_jsonb('JV-BLANKPARTY'::text)),false); raise exception 'unexpected_success' using errcode='P0002'; end $body$$test$, '22023','supplier_mismatch','AC-ROP-022 blank-party companion cannot mask active supplier on apply');
-- Optional override values must be valid explanations in both modes.
select throws_ok(format('do $body$ begin perform public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),''{journal_lines,0,voucher_no}'',''"JV-PARTY"''::jsonb) || jsonb_build_object(''supplier_override_reason'', %L::jsonb), %L); raise exception ''unexpected_success'' using errcode=''P0002''; end $body$', value, dry_run), '22023', expected, 'AC-ROP-SAFETY-PARTY rejects ' || label || ' in ' || dry_run::text)
from (values ('"\t"','tab','supplier_mismatch'), ('"\n"','newline','supplier_mismatch'), ('"\r"','carriage return','supplier_mismatch'), ('{}','object','invalid_supplier_override_reason'), ('[]','array','invalid_supplier_override_reason'), ('true','boolean','invalid_supplier_override_reason'), ('12','number','invalid_supplier_override_reason')) v(value,label,expected)
cross join (values (true),(false)) modes(dry_run);
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}',to_jsonb('JV-PARTY'::text)) || '{"supplier_override_reason":null}'::jsonb,true)$test$,'22023','supplier_mismatch','AC-ROP-SAFETY-PARTY null is no override');
select is((select count(*)::int from public.procurements where title='Another purchase'),0,'AC-ROP-SAFETY-PARTY refusals leave no wrapper');
select is((select count(*)::int from public.erp_journal_line_links where voucher_no='JV-PARTY'),0,'AC-ROP-SAFETY-PARTY refusals leave no link');
select is((select count(*)::int from public.erp_purchase_captures where request_id='21950000-0000-0000-0000-000000000996'),0,'AC-ROP-SAFETY-PARTY refusals leave no capture');
select is((select count(*)::int from public.audit_events where action='procurement.record_only_create' and detail->'sources' @> '[{"voucher_no":"JV-PARTY"}]'::jsonb),0,'AC-ROP-SAFETY-PARTY refusals leave no create audit');
-- The selected active supplier is retained independently of cancelled display companions.
select is(public.create_record_only_journal_purchase(jsonb_set(jsonb_set(pg_temp.journal_group(),'{request_id}',to_jsonb('21950000-0000-0000-0000-000000000a94'::text)),'{journal_lines,0,voucher_no}',to_jsonb('JV-PARTY'::text)) || '{"supplier_override_reason":"  \tReviewed source\n "}'::jsonb,true)->>'outcome','create','AC-ROP-SAFETY-PARTY explicit mismatch reason permits preview');
select set_config('rop.party_result',public.create_record_only_journal_purchase(jsonb_set(jsonb_set(pg_temp.journal_group(),'{request_id}',to_jsonb('21950000-0000-0000-0000-000000000a94'::text)),'{journal_lines,0,voucher_no}',to_jsonb('JV-PARTY'::text)) || '{"supplier_override_reason":"  \tReviewed source\n "}'::jsonb,false)::text,true);
select is(current_setting('rop.party_result')::jsonb->>'outcome','create','AC-ROP-SAFETY-PARTY explicit mismatch reason permits apply');
select is((select source_evidence->0->'raw_parties' from public.erp_purchase_captures where procurement_id=(current_setting('rop.party_result')::jsonb->>'procurement_id')::uuid),'["  Different supplier  "]'::jsonb,'AC-ROP-SAFETY-PARTY capture retains raw active supplier only');
select is((select detail->'source_evidence'->0->'raw_parties' from public.audit_events where entity_id=(current_setting('rop.party_result')::jsonb->>'procurement_id')::uuid and action='procurement.record_only_create'),'["  Different supplier  "]'::jsonb,'AC-ROP-SAFETY-PARTY audit retains raw active supplier only');
select is((select detail->>'supplier_override_reason' from public.audit_events where entity_id=(current_setting('rop.party_result')::jsonb->>'procurement_id')::uuid and action='procurement.record_only_create'),'Reviewed source','AC-ROP-SAFETY-PARTY audit retains explicit override reason');
select lives_ok($test$select public.undo_captured_purchase((current_setting('rop.party_result')::jsonb->>'procurement_id')::uuid,'Test undo',false)$test$,'AC-ROP-SAFETY-PARTY undo releases fixture source');
select is((select supplier_override_reason from public.erp_purchase_captures where procurement_id=(current_setting('rop.party_result')::jsonb->>'procurement_id')::uuid),'Reviewed source','AC-ROP-SAFETY-PARTY provenance retains override reason');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}',to_jsonb('JV-PARTY'::text)) || '{"supplier_override_reason":"   "}'::jsonb,true)$test$,'22023','supplier_mismatch','AC-ROP-SAFETY-PARTY whitespace is not an override reason');
select set_config('rop.blank_result',public.create_record_only_journal_purchase(jsonb_set(jsonb_set(pg_temp.journal_group(),'{request_id}',to_jsonb('21950000-0000-0000-0000-000000000a95'::text)),'{journal_lines,0,voucher_no}',to_jsonb('JV-BLANKPARTY'::text)) || '{"supplier_override_reason":"Reviewed blank companion"}'::jsonb,false)::text,true);
select is((select source_evidence->0->'raw_parties' from public.erp_purchase_captures where procurement_id=(current_setting('rop.blank_result')::jsonb->>'procurement_id')::uuid),'["", "Different supplier"]'::jsonb,'AC-ROP-SAFETY-PARTY blank active companion remains evidence');
select is((select detail->'source_evidence'->0->'raw_parties' from public.audit_events where entity_id=(current_setting('rop.blank_result')::jsonb->>'procurement_id')::uuid and action='procurement.record_only_create'),'["", "Different supplier"]'::jsonb,'AC-ROP-SAFETY-PARTY audit retains blank active companion');
select lives_ok($test$select public.undo_captured_purchase((current_setting('rop.blank_result')::jsonb->>'procurement_id')::uuid,'Test undo',false)$test$,'AC-ROP-SAFETY-PARTY blank fixture source released');
-- Simulate a mirror refresh between the facts lookup and the provenance read.
reset role;
alter function public.journal_source_line_facts(uuid,uuid,text,text,text) rename to journal_source_line_facts_test_original;
create function public.journal_source_line_facts(p_org uuid,p_project uuid,p_doctype text,p_voucher text,p_account text)
returns table(has_negative boolean,party_count bigint,active_party text) language plpgsql security definer set search_path=public,pg_catalog as $body$
begin
  return query select * from public.journal_source_line_facts_test_original(p_org,p_project,p_doctype,p_voucher,p_account);
  update public.erp_gl_entry_mirror set party='Example vendor' where org_id=p_org and erp_name='gparty';
end $body$;
set local role authenticated;
select set_config('rop.race_result',public.create_record_only_journal_purchase(jsonb_set(jsonb_set(jsonb_set(pg_temp.journal_group(),'{request_id}',to_jsonb('21950000-0000-0000-0000-000000000a96'::text)),'{vendor_id}',to_jsonb('21950000-0000-0000-0000-000000000903'::text)),'{journal_lines,0,voucher_no}',to_jsonb('JV-PARTY'::text)),false)::text,true);
select is((select source_evidence->0->'raw_parties' from public.erp_purchase_captures where procurement_id=(current_setting('rop.race_result')::jsonb->>'procurement_id')::uuid),'["  Different supplier  "]'::jsonb,'AC-ROP-SAFETY-PARTY matching and raw evidence share one source snapshot');
select public.undo_captured_purchase((current_setting('rop.race_result')::jsonb->>'procurement_id')::uuid,'Test undo',false);
reset role;
drop function public.journal_source_line_facts(uuid,uuid,text,text,text);
alter function public.journal_source_line_facts_test_original(uuid,uuid,text,text,text) rename to journal_source_line_facts;
update public.erp_gl_entry_mirror set party='  Different supplier  ' where org_id='21950000-0000-0000-0000-00000000000a' and erp_name='gparty';
set local role authenticated;


select throws_ok($test$select public.create_record_only_journal_purchase(pg_temp.journal_group() || '{"erp_documents":[{"id":"x"}]}'::jsonb,true)$test$, '22023','unsupported_source_kind','AC-ROP-022 mixed sources refused in preview');
select throws_ok($test$do $body$ begin perform public.create_record_only_journal_purchase(pg_temp.journal_group() || '{"erp_documents":[{"id":"x"}]}'::jsonb,false); raise exception 'unexpected_success' using errcode='P0002'; end $body$$test$, '22023','unsupported_source_kind','AC-ROP-022 mixed sources refused on apply');
reset role;
insert into public.org_features(org_id,feature_key,enabled) values ('21950000-0000-0000-0000-00000000000a','procurement',false) on conflict (org_id,feature_key) do update set enabled=false;
set local role authenticated;
select throws_ok($test$select public.create_record_only_journal_purchase(pg_temp.journal_group(),true)$test$, 'P0001','feature_off','AC-ROP-020 disabled procurement refuses capture');
reset role;
update public.org_features set enabled=true where org_id='21950000-0000-0000-0000-00000000000a' and feature_key='procurement';
set local role authenticated;
select has_function('public', 'create_record_only_journal_purchase', array['jsonb', 'boolean'], 'AC-ROP-001 record-only journal RPC exists');
select lives_ok($test$select public.create_record_only_journal_purchase(
  '{"request_id":"21950000-0000-0000-0000-000000000991","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"reference":"Reference","title":"Historical purchase","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-1","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb, false)$test$, 'AC-ROP-001 Admin records journal purchase');
select is((select count(*)::int from project_erp_journal_lines('21950000-0000-0000-0000-0000000000d1') where voucher_no='JV-1' and procurement_id is not null), 1, 'AC-ROP-001 journal read shows purchase');
select is((select count(*)::int from procurements where title = 'Historical purchase' and total_value = 60 and currency = 'IDR'), 1, 'AC-ROP-001 wrapper holds ledger amount');
reset role;
insert into public.purchase_orders(id,org_id,procurement_id,status) values ('21950000-0000-0000-0000-000000000902','21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-0000000000e2','Draft');
update public.procurements set record_only=true where id='21950000-0000-0000-0000-0000000000e2';
select is(public.po_revision_push_refusal('21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-000000000902',1,true),'record_only_forward_step_refused','AC-ROP-004 revise by order id refuses record-only purchase');
delete from public.purchase_orders where id='21950000-0000-0000-0000-000000000902';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select status::text from public.procurements where title='Historical purchase'),'Paid','AC-ROP-003 historical journal purchase is shown as Paid');
select is((select count(*)::int from public.payments where procurement_id=(select id from public.procurements where title='Historical purchase')),0,'AC-ROP-003 no payment record is invented');
select is((select coalesce(sum(actuals_to_date),0) from public.project_mapped_actuals('21950000-0000-0000-0000-0000000000d1')),current_setting('rop.before_actuals')::numeric,'AC-ROP-001 capture leaves project actuals unchanged');
select is((select coalesce(sum(amount),0) from public.project_committed_spend('21950000-0000-0000-0000-0000000000d1') where currency='IDR'),current_setting('rop.before_committed')::numeric,'AC-ROP-004 capture leaves project committed spend unchanged');
-- Each request uses a stable source identity and is safe to preview and retry.
select is(public.create_record_only_journal_purchase(
  '{"request_id":"21950000-0000-0000-0000-000000000991","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"reference":"Reference","title":"Historical purchase","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-1","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb, false)->>'outcome', 'skip', 'AC-ROP-008 retry is idempotent');
select set_config('rop.retry',public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000991","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"reference":"Reference","title":"Historical purchase","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-1","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb,false)::text,true);
select is(current_setting('rop.retry')::jsonb->>'actuals_delta','0','AC-ROP-008 retry reports unchanged actuals');
select is(current_setting('rop.retry')::jsonb->>'amount','60.00','AC-ROP-008 retry returns original amount');
select throws_ok($test$select public.create_record_only_journal_purchase(
  '{"request_id":"21950000-0000-0000-0000-000000000992","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"title":"Refund","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-3","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Cost of Goods - X"}]}'::jsonb, false)$test$, '22023', 'line_not_positive_or_cancelled', 'AC-ROP-007 negative journal is refused');
select throws_ok($test$select public.create_record_only_journal_purchase(
  '{"request_id":"21950000-0000-0000-0000-000000000995","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"title":"Duplicate","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-2","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X","extra":"a"},{"erp_doctype":"Journal Entry","voucher_no":"JV-2","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X","extra":"b"}]}'::jsonb,true)$test$, '22023','duplicate_line','AC-ROP-007 duplicate stable source key is refused');
select is(public.create_record_only_journal_purchase(
  '{"request_id":"21950000-0000-0000-0000-000000000993","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"title":"No reference","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-2","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb, true)->>'outcome', 'create', 'AC-ROP-001 reference is optional');
select set_config('rop.preview', public.create_record_only_journal_purchase(
  '{"request_id":"21950000-0000-0000-0000-000000000993","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"title":"No reference","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-2","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb, true)::text, true);
select is(current_setting('rop.preview')::jsonb->>'assignment_origin','erp_project','AC-ROP-012 preview identifies ERP project origin');
select is(current_setting('rop.preview')::jsonb->>'actuals_delta','0','AC-ROP-012 preview reports zero actuals delta');
select is(current_setting('rop.preview')::jsonb->>'source_date','2026-03-05','AC-ROP-001 preview reports source date');
select is(current_setting('rop.preview')::jsonb->>'stage','already_settled_in_erp','AC-ROP-003 journal carries settled evidence');
select is((select count(*)::int from procurements where title='No reference'), 0, 'AC-ROP-008 preview writes no purchase');
select is((select amount from procurement_open_commitments(array[(select id from procurements where title='Historical purchase')])), 0::numeric, 'AC-ROP-004 journal creates zero open commitment');
reset role;
select throws_ok($test$update public.procurements set status='Ordered' where title='Historical purchase'$test$, '42501','history_complete','AC-ROP-004 direct forward status update is refused');
select throws_ok($test$update public.procurements set status='Cancelled' where title='Historical purchase'$test$, '42501','record_only_use_undo','AC-ROP-009 cancellation cannot leave attached sources');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($test$select public.transition_procurement((select id from procurements where title='Historical purchase'), 'Requested')$test$, '42501', 'history_complete', 'AC-ROP-004 forward transition is refused');
select lives_ok($test$update public.procurements set title='Historical purchase edited' where title='Historical purchase'$test$, 'AC-ROP-004 title remains editable');
select throws_ok($test$update public.procurements set record_only=false where title='Historical purchase edited'$test$, '42501', 'permission denied for table procurements', 'AC-ROP-004 client cannot remove guard marker');
select throws_ok($test$update public.procurements set total_value=1 where title='Historical purchase edited'$test$, '42501', 'record_only_source_locked', 'AC-ROP-004 captured amount cannot be edited');
select throws_ok($test$select public.create_purchase_order((select id from public.procurements where title='Historical purchase edited'),null,'Draft',current_date,10)$test$, '42501', 'history_complete', 'AC-ROP-004 transactional child insert is refused');
select is(public.attach_erp_journal_lines(jsonb_build_array(jsonb_build_object('erp_doctype','Journal Entry','voucher_no','JV-2','project_id','21950000-0000-0000-0000-0000000000d1','account','Project Subcontractors - X','procurement_id',(select id from public.procurements where title='Historical purchase edited'))),false)#>>'{results,0,reason}','record_only_use_undo','AC-ROP-007 ordinary attach cannot change record-only sources');
select is(public.link_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_doctype','Purchase Invoice','erp_name','PINV-TEST','procurement_id',(select id from public.procurements where title='Historical purchase edited'))),false)#>>'{results,0,reason}','record_only_use_undo','AC-ROP-007 ordinary document linking cannot change a journal wrapper');
select throws_ok($test$select public.detach_erp_journal_line((select link_id from public.project_erp_journal_lines('21950000-0000-0000-0000-0000000000d1') where voucher_no='JV-1'))$test$, '42501', 'record_only_use_undo', 'AC-ROP-009 ordinary detach cannot leave a half wrapper');
select is((select coalesce(sum(actuals_to_date),0) from public.project_mapped_actuals('21950000-0000-0000-0000-0000000000d1')), 110::numeric, 'AC-ROP-001 actuals stay ledger-derived');
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase('{}'::jsonb,true)$test$, '42501', 'not authorized', 'AC-ROP-005 Finance cannot preview');
select throws_ok($test$insert into public.procurements(org_id,title,requested_by_id,record_only) values ('21950000-0000-0000-0000-00000000000a','Forged','21950000-0000-0000-0000-0000000000a1',true)$test$, '42501','permission denied for table procurements','AC-ROP-005 direct insert cannot forge record-only provenance');
select throws_ok($test$select public.undo_captured_purchase('21950000-0000-0000-0000-0000000000e1','reason',false)$test$, '42501', 'not authorized', 'AC-ROP-005 Finance cannot undo');
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase(
  '{"request_id":"21950000-0000-0000-0000-000000000994","project_id":"21950000-0000-0000-0000-0000000000d3","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"title":"Cross org","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-B","project_id":"21950000-0000-0000-0000-0000000000d3","account":"Project Subcontractors - X"}]}'::jsonb,false)$test$, '22023', 'project_not_found', 'AC-ROP-006 foreign project is not disclosed');
select set_config('rop.committed_before', (select coalesce(sum(amount),0)::text from public.project_committed_spend('21950000-0000-0000-0000-0000000000d1') where currency='IDR'), true);
reset role;
update public.erp_gl_entry_mirror set is_cancelled=true where org_id='21950000-0000-0000-0000-00000000000a' and voucher_no='JV-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select amount from public.procurement_open_commitments(array[(select id from public.procurements where title='Historical purchase edited')])),0::numeric,'AC-ROP-011 cancellation does not create journal commitment');
select is((select coalesce(sum(amount),0) from public.project_committed_spend('21950000-0000-0000-0000-0000000000d1') where currency='IDR'),current_setting('rop.committed_before')::numeric,'AC-ROP-011 project commitment does not increase on cancellation');
reset role;
update public.erp_gl_entry_mirror set is_cancelled=false where org_id='21950000-0000-0000-0000-00000000000a' and voucher_no='JV-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
reset role;
select throws_ok($test$select public.insert_procurement_outbox_pending('21950000-0000-0000-0000-00000000000a','forged','test-key','erpnext','create',jsonb_build_object('procurementId',(select id::text from public.procurements where title='Historical purchase edited'),'erp_doc_kind','purchase-order'),'digest','21950000-0000-0000-0000-0000000000a4',(select id from public.procurements where title='Historical purchase edited'),'[]'::jsonb)$test$, '42501', 'history_complete', 'AC-ROP-004 forged outbox insert is refused');
select is(public.procurement_create_refusal('21950000-0000-0000-0000-00000000000a',(select id from public.procurements where title='Historical purchase edited'),'purchase-order','21950000-0000-0000-0000-0000000000a4'), 'history_complete', 'AC-ROP-004 queued ERP create is refused');
select is((select count(*)::int from public.external_command_outbox where org_id='21950000-0000-0000-0000-00000000000a'),0,'AC-ROP-004 no ERP outbox created');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase('{}'::jsonb,true)$test$, '42501', 'not authorized', 'AC-ROP-005 Project Manager cannot preview');
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase('{}'::jsonb,true)$test$, '42501', 'not authorized', 'AC-ROP-005 Engineer cannot preview');
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select set_config('rop.multiline', public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines}',(pg_temp.journal_group()->'journal_lines') || '[{"erp_doctype":"Journal Entry","voucher_no":"JV-4","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]'::jsonb),true)::text,true);
select is((current_setting('rop.multiline')::jsonb->>'amount')::numeric,60::numeric,'AC-ROP-001 two source lines are summed');
select is(jsonb_array_length(current_setting('rop.multiline')::jsonb->'source_keys'),2,'AC-ROP-001 preview retains both source keys');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-MIX"'),true)$test$, '22023','negative_line_requires_review','AC-ROP-007 negative source rows cannot be silently netted');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines}','[{"erp_doctype":"Journal Entry","voucher_no":"JV-UNKNOWN-1","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"},{"erp_doctype":"Journal Entry","voucher_no":"JV-UNKNOWN-2","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]'::jsonb),true)$test$, '22023','supplier_mismatch','AC-ROP-007 different unresolved parties cannot share a purchase');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-MIXPARTY"'),true)$test$, '22023','supplier_mismatch','AC-ROP-007 multiple parties in one journal line are refused');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-MIXPARTY"') || '{"supplier_override_reason":"Attempt to override"}'::jsonb,true)$test$, '22023','supplier_mismatch','AC-ROP-SAFETY-PARTY an override cannot bypass multiple parties');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-UNKNOWN-1"'),true)$test$, '22023','supplier_mismatch','AC-ROP-SAFETY-PARTY unresolved nonblank supplier requires a reason');
select lives_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-UNKNOWN-1"') || '{"supplier_override_reason":"Reviewed unknown supplier"}'::jsonb,true)$test$, 'AC-ROP-SAFETY-PARTY explicit reason permits unresolved supplier');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-PARTY"'),'{vendor_confirmed}','false'),true)$test$, '22023','supplier_mismatch','AC-ROP-007 confirmation cannot override a known conflicting supplier');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-PARTY"'),true)$test$, '22023','supplier_mismatch','AC-ROP-007 a conflicting known supplier is refused');
select ok(not has_function_privilege('anon','public.create_record_only_journal_purchase(jsonb,boolean)','execute'),'AC-ROP-005 anonymous create is revoked');
select ok(not has_function_privilege('anon','public.undo_captured_purchase(uuid,text,boolean)','execute'),'AC-ROP-005 anonymous undo is revoked');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{vendor_confirmed}','false'),true)$test$, '22023','vendor_confirmation_required','AC-ROP-007 a missing supplier needs explicit confirmation');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{vendor_id}','"21950000-0000-0000-0000-000000000902"'),true)$test$, '22023','vendor_not_found','AC-ROP-006 a foreign vendor is not disclosed');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,project_id}','"21950000-0000-0000-0000-0000000000d2"'),true)$test$, '22023','project_mismatch','AC-ROP-007 mixed projects are refused');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-1"'),true)$test$, '22023','line_already_attached','AC-ROP-007 an attached line is refused');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines,0,voucher_no}','"JV-PMO"'),true)$test$, '22023','line_not_found','AC-ROP-007 a PMO-posted journal is refused');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{title}','""'),true)$test$, '22023','required_field_missing','AC-ROP-007 a title is required');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{request_id}','"21950000-0000-0000-0000-000000000991"'),true)$test$, '22023','request_payload_changed','AC-ROP-008 changed payload on a retry is refused');
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase('{}'::jsonb,true)$test$, '42501','not authorized','AC-ROP-005 Executive cannot preview');
select ok(not ('Viewer' = any(enum_range(null::public.user_role)::text[])), 'AC-ROP-005 Viewer is not a database role');
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase('{}'::jsonb,true)$test$, '42501',null,'AC-ROP-005 inactive Admin cannot preview');
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
reset role;
select throws_ok($test$select public.assert_record_only_rollback_safe()$test$, '55000','record_only_history_exists','AC-ROP-009 rollback cannot discard captured history');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select has_table('public','erp_purchase_captures','AC-ROP-001 shared capture provenance exists');
select is((select kind from public.erp_purchase_captures where procurement_id=(select id from public.procurements where title='Historical purchase edited')),'journal','AC-ROP-001 provenance identifies journal source kind');
select throws_ok($test$select public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines}','[]'),true)$test$, '22023','invalid_lines','AC-ROP-007 an empty source group is refused');
select throws_ok($test$select public.undo_captured_purchase((select id from public.procurements where title='Historical purchase edited'),' ',true)$test$, '22023','reason_required','AC-ROP-009 undo needs a reason');
reset role;
insert into public.external_org_bindings(org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21950000-0000-0000-0000-00000000000a','odoo','https://other.example.test','test-ref','{}',now(),'active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase(pg_temp.journal_group(),true)$test$, '22023','ambiguous_binding','AC-ROP-006 ambiguous active sources are not guessed');
reset role;
delete from public.external_org_bindings where org_id='21950000-0000-0000-0000-00000000000a' and external_tier='odoo';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select set_config('rop.multiline_applied',public.create_record_only_journal_purchase(jsonb_set(pg_temp.journal_group(),'{journal_lines}',(pg_temp.journal_group()->'journal_lines') || '[{"erp_doctype":"Journal Entry","voucher_no":"JV-4","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]'::jsonb),false)::text,true);
select is((select total_value from public.procurements where id=(current_setting('rop.multiline_applied')::jsonb->>'procurement_id')::uuid),60::numeric,'AC-ROP-001 multiple lines create one purchase with their sum');
select is((select count(*)::int from public.erp_journal_line_links where procurement_id=(current_setting('rop.multiline_applied')::jsonb->>'procurement_id')::uuid),2,'AC-ROP-001 both lines attach to that purchase');
select has_function('public','undo_captured_purchase',array['uuid','text','boolean'], 'AC-ROP-009 undo RPC exists');
select lives_ok($test$select public.undo_captured_purchase((select id from procurements where title='Historical purchase edited'),'Incorrect link',false)$test$, 'AC-ROP-009 Admin undoes record');
select is((select status::text from public.procurements where title='Historical purchase edited'),'Cancelled','AC-ROP-009 undo cancels wrapper');
select is((select count(*)::int from public.project_erp_journal_lines('21950000-0000-0000-0000-0000000000d1') where voucher_no='JV-1' and procurement_id is null),1,'AC-ROP-009 undo releases source');
select is(public.undo_captured_purchase((select id from public.procurements where title='Historical purchase edited'),'Repeated undo',false)->>'outcome','skip','AC-ROP-009 repeated undo is a no-op');
select is(public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000991","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"reference":"Reference","title":"Historical purchase","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-1","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb,false)->>'reason','undone','AC-ROP-SAFETY-REPLAY undo is reported on replay');
select is(public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000991","project_id":"21950000-0000-0000-0000-0000000000d1","vendor_id":"21950000-0000-0000-0000-000000000901","vendor_confirmed":true,"reference":"Reference","title":"Historical purchase","journal_lines":[{"erp_doctype":"Journal Entry","voucher_no":"JV-1","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]}'::jsonb,false)->>'outcome','refused','AC-ROP-SAFETY-REPLAY undone replay is not counted as recorded');
select is((select count(*)::int from public.erp_purchase_captures where request_id='21950000-0000-0000-0000-000000000991'),1,'AC-ROP-SAFETY-REPLAY identity remains unique after undo');
select is((select coalesce(sum(actuals_to_date),0) from public.project_mapped_actuals('21950000-0000-0000-0000-0000000000d1')),110::numeric,'AC-ROP-009 undo leaves actuals unchanged');
select is((select count(*)::int from public.erp_journal_line_links where procurement_id=(select id from public.procurements where title='Historical purchase edited')),0,'AC-ROP-009 no journal links remain after undo');
select is((select count(*)::int from public.external_command_outbox where org_id='21950000-0000-0000-0000-00000000000a'),0,'AC-ROP-009 undo creates no outbox');
select is((select detail->>'assignment_origin' from public.audit_events where action='procurement.record_only_create' and entity_id=(select id from public.procurements where title='Historical purchase edited')),'erp_project','AC-ROP-032 create audit records assignment origin');
select is((select detail->>'actuals_delta' from public.audit_events where action='procurement.record_only_undo' and entity_id=(select id from public.procurements where title='Historical purchase edited')),'0','AC-ROP-032 undo audit records unchanged placement');
select is((select count(*)::int from public.audit_events where action='procurement.record_only_create' and entity_id=(select id from public.procurements where title='Historical purchase edited')),1,'AC-ROP-032 create audit survives undo');
select is((select count(*)::int from public.audit_events where action='procurement.record_only_undo' and entity_id=(select id from public.procurements where title='Historical purchase edited')),1,'AC-ROP-032 undo is audited once');
select ok((select undone_at is not null and undo_reason='Incorrect link' from public.erp_purchase_captures where procurement_id=(select id from public.procurements where title='Historical purchase edited')),'AC-ROP-009 shared provenance retains undo reason');
reset role;
insert into auth.users(id,email) values ('21950000-0000-0000-0000-0000000000b2','rrp-b-admin@example.com');
insert into public.profiles(id,org_id,full_name,email,role,status) values ('21950000-0000-0000-0000-0000000000b2','21950000-0000-0000-0000-00000000000b','B Admin','rrp-b-admin@example.com','Admin','active');
update public.external_org_bindings set external_tier='odoo',config='{"ledger_basis_at":"2026-01-01"}'::jsonb where org_id='21950000-0000-0000-0000-00000000000b';
insert into public.external_project_bindings(org_id,project_id,external_tier,external_container_id) values ('21950000-0000-0000-0000-00000000000b','21950000-0000-0000-0000-0000000000d3','odoo','ERP-B1');
update public.erp_gl_entry_mirror set voucher_type='account.move',party='Unmapped partner' where org_id='21950000-0000-0000-0000-00000000000b' and voucher_no='JV-B';
insert into public.external_master_records(org_id,external_tier,kind,external_id,name,active,attrs,source_write_date) values ('21950000-0000-0000-0000-00000000000b','odoo','company','1','Company B',true,'{"currency":"EUR"}',now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000997","project_id":"21950000-0000-0000-0000-0000000000d3","vendor_id":"21950000-0000-0000-0000-000000000902","vendor_confirmed":true,"supplier_override_reason":"Reviewed source","title":"Odoo journal","journal_lines":[{"erp_doctype":"account.move","voucher_no":"JV-B","project_id":"21950000-0000-0000-0000-0000000000d3","account":"Project Subcontractors - X"}]}'::jsonb,true)$test$, '22023','currency_mismatch','AC-ROP-024 mismatched company currency refused on preview');
select throws_ok($test$do $body$ begin perform public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000997","project_id":"21950000-0000-0000-0000-0000000000d3","vendor_id":"21950000-0000-0000-0000-000000000902","vendor_confirmed":true,"supplier_override_reason":"Reviewed source","title":"Odoo journal","journal_lines":[{"erp_doctype":"account.move","voucher_no":"JV-B","project_id":"21950000-0000-0000-0000-0000000000d3","account":"Project Subcontractors - X"}]}'::jsonb,false); raise exception 'unexpected_success' using errcode='P0002'; end $body$$test$, '22023','currency_mismatch','AC-ROP-024 mismatched company currency refused on apply');
reset role;
update public.external_master_records set attrs='{"currency":"IDR"}' where org_id='21950000-0000-0000-0000-00000000000b' and kind='company';
set local role authenticated;
select throws_ok($test$select public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000997","project_id":"21950000-0000-0000-0000-0000000000d3","vendor_id":"21950000-0000-0000-0000-000000000902","vendor_confirmed":false,"title":"Odoo journal","journal_lines":[{"erp_doctype":"account.move","voucher_no":"JV-B","project_id":"21950000-0000-0000-0000-0000000000d3","account":"Project Subcontractors - X"}]}'::jsonb,true)$test$, '22023','vendor_confirmation_required','AC-ROP-007 unresolved ledger party needs vendor confirmation');
select is(public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000997","project_id":"21950000-0000-0000-0000-0000000000d3","vendor_id":"21950000-0000-0000-0000-000000000902","vendor_confirmed":true,"supplier_override_reason":"Reviewed source","title":"Odoo journal","journal_lines":[{"erp_doctype":"account.move","voucher_no":"JV-B","project_id":"21950000-0000-0000-0000-0000000000d3","account":"Project Subcontractors - X"}]}'::jsonb,false)->>'outcome','create','AC-ROP-010 Odoo ledger journal is recorded');
reset role;
update public.external_master_records set attrs='{"currency":"EUR"}' where org_id='21950000-0000-0000-0000-00000000000b' and kind='company';
set local role authenticated;
select throws_ok($test$select public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000997","project_id":"21950000-0000-0000-0000-0000000000d3","vendor_id":"21950000-0000-0000-0000-000000000902","vendor_confirmed":true,"supplier_override_reason":"Reviewed source","title":"Odoo journal","journal_lines":[{"erp_doctype":"account.move","voucher_no":"JV-B","project_id":"21950000-0000-0000-0000-0000000000d3","account":"Project Subcontractors - X"}]}'::jsonb,false)$test$, '22023','currency_mismatch','AC-ROP-024 mismatched company currency refused on retry');
reset role;
update public.external_master_records set attrs='{"currency":"IDR"}' where org_id='21950000-0000-0000-0000-00000000000b' and kind='company';
set local role authenticated;
select is((select total_value from public.procurements where title='Odoo journal'),30::numeric,'AC-ROP-010 Odoo amount comes from ledger');
select is((select count(*)::int from public.project_erp_journal_lines('21950000-0000-0000-0000-0000000000d3') where voucher_no='JV-B' and procurement_id is not null),1,'AC-ROP-001 Odoo journal read shows purchase');
reset role;
select throws_ok($test$insert into public.erp_purchase_captures(procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by) values ('21950000-0000-0000-0000-0000000000e1','21950000-0000-0000-0000-00000000000a',(select id from public.external_org_bindings where org_id='21950000-0000-0000-0000-00000000000b'),'21950000-0000-0000-0000-000000000998','{}','journal','paid','21950000-0000-0000-0000-0000000000a4')$test$, '23514','capture_org_mismatch','AC-ROP-006 capture provenance cannot cross organizations');
update public.external_org_bindings set config='{}'::jsonb where org_id='21950000-0000-0000-0000-00000000000b';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($test$select public.create_record_only_journal_purchase('{"request_id":"21950000-0000-0000-0000-000000000999","project_id":"21950000-0000-0000-0000-0000000000d3","vendor_id":"21950000-0000-0000-0000-000000000902","vendor_confirmed":true,"title":"Missing basis","journal_lines":[{"erp_doctype":"account.move","voucher_no":"JV-B","project_id":"21950000-0000-0000-0000-0000000000d3","account":"Project Subcontractors - X"}]}'::jsonb,true)$test$, '22023','ledger_basis_missing','AC-ROP-007 missing ledger basis is refused');
reset role;
select is((select count(*)::int from public.audit_events where org_id='21950000-0000-0000-0000-00000000000b' and action='procurement.record_only_create'),1,'AC-ROP-008 preview writes no second audit');
select is((select count(*)::int from public.erp_purchase_captures where org_id='21950000-0000-0000-0000-00000000000b'),1,'AC-ROP-008 preview writes no capture');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000b2","role":"authenticated"}';
reset role;
select * from finish();
rollback;
