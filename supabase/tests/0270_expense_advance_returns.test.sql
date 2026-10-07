-- 0270_expense_advance_returns.test.sql — #775 phase B: each cash return is its own row and its own posting intent
-- (FR-EXP-102, DD-EXP-17). AC-EXP-102. Migration under test: 0270_expense_postings.sql §1 + §4.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02700000-0000-0000-0000-00000000000a','EXP-B Returns Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1','expb-r-e1@example.com'),
  ('02700000-0000-0000-0000-0000000000a4','expb-r-f1@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1','02700000-0000-0000-0000-00000000000a','R Eng','expb-r-e1@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000000a4','02700000-0000-0000-0000-00000000000a','R Fin','expb-r-f1@example.com','Finance','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at) values
  ('02700000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref','{"company":"Example Co"}'::jsonb, now());
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('02700000-0000-0000-0000-00000000000a','erpnext','expenses');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number,
                            approved_by_id, paid_by_id, paid_at, paid_on) values
  ('02700000-0000-0000-0000-000000000301','02700000-0000-0000-0000-00000000000a','advance',
   '02700000-0000-0000-0000-0000000000a1','Float',500,'Paid','ADV-2610070001',
   '02700000-0000-0000-0000-0000000000a4','02700000-0000-0000-0000-0000000000a4', now(),
   (now() at time zone 'Asia/Jakarta')::date);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select record_expense_advance_return('02700000-0000-0000-0000-000000000301', 100, 'CB-1') $$,
  'AC-EXP-102: Finance records a 100 cash return');
select throws_ok($$ select record_expense_advance_return('02700000-0000-0000-0000-000000000301', 450) $$,
  'P0001', 'a return of 450.00 exceeds the 400.00 still outstanding on this advance',
  'AC-EXP-102: the phase-A ceiling still refuses a return above what is outstanding');
reset role;

select is((select returned_amount from expense_claims where id = '02700000-0000-0000-0000-000000000301'),
  100.00::numeric, 'AC-EXP-102: returned_amount carries the return');
select is((select count(*)::int from expense_advance_returns where advance_id = '02700000-0000-0000-0000-000000000301'),
  1, 'AC-EXP-102: one return row — the refused 450 wrote none');
select is((select amount::text || '/' || reference || '/' || recorded_by::text
             from expense_advance_returns where advance_id = '02700000-0000-0000-0000-000000000301'),
  '100.00/CB-1/02700000-0000-0000-0000-0000000000a4',
  'AC-EXP-102: the row holds the amount, the reference and the recorder');
select is((select returned_on from expense_advance_returns where advance_id = '02700000-0000-0000-0000-000000000301'),
  (now() at time zone 'Asia/Jakarta')::date, 'AC-EXP-102: returned_on is today in the org timezone');
select is((select count(*)::int
             from expense_posting_erp_mirror m join expense_advance_returns r on r.id = m.return_id
            where r.advance_id = '02700000-0000-0000-0000-000000000301' and m.posting = 'advance-return'
              and m.push_state = 'pending' and m.state_stamp = r.recorded_at and m.actor_id = r.recorded_by),
  1, 'AC-EXP-102: one pending advance-return intent carries the row''s stamp and recorder');
select is((select posting_identity from expense_posting_erp_mirror
            where posting = 'advance-return' and claim_id = '02700000-0000-0000-0000-000000000301'),
  (select id::text || ':advance-return' from expense_advance_returns
    where advance_id = '02700000-0000-0000-0000-000000000301'),
  'AC-EXP-102: the intent identity is <return id>:advance-return');

select * from finish();
rollback;
