-- 0270_expense_posting_gate.test.sql — #775 phase B: the sweep re-reads DB truth and the recorded actor's CURRENT
-- standing before every attempt (FR-EXP-104, FR-EXP-109). AC-EXP-105. Migration under test: 0270 §5.
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02700000-0000-0000-0000-00000000020a','EXP-B Gate Org','IDR','Asia/Jakarta'),
  ('02700000-0000-0000-0000-00000000020b','EXP-B Gate Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000002a1','expb-g-e1@example.com'),
  ('02700000-0000-0000-0000-0000000002a3','expb-g-pm@example.com'),
  ('02700000-0000-0000-0000-0000000002a4','expb-g-f1@example.com'),
  ('02700000-0000-0000-0000-0000000002a5','expb-g-pmx@example.com'),
  ('02700000-0000-0000-0000-0000000002a6','expb-g-fx@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000002a1','02700000-0000-0000-0000-00000000020a','G Eng','expb-g-e1@example.com','Engineer','active'),
  ('02700000-0000-0000-0000-0000000002a3','02700000-0000-0000-0000-00000000020a','G PM','expb-g-pm@example.com','Project Manager','active'),
  ('02700000-0000-0000-0000-0000000002a4','02700000-0000-0000-0000-00000000020a','G Fin','expb-g-f1@example.com','Finance','active'),
  ('02700000-0000-0000-0000-0000000002a5','02700000-0000-0000-0000-00000000020a','G PM Gone','expb-g-pmx@example.com','Project Manager','disabled'),
  -- paid a claim as Finance, since demoted to Engineer and still active
  ('02700000-0000-0000-0000-0000000002a6','02700000-0000-0000-0000-00000000020a','G Fin Demoted','expb-g-fx@example.com','Engineer','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('02700000-0000-0000-0000-000000000501','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Trip',0,'Approved','EXP-2610080001','02700000-0000-0000-0000-0000000002a3','2026-10-07 18:30:00+00'),
  ('02700000-0000-0000-0000-000000000502','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Trip 2',0,'Approved','EXP-2610080002','02700000-0000-0000-0000-0000000002a5','2026-10-07 10:00:00+00');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02700000-0000-0000-0000-000000000501','2026-10-06','Travel','Bus',100),
  ('02700000-0000-0000-0000-000000000501','2026-10-06','Travel','Taxi',50),
  ('02700000-0000-0000-0000-000000000501','2026-10-06','Meals','Lunch',25);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on) values
  ('02700000-0000-0000-0000-000000000503','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Paid',200,'Paid','EXP-2610080003','02700000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02700000-0000-0000-0000-0000000002a4','2026-10-07 02:00:00+00','2026-10-07'),
  ('02700000-0000-0000-0000-000000000504','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Paid 2',200,'Paid','EXP-2610080004','02700000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02700000-0000-0000-0000-0000000002a4','2026-10-07 03:00:00+00','2026-10-07');
insert into expense_posting_erp_mirror (id, org_id, claim_id, posting, posting_identity, state_stamp, actor_id) values
  ('02700000-0000-0000-0000-000000000601','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000501','approval','02700000-0000-0000-0000-000000000501:approval','2026-10-07 18:30:00+00','02700000-0000-0000-0000-0000000002a3'),
  ('02700000-0000-0000-0000-000000000602','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000502','approval','02700000-0000-0000-0000-000000000502:approval','2026-10-07 10:00:00+00','02700000-0000-0000-0000-0000000002a5'),
  ('02700000-0000-0000-0000-000000000603','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000503','claim-payment','02700000-0000-0000-0000-000000000503:claim-payment','2026-10-07 02:00:00+00','02700000-0000-0000-0000-0000000002a4'),
  ('02700000-0000-0000-0000-000000000604','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000504','claim-payment','02700000-0000-0000-0000-000000000504:claim-payment','2026-10-07 03:00:00+00','02700000-0000-0000-0000-0000000002a1');
-- A paid advance; a claim settled partly against it; a cash return on it (Q1: each posting's own amount).
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on) values
  ('02700000-0000-0000-0000-000000000507','02700000-0000-0000-0000-00000000020a','advance','02700000-0000-0000-0000-0000000002a1','Float',500,'Paid','ADV-2610080007','02700000-0000-0000-0000-0000000002a3','2026-10-01 02:00:00+00','02700000-0000-0000-0000-0000000002a4','2026-10-01 03:00:00+00','2026-10-01');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on, advance_id, advance_applied) values
  ('02700000-0000-0000-0000-000000000505','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Settled',300,'Paid','EXP-2610080005','02700000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02700000-0000-0000-0000-0000000002a4','2026-10-07 04:00:00+00','2026-10-07','02700000-0000-0000-0000-000000000507',120);
insert into expense_advance_returns (id, org_id, advance_id, amount, recorded_by, recorded_at, returned_on) values
  ('02700000-0000-0000-0000-000000000711','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000507',70,'02700000-0000-0000-0000-0000000002a4','2026-10-07 05:00:00+00','2026-10-07');
-- S3: approved, then cancelled before its approval posted. S4: paid by the since-demoted payer.
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            cancelled_at) values
  ('02700000-0000-0000-0000-000000000508','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Cancelled',0,'Cancelled','EXP-2610080008','02700000-0000-0000-0000-0000000002a3','2026-10-05 02:00:00+00','2026-10-06 00:00:00+00');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on) values
  ('02700000-0000-0000-0000-000000000506','02700000-0000-0000-0000-00000000020a','claim','02700000-0000-0000-0000-0000000002a1','Paid 3',200,'Paid','EXP-2610080006','02700000-0000-0000-0000-0000000002a3','2026-10-06 02:00:00+00','02700000-0000-0000-0000-0000000002a6','2026-10-07 06:00:00+00','2026-10-07');
insert into expense_posting_erp_mirror (id, org_id, claim_id, return_id, posting, posting_identity, state_stamp, actor_id) values
  ('02700000-0000-0000-0000-000000000605','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000505',null,'claim-payment','02700000-0000-0000-0000-000000000505:claim-payment','2026-10-07 04:00:00+00','02700000-0000-0000-0000-0000000002a4'),
  ('02700000-0000-0000-0000-000000000607','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000505',null,'settlement','02700000-0000-0000-0000-000000000505:settlement','2026-10-07 04:00:00+00','02700000-0000-0000-0000-0000000002a4'),
  ('02700000-0000-0000-0000-000000000608','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000507','02700000-0000-0000-0000-000000000711','advance-return','02700000-0000-0000-0000-000000000711:advance-return','2026-10-07 05:00:00+00','02700000-0000-0000-0000-0000000002a4'),
  ('02700000-0000-0000-0000-000000000609','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000508',null,'approval','02700000-0000-0000-0000-000000000508:approval','2026-10-05 02:00:00+00','02700000-0000-0000-0000-0000000002a3'),
  ('02700000-0000-0000-0000-000000000610','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000506',null,'claim-payment','02700000-0000-0000-0000-000000000506:claim-payment','2026-10-07 06:00:00+00','02700000-0000-0000-0000-0000000002a6'),
  ('02700000-0000-0000-0000-000000000611','02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000503',null,'approval','02700000-0000-0000-0000-000000000503:approval','2026-10-06 02:00:00+00','02700000-0000-0000-0000-0000000002a3');

set local role service_role;
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') ->> 'amount',
  '175.00', 'AC-EXP-105: the approval amount is the claim amount, as text with two decimals');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') -> 'lines',
  '[{"amount":"25.00","expense_type":"Meals"},{"amount":"150.00","expense_type":"Travel"}]'::jsonb,
  'AC-EXP-105: lines are summed per expense type, ordered by type');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') ->> 'posting_date',
  '2026-10-08', 'AC-EXP-105: 18:30 UTC is the next day in Asia/Jakarta (FR-EXP-109)');
select is((expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') ->> 'approval_posting_exists')::boolean,
  true, 'AC-EXP-105: the gate reports whether the claim has an approval intent');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000603') ->> 'amount',
  '200.00', 'AC-EXP-105: a claim payment is the cash part (amount - advance_applied)');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000605') ->> 'amount',
  '180.00', 'AC-EXP-105: a claim settled partly from an advance pays only the cash part (300 - 120 applied)');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000607') ->> 'amount',
  '120.00', 'AC-EXP-105: the settlement is the advance applied');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000608') ->> 'amount',
  '70.00', 'AC-EXP-105: an advance return posts the returned amount, not the advance');
select is(expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000611') ->> 'amount',
  '200.00', 'AC-EXP-105: an approval still posts once its claim is Paid');
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000609') $$,
  'P0001', 'expense-posting-claim-cancelled', 'AC-EXP-105: an approval whose claim was cancelled before it posted is not posted fresh');
-- S4: the actor half alone (the sweep runs it before replaying an existing outbox row).
select lives_ok($$ select expense_posting_actor_check('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000603') $$,
  'AC-EXP-105: an active Finance payer passes the actor check');
select lives_ok($$ select expense_posting_actor_check('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000609') $$,
  'AC-EXP-105: the actor check does not re-read the claim status (a replay of a cancelled claim''s approval is unaffected)');
select throws_ok($$ select expense_posting_actor_check('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000610') $$,
  '42501', 'expense-posting-actor-not-authorized', 'AC-EXP-105: a payer demoted to Engineer, still active, fails the actor check');
select throws_ok($$ select expense_posting_actor_check('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000602') $$,
  '42501', 'expense-posting-actor-inactive', 'AC-EXP-105: a disabled approver fails the actor check');
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000602') $$,
  '42501', 'expense-posting-actor-inactive', 'AC-EXP-105: a disabled approver posts nothing');
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000604') $$,
  '42501', 'expense-posting-actor-not-authorized', 'AC-EXP-105: a payment intent whose actor is not Finance/Admin posts nothing');
reset role;
update expense_posting_erp_mirror set state_stamp = state_stamp - interval '1 day'
 where id = '02700000-0000-0000-0000-000000000601';
set local role service_role;
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000601') $$,
  'P0001', 'expense-posting-precondition-failed', 'AC-EXP-105: an intent whose stamp no longer matches the claim posts nothing');
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020b','02700000-0000-0000-0000-000000000603') $$,
  'P0002', 'expense posting not found', 'AC-EXP-105: another org''s id finds nothing');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000002a1","role":"authenticated"}';
select throws_ok($$ select expense_posting_for_push('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000603') $$,
  '42501', 'permission denied for function expense_posting_for_push', 'AC-EXP-105: no client can call the gate');
select throws_ok($$ select expense_posting_actor_check('02700000-0000-0000-0000-00000000020a','02700000-0000-0000-0000-000000000603') $$,
  '42501', 'permission denied for function expense_posting_actor_check', 'AC-EXP-105: no client can call the actor check');

select * from finish();
rollback;
