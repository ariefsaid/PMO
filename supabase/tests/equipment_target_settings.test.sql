-- equipment_target_settings.test.sql — #2701. The availability target, the use target and the breakdown escalation limit
-- are organisation settings: defaults equal today's behaviour (limit 2, no target), Admin-only writes, the escalation job and
-- flag read the setting. AC-ETS-001, 003, 004, 005, 006 (AC-ETS-002 is the untouched equipment_status.test.sql).
begin;
create extension if not exists pgtap;
select plan(27);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27010000-0000-0000-0000-00000000000a', 'ETS Org A', 'IDR', 'UTC'),
  ('27010000-0000-0000-0000-00000000000b', 'ETS Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27010000-0000-0000-0000-0000000000a1', 'ets-admin@example.com'),
  ('27010000-0000-0000-0000-0000000000a2', 'ets-fin@example.com'),
  ('27010000-0000-0000-0000-0000000000a3', 'ets-pm@example.com'),
  ('27010000-0000-0000-0000-0000000000a4', 'ets-eng@example.com'),
  ('27010000-0000-0000-0000-0000000000a5', 'ets-exec@example.com'),
  ('27010000-0000-0000-0000-0000000000b1', 'ets-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27010000-0000-0000-0000-0000000000a1', '27010000-0000-0000-0000-00000000000a', 'ETS Admin', 'ets-admin@example.com', 'Admin', 'active'),
  ('27010000-0000-0000-0000-0000000000a2', '27010000-0000-0000-0000-00000000000a', 'ETS Fin', 'ets-fin@example.com', 'Finance', 'active'),
  ('27010000-0000-0000-0000-0000000000a3', '27010000-0000-0000-0000-00000000000a', 'ETS PM', 'ets-pm@example.com', 'Project Manager', 'active'),
  ('27010000-0000-0000-0000-0000000000a4', '27010000-0000-0000-0000-00000000000a', 'ETS Eng', 'ets-eng@example.com', 'Engineer', 'active'),
  ('27010000-0000-0000-0000-0000000000a5', '27010000-0000-0000-0000-00000000000a', 'ETS Exec', 'ets-exec@example.com', 'Executive', 'active'),
  ('27010000-0000-0000-0000-0000000000b1', '27010000-0000-0000-0000-00000000000b', 'ETS B Admin', 'ets-b-admin@example.com', 'Admin', 'active');
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('27010000-0000-0000-0000-0000000000d1', '27010000-0000-0000-0000-00000000000a', 'ETS-1', 'Loader', 'hours'),
  ('27010000-0000-0000-0000-0000000000d2', '27010000-0000-0000-0000-00000000000a', 'ETS-2', 'Truck', 'hours');
-- d1 down 21-23 (3 days), d2 down 21-22 (2 days)
insert into equipment_status_days (org_id, asset_id, status_date, status) values
  ('27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d1', '2026-09-20', 'ready'),
  ('27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d1', '2026-09-21', 'broken'),
  ('27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d1', '2026-09-22', 'broken'),
  ('27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d1', '2026-09-23', 'broken'),
  ('27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d2', '2026-09-20', 'ready'),
  ('27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d2', '2026-09-21', 'broken'),
  ('27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d2', '2026-09-22', 'broken');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.targets() returns text language sql as $$
  select coalesce(availability_target_pct::text, '-') || '/' || coalesce(utilisation_target_pct::text, '-') || '/' || escalation_down_days::text
    from get_equipment_targets();
$$;
set local role authenticated;

-- ── AC-ETS-001 defaults equal today's behaviour ──
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a4');   -- any active member reads
select is(pg_temp.targets(), '-/-/2', 'AC-ETS-001 a new organisation has no targets and a limit of 2');
reset role;
select is((select count(*)::int from equipment_downtime_escalations('27010000-0000-0000-0000-00000000000a', '2026-09-23')), 1,
  'AC-ETS-001 at the default limit the 3-day downtime is flagged');
select is((select count(*)::int from equipment_downtime_escalations('27010000-0000-0000-0000-00000000000a', '2026-09-22')), 0,
  'AC-ETS-001 at the default limit a 2-day downtime is not flagged');

-- ── AC-ETS-004 only an Admin changes the settings ──
set local role authenticated;
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a3');
select throws_ok($$ select set_equipment_targets(90, 50, 5) $$, '42501', 'not authorized', 'AC-ETS-004 a Project Manager cannot change the settings');
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a2');
select throws_ok($$ select set_equipment_targets(90, 50, 5) $$, '42501', 'not authorized', 'AC-ETS-004 Finance cannot change the settings');
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_equipment_targets(90, 50, 5) $$, '42501', 'not authorized', 'AC-ETS-004 an Engineer cannot change the settings');
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a5');
select throws_ok($$ select set_equipment_targets(90, 50, 5) $$, '42501', 'not authorized', 'AC-ETS-004 an Executive cannot change the settings');
select is(pg_temp.targets(), '-/-/2', 'AC-ETS-004 the refused calls changed nothing');
select throws_ok($$ update organizations set equipment_escalation_down_days = 9 where id = '27010000-0000-0000-0000-00000000000a' $$, '42501', NULL,
  'AC-ETS-004 no direct table write either');

-- ── AC-ETS-005 validation ──
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_equipment_targets(90, 50, 0) $$, '22023', NULL, 'AC-ETS-005 limit 0 is refused');
select throws_ok($$ select set_equipment_targets(90, 50, 366) $$, '22023', NULL, 'AC-ETS-005 limit 366 is refused');
select throws_ok($$ select set_equipment_targets(90, 50, null) $$, '22023', NULL, 'AC-ETS-005 an empty limit is refused');
select throws_ok($$ select set_equipment_targets(100.1, 50, 3) $$, '22023', NULL, 'AC-ETS-005 an availability target above 100 is refused');
select throws_ok($$ select set_equipment_targets(-1, 50, 3) $$, '22023', NULL, 'AC-ETS-005 a negative availability target is refused');
select throws_ok($$ select set_equipment_targets(90, 50.55, 3) $$, '22023', NULL, 'AC-ETS-005 a use target with two decimals is refused');
select is(pg_temp.targets(), '-/-/2', 'AC-ETS-005 refused input stored nothing');

-- ── AC-ETS-003 the escalation job and flag read the setting ──
select lives_ok($$ select set_equipment_targets(90.5, 60, 5) $$, 'AC-ETS-003 an Admin saves the settings');
select is(pg_temp.targets(), '90.5/60.0/5', 'AC-ETS-003 the saved values read back');
reset role;
select is((select count(*)::int from equipment_downtime_escalations('27010000-0000-0000-0000-00000000000a', '2026-09-23')), 0,
  'AC-ETS-003 with limit 5 the 3-day downtime is not flagged');
select is(run_equipment_downtime_escalations('2026-09-23'), 0, 'AC-ETS-003 with limit 5 the job sends nothing for 3 days');
insert into equipment_status_days (org_id, asset_id, status_date, status)
select '27010000-0000-0000-0000-00000000000a', '27010000-0000-0000-0000-0000000000d1', d::date, 'broken'
  from generate_series('2026-09-24'::date, '2026-09-26'::date, interval '1 day') d;
select is(run_equipment_downtime_escalations('2026-09-26'), 1, 'AC-ETS-003 at 6 down days the job escalates once');
select is((select count(*)::int from notifications where title = 'Equipment down more than 5 days' and org_id = '27010000-0000-0000-0000-00000000000a'), 2,
  'AC-ETS-003 the notice title names the organisation''s limit (Admin and Project Manager)');

-- ── AC-ETS-005 an empty target clears it ──
set local role authenticated;
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_equipment_targets(null, 60, 5) $$, 'AC-ETS-005 an Admin clears one target');
select is(pg_temp.targets(), '-/60.0/5', 'AC-ETS-005 the cleared target reads back empty');

-- ── AC-ETS-006 organisations are separate ──
select pg_temp.act_as('27010000-0000-0000-0000-0000000000b1');
select is(pg_temp.targets(), '-/-/2', 'AC-ETS-006 another organisation still has its own defaults');
select lives_ok($$ select set_equipment_targets(70, 40, 9) $$, 'AC-ETS-006 organisation B saves its own settings');
select pg_temp.act_as('27010000-0000-0000-0000-0000000000a4');
select is(pg_temp.targets(), '-/60.0/5', 'AC-ETS-006 organisation A is unaffected by B');

select * from finish();
rollback;
