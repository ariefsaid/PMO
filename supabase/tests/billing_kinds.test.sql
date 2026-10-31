begin;
create extension if not exists pgtap;
select plan(60);   -- finalized in T6.3 (pgTAP fails loudly on a mismatch)

-- ── fixture ────────────────────────────────────────────────────────────────────────────────────
insert into public.organizations (id,name) values
  ('04080000-0000-0000-0000-000000000001','Billing kinds org'),
  ('04080000-0000-0000-0000-000000000002','Billing kinds foreign org');
insert into auth.users (id,email) values
  ('04080000-0000-0000-0000-0000000000a1','bk-finance@example.test'),
  ('04080000-0000-0000-0000-0000000000a2','bk-admin@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('04080000-0000-0000-0000-0000000000a1','04080000-0000-0000-0000-000000000001','BK Finance','bk-finance@example.test','Finance','active'),
  ('04080000-0000-0000-0000-0000000000a2','04080000-0000-0000-0000-000000000001','BK Admin','bk-admin@example.test','Admin','active');
-- P1 main (contract 1000, exclusive, USD); P2 equality/other-only; P3 tax-basis; P4 spare (project change target)
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref) values
 ('04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-000000000001','BK P1','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-1'),
 ('04080000-0000-0000-0000-0000000000d2','04080000-0000-0000-0000-000000000001','BK P2','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-2'),
 ('04080000-0000-0000-0000-0000000000d3','04080000-0000-0000-0000-000000000001','BK P3','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-3'),
 ('04080000-0000-0000-0000-0000000000d4','04080000-0000-0000-0000-000000000001','BK P4','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-4'),
 ('04080000-0000-0000-0000-0000000000d9','04080000-0000-0000-0000-000000000002','BK foreign','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-F');
-- Two invoices that OMIT the kind (the pre-existing / older-caller shape): one adopted ERP, one native.
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus) values
 ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1',
  'SI-BK-1','2026-01-01',400,0,'exclusive',0,'USD','Paid',1);
insert into public.sales_invoices (id,org_id,project_id,invoice_date,amount,erp_outstanding_amount,tax_treatment,tax_amount,
                                   currency,status,native_lines,pmo_native,author_user_id,pmo_number) values
 ('04080000-0000-0000-0000-0000000000e2','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1',
  '2026-01-02',200,200,'exclusive',0,'USD','Unpaid','[{"description":"native"}]',true,'04080000-0000-0000-0000-0000000000a1','PMO-BK-1');

-- ── AC-001 ─────────────────────────────────────────────────────────────────────────────────────
select has_column('public','sales_invoices','billing_kind','AC-001 sales_invoices carries billing_kind');
select col_not_null('public','sales_invoices','billing_kind','AC-001 billing_kind is NOT NULL');
select is((select count(*)::int from public.sales_invoices
            where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2')
              and billing_kind = 'contract'), 2,
          'AC-001 adopted and native rows that omit the kind are Contract billing');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d1')->>'contract_invoiced')::numeric, 600::numeric,
          'AC-001 known contract total is unchanged for kind-less invoices');
reset role;
select throws_ok($$insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,erp_docstatus,billing_kind)
                   values (gen_random_uuid(),'04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-BK-BAD',1,'exclusive',0,'USD','Unpaid',1,'bogus')$$,
                 '23514', null, 'AC-001 an invalid explicit kind is refused');
select throws_ok($$insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,erp_docstatus,billing_kind)
                   values (gen_random_uuid(),'04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d1','SI-BK-NULL',1,'exclusive',0,'USD','Unpaid',1,null)$$,
                 '23502', null, 'AC-001 a null explicit kind is refused');
select ok(exists (select 1 from public.record_history_config where entity_type='sales_invoice' and captured ? 'billing_kind'),
          'FR-005 billing_kind is classified for record history');
select ok(pg_get_functiondef('public.sales_invoices_native_mirror_guard()'::regprocedure) like '%new.billing_kind is distinct from old.billing_kind%',
          'FR-012 the native mirror guard pins billing_kind while ERP owns revenue');


-- ── T2: assignment carries the kind atomically (FR-003) ───────────────────────────────────────
-- adopted ERP invoice with no project, unlinked: the "link" path
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus) values
 ('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-000000000001',null,'SI-BK-3','2026-01-03',50,50,'exclusive',0,'USD','Unpaid',1);
insert into public.external_domain_ownership (org_id,external_tier,domain) values ('04080000-0000-0000-0000-000000000001','erpnext','revenue');
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id)
 values ('04080000-0000-0000-0000-000000000001','revenue','04080000-0000-0000-0000-0000000000e3','erpnext','SI-BK-3');
delete from public.record_changes where entity_type='sales_invoice' and entity_id='04080000-0000-0000-0000-0000000000e3';
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d1','bogus')$$,
                 '23514', null, 'AC-001 assignment refuses an invalid kind and saves nothing');
select is((select project_id from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), null::uuid,
          'AC-001 the refused assignment left the invoice unlinked');
select lives_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d1','other')$$,
                'FR-003 assignment saves project and kind in one call');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), 'other',
          'FR-003 the chosen kind persisted with the project');
reset role;
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e3' and changes ? 'project_id' and changes ? 'billing_kind'), 1,
          'FR-003 project and kind land in ONE history event (atomic)');
-- omitted kind (older callers): a classified row keeps its kind (Q1)
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.assign_sales_invoice_project('04080000-0000-0000-0000-0000000000e3','04080000-0000-0000-0000-0000000000d4')$$,
                'FR-003 the two-argument form still works for older callers');
select is((select billing_kind from public.sales_invoices where id='04080000-0000-0000-0000-0000000000e3'), 'other',
          'FR-003 an omitted kind keeps the stored kind when the project changes');
reset role;

-- ── T3: kind-only correction (AC-006) ─────────────────────────────────────────────────────────
-- snapshot of every column except the kind, to prove nothing else moved
create temp table bk_before as
  select id, to_jsonb(si) - 'billing_kind' as row_data from public.sales_invoices si
   where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2');
grant select on bk_before to authenticated;
create temp table bk_outbox_before as select count(*)::int n from public.external_command_outbox;
grant select on bk_outbox_before to authenticated;
delete from public.record_changes where entity_type='sales_invoice'
   and entity_id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2');

set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$,
                'AC-006 Finance corrects the kind of a PAID adopted invoice on the same project');
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e2','other')$$,
                'AC-006 Finance corrects the kind of a native invoice');
select is((select jsonb_object_agg(id::text, to_jsonb(si) - 'billing_kind') from public.sales_invoices si
            where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2')),
          (select jsonb_object_agg(id::text, row_data) from bk_before),
          'AC-006 project, money, state, receipts fields and authorship are untouched');
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'), 1,
          'AC-006 exactly one history event exists for the correction');
select is((select changes->'billing_kind' from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'),
          '{"old":"contract","new":"other"}'::jsonb, 'AC-006 the event records old and new kind');
select is((select actor_id from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'),
          '04080000-0000-0000-0000-0000000000a1'::uuid, 'AC-006 the event is attributed to the operator');
select lives_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','other')$$,
                'AC-006 the identical save repeats without error');
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='04080000-0000-0000-0000-0000000000e1'), 1,
          'AC-006 the repeat produced no duplicate event');
select is((select count(*)::int from public.external_command_outbox), (select n from bk_outbox_before),
          'AC-006 no ERP command was enqueued');
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e1','bogus')$$,
                 '23514', null, 'AC-006 an invalid kind is refused');
-- an invoice with no project cannot carry a kind
reset role;
insert into public.sales_invoices (id,org_id,project_id,si_number,amount,tax_treatment,tax_amount,currency,status,erp_docstatus)
 values ('04080000-0000-0000-0000-0000000000e5','04080000-0000-0000-0000-000000000001',null,'SI-BK-5',1,'exclusive',0,'USD','Unpaid',1);
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.set_sales_invoice_billing_kind('04080000-0000-0000-0000-0000000000e5','other')$$,
                 '23514', null, 'AC-006 an unlinked invoice is refused (attribute a project first)');
reset role;
-- restore the two subjects to contract for the aggregate blocks that follow
update public.sales_invoices set billing_kind='contract' where id in ('04080000-0000-0000-0000-0000000000e1','04080000-0000-0000-0000-0000000000e2');

-- ── T4: native creation carries the kind (AC-011) ─────────────────────────────────────────────
-- native creation needs an org where no ERP owns revenue
delete from public.external_domain_ownership where org_id='04080000-0000-0000-0000-000000000001' and domain='revenue';
insert into public.companies (id,org_id,name,type) values
 ('04080000-0000-0000-0000-0000000000c1','04080000-0000-0000-0000-000000000001','BK Customer','Client');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
create temp table bk_new_ids (k text primary key, id uuid);
grant all on bk_new_ids to authenticated;
insert into bk_new_ids select 'omitted', public.create_native_sales_invoice(
  '04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-0000000000c1',
  '[{"description":"line","qty":1,"rate":10}]'::jsonb);
insert into bk_new_ids select 'other', public.create_native_sales_invoice(
  '04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-0000000000c1',
  '[{"description":"line","qty":1,"rate":20}]'::jsonb, null, 'other');
select is((select billing_kind from public.sales_invoices where id=(select id from bk_new_ids where k='omitted')), 'contract',
          'AC-011 an omitted kind persists as Contract billing');
select is((select billing_kind from public.sales_invoices where id=(select id from bk_new_ids where k='other')), 'other',
          'AC-011 an explicit Other billing choice persists with the project');
select is((select project_id::text from public.sales_invoices where id=(select id from bk_new_ids where k='other')),
          '04080000-0000-0000-0000-0000000000d1', 'AC-011 the project is saved atomically with the kind');
select ok((select pmo_native and status='Draft' and author_user_id='04080000-0000-0000-0000-0000000000a1'
             from public.sales_invoices where id=(select id from bk_new_ids where k='other')),
          'AC-011 the native body contract is unchanged: Draft, PMO-native, authored by the caller');
select is((select count(*)::int from public.sales_invoice_authors where sales_invoice_id=(select id from bk_new_ids where k='other')), 1,
          'AC-011 the author set row is still written');
create temp table bk_count_before as select count(*)::int n from public.sales_invoices;
grant select on bk_count_before to authenticated;
select throws_ok($$select public.create_native_sales_invoice('04080000-0000-0000-0000-0000000000d1','04080000-0000-0000-0000-0000000000c1',
                   '[{"description":"line","qty":1,"rate":30}]'::jsonb, null, 'bogus')$$,
                 '23514', null, 'AC-011 an invalid kind is refused');
select is((select count(*)::int from public.sales_invoices), (select n from bk_count_before),
          'AC-011 the refused create left no partial invoice');
reset role;

-- ── T5: contract aggregate + excess contributors (AC-002, AC-003, AC-005, FR-009) ────────────
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref) values
 ('04080000-0000-0000-0000-0000000000d5','04080000-0000-0000-0000-000000000001','BK P5','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-5'),
 ('04080000-0000-0000-0000-0000000000d6','04080000-0000-0000-0000-000000000001','BK P6','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-6'),
 ('04080000-0000-0000-0000-0000000000d7','04080000-0000-0000-0000-000000000001','BK P7','Ongoing Project','USD',1000,'exclusive',0,0,1,1,false,'BK-7');
set local request.jwt.claims = '{}';
set local role service_role;
insert into public.budget_category_account_map (org_id,category,erp_account,is_push_target) values
 ('04080000-0000-0000-0000-000000000001','Labor','ACC-BK-LABOR',true);
insert into public.erp_actuals_snapshot (org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at) values
 ('04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d5','ACC-BK-LABOR','FY-2026',200,'2026-10-01','04080000-0000-0000-0000-0000000000b1','2026-10-02');
reset role;
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000f1','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d5','SI-BK-C1','2026-02-01',600,100,'exclusive',0,'USD','Unpaid',1,'contract'),
 ('04080000-0000-0000-0000-0000000000f2','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d5','SI-BK-O1','2026-02-02',300,0,'exclusive',0,'USD','Paid',1,'other');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->>'contract_invoiced')::numeric, 600::numeric, 'AC-002 contract invoiced counts only Contract billing');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->>'remaining_to_invoice')::numeric, 400::numeric, 'AC-002 remaining is contract value minus contract billing');
select is((select (b->>'invoiced')::numeric from jsonb_array_elements(public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->'invoices') b where b->>'currency'='USD'),
          900::numeric, 'AC-002 total invoiced retains both kinds');
select is((select (b->>'work_revenue')::numeric from jsonb_array_elements(public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->'invoices') b where b->>'currency'='USD'),
          900::numeric, 'AC-002 billed-work revenue retains both kinds');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->'actuals'->>'total')::numeric, 200::numeric, 'AC-002 complete same-currency cost is 200, so margin inputs give 900 - 200 = 700');
select is((select (b->>'outstanding')::numeric from jsonb_array_elements(public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->'invoices') b where b->>'currency'='USD'),
          100::numeric, 'AC-002 outstanding retains both kinds');
select is((select (b->>'settled')::numeric from jsonb_array_elements(public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->'invoices') b where b->>'currency'='USD'),
          800::numeric, 'AC-002 settlement retains both kinds (500 + 300)');
select is(public.get_project_finances('04080000-0000-0000-0000-0000000000d5')->'contract_excess', 'null'::jsonb, 'AC-002 no excess while contract billing is within the contract');
reset role;

-- AC-003: only Other billing, plus draft/cancelled rows of either kind, on P2
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000f3','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d2','SI-BK-O2','2026-02-03',300,0,'exclusive',0,'USD','Paid',1,'other'),
 ('04080000-0000-0000-0000-0000000000f4','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d2','SI-BK-D1','2026-02-04',500,500,'exclusive',0,'USD','Draft',0,'contract'),
 ('04080000-0000-0000-0000-0000000000f5','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d2','SI-BK-X1','2026-02-05',200,0,'exclusive',0,'USD','Cancelled',2,'other');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d2')->>'contract_invoiced')::numeric, 0::numeric,
          'AC-003 Other billing and draft/cancelled rows never consume the contract');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d2')->>'remaining_to_invoice')::numeric, 1000::numeric,
          'AC-003 zero eligible contract billing gives the full contract value as remaining');
reset role;
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000f6','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d6','SI-BK-C2','2026-02-06',1000,1000,'exclusive',0,'USD','Unpaid',1,'contract');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d6')->>'contract_invoiced')::numeric, 1000::numeric, 'AC-003 contract billing equal to the contract is fully invoiced');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d6')->>'remaining_to_invoice')::numeric, 0::numeric, 'AC-003 exact equality gives remaining zero');
select is(public.get_project_finances('04080000-0000-0000-0000-0000000000d6')->'contract_excess', 'null'::jsonb, 'AC-003 exact equality is not an excess');
reset role;

-- AC-005: tax-basis normalization + incomparable rows, on P3
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000f7','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d3','SI-BK-C3','2026-02-07',1100,1100,'inclusive',100,'USD','Unpaid',1,'contract'),
 ('04080000-0000-0000-0000-0000000000f8','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d3','SI-BK-O3','2026-02-08',50,50,'inclusive',0,'EUR','Unpaid',1,'other');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d3')->>'contract_invoiced')::numeric, 1000::numeric,
          'AC-005 a known contract row normalizes onto the recorded contract basis');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d3')->>'remaining_to_invoice')::numeric, 0::numeric,
          'AC-005 Other billing in another currency does not affect the contract comparison');
select is((select (b->>'invoiced')::numeric from jsonb_array_elements(public.get_project_finances('04080000-0000-0000-0000-0000000000d3')->'invoices') b where b->>'currency'='EUR'),
          50::numeric, 'AC-005 Other billing stays in its own revenue bucket');
reset role;
update public.sales_invoices set currency='EUR' where id='04080000-0000-0000-0000-0000000000f7';
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.get_project_finances('04080000-0000-0000-0000-0000000000d3')->'contract_invoiced', 'null'::jsonb, 'AC-005 an incomparable Contract row makes contract billing unavailable');
select is(public.get_project_finances('04080000-0000-0000-0000-0000000000d3')->'remaining_to_invoice', 'null'::jsonb, 'AC-005 an incomparable Contract row makes remaining unavailable');
select is(public.get_project_finances('04080000-0000-0000-0000-0000000000d3')->'contract_excess', 'null'::jsonb, 'AC-005 an incomparable Contract row invents no excess');
reset role;

-- FR-009: excess contributors on P7 (contract 1000; contract 700 + 400; other 250; draft and cancelled contract 90)
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,
                                   tax_amount,currency,status,erp_docstatus,billing_kind) values
 ('04080000-0000-0000-0000-0000000000f9','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BK-E1','2026-03-03',700,700,'exclusive',0,'USD','Unpaid',1,'contract'),
 ('04080000-0000-0000-0000-0000000000fa','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BK-E2','2026-03-01',400,0,'exclusive',0,'USD','Paid',1,'contract'),
 ('04080000-0000-0000-0000-0000000000fb','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BK-E3','2026-03-02',250,250,'exclusive',0,'USD','Unpaid',1,'other'),
 ('04080000-0000-0000-0000-0000000000fc','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BK-E4','2026-03-04',90,90,'exclusive',0,'USD','Draft',0,'contract'),
 ('04080000-0000-0000-0000-0000000000fd','04080000-0000-0000-0000-000000000001','04080000-0000-0000-0000-0000000000d7','SI-BK-E5','2026-03-05',90,0,'exclusive',0,'USD','Cancelled',2,'contract');
set local role authenticated;
set local request.jwt.claims='{"sub":"04080000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->>'remaining_to_invoice')::numeric, -100::numeric, 'FR-009 remaining is negative internally when contract billing exceeds the contract');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->>'amount')::numeric, 100::numeric, 'FR-009 the exact excess is reported');
select is((public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->>'contract_billing')::numeric, 1100::numeric, 'FR-009 the contract billing total is reported');
select is(jsonb_array_length(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'), 2, 'FR-009 every contributing Contract invoice is listed, and only those');
select is((select jsonb_agg(c->>'invoice_id' order by c->>'invoice_id') from jsonb_array_elements(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors') c),
          jsonb_build_array('04080000-0000-0000-0000-0000000000f9','04080000-0000-0000-0000-0000000000fa'),
          'FR-009 Other, draft and cancelled invoices are absent from the contributors');
select is((select sum((c->>'contribution')::numeric) from jsonb_array_elements(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors') c),
          1100::numeric, 'FR-009 the contributors reconcile to the contract billing');
select is(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'->0->>'invoice_id', '04080000-0000-0000-0000-0000000000f9',
          'FR-009 contributors are ordered by invoice date, newest first');
select is(public.get_project_finances('04080000-0000-0000-0000-0000000000d7')->'contract_excess'->'contributors'->0->>'invoice_number', 'SI-BK-E1',
          'FR-009 an adopted invoice is identified by its ERP number');
reset role;
select * from finish();
rollback;
