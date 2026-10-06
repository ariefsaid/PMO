-- expense_claims_schema_rls.test.sql — #775 records, RLS and the server-owned columns (AC-EXP-001..006).
begin;
select plan(23);

insert into organizations (id, name, default_currency) values
  ('02471000-0000-0000-0000-00000000000a','EXP Schema Org A','IDR'),
  ('02471000-0000-0000-0000-00000000000b','EXP Schema Org B','IDR');
insert into auth.users (id, email) values
  ('02471000-0000-0000-0000-0000000000a1','exp-s-e1@example.com'),
  ('02471000-0000-0000-0000-0000000000a2','exp-s-e2@example.com'),
  ('02471000-0000-0000-0000-0000000000a3','exp-s-pm@example.com'),
  ('02471000-0000-0000-0000-0000000000b1','exp-s-badmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02471000-0000-0000-0000-0000000000a1','02471000-0000-0000-0000-00000000000a','S Eng One','exp-s-e1@example.com','Engineer','active'),
  ('02471000-0000-0000-0000-0000000000a2','02471000-0000-0000-0000-00000000000a','S Eng Two','exp-s-e2@example.com','Engineer','active'),
  ('02471000-0000-0000-0000-0000000000a3','02471000-0000-0000-0000-00000000000a','S PM','exp-s-pm@example.com','Project Manager','active'),
  ('02471000-0000-0000-0000-0000000000b1','02471000-0000-0000-0000-00000000000b','S B Admin','exp-s-badmin@example.com','Admin','active');
insert into projects (id, org_id, name, status) values
  ('02471000-0000-0000-0000-000000000101','02471000-0000-0000-0000-00000000000a','S Project','Ongoing Project');
-- Server-side fixtures: postgres bypasses the origination guard, exactly as an importer would.
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, paid_on) values
  ('02471000-0000-0000-0000-000000000301','02471000-0000-0000-0000-00000000000a','advance','02471000-0000-0000-0000-0000000000a1','E1 paid advance',500,'Paid',current_date),
  ('02471000-0000-0000-0000-000000000302','02471000-0000-0000-0000-00000000000a','advance','02471000-0000-0000-0000-0000000000a2','E2 paid advance',500,'Paid',current_date),
  ('02471000-0000-0000-0000-000000000303','02471000-0000-0000-0000-00000000000a','advance','02471000-0000-0000-0000-0000000000a1','E1 draft advance',300,'Draft',null),
  ('02471000-0000-0000-0000-000000000304','02471000-0000-0000-0000-00000000000a','claim','02471000-0000-0000-0000-0000000000a1','E1 submitted claim',0,'Submitted',null),
  ('02471000-0000-0000-0000-000000000305','02471000-0000-0000-0000-00000000000a','claim','02471000-0000-0000-0000-0000000000a2','E2 draft claim',0,'Draft',null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok($$ insert into expense_claims (id, kind, title, project_id)
                   values ('02471000-0000-0000-0000-000000000401','claim','Site visit','02471000-0000-0000-0000-000000000101') $$,
  'AC-EXP-001: an Engineer creates a claim sending only kind, title and project');
select is((select org_id::text || '|' || claimant_id::text || '|' || status::text || '|' || currency
             from expense_claims where id = '02471000-0000-0000-0000-000000000401'),
  '02471000-0000-0000-0000-00000000000a|02471000-0000-0000-0000-0000000000a1|Draft|IDR',
  'AC-EXP-001: org, claimant, status and currency are stamped by the server');
select throws_ok($$ insert into expense_claims (kind, title, status) values ('claim','Forged','Submitted') $$,
  '42501', 'permission denied for table expense_claims',
  'AC-EXP-001: a client cannot choose the status');
select throws_ok($$ insert into expense_claims (kind, title, amount) values ('claim','Padded',50) $$,
  'P0001', 'an expense claim''s amount is the sum of its lines: create the claim, then add lines',
  'AC-EXP-001: a claim cannot be created carrying an amount');
select is((select count(*)::int from expense_claims
            where id in ('02471000-0000-0000-0000-000000000401','02471000-0000-0000-0000-000000000305')), 1,
  'AC-EXP-002: an Engineer sees only their own claims');

select lives_ok($$ insert into expense_claim_lines (id, claim_id, expense_date, expense_type, description, amount) values
   ('02471000-0000-0000-0000-000000000501','02471000-0000-0000-0000-000000000401','2026-10-01','Travel','Flight',100),
   ('02471000-0000-0000-0000-000000000502','02471000-0000-0000-0000-000000000401','2026-10-01','Accommodation','Hotel',250) $$,
  'AC-EXP-003: the claimant adds two lines');
select is((select amount from expense_claims where id = '02471000-0000-0000-0000-000000000401'), 350.00::numeric,
  'AC-EXP-003: the claim amount is the sum of its lines');
update expense_claim_lines set amount = 200 where id = '02471000-0000-0000-0000-000000000502';
select is((select amount from expense_claims where id = '02471000-0000-0000-0000-000000000401'), 300.00::numeric,
  'AC-EXP-003: changing a line re-sums the claim');
delete from expense_claim_lines where id = '02471000-0000-0000-0000-000000000501';
select is((select amount from expense_claims where id = '02471000-0000-0000-0000-000000000401'), 200.00::numeric,
  'AC-EXP-003: removing a line re-sums the claim');
select throws_ok($$ update expense_claims set amount = 999 where id = '02471000-0000-0000-0000-000000000401' $$,
  '42501', 'an expense claim''s amount is the sum of its lines: add, change or remove a line instead',
  'AC-EXP-003: a claim''s amount cannot be set directly');

select is((with u as (update expense_claims set title = 'Changed'
                       where id = '02471000-0000-0000-0000-000000000304' returning 1)
           select count(*)::int from u), 0,
  'AC-EXP-004: a submitted claim''s header cannot be changed by its claimant');
select throws_ok($$ insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount)
                   values ('02471000-0000-0000-0000-000000000304','2026-10-02','Meals','Lunch',40) $$,
  '42501', 'new row violates row-level security policy for table "expense_claim_lines"',
  'AC-EXP-004: no line can be added to a submitted claim');

select throws_ok($$ update expense_claims set advance_id = '02471000-0000-0000-0000-000000000302'
                   where id = '02471000-0000-0000-0000-000000000401' $$,
  '23514', 'a claim can be settled only against one of the claimant''s own paid advances',
  'AC-EXP-005: a claim cannot name another person''s advance');
select throws_ok($$ update expense_claims set advance_id = '02471000-0000-0000-0000-000000000303'
                   where id = '02471000-0000-0000-0000-000000000401' $$,
  '23514', 'a claim can be settled only against one of the claimant''s own paid advances',
  'AC-EXP-005: a claim cannot name an unpaid advance');
select lives_ok($$ update expense_claims set advance_id = '02471000-0000-0000-0000-000000000301'
                  where id = '02471000-0000-0000-0000-000000000401' $$,
  'AC-EXP-005: a claim names the claimant''s own paid advance');
select throws_ok($$ insert into expense_claims (kind, title, amount, advance_id)
                   values ('advance','Advance on advance',100,'02471000-0000-0000-0000-000000000301') $$,
  '23514', 'only a claim can be settled against an advance',
  'AC-EXP-005: an advance cannot name an advance');

select lives_ok($$ insert into expense_claim_files (id, claim_id, file_path) values
   ('02471000-0000-0000-0000-000000000601','02471000-0000-0000-0000-000000000401',
    '02471000-0000-0000-0000-00000000000a/02471000-0000-0000-0000-000000000401/f1/receipt.pdf') $$,
  'AC-EXP-006: the claimant records a receipt on their Draft claim');
select is((select org_id from expense_claim_files where id = '02471000-0000-0000-0000-000000000601'),
  '02471000-0000-0000-0000-00000000000a'::uuid, 'AC-EXP-006: the receipt row inherits the claim''s org');
select throws_ok($$ insert into expense_claim_files (claim_id, file_path)
                   values ('02471000-0000-0000-0000-000000000304','x/y/z/r.pdf') $$,
  '42501', 'new row violates row-level security policy for table "expense_claim_files"',
  'AC-EXP-006: no receipt is added to a submitted claim');

set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ insert into expense_claim_files (claim_id, file_path)
                   values ('02471000-0000-0000-0000-000000000401','x/y/z/r.pdf') $$,
  '42501', 'new row violates row-level security policy for table "expense_claim_files"',
  'AC-EXP-006: nobody else records a receipt on a claim');

set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from expense_claims
            where id in ('02471000-0000-0000-0000-000000000401','02471000-0000-0000-0000-000000000305')), 2,
  'AC-EXP-002: a Project Manager sees every claim in the org');
select is((with u as (update expense_claims set title = 'PM edit'
                       where id = '02471000-0000-0000-0000-000000000305' returning 1)
           select count(*)::int from u), 0,
  'AC-EXP-004: a Project Manager cannot edit someone else''s Draft');

set local request.jwt.claims = '{"sub":"02471000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from expense_claims where org_id = '02471000-0000-0000-0000-00000000000a'), 0,
  'AC-EXP-002: another org''s Admin sees none of them');
reset role;

select * from finish();
rollback;
