-- 0263_expense_ledger_read_scope.test.sql — #775 phase B: an expense posting's outbox command and an Employee
-- party's GL entries are read only by approval rank (Finance, Admin, Executive, Project Manager) — the claim's own
-- read scope (NFR-EXP-010). Other domains and party types keep their org-member read. AC-EXP-104.
-- Migration under test: 0263 §5b.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02630000-0000-0000-0000-00000000040a','EXP-B Read Scope Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02630000-0000-0000-0000-0000000004a1','expb-s-e1@example.com'),
  ('02630000-0000-0000-0000-0000000004a3','expb-s-pm@example.com'),
  ('02630000-0000-0000-0000-0000000004a4','expb-s-f1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02630000-0000-0000-0000-0000000004a1','02630000-0000-0000-0000-00000000040a','S Eng','expb-s-e1@example.com','Engineer','active'),
  ('02630000-0000-0000-0000-0000000004a3','02630000-0000-0000-0000-00000000040a','S PM','expb-s-pm@example.com','Project Manager','active'),
  ('02630000-0000-0000-0000-0000000004a4','02630000-0000-0000-0000-00000000040a','S Fin','expb-s-f1@example.com','Finance','active');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state) values
  ('02630000-0000-0000-0000-00000000040a','expenses','02630000-0000-0000-0000-000000000801:approval',
   'expj:02630000-0000-0000-0000-000000000801:1791367200123','erpnext','create','pending'),
  ('02630000-0000-0000-0000-00000000040a','procurement','pmo-proc-1','proc-key-1','erpnext','create','pending');
insert into erp_gl_entry_mirror (org_id, erp_name, account, party_type, party, voucher_type, voucher_no, debit, credit, erp_modified) values
  ('02630000-0000-0000-0000-00000000040a','GLE-1','Employee Payable - EX','Employee','HR-EMP-1','Journal Entry','ACC-JV-1',0,100,'2026-10-07'),
  ('02630000-0000-0000-0000-00000000040a','GLE-2','Creditors - EX','Supplier','SUP-1','Payment Entry','ACC-PAY-1',100,0,'2026-10-07'),
  ('02630000-0000-0000-0000-00000000040a','GLE-3','Travel - EX',null,null,'Journal Entry','ACC-JV-1',100,0,'2026-10-07');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000004a1","role":"authenticated"}';
select is((select count(id)::int from external_command_outbox where domain = 'expenses'), 0,
  'AC-EXP-104: an Engineer reads no expense posting command');
select is((select count(id)::int from external_command_outbox where domain = 'procurement'), 1,
  'AC-EXP-104: an Engineer still reads another domain''s command');
select is((select count(*)::int from erp_gl_entry_mirror where party_type = 'Employee'), 0,
  'AC-EXP-104: an Engineer reads no Employee-party GL entry');
select is((select count(*)::int from erp_gl_entry_mirror), 2,
  'AC-EXP-104: an Engineer still reads Supplier and party-less GL entries');

set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000004a4","role":"authenticated"}';
select is((select count(id)::int from external_command_outbox where domain = 'expenses'), 1,
  'AC-EXP-104: Finance reads the expense posting command');
select is((select count(*)::int from erp_gl_entry_mirror), 3, 'AC-EXP-104: Finance reads every GL entry');

set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000004a3","role":"authenticated"}';
select is((select count(id)::int from external_command_outbox where domain = 'expenses'), 1,
  'AC-EXP-104: approval rank (a Project Manager) reads the expense posting command');
select is((select count(*)::int from erp_gl_entry_mirror where party_type = 'Employee'), 1,
  'AC-EXP-104: approval rank reads the Employee-party GL entry');
reset role;

-- Demoting the Project Manager takes the read away: the role is read from the profile at query time.
update profiles set role = 'Engineer' where id = '02630000-0000-0000-0000-0000000004a3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000004a3","role":"authenticated"}';
select is((select count(id)::int from external_command_outbox where domain = 'expenses'), 0,
  'AC-EXP-104: a demoted Project Manager no longer reads the expense posting command');
select is((select count(*)::int from erp_gl_entry_mirror where party_type = 'Employee'), 0,
  'AC-EXP-104: a demoted Project Manager no longer reads the Employee-party GL entry');
reset role;

select * from finish();
rollback;
