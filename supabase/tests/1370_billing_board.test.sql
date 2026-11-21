-- 1370_billing_board.test.sql — the billing board read (#2681). AC-BBD-001..007 (docs/specs/billing-board.spec.md). Ids 13700000-… (synthetic).
-- Org a1: b1 finance, b6 engineer. Org a2 (foreign): b9 finance. Projects c1, c2 (org a1), c3 (org a2).
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone) values
  ('13700000-0000-0000-0000-0000000000a1', 'BBD Org A', 'IDR', 'UTC'),
  ('13700000-0000-0000-0000-0000000000a2', 'BBD Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('13700000-0000-0000-0000-0000000000b1', 'bbd-fin@example.com'),
  ('13700000-0000-0000-0000-0000000000b6', 'bbd-eng@example.com'),
  ('13700000-0000-0000-0000-0000000000b9', 'bbd-ffin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('13700000-0000-0000-0000-0000000000b1', '13700000-0000-0000-0000-0000000000a1', 'BBD Finance', 'bbd-fin@example.com', 'Finance', 'active'),
  ('13700000-0000-0000-0000-0000000000b6', '13700000-0000-0000-0000-0000000000a1', 'BBD Engineer', 'bbd-eng@example.com', 'Engineer', 'active'),
  ('13700000-0000-0000-0000-0000000000b9', '13700000-0000-0000-0000-0000000000a2', 'BBD Foreign Finance', 'bbd-ffin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('13700000-0000-0000-0000-0000000000cc', '13700000-0000-0000-0000-0000000000a1', 'BBD Client', 'Client'),
  ('13700000-0000-0000-0000-0000000000cd', '13700000-0000-0000-0000-0000000000a2', 'BBD Foreign Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, client_id) values
  ('13700000-0000-0000-0000-0000000000c1', '13700000-0000-0000-0000-0000000000a1', 'BBD one', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '13700000-0000-0000-0000-0000000000cc'),
  ('13700000-0000-0000-0000-0000000000c2', '13700000-0000-0000-0000-0000000000a1', 'BBD two', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '13700000-0000-0000-0000-0000000000cc'),
  ('13700000-0000-0000-0000-0000000000c3', '13700000-0000-0000-0000-0000000000a2', 'BBD foreign', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null, 1, 1, false, '13700000-0000-0000-0000-0000000000cd');
insert into work_orders (id, project_id, title, order_value, tax_treatment, tax_amount, currency) values
  ('13700000-0000-0000-0000-0000000000d1', '13700000-0000-0000-0000-0000000000c1', 'BBD work order', 100, 'exclusive', 0, 'IDR');

-- Claims (no project template exists, so no stage is created by the trigger; the steps are inserted here).
-- e1 c1: step 1 done, step 2 current (own date), step 3 open.   e2 c1: step 1 skipped, step 2 current (days only).
-- e3 c2: all steps done (ready to invoice).   e4 c1: withdrawn.   e5 c1: no steps.   e6 c1: invoiced.   e7 c3: foreign.
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, created_by, withdrawn_by, withdrawn_at) values
  ('13700000-0000-0000-0000-000000000e01', '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c1', '13700000-0000-0000-0000-0000000000d1', 'progress', 'IDR', 1000, '13700000-0000-0000-0000-0000000000b1', null, null),
  ('13700000-0000-0000-0000-000000000e02', '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c1', null, 'progress', 'IDR', 1000, '13700000-0000-0000-0000-0000000000b1', null, null),
  ('13700000-0000-0000-0000-000000000e03', '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c2', null, 'progress', 'IDR', 1000, '13700000-0000-0000-0000-0000000000b1', null, null),
  ('13700000-0000-0000-0000-000000000e04', '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c1', null, 'progress', 'IDR', 1000, '13700000-0000-0000-0000-0000000000b1', '13700000-0000-0000-0000-0000000000b1', now()),
  ('13700000-0000-0000-0000-000000000e05', '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c1', null, 'progress', 'IDR', 1000, '13700000-0000-0000-0000-0000000000b1', null, null),
  ('13700000-0000-0000-0000-000000000e06', '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c1', null, 'progress', 'IDR', 1000, '13700000-0000-0000-0000-0000000000b1', null, null),
  ('13700000-0000-0000-0000-000000000e07', '13700000-0000-0000-0000-0000000000a2', '13700000-0000-0000-0000-0000000000c3', null, 'progress', 'IDR', 1000, '13700000-0000-0000-0000-0000000000b9', null, null);
-- (The claim insert above may mint stages through the 1021 trigger only when the project has a template; none does.)
insert into claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, started_on, completed_on, completed_by, skipped_on, target_days, target_on)
select o.org, o.claim, o.proj, o.pos, o.nm, false, o.st, o.done, case when o.done is not null then '13700000-0000-0000-0000-0000000000b1'::uuid end, o.skip, o.td, o.tn
  from (values
    ('13700000-0000-0000-0000-0000000000a1'::uuid, '13700000-0000-0000-0000-000000000e01'::uuid, '13700000-0000-0000-0000-0000000000c1'::uuid, 1::smallint, 'Check',   date '2026-01-01', date '2026-01-03', null::date, null::smallint, null::date),
    ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e01', '13700000-0000-0000-0000-0000000000c1', 2, 'Approve', date '2026-01-03', null, null, 5::smallint, date '2026-01-20'),
    ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e01', '13700000-0000-0000-0000-0000000000c1', 3, 'Send',    null, null, null, null, null),
    ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e02', '13700000-0000-0000-0000-0000000000c1', 2, 'Approve', date '2026-01-02', null, null, 7::smallint, null),
    ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e03', '13700000-0000-0000-0000-0000000000c2', 1, 'Check',   date '2026-02-01', date '2026-02-02', null, null, null),
    ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e03', '13700000-0000-0000-0000-0000000000c2', 2, 'Approve', date '2026-02-02', date '2026-02-09', null, null, null),
    ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e04', '13700000-0000-0000-0000-0000000000c1', 1, 'Check',   date '2026-01-01', null, null, null, null),
    ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e06', '13700000-0000-0000-0000-0000000000c1', 1, 'Check',   date '2026-01-01', date '2026-01-02', null, null, null),
    ('13700000-0000-0000-0000-0000000000a2', '13700000-0000-0000-0000-000000000e07', '13700000-0000-0000-0000-0000000000c3', 1, 'Check',   date '2026-01-01', null, null, null, null)
  ) as o(org, claim, proj, pos, nm, st, done, skip, td, tn);
insert into claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, started_on, optional, skipped_on, skipped_by, skipped_reason) values
  ('13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-000000000e02', '13700000-0000-0000-0000-0000000000c1', 1, 'Check', false, date '2026-01-01', true, date '2026-01-02',
   '13700000-0000-0000-0000-0000000000b1', 'not needed');
insert into sales_invoices (tax_treatment, tax_amount, id, org_id, project_id, customer_id, si_number, invoice_date, amount, erp_outstanding_amount, status, erp_docstatus, author_user_id) values
  ('exclusive', 0, '13700000-0000-0000-0000-000000000e06', '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c1', '13700000-0000-0000-0000-0000000000cc',
   'SI-BBD-001', '2026-03-02', 500.00, 500.00, 'Unpaid', 1, '13700000-0000-0000-0000-0000000000b1');

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"13700000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;

select pg_temp.as_user('b1');
-- AC-BBD-001: open claims, once each, first open step and counts (e1, e2, e3 only: e4 withdrawn, e5 no steps, e6 invoiced, e7 foreign).
select is((select count(*)::int from billing_board()), 3, 'AC-BBD-001 finance sees exactly the three open claims of the organisation');
select is((select count(distinct claim_id)::int from billing_board()), 3, 'AC-BBD-001 each claim appears once');
select results_eq($$ select current_name, current_position::int, step_count, steps_done, project_name from billing_board() where claim_id = '13700000-0000-0000-0000-000000000e01' $$,
  $$ values ('Approve'::text, 2, 3, 1, 'BBD one'::text) $$, 'AC-BBD-001 claim e1: current step, counts, project');
select is((select work_order_id from billing_board() where claim_id = '13700000-0000-0000-0000-000000000e01'), '13700000-0000-0000-0000-0000000000d1'::uuid, 'AC-BBD-001 the work order is carried');
-- AC-BBD-002: skipped / completed are passed over; all done -> flag.
select results_eq($$ select current_name, current_position::int, steps_done, all_done from billing_board() where claim_id = '13700000-0000-0000-0000-000000000e02' $$,
  $$ values ('Approve'::text, 2, 1, false) $$, 'AC-BBD-002 a skipped first step is passed over');
select results_eq($$ select all_done, current_stage_id is null, current_name is null, last_completed_on, due_on is null from billing_board() where claim_id = '13700000-0000-0000-0000-000000000e03' $$,
  $$ values (true, true, true, date '2026-02-09', true) $$, 'AC-BBD-002 all steps completed: all-done flag, no current step, last completion date');
-- AC-BBD-003: excluded kinds.
select is((select count(*)::int from billing_board() where claim_id in ('13700000-0000-0000-0000-000000000e04','13700000-0000-0000-0000-000000000e05','13700000-0000-0000-0000-000000000e06')), 0,
  'AC-BBD-003 withdrawn, step-less and invoiced claims do not appear');
-- AC-BBD-005: project filter.
select is((select count(*)::int from billing_board('13700000-0000-0000-0000-0000000000c1')), 2, 'AC-BBD-005 project filter keeps that project only');
select is((select count(*)::int from billing_board('13700000-0000-0000-0000-0000000000c2')), 1, 'AC-BBD-005 other project');
select is((select count(*)::int from billing_board('13700000-0000-0000-0000-0000000000c3')), 0, 'AC-BBD-004 a foreign project filter returns nothing');
-- AC-BBD-007: inline due rule equals billing_stage_due_on (table owner may call it).
reset role;
select is((select count(*)::int from billing_board() b join claim_billing_stages s on s.id = b.current_stage_id where b.due_on is distinct from billing_stage_due_on(s)), 0,
  'AC-BBD-007 the inline due date equals billing_stage_due_on for every current step (date wins, days only, neither)');
select is((select due_on from billing_board() where claim_id = '13700000-0000-0000-0000-000000000e01'), date '2026-01-20', 'AC-BBD-007 the step date wins over its days');
select is((select due_on from billing_board() where claim_id = '13700000-0000-0000-0000-000000000e02'), date '2026-01-09', 'AC-BBD-007 days only: started + days');
-- AC-BBD-004: Engineer sees nothing; foreign finance sees only its own organisation.
select pg_temp.as_user('b6');
select is((select count(*)::int from billing_board()), 0, 'AC-BBD-004 an Engineer gets no rows');
select pg_temp.as_user('b9');
select is((select count(*)::int from billing_board()), 1, 'AC-BBD-004 foreign finance sees only its own claim');
select is((select count(*)::int from billing_board() where project_id <> '13700000-0000-0000-0000-0000000000c3'), 0, 'AC-BBD-004 no row of the first organisation leaks');
-- Function shape.
reset role;
select is((select prosecdef from pg_proc where proname = 'billing_board'), false, 'billing_board is security invoker');
select is(has_function_privilege('anon', 'public.billing_board(uuid)', 'execute'), false, 'anon cannot execute billing_board');
select is(has_function_privilege('authenticated', 'public.billing_board(uuid)', 'execute'), true, 'authenticated can execute billing_board');
-- AC-BBD-006: bound of 501.
insert into progress_claims (org_id, project_id, kind, currency, gross_amount, created_by)
  select '13700000-0000-0000-0000-0000000000a1', '13700000-0000-0000-0000-0000000000c2', 'progress', 'IDR', 1, '13700000-0000-0000-0000-0000000000b1' from generate_series(1, 510);
insert into claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, started_on)
  select org_id, id, project_id, 1, 'Check', false, date '2026-03-01' from progress_claims where gross_amount = 1;
select pg_temp.as_user('b1');
select is((select count(*)::int from billing_board()), 501, 'AC-BBD-006 the read is bounded at 501 rows');
select is((select count(*)::int from billing_board() where claim_id in ('13700000-0000-0000-0000-000000000e01','13700000-0000-0000-0000-000000000e02')), 2,
  'AC-BBD-006 oldest current step first: the January steps stay inside the bound');
select * from finish();
rollback;
