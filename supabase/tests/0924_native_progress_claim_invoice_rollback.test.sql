-- 0924 rollback: refused while a claim names PMO's own down payment item or a native invoice shares an id with a progress claim;
-- otherwise drops the RPC and the item function and restores create_progress_claim (0534) and the ERP fence (0517).
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name) values ('09240000-0000-0000-0000-0000000000a9', 'NPC rollback org');
insert into auth.users (id, email) values ('09240000-0000-0000-0000-0000000000b9', 'npc-rb@example.com');
insert into profiles (id, org_id, full_name, email, role, status)
values ('09240000-0000-0000-0000-0000000000b9', '09240000-0000-0000-0000-0000000000a9', 'NPC RB', 'npc-rb@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values ('09240000-0000-0000-0000-0000000000cc', '09240000-0000-0000-0000-0000000000a9', 'Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id)
values ('09240000-0000-0000-0000-0000000000c9', '09240000-0000-0000-0000-0000000000a9', 'P', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false, '09240000-0000-0000-0000-0000000000cc');
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
values ('09240000-0000-0000-0000-0000000000e1', '09240000-0000-0000-0000-0000000000a9', '09240000-0000-0000-0000-0000000000c9', 'down_payment', 'IDR', 10, 10, 10, 0,
        'DOWN-PAYMENT', '09240000-0000-0000-0000-0000000000b9');

\set npc_embedded 1
\ir 0924_native_progress_claim_invoice_down_runner.sql
select throws_ok('select pg_temp.run_npc_down()', 'P0001', null, 'NFR-005 rollback refuses while a claim names PMO''s own down payment item');
delete from progress_claims where id = '09240000-0000-0000-0000-0000000000e1';
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
values ('09240000-0000-0000-0000-0000000000e2', '09240000-0000-0000-0000-0000000000a9', '09240000-0000-0000-0000-0000000000c9', 'down_payment', 'IDR', 10, 10, 10, 0,
        'ERP-ITEM', '09240000-0000-0000-0000-0000000000b9');
insert into sales_invoices (id, org_id, project_id, customer_id, native_lines, amount, currency, tax_treatment, tax_rate, tax_amount,
                            tax_base_numerator, tax_base_denominator, status, pmo_native)
values ('09240000-0000-0000-0000-0000000000e2', '09240000-0000-0000-0000-0000000000a9', '09240000-0000-0000-0000-0000000000c9', '09240000-0000-0000-0000-0000000000cc',
        '[{"item_code":null,"description":"x","qty":1,"rate":10,"amount":10}]', 10, 'IDR', 'exclusive', 0, 0, 1, 1, 'Draft', true);
select throws_ok('select pg_temp.run_npc_down()', 'P0001', null, 'NFR-005 rollback refuses while a native invoice shares an id with a progress claim');
select ok(to_regprocedure('public.create_native_progress_claim_invoice(uuid)') is not null
          and to_regprocedure('public.native_down_payment_item()') is not null, 'NFR-005 a refused rollback leaves the RPC and the item function in place');
delete from sales_invoices where id = '09240000-0000-0000-0000-0000000000e2';
select lives_ok('select pg_temp.run_npc_down()', 'NFR-005 rollback runs once no such claim or invoice remains');
select ok(to_regprocedure('public.create_native_progress_claim_invoice(uuid)') is null, 'NFR-005 rollback drops the RPC');
select ok(to_regprocedure('public.native_down_payment_item()') is null, 'NFR-005 rollback drops the item function');
select ok(position('native_down_payment_item' in pg_get_functiondef('public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)'::regprocedure)) = 0,
          'NFR-005 rollback restores create_progress_claim without the native item');
select ok(position('native_down_payment_item' in pg_get_functiondef('public.assert_progress_claim_raisable()'::regprocedure)) = 0,
          'NFR-005 rollback restores the ERP fence without the native item refusal');
select ok(has_function_privilege('authenticated', 'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.assert_progress_claim_raisable()', 'execute'),
          'NFR-005 rollback keeps the grants: the claim writer reachable, the fence not');
select ok(exists (select 1 from progress_claims where id = '09240000-0000-0000-0000-0000000000e2'), 'NFR-005 rollback keeps the claim');
select * from finish();
rollback;
