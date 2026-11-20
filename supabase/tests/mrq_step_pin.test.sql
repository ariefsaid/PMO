-- mrq_step_pin.test.sql — #2598 a project can pin a material-request approval step to a named person.
-- Spec docs/specs/material-requests.spec.md (FR-MRQ-020..023, AC-MRQ-016..020). Migration under test: 1036_mrq_step_pins.sql.
-- Every denial asserts the errcode AND the message, so a different gate moving in front cannot pass it.
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25980000-0000-0000-0000-00000000000a', 'Pin Org',       'IDR', 'Asia/Jakarta'),
  ('25980000-0000-0000-0000-00000000000b', 'Pin Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25980000-0000-0000-0000-0000000000a1', 'pin-admin@example.com'),
  ('25980000-0000-0000-0000-0000000000a2', 'pin-req@example.com'),
  ('25980000-0000-0000-0000-0000000000a3', 'pin-pm@example.com'),
  ('25980000-0000-0000-0000-0000000000a4', 'pin-eng@example.com'),
  ('25980000-0000-0000-0000-0000000000a5', 'pin-fin@example.com'),
  ('25980000-0000-0000-0000-0000000000a6', 'pin-fin2@example.com'),
  ('25980000-0000-0000-0000-0000000000a7', 'pin-exec@example.com'),
  ('25980000-0000-0000-0000-0000000000a8', 'pin-gone@example.com'),
  ('25980000-0000-0000-0000-0000000000b1', 'pin-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25980000-0000-0000-0000-0000000000a1', '25980000-0000-0000-0000-00000000000a', 'Pin Admin', 'pin-admin@example.com', 'Admin', 'active'),
  ('25980000-0000-0000-0000-0000000000a2', '25980000-0000-0000-0000-00000000000a', 'Pin Req',   'pin-req@example.com',   'Engineer', 'active'),
  ('25980000-0000-0000-0000-0000000000a3', '25980000-0000-0000-0000-00000000000a', 'Pin PM',    'pin-pm@example.com',    'Project Manager', 'active'),
  ('25980000-0000-0000-0000-0000000000a4', '25980000-0000-0000-0000-00000000000a', 'Pin Eng',   'pin-eng@example.com',   'Engineer', 'active'),
  ('25980000-0000-0000-0000-0000000000a5', '25980000-0000-0000-0000-00000000000a', 'Pin Fin',   'pin-fin@example.com',   'Finance', 'active'),
  ('25980000-0000-0000-0000-0000000000a6', '25980000-0000-0000-0000-00000000000a', 'Pin Fin2',  'pin-fin2@example.com',  'Finance', 'active'),
  ('25980000-0000-0000-0000-0000000000a7', '25980000-0000-0000-0000-00000000000a', 'Pin Exec',  'pin-exec@example.com',  'Executive', 'active'),
  ('25980000-0000-0000-0000-0000000000a8', '25980000-0000-0000-0000-00000000000a', 'Pin Gone',  'pin-gone@example.com',  'Finance', 'disabled'),
  ('25980000-0000-0000-0000-0000000000b1', '25980000-0000-0000-0000-00000000000b', 'Pin XOrg',  'pin-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25980000-0000-0000-0000-0000000000d1', '25980000-0000-0000-0000-00000000000a', 'Pin Site', 'Ongoing Project', '25980000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25980000-0000-0000-0000-000000000401', '25980000-0000-0000-0000-00000000000a', '25980000-0000-0000-0000-0000000000d1', 'Pin WO', 'Issued', 10000, 'exclusive', 0);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25980000-0000-0000-0000-000000000301', '25980000-0000-0000-0000-00000000000a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25980000-0000-0000-0000-000000000311', '25980000-0000-0000-0000-00000000000a', 'CEM', 'Cement', '25980000-0000-0000-0000-000000000301');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25980000-0000-0000-0000-000000000801', '25980000-0000-0000-0000-00000000000a', 'PIN-C', 'Central',  'central', null),
  ('25980000-0000-0000-0000-000000000802', '25980000-0000-0000-0000-00000000000a', 'PIN-S', 'Site one', 'site',    '25980000-0000-0000-0000-0000000000d1');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('25980000-0000-0000-0000-00000000000a', '25980000-0000-0000-0000-000000000801', '25980000-0000-0000-0000-0000000000a5'),
  ('25980000-0000-0000-0000-00000000000a', '25980000-0000-0000-0000-000000000801', '25980000-0000-0000-0000-0000000000a6'),
  ('25980000-0000-0000-0000-00000000000a', '25980000-0000-0000-0000-000000000801', '25980000-0000-0000-0000-0000000000a7');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._raise() returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp._as('25980000-0000-0000-0000-0000000000a2');
  v := public.mrq_save_draft(null,
         jsonb_build_object('work_order_id', '25980000-0000-0000-0000-000000000401', 'needed_by', current_date + 5),
         jsonb_build_array(jsonb_build_object('item_id', '25980000-0000-0000-0000-000000000311', 'quantity', 10,
                                              'over_plan_reason', 'pour')));
  perform public.mrq_submit(v);
  return v;
end $$;
grant execute on function pg_temp._raise() to authenticated;
-- Take steps 1 and 2 (Engineer, Project Manager) so step 3 (Finance) is the open one.
create or replace function pg_temp._to_step3(p_req uuid) returns void language plpgsql as $$
begin
  perform pg_temp._as('25980000-0000-0000-0000-0000000000a4'); perform public.mrq_decide_step(p_req, 1, 'approve');
  perform pg_temp._as('25980000-0000-0000-0000-0000000000a3'); perform public.mrq_decide_step(p_req, 2, 'approve');
end $$;
grant execute on function pg_temp._to_step3(uuid) to authenticated;

set local role authenticated;
select pg_temp._as('25980000-0000-0000-0000-0000000000a1');
select public.mrq_set_chain('[{"role":"Engineer","label":"Plan check"},{"role":"Project Manager","label":"Billable change"},
                              {"role":"Finance","label":"Stock"}]'::jsonb);
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

-- Setting a pin: the project's manager or an Admin, for a holder of the step's role.
select pg_temp._as('25980000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 3, '25980000-0000-0000-0000-0000000000a6') $$,
  '42501', 'MRQ_PIN_FORBIDDEN: only an Admin or the project''s manager can pin an approval step',
  'AC-MRQ-016 a user who is neither Admin nor the project manager cannot pin');
select pg_temp._as('25980000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 3, '25980000-0000-0000-0000-0000000000a7') $$,
  'P0001', 'MRQ_PIN_INVALID: the approver must be an active member who holds the step''s role',
  'AC-MRQ-017 a person without the step''s role cannot be pinned');
select throws_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 3, '25980000-0000-0000-0000-0000000000a8') $$,
  'P0001', 'MRQ_PIN_INVALID: the approver must be an active member who holds the step''s role',
  'AC-MRQ-017 a deactivated member cannot be pinned');
select throws_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 3, '25980000-0000-0000-0000-0000000000b1') $$,
  'P0001', 'MRQ_PIN_INVALID: the approver must be an active member who holds the step''s role',
  'AC-MRQ-017 a person from another organisation cannot be pinned');
select throws_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 7, '25980000-0000-0000-0000-0000000000a6') $$,
  'P0001', 'MRQ_PIN_INVALID: the chain has no step 7',
  'AC-MRQ-017 a position the chain does not have cannot be pinned');
select lives_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 3, '25980000-0000-0000-0000-0000000000a6') $$,
  'AC-MRQ-016 the project''s manager pins step 3 to a Finance person');
select is((select approver_id from approval_step_pins where project_id = '25980000-0000-0000-0000-0000000000d1' and position = 3),
  '25980000-0000-0000-0000-0000000000a6'::uuid, 'FR-MRQ-020 the pin is stored per project and step');
select throws_ok($$ insert into approval_step_pins (project_id, position, role, approver_id)
                    values ('25980000-0000-0000-0000-0000000000d1', 1, 'Engineer', '25980000-0000-0000-0000-0000000000a4') $$,
  '42501', null, 'FR-MRQ-020 no client writes the pin table directly');
select pg_temp._as('25980000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 3, '25980000-0000-0000-0000-0000000000a6') $$,
  'P0001', 'MRQ_NOT_FOUND: the project is not in your organisation', 'AC-MRQ-019 another organisation pins nothing');
select is((select count(*)::int from approval_step_pins), 0, 'AC-MRQ-019 and reads no pins of ours');

-- Deciding: only the pinned person, or their in-window stand-in.
insert into t_ids values ('r1', pg_temp._raise());
select pg_temp._to_step3((select v from t_ids where k = 'r1'));
select pg_temp._as('25980000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 3, 'approve') $$, '42501',
  'MRQ_NOT_PINNED: this step is pinned to another approver on this project',
  'AC-MRQ-018 a role-holder who is not the pinned person cannot decide a pinned step');
select is((select count(*)::int from mrq_waiting_for_me()), 0, 'AC-MRQ-018 and the step is not in their queue');
select pg_temp._as('25980000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from mrq_waiting_for_me()), 1, 'AC-MRQ-018 it is in the pinned person''s queue');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 3, 'approve', null, '25980000-0000-0000-0000-000000000801') $$,
  'AC-MRQ-018 the pinned person decides it');

-- A stand-in for the pinned person may decide; a stand-in for someone else may not.
insert into t_ids values ('r2', pg_temp._raise());
select pg_temp._to_step3((select v from t_ids where k = 'r2'));
select pg_temp._as('25980000-0000-0000-0000-0000000000a1');
select public.mrq_set_stand_in('25980000-0000-0000-0000-0000000000a5', '25980000-0000-0000-0000-0000000000a7', current_date - 1, current_date + 1);
select pg_temp._as('25980000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 3, 'approve') $$, '42501',
  'MRQ_NOT_PINNED: this step is pinned to another approver on this project',
  'AC-MRQ-018 a stand-in for a different Finance person cannot decide the pinned step');
select pg_temp._as('25980000-0000-0000-0000-0000000000a1');
select public.mrq_set_stand_in('25980000-0000-0000-0000-0000000000a6', '25980000-0000-0000-0000-0000000000a7', current_date - 1, current_date + 1);
select pg_temp._as('25980000-0000-0000-0000-0000000000a7');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r2'), 3, 'approve', null, '25980000-0000-0000-0000-000000000801') $$,
  'AC-MRQ-018 the pinned person''s stand-in decides it');
select is((select acted_for from material_request_steps where request_id = (select v from t_ids where k = 'r2') and position = 3),
  '25980000-0000-0000-0000-0000000000a6'::uuid, 'AC-MRQ-018 and both identities are stored');

-- Cleared: the step is role-level again.
select pg_temp._as('25980000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.mrq_set_step_pin('25980000-0000-0000-0000-0000000000d1', 3, null) $$, 'AC-MRQ-020 an Admin clears the pin');
insert into t_ids values ('r3', pg_temp._raise());
select pg_temp._to_step3((select v from t_ids where k = 'r3'));
select pg_temp._as('25980000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r3'), 3, 'approve', null, '25980000-0000-0000-0000-000000000801') $$,
  'AC-MRQ-020 with no pin any holder of the role decides');
select is((select count(*)::int from approval_step_pins), 0, 'AC-MRQ-020 clearing removes the row');

select * from finish();
rollback;
