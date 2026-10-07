-- 0263_expense_posting_gate.test.sql — #775 phase B: the sweep re-reads DB truth and the recorded actor's CURRENT
-- standing before every attempt (FR-EXP-104, FR-EXP-109). AC-EXP-105. Migration under test: 0263 §5.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02630000-0000-0000-0000-00000000020a','EXP-B Gate Org','IDR','Asia/Jakarta'),
  ('02630000-0000-0000-0000-00000000020b','EXP-B Gate Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02630000-0000-0000-0000-0000000002a1','expb-g-e1@example.com'),
  ('02630000-0000-0000-0000-0000000002a3','expb-g-pm@example.com'),
  ('02630000-0000-0000-0000-0000000002a4','expb-g-f1@example.com'),
  ('02630000-0000-0000-0000-0000000002a5','expb-g-pmx@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02630000-0000-0000-0000-0000000002a1','02630000-0000-0000-0000-00000000020a','G Eng','expb-g-e1@example.com','Engineer','active'),
  ('02630000-0000-0000-0000-0000000002a3','02630000-0000-0000-0000-00000000020a','G PM','expb-g-pm@example.com','Project Manager','active'),
  ('02630000-0000-0000-0000-0000000002a4','02630000-0000-0000-0000-00000000020a','G Fin','expb-g-f1@example.com','Finance','active'),
  ('02630000-0000-0000-0000-0000000002a5','02630000-0000-0000-0000-00000000020a','G PM Gone','expb-g-pmx@example.com','Project Manager','disabled');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('02630000-0000-0000-0000-000000000501','02630000-0000-0000-0000-00000000020a','claim','02630000-0000-0000-0000-0000000002a1','Trip',0,'Approved','EXP-2610080001','02630000-0000-0000-0000-0000000002a3','2026-10-07 18:30:00+00'),
  ('02630000-0000-0000-0000-000000000502','02630000-0000-0000-0000-00000000020a','claim','02630000-0000-0000-0000-0000000002a1','Trip 2',0,'Approved','EXP-2610080002','02630000-0000-0000-0000-0000000002a5','2026-10-07 10:00:00+00');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02630000-0000-0000-0000-000000000501','2026-10-06','Travel','Bus',100),
  ('02630000-0000-0000-0000-000000000501','2026-10-06','Travel','Taxi',50),
  ('02630000-0000-0000-0000-000000000501','2026-10-06','Meals','Lunch',25);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on) values
  ('02630000-0000-0000-0000-000000000503','02630000-0000-0000-0000-00000000020a','claim','02630000-0000-0000-0000-0000000002a1','Paid',200,'Paid','EXP-2610080003','02630000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02630000-0000-0000-0000-0000000002a4','2026-10-07 02:00:00+00','2026-10-07'),
  ('02630000-0000-0000-0000-000000000504','02630000-0000-0000-0000-00000000020a','claim','02630000-0000-0000-0000-0000000002a1','Paid 2',200,'Paid','EXP-2610080004','02630000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02630000-0000-0000-0000-0000000002a4','2026-10-07 03:00:00+00','2026-10-07');
insert into expense_posting_erp_mirror (id, org_id, claim_id, posting, posting_identity, state_stamp, actor_id) values
  ('02630000-0000-0000-0000-000000000601','02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000501','approval','02630000-0000-0000-0000-000000000501:approval','2026-10-07 18:30:00+00','02630000-0000-0000-0000-0000000002a3'),
  ('02630000-0000-0000-0000-000000000602','02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000502','approval','02630000-0000-0000-0000-000000000502:approval','2026-10-07 10:00:00+00','02630000-0000-0000-0000-0000000002a5'),
  ('02630000-0000-0000-0000-000000000603','02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000503','claim-payment','02630000-0000-0000-0000-000000000503:claim-payment','2026-10-07 02:00:00+00','02630000-0000-0000-0000-0000000002a4'),
  ('02630000-0000-0000-0000-000000000604','02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000504','claim-payment','02630000-0000-0000-0000-000000000504:claim-payment','2026-10-07 03:00:00+00','02630000-0000-0000-0000-0000000002a1');

set local role service_role;
select is(expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000601') ->> 'amount',
  '175.00', 'AC-EXP-105: the approval amount is the claim amount, as text with two decimals');
select is(expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000601') -> 'lines',
  '[{"amount":"25.00","expense_type":"Meals"},{"amount":"150.00","expense_type":"Travel"}]'::jsonb,
  'AC-EXP-105: lines are summed per expense type, ordered by type');
select is(expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000601') ->> 'posting_date',
  '2026-10-08', 'AC-EXP-105: 18:30 UTC is the next day in Asia/Jakarta (FR-EXP-109)');
select is((expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000601') ->> 'approval_posting_exists')::boolean,
  true, 'AC-EXP-105: the gate reports whether the claim has an approval intent');
select is(expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000603') ->> 'amount',
  '200.00', 'AC-EXP-105: a claim payment is the cash part (amount - advance_applied)');
select throws_ok($$ select expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000602') $$,
  '42501', 'expense-posting-actor-inactive', 'AC-EXP-105: a disabled approver posts nothing');
select throws_ok($$ select expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000604') $$,
  '42501', 'expense-posting-actor-not-authorized', 'AC-EXP-105: a payment intent whose actor is not Finance/Admin posts nothing');
reset role;
update expense_posting_erp_mirror set state_stamp = state_stamp - interval '1 day'
 where id = '02630000-0000-0000-0000-000000000601';
set local role service_role;
select throws_ok($$ select expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000601') $$,
  'P0001', 'expense-posting-precondition-failed', 'AC-EXP-105: an intent whose stamp no longer matches the claim posts nothing');
select throws_ok($$ select expense_posting_for_push('02630000-0000-0000-0000-00000000020b','02630000-0000-0000-0000-000000000603') $$,
  'P0002', 'expense posting not found', 'AC-EXP-105: another org''s id finds nothing');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000002a1","role":"authenticated"}';
select throws_ok($$ select expense_posting_for_push('02630000-0000-0000-0000-00000000020a','02630000-0000-0000-0000-000000000603') $$,
  '42501', 'permission denied for function expense_posting_for_push', 'AC-EXP-105: no client can call the gate');

select * from finish();
rollback;
