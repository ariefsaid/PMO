begin;
create extension if not exists pgtap;
select plan(8);   -- finalized in T6.3 (pgTAP fails loudly on a mismatch)

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

select * from finish();
rollback;
