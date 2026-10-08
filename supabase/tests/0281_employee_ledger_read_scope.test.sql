-- 0281: Employee-party PLE balances are visible only to spend-approval authority; other parties retain member reads.
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02810000-0000-0000-0000-00000000040a','Employee Ledger Scope Org','IDR','UTC');
insert into auth.users (id, email) values
  ('02810000-0000-0000-0000-0000000004a1','scope-eng@example.com'),
  ('02810000-0000-0000-0000-0000000004a2','scope-fin@example.com'),
  ('02810000-0000-0000-0000-0000000004a3','scope-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02810000-0000-0000-0000-0000000004a1','02810000-0000-0000-0000-00000000040a','Scope Engineer','scope-eng@example.com','Engineer','active'),
  ('02810000-0000-0000-0000-0000000004a2','02810000-0000-0000-0000-00000000040a','Scope Finance','scope-fin@example.com','Finance','active'),
  ('02810000-0000-0000-0000-0000000004a3','02810000-0000-0000-0000-00000000040a','Scope Admin','scope-admin@example.com','Admin','active');
insert into erp_payment_ledger_mirror (org_id, erp_name, account, party_type, party, amount, erp_modified) values
  ('02810000-0000-0000-0000-00000000040a','PLE-0281-EMP','Employee Payable','Employee','EMP-1',100,'2026-10-08'),
  ('02810000-0000-0000-0000-00000000040a','PLE-0281-CUST','Receivable','Customer','CUST-1',200,'2026-10-08'),
  ('02810000-0000-0000-0000-00000000040a','PLE-0281-SUP','Payable','Supplier','SUP-1',300,'2026-10-08');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02810000-0000-0000-0000-0000000004a1","role":"authenticated"}';
select is((select count(*)::int from erp_payment_ledger_mirror where party_type = 'Employee'), 0, 'Engineer cannot read Employee PLE balances');
select is((select count(*)::int from erp_payment_ledger_mirror where party_type in ('Customer','Supplier')), 2, 'Engineer retains customer and supplier PLE reads');

set local request.jwt.claims = '{"sub":"02810000-0000-0000-0000-0000000004a2","role":"authenticated"}';
select is((select count(*)::int from erp_payment_ledger_mirror where party_type = 'Employee'), 1, 'Finance can read Employee PLE balances');

set local request.jwt.claims = '{"sub":"02810000-0000-0000-0000-0000000004a3","role":"authenticated"}';
select is((select count(*)::int from erp_payment_ledger_mirror where party_type = 'Employee'), 1, 'Admin can read Employee PLE balances');
select is((select count(*)::int from erp_payment_ledger_mirror where party_type = 'Customer'), 1, 'Admin retains customer PLE reads');
select is((select count(*)::int from erp_payment_ledger_mirror where party_type = 'Supplier'), 1, 'Admin retains supplier PLE reads');
reset role;

select ok((select permissive = 'RESTRICTIVE' from pg_policies where schemaname = 'public' and tablename = 'erp_payment_ledger_mirror' and policyname = 'erp_payment_ledger_mirror_employee_read_scope'), 'the Employee scope is restrictive');
select * from finish();
rollback;
