-- expense_claims_transition.test.sql — #775 status machine, numbering and the separations of duty
-- (AC-EXP-010..016). No spend_approvers rows here, so routing is `flat` (the OD-PROC-1 rank floor).
begin;
select plan(24);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02472000-0000-0000-0000-00000000000a','EXP Txn Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02472000-0000-0000-0000-0000000000a1','exp-t-e1@example.com'),
  ('02472000-0000-0000-0000-0000000000a2','exp-t-e2@example.com'),
  ('02472000-0000-0000-0000-0000000000a3','exp-t-pm@example.com'),
  ('02472000-0000-0000-0000-0000000000a4','exp-t-f1@example.com'),
  ('02472000-0000-0000-0000-0000000000a5','exp-t-f2@example.com'),
  ('02472000-0000-0000-0000-0000000000a6','exp-t-ad@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02472000-0000-0000-0000-0000000000a1','02472000-0000-0000-0000-00000000000a','T Eng One','exp-t-e1@example.com','Engineer','active'),
  ('02472000-0000-0000-0000-0000000000a2','02472000-0000-0000-0000-00000000000a','T Eng Two','exp-t-e2@example.com','Engineer','active'),
  ('02472000-0000-0000-0000-0000000000a3','02472000-0000-0000-0000-00000000000a','T PM','exp-t-pm@example.com','Project Manager','active'),
  ('02472000-0000-0000-0000-0000000000a4','02472000-0000-0000-0000-00000000000a','T Fin One','exp-t-f1@example.com','Finance','active'),
  ('02472000-0000-0000-0000-0000000000a5','02472000-0000-0000-0000-00000000000a','T Fin Two','exp-t-f2@example.com','Finance','active'),
  ('02472000-0000-0000-0000-0000000000a6','02472000-0000-0000-0000-00000000000a','T Admin','exp-t-ad@example.com','Admin','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id) values
  ('02472000-0000-0000-0000-000000000701','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T1 draft claim',0,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000702','02472000-0000-0000-0000-00000000000a','advance','02472000-0000-0000-0000-0000000000a1','T2 draft advance',500,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000703','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T3 empty claim',0,'Draft',null,null),
  ('02472000-0000-0000-0000-000000000704','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a6','T4 admin own',100,'Submitted','EXP-2610010004',null),
  ('02472000-0000-0000-0000-000000000705','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T5 submitted',200,'Submitted','EXP-2610010005',null),
  ('02472000-0000-0000-0000-000000000706','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T6 approved by F1',150,'Approved','EXP-2610010006','02472000-0000-0000-0000-0000000000a4'),
  ('02472000-0000-0000-0000-000000000707','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a5','T7 F2 own',80,'Approved','EXP-2610010007','02472000-0000-0000-0000-0000000000a6'),
  ('02472000-0000-0000-0000-000000000708','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T8 rejected',0,'Rejected','EXP-2610010008',null),
  ('02472000-0000-0000-0000-000000000709','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T9 submitted',60,'Submitted','EXP-2610010009',null),
  ('02472000-0000-0000-0000-000000000710','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T10 approved by PM',70,'Approved','EXP-2610010010','02472000-0000-0000-0000-0000000000a3'),
  ('02472000-0000-0000-0000-000000000711','02472000-0000-0000-0000-00000000000a','claim',  '02472000-0000-0000-0000-0000000000a1','T11 submitted',50,'Submitted','EXP-2610010011',null);
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('02472000-0000-0000-0000-000000000701','2026-10-01','Travel','Bus',120),
  ('02472000-0000-0000-0000-000000000708','2026-10-01','Meals','Dinner',90);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000701','Submitted') $$,
  'AC-EXP-010: the claimant submits a claim that has a line');
select ok((select claim_number ~ '^EXP-\d{10}$' and status = 'Submitted' and submitted_at is not null
             from expense_claims where id = '02472000-0000-0000-0000-000000000701'),
  'AC-EXP-010: submission mints an EXP number and stamps submitted_at');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000702','Submitted') $$,
  'AC-EXP-010: the claimant submits an advance');
select ok((select claim_number ~ '^ADV-\d{10}$' from expense_claims where id = '02472000-0000-0000-0000-000000000702'),
  'AC-EXP-010: an advance gets an ADV number');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000703','Submitted') $$,
  'P0001', 'an expense claim needs at least one line before it can be submitted',
  'AC-EXP-010: a claim with no lines cannot be submitted');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000703','Submitted') $$,
  '42501', 'only the claimant can submit this expense claim', 'AC-EXP-010: only the claimant submits');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000704','Approved') $$,
  '42501', 'separation of duties: a claimant cannot approve or reject their own expense claim',
  'AC-EXP-011: an Admin cannot approve their own claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Approved') $$,
  '42501', 'not authorized for transition Submitted -> Approved', 'AC-EXP-012: an Engineer cannot approve');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000705','Approved') $$,
  'AC-EXP-012: a Project Manager approves when no approvers are configured');
select is((select approved_by_id from expense_claims where id = '02472000-0000-0000-0000-000000000705'),
  '02472000-0000-0000-0000-0000000000a3'::uuid, 'AC-EXP-012: the approver is stamped');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000706','Paid') $$,
  '42501', 'not authorized for transition Approved -> Paid', 'AC-EXP-013: a Project Manager cannot pay');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000706','Paid') $$,
  '42501', 'separation of duties: the approver cannot also pay this expense claim', 'AC-EXP-013: the approver cannot pay');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000707','Paid') $$,
  '42501', 'separation of duties: a claimant cannot pay their own expense claim',
  'AC-EXP-013: Finance cannot pay their own claim');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000706','Paid', null, 'TRF-9') $$,
  'AC-EXP-013: another Finance member pays it with a reference');
select is((select paid_by_id::text || '|' || payment_reference || '|' || paid_on::text
             from expense_claims where id = '02472000-0000-0000-0000-000000000706'),
  '02472000-0000-0000-0000-0000000000a5|TRF-9|' || ((now() at time zone 'Asia/Jakarta')::date)::text,
  'AC-EXP-013: payer, reference and the org-timezone paid date are stamped');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000708','Draft') $$,
  '42501', 'only the claimant can send a rejected expense claim back to Draft',
  'AC-EXP-014: only the claimant reopens a rejected claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000708','Draft') $$,
  'AC-EXP-014: the claimant reopens it');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000708','Submitted') $$,
  'AC-EXP-014: and resubmits it');
select is((select claim_number from expense_claims where id = '02472000-0000-0000-0000-000000000708'),
  'EXP-2610010008', 'AC-EXP-014: the number is minted once');
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000709','Cancelled') $$,
  'AC-EXP-015: the claimant cancels a submitted claim');
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000710','Cancelled') $$,
  '42501', 'not authorized for transition Approved -> Cancelled',
  'AC-EXP-015: the claimant cannot cancel an approved claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000710','Cancelled') $$,
  'AC-EXP-015: Finance cancels an approved claim');

set local request.jwt.claims = '{"sub":"02472000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select transition_expense_claim('02472000-0000-0000-0000-000000000711','Approved', null, 'TRF-1') $$,
  'P0001', 'a payment reference belongs only to the payment step',
  'AC-EXP-016: a payment reference on an approval is refused');
reset role;

select ok(exists (select 1 from audit_events
                   where action = 'expense_claim.transition'
                     and entity_id = '02472000-0000-0000-0000-000000000705'
                     and detail->>'to' = 'Approved'),
  'AC-EXP-012: the approval is on the audit trail');

select * from finish();
rollback;
