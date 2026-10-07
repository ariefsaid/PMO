-- 0263_expense_postings_acl.test.sql — #775 phase B: no client write path, visibility follows the claim, the gate
-- and the trigger functions are not client-callable, and the account-map keys track the expense_type enum
-- (NFR-EXP-010/012, FR-EXP-112). AC-EXP-104. Migration under test: 0263 §1–§5.
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name, default_currency, default_timezone) values
  ('02630000-0000-0000-0000-00000000030a','EXP-B ACL Org','IDR','Asia/Jakarta'),
  ('02630000-0000-0000-0000-00000000030b','EXP-B ACL Org B','IDR','Asia/Jakarta');
insert into auth.users (id, email) values
  ('02630000-0000-0000-0000-0000000003a1','expb-a-e1@example.com'),
  ('02630000-0000-0000-0000-0000000003a2','expb-a-e2@example.com'),
  ('02630000-0000-0000-0000-0000000003a3','expb-a-pm@example.com'),
  ('02630000-0000-0000-0000-0000000003b1','expb-a-bad@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02630000-0000-0000-0000-0000000003a1','02630000-0000-0000-0000-00000000030a','A Eng 1','expb-a-e1@example.com','Engineer','active'),
  ('02630000-0000-0000-0000-0000000003a2','02630000-0000-0000-0000-00000000030a','A Eng 2','expb-a-e2@example.com','Engineer','active'),
  ('02630000-0000-0000-0000-0000000003a3','02630000-0000-0000-0000-00000000030a','A PM','expb-a-pm@example.com','Project Manager','active'),
  ('02630000-0000-0000-0000-0000000003b1','02630000-0000-0000-0000-00000000030b','B Admin','expb-a-bad@example.com','Admin','active');
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at,
                            paid_by_id, paid_at, paid_on, returned_amount) values
  ('02630000-0000-0000-0000-000000000701','02630000-0000-0000-0000-00000000030a','advance','02630000-0000-0000-0000-0000000003a1','E1 float',300,'Paid','ADV-2610090001','02630000-0000-0000-0000-0000000003a3',now(),'02630000-0000-0000-0000-0000000003a3',now(),current_date,50);
insert into expense_claims (id, org_id, kind, claimant_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('02630000-0000-0000-0000-000000000702','02630000-0000-0000-0000-00000000030a','claim','02630000-0000-0000-0000-0000000003a2','E2 claim',90,'Approved','EXP-2610090002','02630000-0000-0000-0000-0000000003a3',now());
insert into expense_advance_returns (id, org_id, advance_id, amount, recorded_by, returned_on) values
  ('02630000-0000-0000-0000-000000000711','02630000-0000-0000-0000-00000000030a','02630000-0000-0000-0000-000000000701',50,'02630000-0000-0000-0000-0000000003a3',current_date);
insert into expense_posting_erp_mirror (org_id, claim_id, posting, posting_identity, state_stamp, actor_id) values
  ('02630000-0000-0000-0000-00000000030a','02630000-0000-0000-0000-000000000701','advance-payment','02630000-0000-0000-0000-000000000701:advance-payment',now(),'02630000-0000-0000-0000-0000000003a3'),
  ('02630000-0000-0000-0000-00000000030a','02630000-0000-0000-0000-000000000702','approval','02630000-0000-0000-0000-000000000702:approval',now(),'02630000-0000-0000-0000-0000000003a3');
insert into expense_account_map (org_id, account_key, erp_account) values
  ('02630000-0000-0000-0000-00000000030a','employee_payable','Employee Payable - EX');

create function pg_temp.map_key_accepted(p_key text) returns boolean language plpgsql as $$
begin
  begin
    insert into public.expense_account_map (org_id, account_key, erp_account)
      values ('02630000-0000-0000-0000-00000000030b', p_key, 'probe ' || p_key);
    delete from public.expense_account_map where org_id = '02630000-0000-0000-0000-00000000030b' and account_key = p_key;
    return true;
  exception when check_violation then
    return false;
  end;
end $$;

-- ── table privileges (NFR-EXP-010) ──
select ok(has_table_privilege('authenticated', 'public.expense_posting_erp_mirror', 'SELECT')
      and has_table_privilege('authenticated', 'public.expense_advance_returns', 'SELECT')
      and has_table_privilege('authenticated', 'public.expense_account_map', 'SELECT'),
  'AC-EXP-104: authenticated may read the three tables');
select ok(not has_table_privilege('authenticated', 'public.expense_posting_erp_mirror', 'INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('authenticated', 'public.expense_advance_returns', 'INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('authenticated', 'public.expense_account_map', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'AC-EXP-104: authenticated may write none of them');
select ok(not has_table_privilege('anon', 'public.expense_posting_erp_mirror', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('anon', 'public.expense_advance_returns', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      and not has_table_privilege('anon', 'public.expense_account_map', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
  'AC-EXP-104: anon holds nothing on them');

-- ── visibility follows the claim ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000003a1","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror), 1, 'AC-EXP-104: E1 sees the intent of their own advance');
select is((select count(*)::int from expense_advance_returns), 1, 'AC-EXP-104: E1 sees the return on their own advance');
select is((select count(*)::int from expense_account_map), 1, 'AC-EXP-104: a member reads the org''s account map');
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000003a2","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror
            where claim_id = '02630000-0000-0000-0000-000000000701'), 0, 'AC-EXP-104: E2 does not see E1''s intents');
select is((select count(*)::int from expense_advance_returns), 0, 'AC-EXP-104: E2 does not see E1''s returns');
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000003a3","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror), 2, 'AC-EXP-104: approval rank sees every intent');
set local request.jwt.claims = '{"sub":"02630000-0000-0000-0000-0000000003b1","role":"authenticated"}';
select is((select count(*)::int from expense_posting_erp_mirror), 0, 'AC-EXP-104: another org''s Admin sees no intent');
select is((select count(*)::int from expense_account_map), 0, 'AC-EXP-104: another org''s Admin sees no account map');
reset role;

-- ── functions (NFR-EXP-012) ──
select ok(not has_function_privilege('anon', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.expense_posting_for_push(uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.org_employs_expense_postings(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.org_employs_expense_postings(uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.org_employs_expense_postings(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.expense_posting_actor_check(uuid, uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.expense_posting_actor_check(uuid, uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.expense_posting_actor_check(uuid, uuid)', 'EXECUTE'),
  'AC-EXP-104: the gate, its actor check and the employment check are service_role only');
select ok(not has_function_privilege('anon', 'public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_expense_posting(uuid, uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.enqueue_expense_claim_postings()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_expense_claim_postings()', 'EXECUTE')
      and not has_function_privilege('anon', 'public.enqueue_expense_return_posting()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_expense_return_posting()', 'EXECUTE'),
  'AC-EXP-104: no client can call the enqueue functions');

-- ── the key CHECK tracks the enum (a new expense_type label must be added to the CHECK in the same change) ──
select is((select count(*)::int
             from (select unnest(enum_range(null::public.expense_type))::text as k
                   union all select 'employee_payable' union all select 'employee_advance') keys
            where pg_temp.map_key_accepted(keys.k)),
  (select count(*)::int + 2 from unnest(enum_range(null::public.expense_type))),
  'AC-EXP-104: every expense_type label and the two party keys are accepted');
select throws_ok($$ insert into expense_account_map (org_id, account_key, erp_account)
                    values ('02630000-0000-0000-0000-00000000030b','Bogus','Any') $$,
  '23514', 'new row for relation "expense_account_map" violates check constraint "expense_account_map_key"',
  'AC-EXP-104: an unknown key is refused');

select * from finish();
rollback;
