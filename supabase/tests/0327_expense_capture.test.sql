-- AC-S29-002: atomic, claimant-scoped, stable-ID creation of a Draft claim and its optional first line.
begin;
select plan(27);

insert into organizations (id, name, default_currency) values
  ('03270000-0000-0000-0000-00000000000a','S29 Capture Org A','IDR'),
  ('03270000-0000-0000-0000-00000000000b','S29 Capture Org B','USD');
insert into auth.users (id, email) values
  ('03270000-0000-0000-0000-0000000000a1','s29-capture-a@example.com'),
  ('03270000-0000-0000-0000-0000000000a2','s29-capture-b@example.com'),
  ('03270000-0000-0000-0000-0000000000a3','s29-capture-disabled@example.com'),
  ('03270000-0000-0000-0000-0000000000a4','s29-capture-approver@example.com'),
  ('03270000-0000-0000-0000-0000000000b1','s29-capture-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03270000-0000-0000-0000-0000000000a1','03270000-0000-0000-0000-00000000000a','S29 Claimant A','s29-capture-a@example.com','Engineer','active'),
  ('03270000-0000-0000-0000-0000000000a2','03270000-0000-0000-0000-00000000000a','S29 Claimant B','s29-capture-b@example.com','Engineer','active'),
  ('03270000-0000-0000-0000-0000000000a3','03270000-0000-0000-0000-00000000000a','S29 Disabled','s29-capture-disabled@example.com','Engineer','disabled'),
  ('03270000-0000-0000-0000-0000000000a4','03270000-0000-0000-0000-00000000000a','S29 Approver','s29-capture-approver@example.com','Project Manager','active'),
  ('03270000-0000-0000-0000-0000000000b1','03270000-0000-0000-0000-00000000000b','S29 Foreign','s29-capture-foreign@example.com','Engineer','active');
insert into projects (id, org_id, name, status) values
  ('03270000-0000-0000-0000-000000000201','03270000-0000-0000-0000-00000000000a','S29 Project A','Ongoing Project'),
  ('03270000-0000-0000-0000-000000000202','03270000-0000-0000-0000-00000000000b','S29 Project B','Ongoing Project');

select ok(
  not has_function_privilege('anon','public.create_expense_capture(uuid,uuid,jsonb,jsonb)','EXECUTE'),
  'AC-S29-002: anonymous callers cannot execute expense capture');
select ok(
  has_function_privilege('authenticated','public.create_expense_capture(uuid,uuid,jsonb,jsonb)','EXECUTE'),
  'AC-S29-002: authenticated claimants can reach the invoker function');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03270000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.create_expense_capture(
  '03270000-0000-0000-0000-000000000101','03270000-0000-0000-0000-000000000102',
  '{"title":"Taxi to project site","purpose":null,"projectId":"03270000-0000-0000-0000-000000000201","budgetCategory":"Special expenses","advanceId":null}'::jsonb,
  '{"expenseDate":"2026-10-07","expenseType":"Travel","description":"Taxi to project site","amount":150000}'::jsonb
)::text, '03270000-0000-0000-0000-000000000101',
  'AC-S29-002: one capture creates the supplied stable Draft claim ID');
select is((select kind::text || '|' || claimant_id::text || '|' || org_id::text || '|' || status::text || '|' || currency || '|' || amount::text
             from expense_claims where id='03270000-0000-0000-0000-000000000101'),
  'claim|03270000-0000-0000-0000-0000000000a1|03270000-0000-0000-0000-00000000000a|Draft|IDR|150000.00',
  'AC-S29-002: server stamps claimant, organization, currency, Draft status and the line-summed amount');
select is((select expense_date::text || '|' || expense_type::text || '|' || description || '|' || amount::text
             from expense_claim_lines where id='03270000-0000-0000-0000-000000000102'),
  '2026-10-07|Travel|Taxi to project site|150000.00',
  'AC-S29-002: the first line persists with the stable line ID and supplied source amount');
select is((select count(*)::int from expense_posting_erp_mirror where claim_id='03270000-0000-0000-0000-000000000101'), 0,
  'AC-S29-002: capture creates no posting or approval record');
set local request.jwt.claims = '{"sub":"03270000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from expense_claims where id='03270000-0000-0000-0000-000000000101'), 1,
  'AC-S29-002: an active Project Manager approver can read the claimant Draft');
select throws_ok($$select public.create_expense_capture(
  '03270000-0000-0000-0000-000000000101','03270000-0000-0000-0000-000000000102',
  '{"title":"Taxi to project site","purpose":null,"projectId":"03270000-0000-0000-0000-000000000201","budgetCategory":"Special expenses","advanceId":null}'::jsonb,
  '{"expenseDate":"2026-10-07","expenseType":"Travel","description":"Taxi to project site","amount":150000}'::jsonb
)$$, '42501', null, 'AC-S29-002: an approver cannot replay another claimant’s stable Draft ID');
select ok(exists(select 1 from expense_claims
    where id='03270000-0000-0000-0000-000000000101'
      and kind='claim' and org_id='03270000-0000-0000-0000-00000000000a'
      and claimant_id='03270000-0000-0000-0000-0000000000a1'
      and status='Draft' and title='Taxi to project site' and purpose is null
      and project_id='03270000-0000-0000-0000-000000000201'
      and budget_category='Special expenses' and advance_id is null and amount=150000
      and approved_by_id is null and approved_at is null and approval_notes is null),
  'AC-S29-002: rejected approver replay leaves the Draft header and amount unchanged');
select is((select count(*)::int from expense_claim_lines where claim_id='03270000-0000-0000-0000-000000000101'), 1,
  'AC-S29-002: rejected approver replay does not add a line');
select ok(exists(select 1 from expense_claim_lines
    where id='03270000-0000-0000-0000-000000000102'
      and claim_id='03270000-0000-0000-0000-000000000101'
      and expense_date='2026-10-07' and expense_type='Travel'
      and description='Taxi to project site' and amount=150000),
  'AC-S29-002: rejected approver replay leaves the original line unchanged');
select ok(not exists(select 1 from expense_posting_erp_mirror where claim_id='03270000-0000-0000-0000-000000000101')
    and exists(select 1 from expense_claims where id='03270000-0000-0000-0000-000000000101'
      and status='Draft' and approved_by_id is null and approved_at is null and approval_notes is null),
  'AC-S29-002: rejected approver replay creates no posting or approval state');
set local request.jwt.claims = '{"sub":"03270000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.create_expense_capture(
  '03270000-0000-0000-0000-000000000101','03270000-0000-0000-0000-000000000102',
  '{"title":"Taxi to project site","purpose":null,"projectId":"03270000-0000-0000-0000-000000000201","budgetCategory":"Special expenses","advanceId":null}'::jsonb,
  '{"expenseDate":"2026-10-07","expenseType":"Travel","description":"Taxi to project site","amount":150000}'::jsonb
)::text, '03270000-0000-0000-0000-000000000101',
  'AC-S29-002: a matching lost-response replay returns the same stable ID');
select is((select count(*)::int from expense_claim_lines where claim_id='03270000-0000-0000-0000-000000000101'), 1,
  'AC-S29-002: matching replay does not duplicate the first line');
select throws_ok($$select public.create_expense_capture(
  '03270000-0000-0000-0000-000000000101','03270000-0000-0000-0000-000000000102',
  '{"title":"Changed intent","purpose":null,"projectId":"03270000-0000-0000-0000-000000000201","budgetCategory":"Special expenses","advanceId":null}'::jsonb,
  '{"expenseDate":"2026-10-07","expenseType":"Travel","description":"Taxi to project site","amount":150000}'::jsonb
)$$, '55000', null, 'AC-S29-002: a changed header cannot reuse the saved claim ID');
select is((select title || '|' || amount::text from expense_claims where id='03270000-0000-0000-0000-000000000101'),
  'Taxi to project site|150000.00', 'AC-S29-002: conflicting replay leaves the saved Draft unchanged');
select throws_ok($$select public.create_expense_capture(
  '03270000-0000-0000-0000-000000000103','03270000-0000-0000-0000-000000000104',
  '{"title":"Invalid first line","purpose":null,"projectId":null,"budgetCategory":null,"advanceId":null}'::jsonb,
  '{"expenseDate":"2026-10-07","expenseType":"Travel","description":"Invalid zero amount","amount":0}'::jsonb
)$$, '23514', null, 'AC-S29-002: the existing positive-line constraint rejects a zero amount');
select is((select count(*)::int from expense_claims where id='03270000-0000-0000-0000-000000000103'), 0,
  'AC-S29-002: a failed line constraint rolls back its newly inserted claim header');

set local request.jwt.claims = '{"sub":"03270000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.create_expense_capture(
  '03270000-0000-0000-0000-000000000101',null,
  '{"title":"Taxi to project site","purpose":null,"projectId":"03270000-0000-0000-0000-000000000201","budgetCategory":"Special expenses","advanceId":null}'::jsonb,
  null::jsonb
)$$, '42501', null, 'AC-S29-002: another claimant cannot replay someone else’s stable ID');
select throws_ok($$select public.create_expense_capture(
  '03270000-0000-0000-0000-000000000105',null,
  '{"title":"Foreign project","purpose":null,"projectId":"03270000-0000-0000-0000-000000000202","budgetCategory":null,"advanceId":null}'::jsonb,
  null::jsonb
)$$, '42501', null, 'AC-S29-002: the existing project organization policy refuses a foreign project');

set local request.jwt.claims = '{"sub":"03270000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.create_expense_capture(
  '03270000-0000-0000-0000-000000000106',null,
  '{"title":"Disabled claimant","purpose":null,"projectId":null,"budgetCategory":null,"advanceId":null}'::jsonb,
  null::jsonb
)$$, '42501', null, 'AC-S29-002: a disabled profile cannot create a draft');

set local request.jwt.claims = '{"sub":"03270000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.create_expense_capture(
  '03270000-0000-0000-0000-000000000101',null,
  '{"title":"Taxi to project site","purpose":null,"projectId":null,"budgetCategory":null,"advanceId":null}'::jsonb,
  null::jsonb
)$$, '42501', null, 'AC-S29-002: a caller from another organization cannot reuse a claim ID');

set local request.jwt.claims = '{"sub":"03270000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.create_expense_capture(
  '03270000-0000-0000-0000-000000000107',null,
  '{"title":"Receipt first","purpose":null,"projectId":null,"budgetCategory":null,"advanceId":null}'::jsonb,
  null::jsonb
)::text, '03270000-0000-0000-0000-000000000107',
  'AC-S29-002: receipt-first capture can save a header without inventing a line');
select is((select count(*)::int from expense_claim_lines where claim_id='03270000-0000-0000-0000-000000000107'), 0,
  'AC-S29-002: header-only capture has no synthetic line');
select is((select amount::text from expense_claims where id='03270000-0000-0000-0000-000000000107'), '0.00',
  'AC-S29-002: header-only capture stores the database-derived zero total, not a fabricated expense amount');
select is(public.create_expense_capture(
  '03270000-0000-0000-0000-000000000107',null,
  '{"title":"Receipt first","purpose":null,"projectId":null,"budgetCategory":null,"advanceId":null}'::jsonb,
  null::jsonb
)::text, '03270000-0000-0000-0000-000000000107',
  'AC-S29-002: header-only RPC retry preserves its stable claim identity');
select is((select count(*)::int from expense_claim_lines where claim_id='03270000-0000-0000-0000-000000000107'), 0,
  'AC-S29-002: header-only retry remains atomic and does not add lines');
reset role;

select * from finish();
rollback;
