-- expense_advances.test.sql — #775 advances: claims settle against them at payment, Finance records cash
-- returns, aging is in the org's timezone (DD-EXP-6/7). AC-EXP-017, 030..032.
begin;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02475000-0000-0000-0000-00000000000a','EXP Adv Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02475000-0000-0000-0000-0000000000a1','exp-a-e1@example.com'),
  ('02475000-0000-0000-0000-0000000000a2','exp-a-e2@example.com'),
  ('02475000-0000-0000-0000-0000000000a3','exp-a-pm@example.com'),
  ('02475000-0000-0000-0000-0000000000a4','exp-a-f1@example.com'),
  ('02475000-0000-0000-0000-0000000000a5','exp-a-f2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02475000-0000-0000-0000-0000000000a1','02475000-0000-0000-0000-00000000000a','A Eng One','exp-a-e1@example.com','Engineer','active'),
  ('02475000-0000-0000-0000-0000000000a2','02475000-0000-0000-0000-00000000000a','A Eng Two','exp-a-e2@example.com','Engineer','active'),
  ('02475000-0000-0000-0000-0000000000a3','02475000-0000-0000-0000-00000000000a','A PM','exp-a-pm@example.com','Project Manager','active'),
  ('02475000-0000-0000-0000-0000000000a4','02475000-0000-0000-0000-00000000000a','A Fin One','exp-a-f1@example.com','Finance','active'),
  ('02475000-0000-0000-0000-0000000000a5','02475000-0000-0000-0000-00000000000a','A Fin Two','exp-a-f2@example.com','Finance','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, paid_on, returned_amount) values
  ('02475000-0000-0000-0000-000000000301','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Trip float',1000,'Paid','ADV-2610040001','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 10,0),
  ('02475000-0000-0000-0000-000000000302','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Returnable',500,'Paid','ADV-2610040002','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 10,0),
  ('02475000-0000-0000-0000-000000000303','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a5','F2 own',200,'Paid','ADV-2610040003','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 5,0),
  ('02475000-0000-0000-0000-000000000304','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Not yet paid',100,'Approved','ADV-2610040004','02475000-0000-0000-0000-0000000000a3',null,0),
  ('02475000-0000-0000-0000-000000000305','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Settled',50,'Paid','ADV-2610040005','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 100,50),
  ('02475000-0000-0000-0000-000000000306','02475000-0000-0000-0000-00000000000a','advance','02475000-0000-0000-0000-0000000000a1','Aged',500,'Paid','ADV-2610040006','02475000-0000-0000-0000-0000000000a3',(now() at time zone 'Asia/Jakarta')::date - 45,0);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, advance_id) values
  ('02475000-0000-0000-0000-000000000401','02475000-0000-0000-0000-00000000000a','claim','02475000-0000-0000-0000-0000000000a1','Claim 300',300,'Approved','EXP-2610040007','02475000-0000-0000-0000-0000000000a3','02475000-0000-0000-0000-000000000301'),
  ('02475000-0000-0000-0000-000000000402','02475000-0000-0000-0000-00000000000a','claim','02475000-0000-0000-0000-0000000000a1','Claim 900',900,'Approved','EXP-2610040008','02475000-0000-0000-0000-0000000000a3','02475000-0000-0000-0000-000000000301');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02475000-0000-0000-0000-000000000401','Paid') $$,
  'AC-EXP-030: Finance pays the 300 claim');
select is((select advance_applied from expense_claims where id = '02475000-0000-0000-0000-000000000401'), 300.00::numeric,
  'AC-EXP-030: the advance covers all 300');
select is(expense_advance_outstanding('02475000-0000-0000-0000-000000000301'), 700.00::numeric,
  'AC-EXP-030: 700 of the advance remains');
select lives_ok($$ select transition_expense_claim('02475000-0000-0000-0000-000000000402','Paid') $$,
  'AC-EXP-030: Finance pays the 900 claim');
select is((select advance_applied from expense_claims where id = '02475000-0000-0000-0000-000000000402'), 700.00::numeric,
  'AC-EXP-030: the advance covers only the 700 left; 200 is paid in cash');
select is(expense_advance_outstanding('02475000-0000-0000-0000-000000000301'), 0.00::numeric,
  'AC-EXP-030: the advance is fully settled');
select lives_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 100, 'Cash back') $$,
  'AC-EXP-031: Finance records a 100 cash return');
select is(expense_advance_outstanding('02475000-0000-0000-0000-000000000302'), 400.00::numeric,
  'AC-EXP-031: 400 remains outstanding');
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 450) $$,
  'P0001', 'a return of 450.00 exceeds the 400.00 still outstanding on this advance',
  'AC-EXP-031: a return cannot exceed what is outstanding');
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 'NaN') $$,
  'P0001', 'a return amount must be greater than zero', 'AC-EXP-031: NaN is refused');
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000304', 10) $$,
  'P0001', 'only a paid advance can have cash returned against it', 'AC-EXP-031: an unpaid advance takes no return');

set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000303', 10) $$,
  '42501', 'separation of duties: a claimant cannot record a return of their own advance',
  'AC-EXP-031: Finance cannot record a return on their own advance');

set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select record_expense_advance_return('02475000-0000-0000-0000-000000000302', 10) $$,
  '42501', 'only Finance or an Admin records an advance return', 'AC-EXP-031: a Project Manager cannot record a return');
select is((select age_days || '/' || bucket || '/' || outstanding::text
             from get_expense_advance_aging() where advance_id = '02475000-0000-0000-0000-000000000306'),
  '45/31-60/500.00', 'AC-EXP-032: age is counted in org days and bucketed');
select is((select count(*)::int from get_expense_advance_aging()
            where advance_id in ('02475000-0000-0000-0000-000000000301','02475000-0000-0000-0000-000000000305')), 0,
  'AC-EXP-032: settled advances are not aging');

set local request.jwt.claims = '{"sub":"02475000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from get_expense_advance_aging()), 0,
  'AC-EXP-032: an Engineer sees no one else''s advances');
reset role;

select ok(exists (select 1 from audit_events where action = 'expense_advance.return'
                   and entity_id = '02475000-0000-0000-0000-000000000302' and (detail->>'amount')::numeric = 100),
  'AC-EXP-031: the return is on the audit trail');
select is(has_function_privilege('anon','public.transition_expense_claim(uuid, public.expense_claim_status, text, text)','EXECUTE'), false,
  'AC-EXP-017: anon cannot execute transition_expense_claim');
select is(has_function_privilege('anon','public.record_expense_advance_return(uuid, numeric, text)','EXECUTE'), false,
  'AC-EXP-017: anon cannot execute record_expense_advance_return');
select is(has_function_privilege('authenticated','public.transition_expense_claim(uuid, public.expense_claim_status, text, text)','EXECUTE'), true,
  'AC-EXP-017: members can execute transition_expense_claim');
select is(has_function_privilege('authenticated','public.record_expense_advance_return(uuid, numeric, text)','EXECUTE'), true,
  'AC-EXP-017: members can execute record_expense_advance_return');

select * from finish();
rollback;
