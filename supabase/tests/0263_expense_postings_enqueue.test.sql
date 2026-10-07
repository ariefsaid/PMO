-- 0263_expense_postings_enqueue.test.sql — #775 phase B: the event writes its posting intents in its own
-- transaction, and only while the org employs `expenses` (FR-EXP-100/101, DD-EXP-12/13). AC-EXP-100, 101, 103.
-- Migration under test: 0263_expense_postings.sql §3 + §4.
begin;
create extension if not exists pgtap;
select plan(17);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02630000-0000-0000-0000-00000000010a','EXP-B Employing Org','IDR','Asia/Jakarta'),
  ('02630000-0000-0000-0000-00000000010c','EXP-B Connected Only Org','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02630000-0000-0000-0000-0000000001a1','expb-q-e1@example.com'),
  ('02630000-0000-0000-0000-0000000001a3','expb-q-pm@example.com'),
  ('02630000-0000-0000-0000-0000000001a4','expb-q-f1@example.com'),
  ('02630000-0000-0000-0000-0000000001c1','expb-q-ce1@example.com'),
  ('02630000-0000-0000-0000-0000000001c3','expb-q-cpm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02630000-0000-0000-0000-0000000001a1','02630000-0000-0000-0000-00000000010a','Q Eng','expb-q-e1@example.com','Engineer','active'),
  ('02630000-0000-0000-0000-0000000001a3','02630000-0000-0000-0000-00000000010a','Q PM','expb-q-pm@example.com','Project Manager','active'),
  ('02630000-0000-0000-0000-0000000001a4','02630000-0000-0000-0000-00000000010a','Q Fin','expb-q-f1@example.com','Finance','active'),
  ('02630000-0000-0000-0000-0000000001c1','02630000-0000-0000-0000-00000000010c','QC Eng','expb-q-ce1@example.com','Engineer','active'),
  ('02630000-0000-0000-0000-0000000001c3','02630000-0000-0000-0000-00000000010c','QC PM','expb-q-cpm@example.com','Project Manager','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at) values
  ('02630000-0000-0000-0000-00000000010a','erpnext','https://erp.example.test','test-ref-a','{"company":"Example Co"}'::jsonb, now()),
  ('02630000-0000-0000-0000-00000000010c','erpnext','https://erp.example.test','test-ref-c','{"company":"Other Co"}'::jsonb, now());
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('02630000-0000-0000-0000-00000000010a','erpnext','expenses');

-- advances (paid ones first: the advance-link check needs them)
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number,
                            approved_by_id, approved_at, paid_by_id, paid_at, paid_on) values
  ('02630000-0000-0000-0000-000000000311','02630000-0000-0000-0000-00000000010a','advance','02630000-0000-0000-0000-0000000001a1','Adv 500',500,'Paid','ADV-2610070011','02630000-0000-0000-0000-0000000001a3',now(),'02630000-0000-0000-0000-0000000001a4',now(),(now() at time zone 'Asia/Jakarta')::date),
  ('02630000-0000-0000-0000-000000000312','02630000-0000-0000-0000-00000000010a','advance','02630000-0000-0000-0000-0000000001a1','Adv 1000',1000,'Paid','ADV-2610070012','02630000-0000-0000-0000-0000000001a3',now(),'02630000-0000-0000-0000-0000000001a4',now(),(now() at time zone 'Asia/Jakarta')::date);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('02630000-0000-0000-0000-000000000313','02630000-0000-0000-0000-00000000010a','advance','02630000-0000-0000-0000-0000000001a1','Adv 200',200,'Approved','ADV-2610070013','02630000-0000-0000-0000-0000000001a3',now());
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, submitted_at) values
  ('02630000-0000-0000-0000-000000000411','02630000-0000-0000-0000-00000000010a','claim','02630000-0000-0000-0000-0000000001a1','To approve',100,'Submitted','EXP-2610070011',now()),
  ('02630000-0000-0000-0000-000000000412','02630000-0000-0000-0000-00000000010c','claim','02630000-0000-0000-0000-0000000001c1','Org C claim',100,'Submitted','EXP-2610070012',now()),
  ('02630000-0000-0000-0000-000000000415','02630000-0000-0000-0000-00000000010a','claim','02630000-0000-0000-0000-0000000001a1','Withdrawn',100,'Submitted','EXP-2610070015',now());
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at, advance_id) values
  ('02630000-0000-0000-0000-000000000413','02630000-0000-0000-0000-00000000010a','claim','02630000-0000-0000-0000-0000000001a1','Claim 800',800,'Approved','EXP-2610070013','02630000-0000-0000-0000-0000000001a3',now(),'02630000-0000-0000-0000-000000000311'),
  ('02630000-0000-0000-0000-000000000414','02630000-0000-0000-0000-00000000010a','claim','02630000-0000-0000-0000-0000000001a1','Claim 300',300,'Approved','EXP-2610070014','02630000-0000-0000-0000-0000000001a3',now(),'02630000-0000-0000-0000-000000000312'),
  ('02630000-0000-0000-0000-000000000416','02630000-0000-0000-0000-00000000010a','claim','02630000-0000-0000-0000-0000000001a1','Approved before employment',100,'Approved','EXP-2610070016','02630000-0000-0000-0000-0000000001a3',now(),null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000001a3","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000411','Approved') $$,
  'AC-EXP-100: the PM approves E1''s claim in the org that employs expenses');
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000001c3","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000412','Approved') $$,
  'AC-EXP-100: the PM approves in the org that is connected but has not employed expenses');
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000001a4","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000413','Paid') $$,
  'AC-EXP-101: Finance pays the 800 claim (500 from the advance, 300 cash)');
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000414','Paid') $$,
  'AC-EXP-101: Finance pays the 300 claim (all from the advance)');
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000313','Paid') $$,
  'AC-EXP-101: Finance pays the 200 advance');
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000411','Cancelled') $$,
  'AC-EXP-103: Finance cancels the approved claim that has an approval intent');
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000416','Cancelled') $$,
  'AC-EXP-103: Finance cancels an approved claim that has no approval intent');
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000001a1","role":"authenticated"}';
select lives_ok($$ select transition_expense_claim('02630000-0000-0000-0000-000000000415','Cancelled') $$,
  'AC-EXP-103: the claimant cancels a Submitted claim');
reset role;

select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02630000-0000-0000-0000-000000000411' and posting = 'approval'),
  1, 'AC-EXP-100: exactly one approval intent');
select is((select m.push_state || '/' || (m.state_stamp = c.approved_at)::text || '/' || m.actor_id::text
             from expense_posting_erp_mirror m join expense_claims c on c.id = m.claim_id
            where m.posting_identity = '02630000-0000-0000-0000-000000000411:approval'),
  'pending/true/02630000-0000-0000-0000-0000000001a3',
  'AC-EXP-100: pending, stamped with approved_at, attributed to the approver');
select is((select count(*)::int from expense_posting_erp_mirror
            where org_id = '02630000-0000-0000-0000-00000000010c'),
  0, 'AC-EXP-100: an org that has not employed expenses gets no intent');
select is((select array_agg(posting order by posting) from expense_posting_erp_mirror
            where claim_id = '02630000-0000-0000-0000-000000000413'),
  array['claim-payment','settlement'], 'AC-EXP-101: cash part and advance part are two intents');
select is((select array_agg(posting order by posting) from expense_posting_erp_mirror
            where claim_id = '02630000-0000-0000-0000-000000000414'),
  array['settlement'], 'AC-EXP-101: a claim the advance fully covers has no cash payment intent');
select is((select array_agg(posting order by posting) from expense_posting_erp_mirror
            where claim_id = '02630000-0000-0000-0000-000000000313'),
  array['advance-payment'], 'AC-EXP-101: a paid advance has one advance-payment intent');
select is((select actor_id from expense_posting_erp_mirror
            where posting_identity = '02630000-0000-0000-0000-000000000411:approval-cancel'),
  '02630000-0000-0000-0000-0000000001a4'::uuid, 'AC-EXP-103: the cancel intent is attributed to the canceller');
select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02630000-0000-0000-0000-000000000415'),
  0, 'AC-EXP-103: cancelling a Submitted claim queues nothing');
select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02630000-0000-0000-0000-000000000416'),
  0, 'AC-EXP-103: cancelling an approval that was never queued queues nothing');

select * from finish();
rollback;
