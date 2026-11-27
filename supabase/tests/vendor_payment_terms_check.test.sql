-- vendor_payment_terms_check.test.sql — #3025 review should-fix (migration 2800).
-- The PMO-native payment_terms_days column (2786) carries a sanity bound: null (unset) or an
-- integer 0..365. The int column already excludes fractions; this pins the range, so a typo like
-- 3650 or a negative term is refused at the database (23514), not just in the form. Existing rows
-- are all null, so the constraint is safe in place.
-- Mutation-check: widen or drop the constraint and the refusal cases below go red.
-- Isolated org; UUID prefix 30250000-… (issue #3025).
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name) values
  ('30250000-0000-0000-0000-000000000003','Payment Terms Bound Org (3025)');

insert into companies (id, org_id, name, type) values
  ('30250000-0000-0000-0000-000000000020','30250000-0000-0000-0000-000000000003','Bound Vendor','Vendor');

select lives_ok(
  $$ update companies set payment_terms_days = 365 where id = '30250000-0000-0000-0000-000000000020' $$,
  'AC-3025: payment terms of 365 days are accepted (upper bound inclusive)');

select lives_ok(
  $$ update companies set payment_terms_days = 0 where id = '30250000-0000-0000-0000-000000000020' $$,
  'AC-3025: payment terms of 0 days are accepted (lower bound inclusive)');

select lives_ok(
  $$ update companies set payment_terms_days = null where id = '30250000-0000-0000-0000-000000000020' $$,
  'AC-3025: clearing payment terms stays allowed (null is unset, not zero)');

select throws_ok(
  $$ update companies set payment_terms_days = 366 where id = '30250000-0000-0000-0000-000000000020' $$,
  '23514', null,
  'AC-3025: payment terms beyond one year are refused');

select throws_ok(
  $$ update companies set payment_terms_days = -1 where id = '30250000-0000-0000-0000-000000000020' $$,
  '23514', null,
  'AC-3025: negative payment terms are refused');

select is(
  (select payment_terms_days from companies where id = '30250000-0000-0000-0000-000000000020'),
  NULL::int,
  'AC-3025: the refused writes left the stored value untouched');

reset role;
select * from finish();
rollback;
