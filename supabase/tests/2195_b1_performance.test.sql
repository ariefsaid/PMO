-- #2195 B1 round 3: the read path of every project money screen. 5,000 unrelated ledger rows and 500 assignments over two organizations.
-- The helper reads only the assigned vouchers through the assignment and voucher indexes; its sum equals an independent sum;
-- an organization with nothing configured never runs the attribution engine. No forced scans, no latency threshold.
begin;
select plan(15);
insert into organizations(id,name,default_currency) values
 ('21951005-0000-0000-0000-000000000001','Perf 1','USD'),('21951005-0000-0000-0000-000000000002','Perf 2','USD'),('21951005-0000-0000-0000-000000000003','Perf 3','USD');
insert into auth.users(id,email) select ('21951005-0000-0000-0000-00000000010'||g)::uuid,'perf-'||g||'@example.test' from generate_series(1,3) g;
insert into profiles(id,org_id,full_name,email,role,status) select ('21951005-0000-0000-0000-00000000010'||g)::uuid,('21951005-0000-0000-0000-00000000000'||g)::uuid,'Admin '||g,'perf-'||g||'@example.test','Admin','active' from generate_series(1,3) g;
insert into projects(id,org_id,name,status)
select ('21951005-0000-0000-0000-0000000002'||o||p)::uuid,('21951005-0000-0000-0000-00000000000'||o)::uuid,'P'||o||p,'Ongoing Project' from generate_series(1,3) o cross join generate_series(1,5) p;
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status)
select ('21951005-0000-0000-0000-00000000003'||o)::uuid,('21951005-0000-0000-0000-00000000000'||o)::uuid,'erpnext','https://example.test','test','{"company":"Example"}',now(),'active' from generate_series(1,3) o;
insert into budget_category_account_map(org_id,category,erp_account) select ('21951005-0000-0000-0000-00000000000'||o)::uuid,'Materials','Cost' from generate_series(1,3) o;
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
select ('21951005-0000-0000-0000-00000000000'||o)::uuid,'Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21951005-0000-0000-0000-000000000099' from generate_series(1,3) o;
-- a rule in organization 2 (the configured control: its engine does run)
insert into cost_attribution_rules(id,org_id,rule_key,version,name,match_account,effective_from,specificity) values ('21951005-0000-0000-0000-0000000000d1','21951005-0000-0000-0000-000000000002','21951005-0000-0000-0000-0000000000d2',1,'Rule','Cost','2026-01-01',2);
insert into cost_attribution_rule_targets(rule_id,org_id,position,project_id,percent) values ('21951005-0000-0000-0000-0000000000d1','21951005-0000-0000-0000-000000000002',0,'21951005-0000-0000-0000-000000000225',100);
-- 500 assigned invoices: 250 per organization, spread over the organization's five projects (50 each), ledger amount 10 each
create temp table fixture(o integer,n integer,p integer);
insert into fixture select o,n,1+(n%5) from generate_series(1,2) o cross join generate_series(1,250) n;
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,currency,grand_total,net_total,erp_status,erp_docstatus,erp_modified)
select ('21951005-1000-000'||o||'-0000-'||lpad(n::text,12,'0'))::uuid,('21951005-0000-0000-0000-00000000000'||o)::uuid,'Purchase Invoice','A-'||o||'-'||n,'S','USD',10,10,'Unpaid',1,'1' from fixture;
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,fiscal_year,party_type,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select ('21951005-0000-0000-0000-00000000000'||o)::uuid,'GL-A-'||o||'-'||n,'Example','Cost','2026','Supplier','Purchase Invoice','A-'||o||'-'||n,'2026-02-01',10,0,false,'1' from fixture;
insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,actor_id,source_voucher_type,source_voucher_no,source_company)
select ('21951005-0000-0000-0000-00000000000'||o)::uuid,('21951005-0000-0000-0000-00000000003'||o)::uuid,('21951005-1000-000'||o||'-0000-'||lpad(n::text,12,'0'))::uuid,gen_random_uuid(),'x','project',('21951005-0000-0000-0000-0000000002'||o||p)::uuid,('21951005-0000-0000-0000-00000000010'||o)::uuid,'Purchase Invoice','A-'||o||'-'||n,'Example' from fixture;
-- 5,000 unrelated ledger rows (3,000 and 2,000), half on the mapped account, none assigned
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,fiscal_year,party_type,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select ('21951005-0000-0000-0000-00000000000'||o)::uuid,'GL-U-'||o||'-'||g,'Example',case when g%2=0 then 'Cost' else 'Other' end,'2026','Supplier','Purchase Invoice','U-'||o||'-'||g,'2026-03-01',7,0,false,'1'
from (values (1,3000),(2,2000)) c(o,cnt) cross join lateral generate_series(1,c.cnt) g;
analyze erp_gl_entry_mirror; analyze erp_capture_invoice_assignments;
grant select on fixture to authenticated;
create function pg_temp.plan(p_org uuid,p_project uuid) returns jsonb language plpgsql as $$
declare v jsonb; begin
 execute 'explain (analyze, buffers, format json) select * from public.capture_assigned_gl($1,$2)' into v using p_org,p_project; return v; end $$;
create function pg_temp.nodes(p jsonb) returns table(node jsonb) language sql as $$
 with recursive t(n) as (select p->0->'Plan' union all select c from t, jsonb_array_elements(coalesce(t.n->'Plans','[]'::jsonb)) c) select n from t $$;
select set_config('perf.plan',pg_temp.plan('21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-000000000211')::text,true);
select ok(exists(select 1 from pg_temp.nodes(current_setting('perf.plan')::jsonb) where node->>'Index Name'='erp_capture_assignment_active_project_idx'),'AC-ROP-003 the helper reads assignments through the active project index');
select ok(exists(select 1 from pg_temp.nodes(current_setting('perf.plan')::jsonb) where node->>'Index Name'='erp_gl_entry_mirror_org_voucher_idx'),'AC-ROP-003 and the ledger through the existing voucher index');
select ok((select coalesce(sum((node->>'Actual Rows')::numeric*coalesce((node->>'Actual Loops')::numeric,1)),0) from pg_temp.nodes(current_setting('perf.plan')::jsonb) where node->>'Relation Name'='erp_gl_entry_mirror')<=200,'AC-ROP-003 the helper examines only the assigned vouchers of the project, not the 5,000 unrelated rows');
-- the helper's sums equal an independent sum from the fixture
select is((select sum(amount) from capture_assigned_gl('21951005-0000-0000-0000-000000000001','21951005-0000-0000-0000-000000000211')),(select 10*count(*) from fixture where o=1 and p=1)::numeric,'AC-ROP-003 the selective project total equals the independent sum');
select is((select sum(amount) from capture_assigned_gl('21951005-0000-0000-0000-000000000002')),(select 10*count(*) from fixture where o=2)::numeric,'AC-ROP-003 the organization total equals the independent sum');
select is((select sum(amount) from capture_assigned_gl('21951005-0000-0000-0000-000000000001'))+(select sum(g.debit-g.credit) from erp_gl_entry_mirror g where g.org_id='21951005-0000-0000-0000-000000000001' and g.account='Cost' and g.voucher_no like 'U-%'),(select sum(g.debit-g.credit) from erp_gl_entry_mirror g where g.org_id='21951005-0000-0000-0000-000000000001' and g.account='Cost'),'AC-ROP-003 placed plus unassigned mapped ledger equals the whole mapped ledger');
-- an organization with no rule, equipment setting or assignment never runs the attribution engine; a configured one does
set local track_functions='all';
create function pg_temp.engine_calls() returns bigint language sql as $$ select coalesce(pg_stat_get_xact_function_calls('public.cost_attribution_engine(uuid,jsonb,uuid,uuid,jsonb)'::regprocedure::oid),0) $$;
select set_config('perf.before',pg_temp.engine_calls()::text,true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951005-0000-0000-0000-000000000103","role":"authenticated"}';
select count(*) from public.project_mapped_actuals('21951005-0000-0000-0000-000000000315');
select count(*) from public.project_mapped_actuals_all();
reset role;
select is(pg_temp.engine_calls()::text,current_setting('perf.before'),'AC-ROP-003 an unconfigured organization never executes the attribution engine');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951005-0000-0000-0000-000000000102","role":"authenticated"}';
select count(*) from public.project_mapped_actuals('21951005-0000-0000-0000-000000000225');
reset role;
select ok(pg_temp.engine_calls()>current_setting('perf.before')::bigint,'AC-ROP-003 control: a configured organization does execute it');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951005-0000-0000-0000-000000000101","role":"authenticated"}';
select is((select actuals_to_date from public.project_mapped_actuals('21951005-0000-0000-0000-000000000211') where category='Materials'),(select 10*count(*) from fixture where o=1 and p=1)::numeric,'AC-ROP-003 the project read returns the same independent sum');
reset role;

-- The engine's exclusion of assigned vouchers, for an organization with many ledger rows, a rule and few assignments, against an identical
-- organization that has the same ledger without the assigned vouchers and no assignment at all.
insert into organizations(id,name,default_currency) values ('21951005-0000-0000-0000-000000000004','Excl A','USD'),('21951005-0000-0000-0000-000000000005','Excl B','USD');
insert into projects(id,org_id,name,status) values ('21951005-0000-0000-0000-000000000414','21951005-0000-0000-0000-000000000004','PA','Ongoing Project'),('21951005-0000-0000-0000-000000000515','21951005-0000-0000-0000-000000000005','PB','Ongoing Project');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21951005-0000-0000-0000-000000000034','21951005-0000-0000-0000-000000000004','erpnext','https://example.test','test','{"company":"Example"}',now(),'active');
insert into cost_attribution_rules(id,org_id,rule_key,version,name,match_account,effective_from,specificity) values
 ('21951005-0000-0000-0000-0000000004d1','21951005-0000-0000-0000-000000000004','21951005-0000-0000-0000-0000000004d2',1,'Rule A','Cost','2026-01-01',2),
 ('21951005-0000-0000-0000-0000000005d1','21951005-0000-0000-0000-000000000005','21951005-0000-0000-0000-0000000005d2',1,'Rule B','Cost','2026-01-01',2);
insert into cost_attribution_rule_targets(rule_id,org_id,position,project_id,percent) values
 ('21951005-0000-0000-0000-0000000004d1','21951005-0000-0000-0000-000000000004',0,'21951005-0000-0000-0000-000000000414',100),
 ('21951005-0000-0000-0000-0000000005d1','21951005-0000-0000-0000-000000000005',0,'21951005-0000-0000-0000-000000000515',100);
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,fiscal_year,party_type,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select ('21951005-0000-0000-0000-00000000000'||o)::uuid,'GL-X-'||o||'-'||g,'Example','Cost','2026','Supplier','Purchase Invoice','X-'||g,'2026-03-01',3,0,false,'1' from generate_series(4,5) o cross join generate_series(1,4000) g;
-- three assigned vouchers exist only in organization A
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,fiscal_year,party_type,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
select '21951005-0000-0000-0000-000000000004'::uuid,'GL-Y-'||g,'Example','Cost','2026','Supplier','Purchase Invoice','Y-'||g,'2026-03-01',50,0,false,'1' from generate_series(1,3) g;
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,currency,grand_total,net_total,erp_status,erp_docstatus,erp_modified)
select ('21951005-1000-0004-0000-'||lpad(g::text,12,'0'))::uuid,'21951005-0000-0000-0000-000000000004'::uuid,'Purchase Invoice','Y-'||g,'S','USD',50,50,'Unpaid',1,'1' from generate_series(1,3) g;
insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,actor_id,source_voucher_type,source_voucher_no,source_company)
select '21951005-0000-0000-0000-000000000004'::uuid,'21951005-0000-0000-0000-000000000034'::uuid,('21951005-1000-0004-0000-'||lpad(g::text,12,'0'))::uuid,gen_random_uuid(),'x','project','21951005-0000-0000-0000-000000000414'::uuid,'21951005-0000-0000-0000-000000000101'::uuid,'Purchase Invoice','Y-'||g,'Example' from generate_series(1,3) g;
analyze erp_gl_entry_mirror; analyze erp_capture_invoice_assignments;
create function pg_temp.excl_plan(p_org uuid) returns jsonb language plpgsql as $$
declare v jsonb; begin
 execute 'explain (analyze, buffers, format json) select count(*) from public.erp_gl_entry_mirror l where l.org_id = $1 and l.account = ''Cost'' and coalesce(l.project, '''') = '''' and not l.is_cancelled
   and not exists (select 1 from public.erp_capture_invoice_assignments x where x.org_id = $1 and x.undone_at is null and x.decision = ''project''
     and x.source_voucher_type = l.voucher_type and x.source_voucher_no = l.voucher_no and x.source_company is not distinct from l.company)' into v using p_org; return v; end $$;
select set_config('perf.excl',pg_temp.excl_plan('21951005-0000-0000-0000-000000000004')::text,true);
select ok(exists(select 1 from pg_temp.nodes(current_setting('perf.excl')::jsonb) where node->>'Index Name' like 'erp_capture_assignment_active_%'),'AC-ROP-003 the exclusion of assigned vouchers is served by an index on the assignment table');
select ok(not exists(select 1 from pg_temp.nodes(current_setting('perf.excl')::jsonb) where node->>'Relation Name'='erp_capture_invoice_assignments' and node->>'Node Type'='Seq Scan' and coalesce((node->>'Actual Loops')::numeric,1)>1),'AC-ROP-003 the assignment table is never scanned sequentially once per ledger row');
-- the real engine: it reads the assignment table only through its index, once, and never per ledger row
select set_config('perf.seq0',coalesce(pg_stat_get_xact_numscans('public.erp_capture_invoice_assignments'::regclass::oid),0)::text,true);
create temp table engine_a as select * from public.cost_attribution_engine('21951005-0000-0000-0000-000000000004');
create temp table engine_b as select * from public.cost_attribution_engine('21951005-0000-0000-0000-000000000005');
select ok(coalesce(pg_stat_get_xact_numscans('public.erp_capture_invoice_assignments'::regclass::oid),0)-current_setting('perf.seq0')::bigint<=2,'AC-ROP-003 the engine scans the assignment table at most once per call, not once per ledger row');
select is((select count(*)::int from engine_a),(select count(*)::int from engine_b),'AC-ROP-003 the engine allocates the same number of lines with the assignment as the twin without the assigned vouchers');
select is((select sum(amount) from engine_a),(select sum(amount) from engine_b),'AC-ROP-003 and the same total: the assigned vouchers add nothing to the rule');
select is((select count(*)::int from engine_a where gl_id in (select id from erp_gl_entry_mirror where voucher_no like 'Y-%')),0,'AC-ROP-003 none of the assigned vouchers reaches the rule');
select * from finish();
rollback;
