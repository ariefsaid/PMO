-- 1376_billing_plan_candidates.test.sql — the billing plan's candidates (#2682). AC-MBP-001..005 (docs/specs/monthly-billing-plan.spec.md). Ids 13760000-… (synthetic).
-- Org a1: b1 finance, b6 engineer. Org a2 (foreign): b9 finance. Project c1 (live), c3 (archived), c4 (foreign).
begin;
create extension if not exists pgtap;
select plan(19);

insert into organizations (id, name, default_currency, default_timezone) values
  ('13760000-0000-0000-0000-0000000000a1', 'MBP Org A', 'IDR', 'UTC'), ('13760000-0000-0000-0000-0000000000a2', 'MBP Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('13760000-0000-0000-0000-0000000000b1', 'mbp-fin@example.invalid'), ('13760000-0000-0000-0000-0000000000b6', 'mbp-eng@example.invalid'), ('13760000-0000-0000-0000-0000000000b9', 'mbp-ffin@example.invalid');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('13760000-0000-0000-0000-0000000000b1', '13760000-0000-0000-0000-0000000000a1', 'MBP Finance', 'mbp-fin@example.invalid', 'Finance', 'active'),
  ('13760000-0000-0000-0000-0000000000b6', '13760000-0000-0000-0000-0000000000a1', 'MBP Engineer', 'mbp-eng@example.invalid', 'Engineer', 'active'),
  ('13760000-0000-0000-0000-0000000000b9', '13760000-0000-0000-0000-0000000000a2', 'MBP Foreign Finance', 'mbp-ffin@example.invalid', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, archived_at) values
  ('13760000-0000-0000-0000-0000000000c1', '13760000-0000-0000-0000-0000000000a1', 'MBP one', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null),
  ('13760000-0000-0000-0000-0000000000c3', '13760000-0000-0000-0000-0000000000a1', 'MBP archived', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, now()),
  ('13760000-0000-0000-0000-0000000000c4', '13760000-0000-0000-0000-0000000000a2', 'MBP foreign', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, earning_basis, line_no) values
  ('13760000-0000-0000-0000-000000000041', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'I-1', 'Item one', 'm', 100, 1000, 'unit_rate', 1),
  ('13760000-0000-0000-0000-000000000042', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'I-2', 'Item two', 'm', 100, 500, 'unit_rate', 2),
  ('13760000-0000-0000-0000-000000000043', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'I-3', 'Item three (never accepted)', 'm', 100, 100, 'unit_rate', 3),
  ('13760000-0000-0000-0000-000000000044', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'I-4', 'Item four (fully claimed)', 'm', 100, 10, 'unit_rate', 4),
  ('13760000-0000-0000-0000-000000000045', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c3', 'A-1', 'Archived item', 'm', 100, 100, 'unit_rate', 1),
  ('13760000-0000-0000-0000-000000000046', '13760000-0000-0000-0000-0000000000a2', '13760000-0000-0000-0000-0000000000c4', 'F-1', 'Foreign item', 'm', 100, 100, 'unit_rate', 1);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('13760000-0000-0000-0000-0000000000d1', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'MBP lines order', 'Issued', 100000, 'exclusive', 0, 'IDR'),
  ('13760000-0000-0000-0000-0000000000d2', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'MBP money order', 'Issued', 7000, 'exclusive', 0, 'IDR'),
  ('13760000-0000-0000-0000-0000000000d3', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'MBP draft money order', 'Draft', 3000, 'exclusive', 0, 'IDR'),
  ('13760000-0000-0000-0000-0000000000d5', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c3', 'MBP archived order', 'Issued', 9000, 'exclusive', 0, 'IDR'),
  ('13760000-0000-0000-0000-0000000000d6', '13760000-0000-0000-0000-0000000000a2', '13760000-0000-0000-0000-0000000000c4', 'MBP foreign order', 'Issued', 9000, 'exclusive', 0, 'IDR');
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000d1', '13760000-0000-0000-0000-000000000041', 20), ('13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000d1', '13760000-0000-0000-0000-000000000042', 30), ('13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000d1', '13760000-0000-0000-0000-000000000043', 10), ('13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000d1', '13760000-0000-0000-0000-000000000044', 10);
-- A confirmed acceptance on d1: I-1 accepted 12, I-2 accepted 5, I-4 accepted 4; I-3 has no acceptance line (accepted null).
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('13760000-0000-0000-0000-000000000051', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', '13760000-0000-0000-0000-0000000000d1', current_date, false, 'Confirmed', '13760000-0000-0000-0000-0000000000b1', '13760000-0000-0000-0000-0000000000b1', timestamptz '2026-05-04 10:00+00', 'standard');
insert into work_order_acceptance_lines (acceptance_id, boq_item_id, quantity) values
  ('13760000-0000-0000-0000-000000000051', '13760000-0000-0000-0000-000000000041', 12), ('13760000-0000-0000-0000-000000000051', '13760000-0000-0000-0000-000000000042', 5), ('13760000-0000-0000-0000-000000000051', '13760000-0000-0000-0000-000000000044', 4);
-- A live claim on d1 has claimed I-1 x5 and I-4 x4.
insert into progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, created_by) values
  ('13760000-0000-0000-0000-0000000000e1', '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', '13760000-0000-0000-0000-0000000000d1', 'progress', 'IDR', 5040, '13760000-0000-0000-0000-0000000000b1');
insert into progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit, quantity, rate, amount) values
  ('13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000e1', '13760000-0000-0000-0000-000000000041', 'I-1', 'Item one', 'm', 5, 1000, 5000), ('13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000e1', '13760000-0000-0000-0000-000000000044', 'I-4', 'Item four', 'm', 4, 10, 40);

create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"13760000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;

select pg_temp.as_user('b1');
-- AC-MBP-001: accepted-not-claimed lines, once each, value = unclaimed x rate; plus the one money-only order.
select is((select count(*)::int from billing_plan_candidates()), 3, 'AC-MBP-001 two quantity lines and one money-only order of the organisation');
select results_eq($$ select accepted_quantity, claimed_quantity, unclaimed_quantity, value, wo_number is null, kind from billing_plan_candidates() where boq_item_id = '13760000-0000-0000-0000-000000000041' $$,
  $$ values (12::numeric, 5::numeric, 7::numeric, 7000::numeric, true, 'line'::text) $$, 'AC-MBP-001 I-1: accepted 12, claimed 5, unclaimed 7, value 7 x 1000');
select is((select value from billing_plan_candidates() where boq_item_id = '13760000-0000-0000-0000-000000000042'), 2500::numeric, 'AC-MBP-001 I-2: accepted 5, nothing claimed, value 5 x 500');
select is((select accepted_on from billing_plan_candidates() where boq_item_id = '13760000-0000-0000-0000-000000000041'), date '2026-05-04', 'AC-MBP-001 accepted_on is the latest confirmed acceptance date (#2675 seam)');
select is((select count(*)::int from billing_plan_candidates() where currency <> 'IDR'), 0, 'AC-MBP-001 currency is carried');
-- AC-MBP-002: parity with get_project_billing and work_order_billing.
select is((select coalesce(sum(unclaimed_quantity), 0) from billing_plan_candidates('13760000-0000-0000-0000-0000000000c1') where kind = 'line'),
  (select coalesce(sum(greatest(0, (a.x ->> 'accepted_quantity')::numeric - (a.x ->> 'claimed_quantity')::numeric)), 0)
     from jsonb_array_elements(get_project_billing('13760000-0000-0000-0000-0000000000c1') -> 'boq') l(x), jsonb_array_elements(l.x -> 'allocations') a(x)
    where (a.x ->> 'accepted_quantity') is not null),
  'AC-MBP-002 unclaimed quantity equals the project billing allocations');
select is((select value from billing_plan_candidates() where kind = 'order'), (select remaining from work_order_billing where work_order_id = '13760000-0000-0000-0000-0000000000d2'),
  'AC-MBP-002 a money-only order carries work_order_billing.remaining');
-- AC-MBP-003: exclusions.
select is((select count(*)::int from billing_plan_candidates() where boq_item_id in ('13760000-0000-0000-0000-000000000043', '13760000-0000-0000-0000-000000000044')), 0, 'AC-MBP-003 accepted null and accepted-equals-claimed lines do not appear');
select is((select count(*)::int from billing_plan_candidates() where work_order_id = '13760000-0000-0000-0000-0000000000d3'), 0, 'AC-MBP-003 a draft money-only order does not appear');
select is((select count(*)::int from billing_plan_candidates() where project_id = '13760000-0000-0000-0000-0000000000c3'), 0, 'AC-MBP-003 an archived project does not appear');
-- AC-MBP-005: project filter.
select is((select count(*)::int from billing_plan_candidates('13760000-0000-0000-0000-0000000000c1')), 3, 'AC-MBP-005 project filter keeps that project');
select is((select count(*)::int from billing_plan_candidates('13760000-0000-0000-0000-0000000000c4')), 0, 'AC-MBP-005 a foreign project filter returns nothing');
-- AC-MBP-004: Engineer sees nothing; foreign finance sees only its own organisation.
select pg_temp.as_user('b6');
select is((select count(*)::int from billing_plan_candidates()), 0, 'AC-MBP-004 an Engineer gets no rows');
select pg_temp.as_user('b9');
select is((select count(*)::int from billing_plan_candidates() where project_id <> '13760000-0000-0000-0000-0000000000c4'), 0, 'AC-MBP-004 no row of the first organisation leaks');
-- Function shape.
reset role;
select is((select prosecdef from pg_proc where proname = 'billing_plan_candidates'), false, 'billing_plan_candidates is security invoker');
select is(has_function_privilege('anon', 'public.billing_plan_candidates(uuid)', 'execute'), false, 'anon cannot execute billing_plan_candidates');
select is(has_function_privilege('authenticated', 'public.billing_plan_candidates(uuid)', 'execute'), true, 'authenticated can execute billing_plan_candidates');
-- AC-MBP-005: bound of 501, highest value first.
insert into work_orders (org_id, project_id, title, status, order_value, tax_treatment, tax_amount, currency)
  select '13760000-0000-0000-0000-0000000000a1', '13760000-0000-0000-0000-0000000000c1', 'MBP bulk ' || g, 'Issued', 1 + g, 'exclusive', 0, 'IDR' from generate_series(1, 510) g;
select pg_temp.as_user('b1');
select is((select count(*)::int from billing_plan_candidates()), 501, 'AC-MBP-005 the read is bounded at 501 rows');
select is((select max(value) from billing_plan_candidates()), 7000::numeric, 'AC-MBP-005 highest value first: the largest candidates stay inside the bound');
select * from finish();
rollback;
