begin;
create extension if not exists pgtap;
select plan(4);

insert into public.organizations (id, name)
values ('03080000-0000-0000-0000-000000000002', 'Release role contract other org');
insert into public.projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                             tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref)
values ('03080000-0000-0000-0000-0000000000d1', '03080000-0000-0000-0000-000000000002',
        'Synthetic other-org project', 'Ongoing Project', 'USD', 100, 'exclusive', 0, 0, 1, 1, false, 'ROLE-OTHER');

set local request.jwt.claims = '{}';
set local role service_role;
insert into public.erp_account_mirror
  (org_id, company, erp_name, account_name, root_type, report_type, parent_account, is_group,
   account_number, account_currency, lft, rgt, refresh_id)
values
  ('00000000-0000-0000-0000-000000000001', 'Release Test Co', 'SYNTHETIC-ACCOUNT', 'Synthetic account',
   'Expense', 'Profit and Loss', null, false, '9308', 'USD', 1, 2,
   '03080000-0000-0000-0000-0000000000f1');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.erp_account_mirror), 0,
          'Engineer cannot read the account catalogue');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.erp_account_mirror), 0,
          'Project Manager cannot read the account catalogue');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.erp_account_mirror), 1,
          'Finance reads the seed org account catalogue');
select is((select count(*)::int from public.get_projects_money_collection(array[
  '03080000-0000-0000-0000-0000000000d1'::uuid])), 0,
          'Finance collection excludes another org project');

select * from finish();
rollback;
