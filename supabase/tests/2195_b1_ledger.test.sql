-- #2195 B1 round 3: an invoice an Admin placed on a project moves its ledger cost from where a rule or equipment pool had it,
-- counts once, and leaves the organization's ledger total unchanged. Amounts are ledger amounts, never invoice faces.
begin;
select plan(25);
insert into organizations(id,name,default_currency) values
 ('21951004-0000-0000-0000-000000000001','Ledger org','USD'),
 ('21951004-0000-0000-0000-000000000011','No-rule org','USD');
insert into auth.users(id,email) values
 ('21951004-0000-0000-0000-000000000002','ledger-1@example.test'),
 ('21951004-0000-0000-0000-000000000003','ledger-2@example.test'),
 ('21951004-0000-0000-0000-000000000012','ledger-m@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('21951004-0000-0000-0000-000000000002','21951004-0000-0000-0000-000000000001','Admin 1','ledger-1@example.test','Admin','active'),
 ('21951004-0000-0000-0000-000000000003','21951004-0000-0000-0000-000000000001','Admin 2','ledger-2@example.test','Admin','active'),
 ('21951004-0000-0000-0000-000000000012','21951004-0000-0000-0000-000000000011','Admin M','ledger-m@example.test','Admin','active');
insert into projects(id,org_id,name,status) values
 ('21951004-0000-0000-0000-00000000000a','21951004-0000-0000-0000-000000000001','Project A','Ongoing Project'),
 ('21951004-0000-0000-0000-00000000000b','21951004-0000-0000-0000-000000000001','Project B','Ongoing Project'),
 ('21951004-0000-0000-0000-00000000001a','21951004-0000-0000-0000-000000000011','Project X','Ongoing Project');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21951004-0000-0000-0000-000000000005','21951004-0000-0000-0000-000000000001','erpnext','https://example.test','test','{"company":"Example"}',now(),'active'),
 ('21951004-0000-0000-0000-000000000015','21951004-0000-0000-0000-000000000011','erpnext','https://example.test','test','{"company":"Example"}',now(),'active');
insert into budget_category_account_map(org_id,category,erp_account) values
 ('21951004-0000-0000-0000-000000000001','Materials','Cost'),('21951004-0000-0000-0000-000000000001','Equipment','Fuel'),('21951004-0000-0000-0000-000000000001','Overheads','Amort'),
 ('21951004-0000-0000-0000-000000000011','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
select o.id,'Example',a.n,a.n,a.t,case when a.t='Expense' then 'Profit and Loss' else 'Balance Sheet' end,false,'USD',a.l,a.l+1,'21951004-0000-0000-0000-000000000099'
from (values ('21951004-0000-0000-0000-000000000001'::uuid),('21951004-0000-0000-0000-000000000011'::uuid)) o(id)
cross join (values ('Cost','Expense',1),('Fuel','Expense',3),('Amort','Expense',5),('Fixed Assets','Asset',7),('Creditors','Liability',9)) a(n,t,l);
-- a rule sends every untagged Cost line to A; an equipment setting splits the Fuel pool by approved hours (all to A)
insert into cost_attribution_rules(id,org_id,rule_key,version,name,match_account,effective_from,specificity) values ('21951004-0000-0000-0000-0000000000d1','21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-0000000000d2',1,'Cost rule','Cost','2026-01-01',2);
insert into cost_attribution_rule_targets(rule_id,org_id,position,project_id,percent) values ('21951004-0000-0000-0000-0000000000d1','21951004-0000-0000-0000-000000000001',0,'21951004-0000-0000-0000-00000000000a',100);
insert into equipment_assets(id,org_id,code,name,default_unit) values ('21951004-0000-0000-0000-0000000000e1','21951004-0000-0000-0000-000000000001','TRK','Truck','hours');
insert into equipment_costing_settings(org_id,asset_id,setting_key,version,basis,driver,rate_unit,match_account,specificity,effective_from) values ('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-0000000000e1','21951004-0000-0000-0000-0000000000e2',1,'actual_cost','units','hours','Fuel',12,'2026-01-01');
insert into equipment_usage_entries(org_id,asset_id,project_id,work_date,quantity,unit,kind,status,author_id,approver_id,approved_at) values ('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-0000000000e1','21951004-0000-0000-0000-00000000000a','2026-02-10',8,'hours','work','Approved','21951004-0000-0000-0000-000000000002','21951004-0000-0000-0000-000000000003',now());
-- a published tagged snapshot for both projects (nothing tagged: net 0), so a project with no placed cost reads 0, not unknown
insert into erp_actuals_snapshot(org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-00000000000a','Cost','2026',0,now(),'21951004-0000-0000-0000-000000000098',now()),
 ('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-00000000000b','Cost','2026',0,now(),'21951004-0000-0000-0000-000000000098',now()),
 ('21951004-0000-0000-0000-000000000011','21951004-0000-0000-0000-00000000001a','Cost','2026',0,now(),'21951004-0000-0000-0000-000000000097',now());
create function pg_temp.doc(p_org uuid,n integer,p_currency text,p_face numeric) returns void language sql as $$
 insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,currency,grand_total,net_total,erp_status,erp_docstatus,erp_modified)
 values (('21951004-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,p_org,'Purchase Invoice','INV-L'||n,'SUP-1',p_currency,p_face,p_face,'Unpaid',1,'1') $$;
create function pg_temp.gl(p_org uuid,p_voucher text,p_account text,p_debit numeric,p_credit numeric default 0,p_party text default 'Supplier',p_type text default 'Purchase Invoice') returns uuid language sql as $$
 insert into erp_gl_entry_mirror(org_id,erp_name,company,account,fiscal_year,party_type,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
 values (p_org,'GL-'||p_voucher||'-'||p_account||'-'||p_debit||'-'||p_credit,'Example',p_account,'2026',p_party,p_type,p_voucher,'2026-02-01',p_debit,p_credit,false,'1') returning id $$;
create function pg_temp.assign(p_org uuid,p_binding uuid,p_actor uuid,n integer,p_project uuid) returns void language sql as $$
 insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,actor_id,source_voucher_type,source_voucher_no,source_company)
 values (p_org,p_binding,('21951004-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,gen_random_uuid(),'x','project',p_project,p_actor,'Purchase Invoice','INV-L'||n,'Example') $$;
-- INV-L1: mapped cost 100 in company currency on an invoice whose face is 120 EUR (the face never counts)
select pg_temp.doc('21951004-0000-0000-0000-000000000001',1,'EUR',120);
select set_config('l.gl1',pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L1','Cost',100)::text,true);
select pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L1','Creditors',0,100);
-- INV-L2: a fuel line the equipment pool would give to A
select pg_temp.doc('21951004-0000-0000-0000-000000000001',2,'USD',60);
select pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L2','Fuel',60);
select pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L2','Creditors',0,60);
-- unrelated mapped amortisation (a journal): stays where it is, 5
select pg_temp.gl('21951004-0000-0000-0000-000000000001','JV-1','Amort',5,0,'Supplier','Journal Entry');
create function pg_temp.act(p_project uuid,p_category text) returns numeric language sql as $$ select actuals_to_date from public.project_mapped_actuals(p_project) where category=p_category::public.budget_category $$;
create function pg_temp.act_all(p_project uuid,p_category text) returns numeric language sql as $$ select actuals_to_date from public.project_mapped_actuals_all() where project_id=p_project and category=p_category::public.budget_category $$;
-- the organization's mapped ledger, summed straight from the mirror, against what the projects show plus what no project has
create function pg_temp.ledger_total() returns numeric language sql as $$
 select sum(g.debit-g.credit) from erp_gl_entry_mirror g join budget_category_account_map m on m.org_id=g.org_id and m.erp_account=g.account where g.org_id='21951004-0000-0000-0000-000000000001' $$;
create function pg_temp.shown_total() returns numeric language sql as $$
 select coalesce((select sum(actuals_to_date) from public.project_mapped_actuals_all() where project_id in ('21951004-0000-0000-0000-00000000000a','21951004-0000-0000-0000-00000000000b')),0)
      + (select coalesce(sum(g.debit-g.credit),0) from erp_gl_entry_mirror g where g.org_id='21951004-0000-0000-0000-000000000001' and g.voucher_no='JV-1') $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951004-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.act('21951004-0000-0000-0000-00000000000a','Materials'),100::numeric,'AC-ROP-003 assignment supersedes rule and equipment: before the assignment the rule gives A the 100');
select is(pg_temp.act('21951004-0000-0000-0000-00000000000a','Equipment'),60::numeric,'AC-ROP-003 before the assignment the equipment pool gives A the fuel 60');
select is(pg_temp.act('21951004-0000-0000-0000-00000000000b','Materials'),0::numeric,'AC-ROP-003 B has nothing before the assignment');
select is(pg_temp.ledger_total(),pg_temp.shown_total(),'AC-ROP-003 before: the projects plus the unattributed ledger equal the organization ledger');
reset role;
select is((select count(*)::int from cost_attribution_engine('21951004-0000-0000-0000-000000000001') where gl_id=current_setting('l.gl1')::uuid),1,'AC-ROP-003 before: the attribution engine allocates the INV-L1 line to the rule');
select pg_temp.assign('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-000000000005','21951004-0000-0000-0000-000000000002',1,'21951004-0000-0000-0000-00000000000b');
select is((select count(*)::int from cost_attribution_engine('21951004-0000-0000-0000-000000000001') where gl_id=current_setting('l.gl1')::uuid),0,'AC-ROP-003 an assigned line is excluded from the engine input, so preview and totals agree');
set local role authenticated;
select is(pg_temp.act('21951004-0000-0000-0000-00000000000a','Materials'),0::numeric,'AC-ROP-003 assigned to B: A drops from 100 to 0');
select is(pg_temp.act('21951004-0000-0000-0000-00000000000b','Materials'),100::numeric,'AC-ROP-010 foreign face currency uses ledger: B shows the 100 ledger amount, not the 120 EUR face');
select is(pg_temp.act('21951004-0000-0000-0000-00000000000a','Equipment'),60::numeric,'AC-ROP-003 an unassigned fuel line still follows the equipment pool');
select is(pg_temp.ledger_total(),pg_temp.shown_total(),'AC-ROP-003 after: the organization ledger total is conserved');
reset role;
select pg_temp.assign('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-000000000005','21951004-0000-0000-0000-000000000002',2,'21951004-0000-0000-0000-00000000000b');
set local role authenticated;
select is(pg_temp.act('21951004-0000-0000-0000-00000000000a','Equipment'),0::numeric,'AC-ROP-003 assignment supersedes equipment: the assigned fuel line leaves A');
select is(pg_temp.act('21951004-0000-0000-0000-00000000000b','Equipment'),60::numeric,'AC-ROP-003 and lands on B once');
reset role;
-- INV-L3: mixed, mapped cost 20 with 40 of capital spending; INV-L4: an employee-party line
select pg_temp.doc('21951004-0000-0000-0000-000000000001',3,'USD',60);
select pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L3','Cost',20);
select pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L3','Fixed Assets',40);
select pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L3','Creditors',0,60);
select pg_temp.assign('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-000000000005','21951004-0000-0000-0000-000000000002',3,'21951004-0000-0000-0000-00000000000b');
select is((select sum(amount) from capture_assigned_gl('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-00000000000b') where account='Fixed Assets'),null,'AC-ROP-025 only mapped expense: capital spending contributes nothing');
set local role authenticated;
select is(pg_temp.act('21951004-0000-0000-0000-00000000000b','Materials'),120::numeric,'AC-ROP-025 a mixed invoice adds its mapped 20 only');
select is(pg_temp.act('21951004-0000-0000-0000-00000000000a','Materials'),0::numeric,'AC-ROP-025 the mixed invoice no longer reaches A through the rule');
select is(pg_temp.act('21951004-0000-0000-0000-00000000000b','Overheads'),0::numeric,'AC-ROP-025 unrelated mapped amortisation is not placed anywhere');
select is((select sum(g.debit-g.credit) from erp_gl_entry_mirror g where g.voucher_no='JV-1' and g.org_id='21951004-0000-0000-0000-000000000001'),5::numeric,'AC-ROP-025 the unrelated amortisation stays 5');
select is(pg_temp.ledger_total(),pg_temp.shown_total(),'AC-ROP-025 the organization ledger total is still conserved');
reset role;
-- single and all-project reads agree on every category, for both projects
set local role authenticated;
select is((select count(*)::int from (select c.category from unnest(enum_range(null::public.budget_category)) c(category)) c
   where pg_temp.act('21951004-0000-0000-0000-00000000000a',c.category::text) is distinct from pg_temp.act_all('21951004-0000-0000-0000-00000000000a',c.category::text)
      or pg_temp.act('21951004-0000-0000-0000-00000000000b',c.category::text) is distinct from pg_temp.act_all('21951004-0000-0000-0000-00000000000b',c.category::text)),0,'AC-ROP-003 single and all project reads agree');
reset role;
select is((select count(*)::int from external_command_outbox where org_id='21951004-0000-0000-0000-000000000001'),0,'AC-ROP-003 placement writes nothing to the ERP outbox');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='21951004-0000-0000-0000-000000000001' and coalesce(project,'')<>''),0,'AC-ROP-003 placement changes no ledger project');
-- an employee-party line keeps its party type so the existing audience narrowing applies
select pg_temp.doc('21951004-0000-0000-0000-000000000001',4,'USD',10);
select pg_temp.gl('21951004-0000-0000-0000-000000000001','INV-L4','Cost',10,0,'Employee');
select pg_temp.assign('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-000000000005','21951004-0000-0000-0000-000000000002',4,'21951004-0000-0000-0000-00000000000b');
select is((select party_type from capture_assigned_gl('21951004-0000-0000-0000-000000000001','21951004-0000-0000-0000-00000000000b') where amount=10),'Employee','AC-ROP-003 an assigned employee-party line keeps its party type');
-- an organization with no rule and no equipment setting still shows its assignment
select pg_temp.doc('21951004-0000-0000-0000-000000000011',5,'USD',100);
select pg_temp.gl('21951004-0000-0000-0000-000000000011','INV-L5','Cost',100);
select pg_temp.assign('21951004-0000-0000-0000-000000000011','21951004-0000-0000-0000-000000000015','21951004-0000-0000-0000-000000000012',5,'21951004-0000-0000-0000-00000000001a');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951004-0000-0000-0000-000000000012","role":"authenticated"}';
select is(pg_temp.act('21951004-0000-0000-0000-00000000001a','Materials'),100::numeric,'AC-ROP-003 an organization with no rule or equipment shows its assigned invoice (single read)');
select is(pg_temp.act_all('21951004-0000-0000-0000-00000000001a','Materials'),100::numeric,'AC-ROP-003 and in the all-project read');
reset role;
-- an undone assignment places nothing
update erp_capture_invoice_assignments set undone_at=now(),undone_reason='test' where org_id='21951004-0000-0000-0000-000000000011';
set local role authenticated;
select is(pg_temp.act('21951004-0000-0000-0000-00000000001a','Materials'),0::numeric,'AC-ROP-003 an undone assignment places nothing');
reset role;
select * from finish();
rollback;
