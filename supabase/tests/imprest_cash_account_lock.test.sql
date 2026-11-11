-- imprest_cash_account_lock.test.sql — #1515 S6 review fix: a float's ERP cash account is bound once, before the float
-- first moves cash, and one account serves one float (0425 guard_imprest_cash_account + imprest_floats_cash_account_one).
-- Postings are decided at enqueue time (PQ-11), so a late or changed account leaves the ERP float account wrong for good.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15160000-0000-0000-0000-00000000000a', 'LCK Org',       'IDR', 'Asia/Jakarta'),
  ('15160000-0000-0000-0000-00000000000b', 'LCK Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15160000-0000-0000-0000-0000000000a1', 'lck-admin@example.com'),
  ('15160000-0000-0000-0000-0000000000a2', 'lck-fin1@example.com'),
  ('15160000-0000-0000-0000-0000000000a3', 'lck-fin2@example.com'),
  ('15160000-0000-0000-0000-0000000000a4', 'lck-fin3@example.com'),
  ('15160000-0000-0000-0000-0000000000a5', 'lck-fin4@example.com'),
  ('15160000-0000-0000-0000-0000000000b1', 'lck-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15160000-0000-0000-0000-0000000000a1', '15160000-0000-0000-0000-00000000000a', 'LCK Admin', 'lck-admin@example.com', 'Admin', 'active'),
  ('15160000-0000-0000-0000-0000000000a2', '15160000-0000-0000-0000-00000000000a', 'LCK Fin1',  'lck-fin1@example.com',  'Finance', 'active'),
  ('15160000-0000-0000-0000-0000000000a3', '15160000-0000-0000-0000-00000000000a', 'LCK Fin2',  'lck-fin2@example.com',  'Finance', 'active'),
  ('15160000-0000-0000-0000-0000000000a4', '15160000-0000-0000-0000-00000000000a', 'LCK Fin3',  'lck-fin3@example.com',  'Finance', 'active'),
  ('15160000-0000-0000-0000-0000000000a5', '15160000-0000-0000-0000-00000000000a', 'LCK Fin4',  'lck-fin4@example.com',  'Finance', 'active'),
  ('15160000-0000-0000-0000-0000000000b1', '15160000-0000-0000-0000-00000000000b', 'LCK XOrg',  'lck-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15160000-0000-0000-0000-0000000000c1', '15160000-0000-0000-0000-00000000000a', 'LCK Site', 'Ongoing Project', null),
  ('15160000-0000-0000-0000-0000000000c9', '15160000-0000-0000-0000-00000000000b', 'LCK Other Site', 'Ongoing Project', null);
-- Floats: d1 clean · d2 has a Paid funding · d3 has a Paid float advance · d4 a Requested (unpaid) top-up only · d5 clean · e1 other org.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15160000-0000-0000-0000-0000000000d1', '15160000-0000-0000-0000-00000000000a', '15160000-0000-0000-0000-0000000000c1', '15160000-0000-0000-0000-0000000000a2', 1000000, 'IDR', '15160000-0000-0000-0000-0000000000a1'),
  ('15160000-0000-0000-0000-0000000000d2', '15160000-0000-0000-0000-00000000000a', '15160000-0000-0000-0000-0000000000c1', '15160000-0000-0000-0000-0000000000a3', 1000000, 'IDR', '15160000-0000-0000-0000-0000000000a1'),
  ('15160000-0000-0000-0000-0000000000d3', '15160000-0000-0000-0000-00000000000a', '15160000-0000-0000-0000-0000000000c1', '15160000-0000-0000-0000-0000000000a4', 1000000, 'IDR', '15160000-0000-0000-0000-0000000000a1'),
  ('15160000-0000-0000-0000-0000000000d4', '15160000-0000-0000-0000-00000000000a', '15160000-0000-0000-0000-0000000000c1', '15160000-0000-0000-0000-0000000000a5', 1000000, 'IDR', '15160000-0000-0000-0000-0000000000a1'),
  ('15160000-0000-0000-0000-0000000000d5', '15160000-0000-0000-0000-00000000000a', '15160000-0000-0000-0000-0000000000c1', '15160000-0000-0000-0000-0000000000a1', 1000000, 'IDR', '15160000-0000-0000-0000-0000000000a1'),
  ('15160000-0000-0000-0000-0000000000e1', '15160000-0000-0000-0000-00000000000b', '15160000-0000-0000-0000-0000000000c9', '15160000-0000-0000-0000-0000000000b1', 1000000, 'IDR', '15160000-0000-0000-0000-0000000000b1');
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15160000-0000-0000-0000-0000000000f2', '15160000-0000-0000-0000-00000000000a', '15160000-0000-0000-0000-0000000000d2',
   'funding', 'REP-LCK-0002', 'Paid', 1000000, '15160000-0000-0000-0000-0000000000a3', '15160000-0000-0000-0000-0000000000a2',
   '15160000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by) values
  ('15160000-0000-0000-0000-0000000000f4', '15160000-0000-0000-0000-00000000000a', '15160000-0000-0000-0000-0000000000d4',
   'replenishment', 'REP-LCK-0004', 'Requested', 100000, '15160000-0000-0000-0000-0000000000a5');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month) values
  ('15160000-0000-0000-0000-000000000300', '15160000-0000-0000-0000-00000000000a', 'advance', '15160000-0000-0000-0000-0000000000a2',
   '15160000-0000-0000-0000-0000000000c1', 'Vehicle', 'adv J', 100000, 'Paid', 'ADV-2611020300', now(),
   '15160000-0000-0000-0000-0000000000a1', now(), '15160000-0000-0000-0000-0000000000a4', now(), current_date,
   '15160000-0000-0000-0000-0000000000d3', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);

-- the sole writer is service_role (no client holds the column grant)
set local role service_role;
select lives_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash H' where id = '15160000-0000-0000-0000-0000000000d1' $$,
  'a float that has not moved cash binds its account');
select throws_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash H2' where id = '15160000-0000-0000-0000-0000000000d1' $$,
  'P0001', 'imprest-cash-account-locked', 'a float with an account already refuses a different one');
select throws_ok($$ update imprest_floats set erp_cash_account_ref = null where id = '15160000-0000-0000-0000-0000000000d1' $$,
  'P0001', 'imprest-cash-account-locked', 'a float with an account refuses to clear it');
select lives_ok($$ update imprest_floats set erp_cash_account_ref = erp_cash_account_ref where id = '15160000-0000-0000-0000-0000000000d1' $$,
  'writing the same account again is not a change');
select throws_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash I' where id = '15160000-0000-0000-0000-0000000000d2' $$,
  'P0001', 'imprest-cash-account-locked', 'a float with a Paid funding refuses a first bind');
select throws_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash J' where id = '15160000-0000-0000-0000-0000000000d3' $$,
  'P0001', 'imprest-cash-account-locked', 'a float with a Paid float record refuses a first bind');
select lives_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash K' where id = '15160000-0000-0000-0000-0000000000d4' $$,
  'an unpaid top-up does not lock the float');
select throws_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash H' where id = '15160000-0000-0000-0000-0000000000d4' $$,
  'P0001', 'imprest-cash-account-locked', 'a bound float cannot take another account (lock wins over uniqueness here)');
select throws_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash H' where id = '15160000-0000-0000-0000-0000000000d5' $$,
  '23505', null, 'one ERP cash account cannot serve two floats of an org');
select lives_ok($$ update imprest_floats set erp_cash_account_ref = 'Cash H' where id = '15160000-0000-0000-0000-0000000000e1' $$,
  'another org may use the same account name');

select * from finish();
rollback;
