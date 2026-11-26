-- 2660_wo_billing_step_skip_reason.test.sql — skipping a work-order billing step records a reason (#2880). Ids 26600000-… (synthetic).
-- MUTATION: drop the `v_reason is null or ...` refusal in skip_work_order_step and 'a blank reason is refused' goes red.
begin;
create extension if not exists pgtap;
select plan(11);
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('26600000-0000-0000-0000-0000000000a1', 'SR Org A', 'IDR', 'UTC', true), ('26600000-0000-0000-0000-0000000000a2', 'SR Org B', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('26600000-0000-0000-0000-0000000000b1', 'sr-fin@example.com'), ('26600000-0000-0000-0000-0000000000b2', 'sr-eng@example.com'),
  ('26600000-0000-0000-0000-0000000000b0', 'sr-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26600000-0000-0000-0000-0000000000b1', '26600000-0000-0000-0000-0000000000a1', 'SR Finance', 'sr-fin@example.com', 'Finance', 'active', 'finance_officer'),
  ('26600000-0000-0000-0000-0000000000b2', '26600000-0000-0000-0000-0000000000a1', 'SR Engineer', 'sr-eng@example.com', 'Engineer', 'active', 'engineer'),
  ('26600000-0000-0000-0000-0000000000b0', '26600000-0000-0000-0000-0000000000a2', 'SR Foreign', 'sr-foreign@example.com', 'Finance', 'active', 'finance_officer');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount) values
  ('26600000-0000-0000-0000-0000000000c1', '26600000-0000-0000-0000-0000000000a1', 'SR project', 'Ongoing Project', 'IDR', 90000000, 'exclusive', 0);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26600000-0000-0000-0000-000000000032', '26600000-0000-0000-0000-0000000000a1', '26600000-0000-0000-0000-0000000000c1', 'SR order', 'Issued', 10000, 'exclusive', 0);
insert into work_order_billing_steps (id, org_id, work_order_id, project_id, position, name, optional, started_on, owner_role_key) values
  ('26600000-0000-0000-0000-000000000051', '26600000-0000-0000-0000-0000000000a1', '26600000-0000-0000-0000-000000000032', '26600000-0000-0000-0000-0000000000c1', 1, 'Optional pack', true, current_date, 'finance_officer'),
  ('26600000-0000-0000-0000-000000000052', '26600000-0000-0000-0000-0000000000a1', '26600000-0000-0000-0000-000000000032', '26600000-0000-0000-0000-0000000000c1', 2, 'Final', false, null, 'finance_officer');
-- Legacy skips have a date but no recorded reason.
insert into work_order_billing_steps
  (id, org_id, work_order_id, project_id, position, name, optional, skipped_on, owner_role_key)
values ('26600000-0000-0000-0000-000000000053', '26600000-0000-0000-0000-0000000000a1',
        '26600000-0000-0000-0000-000000000032', '26600000-0000-0000-0000-0000000000c1',
        3, 'Legacy step', true, current_date, 'finance_officer');
create function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"26600000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare m text;
begin execute p_sql; return 'ok';
exception when others then get stacked diagnostics m = message_text; return sqlstate || ' ' || split_part(m, ':', 1); end $$;

select pg_temp.as_user('b1');
select is(pg_temp.err($$select skip_work_order_step('26600000-0000-0000-0000-000000000051', null)$$), '23514 WBS_REASON', 'AC-WBS-007 a missing reason is refused');
select is(pg_temp.err($$select skip_work_order_step('26600000-0000-0000-0000-000000000051', '   ')$$), '23514 WBS_REASON', 'AC-WBS-007 a blank reason is refused');
select is(pg_temp.err($$select skip_work_order_step('26600000-0000-0000-0000-000000000051', 'ab')$$), '23514 WBS_REASON', 'AC-WBS-007 a two-character reason is refused');
select is(pg_temp.err(format('select skip_work_order_step(%L, %L)', '26600000-0000-0000-0000-000000000051', repeat('x', 501))), '23514 WBS_REASON', 'AC-WBS-007 a reason over 500 characters is refused');
select pg_temp.as_user('b0');
select is(pg_temp.err($$select skip_work_order_step('26600000-0000-0000-0000-000000000051', 'Client waived it')$$), 'P0002 WBS_NOT_FOUND', 'AC-WBS-007 another organisation cannot skip the step');
select pg_temp.as_user('b2');
select is(pg_temp.err($$select skip_work_order_step('26600000-0000-0000-0000-000000000051', 'Client waived it')$$), 'P0002 WBS_NOT_FOUND', 'AC-WBS-007 a person who cannot read the step cannot skip it');
select pg_temp.as_user('b1');
select is(pg_temp.err($$select skip_work_order_step('26600000-0000-0000-0000-000000000051', '  Client waived it  ')$$), 'ok', 'AC-WBS-007 a step is skipped with a reason');
select is((select skipped_reason from work_order_billing_steps where id = '26600000-0000-0000-0000-000000000051'), 'Client waived it', 'AC-WBS-007 the reason is stored trimmed and read back by a reader of the step');
select is((select skipped_on is not null and skipped_reason is null from work_order_billing_steps
  where id = '26600000-0000-0000-0000-000000000053'), true, 'AC-WBS-007 a reader sees a legacy skip with an empty reason');
reset role;
select is((select detail ->> 'reason' from audit_events where action = 'wo_billing_step.skip' and entity_id = '26600000-0000-0000-0000-000000000032' order by created_at desc limit 1), 'Client waived it', 'AC-WBS-007 the history carries the reason');
select is((select started_on is not null from work_order_billing_steps where id = '26600000-0000-0000-0000-000000000052'), true, 'AC-WBS-007 skipping still opens the next step');
select * from finish();
rollback;
