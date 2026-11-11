begin;
create extension if not exists pgtap;
select plan(15);
insert into public.organizations (id,name) values ('02900000-0000-0000-0000-000000000001','Project finance test');
insert into auth.users (id,email) values ('02900000-0000-0000-0000-0000000000a1','finance@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
 ('02900000-0000-0000-0000-0000000000a1','02900000-0000-0000-0000-000000000001','Finance','finance@example.test','Finance','active');
-- Gross settlement is compared with the outstanding balance on the same tax basis.
reset role;
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
select ('02900000-0000-0000-0001-' || lpad(g::text,12,'0'))::uuid,
       '02900000-0000-0000-0000-000000000001', 'Gross ' || g, 'Ongoing Project', 'USD', 111, 'exclusive', 0, 0, 1, 1, false, 'GROSS-' || g
from generate_series(1,14) g;
set local role service_role;
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,erp_outstanding_amount,tax_treatment,tax_amount,currency,status,erp_docstatus,pmo_native,native_lines)
select ('02900000-0000-0000-0002-' || lpad(g::text,12,'0'))::uuid,
       '02900000-0000-0000-0000-000000000001', ('02900000-0000-0000-0001-' || lpad(g::text,12,'0'))::uuid,
       case when g <= 3 or g between 8 and 10 then null else 'SI-GROSS-' || g end, '2026-01-01', case when g = 14 then 100.10 when g in (4,5,6,8,9,10) then 111 else 100 end,
       case when g = 14 then 70.07 when g in (1,4,8,11) then 111 when g in (2,5,9,12) then 61 when g in (3,6,10,13) then 0 else null end,
       case when g in (4,5,6,8,9,10) then 'inclusive' else 'exclusive' end, case when g = 14 then 11.01 else 11 end, 'USD', 'Submitted', case when g <= 3 or g between 8 and 10 then null else 1 end, (g <= 3 or g between 8 and 10), case when g <= 3 or g between 8 and 10 then '[]'::jsonb else null end
from generate_series(1,14) g;
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"02900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((public.get_project_finances(('02900000-0000-0000-0001-' || lpad(g::text,12,'0'))::uuid)->'invoices'->0->>'settled')::numeric,
          case when g in (1,4) then 0 when g in (2,5) then 50 else 111 end::numeric,
          'Gross settlement case ' || g)
from generate_series(1,6) g;
select is((public.get_project_finances(('02900000-0000-0000-0001-' || lpad(g::text,12,'0'))::uuid)->'invoices'->0->>'settled')::numeric,
          case when g in (8,11) then 0 when g in (9,12) then 50 else 111 end::numeric,
          'Additional gross settlement case ' || g)
from generate_series(8,13) g;
select is(public.get_project_finances('02900000-0000-0000-0001-000000000007')->'invoices'->0->>'settled', null,
          'Settlement is unavailable when outstanding is unavailable');

select is((public.get_project_finances('02900000-0000-0000-0001-000000000014')->'invoices'->0->>'settled')::numeric, 41.04::numeric,
          'Settlement retains exact decimal cents');

reset role;
set local role service_role;
select throws_ok($$update public.sales_invoices set tax_amount = null where id = '02900000-0000-0000-0002-000000000001'$$, '23502', null, 'Exclusive invoices require a known tax amount');
select * from finish();
rollback;
