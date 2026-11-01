-- 0484_invoice_pairs_rollback.test.sql - the ECA-5 rollback refuses while a pair exists (it would count the sale twice), then
-- restores the prior readers and removes the column. The runner (0484_invoice_pairs_down_runner.sql) embeds the rollback file.
begin;
create extension if not exists pgtap;
select plan(9);

insert into public.organizations (id, name) values ('04840000-0000-0000-0000-0000000000f0', 'Pairs rollback org');
insert into auth.users (id, email) values ('04840000-0000-0000-0000-0000000000f9', 'pair-rb@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('04840000-0000-0000-0000-0000000000f9', '04840000-0000-0000-0000-0000000000f0', 'Pair RB', 'pair-rb@example.test', 'Finance', 'active');
insert into public.sales_invoices (id, org_id, si_number, invoice_date, amount, tax_treatment, tax_amount, currency, status, erp_docstatus) values
  ('04840000-0000-0000-0000-0000000000f5', '04840000-0000-0000-0000-0000000000f0', 'SI-RB-1', '2026-01-01', 10, 'exclusive', 0, 'USD', 'Unpaid', 1),
  ('04840000-0000-0000-0000-0000000000f6', '04840000-0000-0000-0000-0000000000f0', 'SI-RB-2', '2026-01-01', 10, 'exclusive', 0, 'USD', 'Unpaid', 1);
set local session_replication_role = replica;
update public.sales_invoices set paired_erp_invoice_id = '04840000-0000-0000-0000-0000000000f6', paired_at = now(),
       paired_by = '04840000-0000-0000-0000-0000000000f9', paired_filled = '{}'::jsonb where id = '04840000-0000-0000-0000-0000000000f5';
set local session_replication_role = origin;

\set ip_embedded 1
\ir 0484_invoice_pairs_down_runner.sql
select throws_ok('select pg_temp.run_ip_down()', 'P0001', null, 'rollback refuses while a pair exists');
select has_column('public', 'sales_invoices', 'paired_erp_invoice_id', 'a refused rollback leaves the column in place');
set local session_replication_role = replica;
update public.sales_invoices set paired_erp_invoice_id = null, paired_at = null, paired_by = null, paired_filled = null where id = '04840000-0000-0000-0000-0000000000f5';
set local session_replication_role = origin;
select lives_ok('select pg_temp.run_ip_down()', 'rollback runs once no pair remains');
select hasnt_column('public', 'sales_invoices', 'paired_erp_invoice_id', 'rollback removes the column');
select ok(to_regprocedure('public.accept_invoice_pairs(jsonb)') is null and to_regprocedure('public.propose_invoice_pairs()') is null
          and to_regprocedure('public.list_unpaired_native_invoices()') is null and to_regprocedure('public.invoice_pair_candidates(uuid,uuid,boolean)') is null and to_regprocedure('public.unpair_invoice(uuid)') is null,
          'rollback removes the pair functions');
select ok(position('paired_erp_invoice_id' in pg_get_viewdef('public.sales_invoice_work_billed'::regclass)) = 0,
          'rollback restores the billed-work view without the filter');
select ok(position('paired_erp_invoice_id' in pg_get_functiondef('public.get_project_finances(uuid)'::regprocedure)) = 0,
          'rollback restores the prior finance aggregate');
select ok(position('invoice_pairing' in pg_get_functiondef('public.sales_invoices_native_mirror_guard()'::regprocedure)) = 0,
          'rollback restores the mirror guard without the pair pin');
select ok(not exists (select 1 from public.record_history_config where entity_type = 'sales_invoice' and captured ? 'paired_erp_invoice_id'),
          'rollback unclassifies the column in record history');
select * from finish();
rollback;
