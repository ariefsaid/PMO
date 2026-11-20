-- mrq_stuck_pin.test.sql — #2605 a pin whose person can no longer act stops binding; the step falls back to its role rule.
-- Spec docs/specs/material-requests.spec.md (FR-MRQ-024, AC-MRQ-021..022). Migration under test: 1120_mrq_stuck_pin.sql.
-- Every denial asserts the errcode AND the message, so a different gate moving in front cannot pass it.
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26050000-0000-0000-0000-00000000000a', 'Pin Org',       'IDR', 'Asia/Jakarta'),
  ('26050000-0000-0000-0000-00000000000b', 'Pin Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('26050000-0000-0000-0000-0000000000a1', 'pin-admin@example.com'),
  ('26050000-0000-0000-0000-0000000000a2', 'pin-req@example.com'),
  ('26050000-0000-0000-0000-0000000000a3', 'pin-pm@example.com'),
  ('26050000-0000-0000-0000-0000000000a4', 'pin-eng@example.com'),
  ('26050000-0000-0000-0000-0000000000a5', 'pin-fin@example.com'),
  ('26050000-0000-0000-0000-0000000000a6', 'pin-fin2@example.com'),
  ('26050000-0000-0000-0000-0000000000a7', 'pin-exec@example.com'),
  ('26050000-0000-0000-0000-0000000000a8', 'pin-gone@example.com'),
  ('26050000-0000-0000-0000-0000000000b1', 'pin-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26050000-0000-0000-0000-0000000000a1', '26050000-0000-0000-0000-00000000000a', 'Pin Admin', 'pin-admin@example.com', 'Admin', 'active'),
  ('26050000-0000-0000-0000-0000000000a2', '26050000-0000-0000-0000-00000000000a', 'Pin Req',   'pin-req@example.com',   'Engineer', 'active'),
  ('26050000-0000-0000-0000-0000000000a3', '26050000-0000-0000-0000-00000000000a', 'Pin PM',    'pin-pm@example.com',    'Project Manager', 'active'),
  ('26050000-0000-0000-0000-0000000000a4', '26050000-0000-0000-0000-00000000000a', 'Pin Eng',   'pin-eng@example.com',   'Engineer', 'active'),
  ('26050000-0000-0000-0000-0000000000a5', '26050000-0000-0000-0000-00000000000a', 'Pin Fin',   'pin-fin@example.com',   'Finance', 'active'),
  ('26050000-0000-0000-0000-0000000000a6', '26050000-0000-0000-0000-00000000000a', 'Pin Fin2',  'pin-fin2@example.com',  'Finance', 'active'),
  ('26050000-0000-0000-0000-0000000000a7', '26050000-0000-0000-0000-00000000000a', 'Pin Exec',  'pin-exec@example.com',  'Executive', 'active'),
  ('26050000-0000-0000-0000-0000000000a8', '26050000-0000-0000-0000-00000000000a', 'Pin Gone',  'pin-gone@example.com',  'Finance', 'disabled'),
  ('26050000-0000-0000-0000-0000000000b1', '26050000-0000-0000-0000-00000000000b', 'Pin XOrg',  'pin-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26050000-0000-0000-0000-0000000000d1', '26050000-0000-0000-0000-00000000000a', 'Pin Site', 'Ongoing Project', '26050000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26050000-0000-0000-0000-000000000401', '26050000-0000-0000-0000-00000000000a', '26050000-0000-0000-0000-0000000000d1', 'Pin WO', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26050000-0000-0000-0000-000000000301', '26050000-0000-0000-0000-00000000000a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26050000-0000-0000-0000-000000000311', '26050000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '26050000-0000-0000-0000-000000000301');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('26050000-0000-0000-0000-000000000801', '26050000-0000-0000-0000-00000000000a', 'PIN-C', 'Central',  'central', null),
  ('26050000-0000-0000-0000-000000000802', '26050000-0000-0000-0000-00000000000a', 'PIN-S', 'Site one', 'site',    '26050000-0000-0000-0000-0000000000d1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('26050000-0000-0000-0000-00000000000a', '26050000-0000-0000-0000-000000000801', '26050000-0000-0000-0000-0000000000a5'),
  ('26050000-0000-0000-0000-00000000000a', '26050000-0000-0000-0000-000000000801', '26050000-0000-0000-0000-0000000000a6'),
  ('26050000-0000-0000-0000-00000000000a', '26050000-0000-0000-0000-000000000801', '26050000-0000-0000-0000-0000000000a7');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._raise() returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp._as('26050000-0000-0000-0000-0000000000a2');
  v := public.mrq_save_draft(null,
         jsonb_build_object('work_order_id', '26050000-0000-0000-0000-000000000401', 'needed_by', current_date + 5),
         jsonb_build_array(jsonb_build_object('item_id', '26050000-0000-0000-0000-000000000311', 'quantity', 10,
                                              'over_plan_reason', 'pour')));
  perform public.mrq_submit(v);
  return v;
end $$;
grant execute on function pg_temp._raise() to authenticated;
-- Take steps 1 and 2 (Engineer, Project Manager) so step 3 (Finance) is the open one.
create or replace function pg_temp._to_step3(p_req uuid) returns void language plpgsql as $$
begin
  perform pg_temp._as('26050000-0000-0000-0000-0000000000a4'); perform public.mrq_decide_step(p_req, 1, 'approve');
  perform pg_temp._as('26050000-0000-0000-0000-0000000000a3'); perform public.mrq_decide_step(p_req, 2, 'approve');
end $$;
grant execute on function pg_temp._to_step3(uuid) to authenticated;

set local role authenticated;
select pg_temp._as('26050000-0000-0000-0000-0000000000a1');
select public.mrq_set_chain('[{"role":"Engineer","label":"Plan check"},{"role":"Project Manager","label":"Billable change"},
                              {"role":"Finance","label":"Stock"}]'::jsonb);
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
select public.mrq_set_step_pin('26050000-0000-0000-0000-0000000000d1', 3, '26050000-0000-0000-0000-0000000000a6');

-- A live pin still binds (the 1045 rule is unchanged).
insert into t_ids values ('r1', pg_temp._raise());
select pg_temp._to_step3((select v from t_ids where k = 'r1'));
select pg_temp._as('26050000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 3, 'approve') $$, '42501',
  'MRQ_NOT_PINNED: this step is pinned to another approver on this project',
  'AC-MRQ-021 a live pin still binds the step to the pinned person');

-- The pinned person is deactivated: the role holder can decide, and sees it in their queue. The pin row stays.
reset role;
update profiles set status = 'disabled' where id = '26050000-0000-0000-0000-0000000000a6';
set local role authenticated;
select pg_temp._as('26050000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from mrq_waiting_for_me()), 1, 'AC-MRQ-021 a deactivated pinned approver: the role holder sees the step in their queue');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 3, 'approve', null, '26050000-0000-0000-0000-000000000801') $$,
  'AC-MRQ-021 and the role holder decides it');
select is((select count(*)::int from approval_step_pins where project_id = '26050000-0000-0000-0000-0000000000d1'), 1,
  'AC-MRQ-022 the pin row is kept so the setting screen can flag it');

-- The pinned person loses the step role: same fallback; a stand-in for a role holder works too.
reset role;
update profiles set status = 'active' where id = '26050000-0000-0000-0000-0000000000a6';
set local role authenticated;
insert into t_ids values ('r2', pg_temp._raise());
select pg_temp._to_step3((select v from t_ids where k = 'r2'));
reset role;
update profiles set role = 'Engineer' where id = '26050000-0000-0000-0000-0000000000a6';
set local role authenticated;
select pg_temp._as('26050000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from mrq_waiting_for_me()), 0, 'AC-MRQ-021 a pinned person who lost the role does not get the step');
select pg_temp._as('26050000-0000-0000-0000-0000000000a1');
select public.mrq_set_stand_in('26050000-0000-0000-0000-0000000000a5', '26050000-0000-0000-0000-0000000000a7', current_date - 1, current_date + 1);
select pg_temp._as('26050000-0000-0000-0000-0000000000a7');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 3, 'approve', null, '26050000-0000-0000-0000-000000000801') $$,
  'AC-MRQ-021 with the pin dead, a stand-in for a Finance role holder decides the step');

-- Re-pointing the pin to a live person binds again.
select pg_temp._as('26050000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_step_pin('26050000-0000-0000-0000-0000000000d1', 3, '26050000-0000-0000-0000-0000000000a5') $$,
  'AC-MRQ-022 an Admin re-points the stuck pin to a live Finance person');

select * from finish();
rollback;
