-- equipment_status.test.sql — 0985/0986 (#2526). Status, rental terms, downtime proof, the availability/utilisation read
-- model and the escalation job. Hand calculation (spec): 30-day month (2026-09), 8 working h/day, days 1-20 ready,
-- 21-23 broken, 24-30 ready, approved work 80 h  =>  27/30 = 90.0 % available, 80 / (27 x 8) = 37.0 % utilised.
begin;
create extension if not exists pgtap;
select plan(49);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25260000-0000-0000-0000-00000000000a', 'EAV Org A', 'IDR', 'UTC'),
  ('25260000-0000-0000-0000-00000000000b', 'EAV Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('25260000-0000-0000-0000-0000000000a1', 'eav-admin@example.com'),
  ('25260000-0000-0000-0000-0000000000a2', 'eav-fin@example.com'),
  ('25260000-0000-0000-0000-0000000000a3', 'eav-pm@example.com'),
  ('25260000-0000-0000-0000-0000000000a6', 'eav-eng@example.com'),
  ('25260000-0000-0000-0000-0000000000b1', 'eav-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25260000-0000-0000-0000-0000000000a1', '25260000-0000-0000-0000-00000000000a', 'EAV Admin', 'eav-admin@example.com', 'Admin', 'active'),
  ('25260000-0000-0000-0000-0000000000a2', '25260000-0000-0000-0000-00000000000a', 'EAV Fin',   'eav-fin@example.com',   'Finance', 'active'),
  ('25260000-0000-0000-0000-0000000000a3', '25260000-0000-0000-0000-00000000000a', 'EAV PM',    'eav-pm@example.com',    'Project Manager', 'active'),
  ('25260000-0000-0000-0000-0000000000a6', '25260000-0000-0000-0000-00000000000a', 'EAV Eng',   'eav-eng@example.com',   'Engineer', 'active'),
  ('25260000-0000-0000-0000-0000000000b1', '25260000-0000-0000-0000-00000000000b', 'EAV B Admin', 'eav-b-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25260000-0000-0000-0000-0000000000c1', '25260000-0000-0000-0000-00000000000a', 'EAV P1', 'Ongoing Project', '25260000-0000-0000-0000-0000000000a3');
insert into companies (id, org_id, name, type) values
  ('25260000-0000-0000-0000-0000000000e1', '25260000-0000-0000-0000-00000000000a', 'EAV Rental Co', 'Vendor');
-- a1 = the hand-calculated month; a3 = open downtime; a4 = down 2 days; a5 = a1 with days 1-3 unrecorded;
-- a6 = status/date rules; r1 = rental terms
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('25260000-0000-0000-0000-0000000000d1', '25260000-0000-0000-0000-00000000000a', 'EAV-1', 'Loader', 'hours'),
  ('25260000-0000-0000-0000-0000000000d3', '25260000-0000-0000-0000-00000000000a', 'EAV-3', 'Crane', 'hours'),
  ('25260000-0000-0000-0000-0000000000d4', '25260000-0000-0000-0000-00000000000a', 'EAV-4', 'Truck', 'hours'),
  ('25260000-0000-0000-0000-0000000000d5', '25260000-0000-0000-0000-00000000000a', 'EAV-5', 'Roller', 'hours'),
  ('25260000-0000-0000-0000-0000000000d6', '25260000-0000-0000-0000-00000000000a', 'EAV-6', 'Grader', 'hours'),
  ('25260000-0000-0000-0000-0000000000d7', '25260000-0000-0000-0000-00000000000a', 'EAV-7', 'Excavator', 'hours');
-- seed rows as the owner (the RPC date rules are proven below)
insert into equipment_status_days (org_id, asset_id, status_date, status)
select '25260000-0000-0000-0000-00000000000a', a, d::date, case when extract(day from d) between 21 and 23 then 'broken' else 'ready' end
  from (values ('25260000-0000-0000-0000-0000000000d1'::uuid), ('25260000-0000-0000-0000-0000000000d5'::uuid)) v(a),
       generate_series('2026-09-01'::date, '2026-09-30'::date, interval '1 day') d
 where not (a = '25260000-0000-0000-0000-0000000000d5'::uuid and extract(day from d) <= 3);
insert into equipment_status_days (org_id, asset_id, status_date, status) values
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d3', '2026-09-21', 'broken'),
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d3', '2026-09-22', 'at_vendor'),
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d3', '2026-09-23', 'waiting_parts'),
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d4', '2026-09-21', 'broken'),
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d4', '2026-09-22', 'broken');
-- approved work: 10 x 8 h = 80 h on each of a1 and a5; one Submitted 40 h entry on a1 (must not count)
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at)
select '25260000-0000-0000-0000-00000000000a', a, '25260000-0000-0000-0000-0000000000c1', d::date, 8, 'hours', 'work', 'Approved',
       '25260000-0000-0000-0000-0000000000a6', '25260000-0000-0000-0000-0000000000a3', now()
  from (values ('25260000-0000-0000-0000-0000000000d1'::uuid), ('25260000-0000-0000-0000-0000000000d5'::uuid)) v(a),
       generate_series('2026-09-05'::date, '2026-09-14'::date, interval '1 day') d;
insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id)
values ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d1', '25260000-0000-0000-0000-0000000000c1', '2026-09-16', 8, 'hours', 'work', 'Submitted', '25260000-0000-0000-0000-0000000000a6');

insert into equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind, status, author_id, approver_id, approved_at)
values ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d5', '25260000-0000-0000-0000-0000000000c1', '2026-09-02', 8, 'hours', 'work', 'Approved', '25260000-0000-0000-0000-0000000000a6', '25260000-0000-0000-0000-0000000000a3', now());

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a3');   -- PM: metrics audience

-- ── AC-EAV-001 the hand-calculated month, at the SQL layer ──
select is((select availability_pct from equipment_metrics(array['25260000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'month')),
  90.0, 'AC-EAV-001 availability is 90.0%');
select is((select utilisation_pct from equipment_metrics(array['25260000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'month')),
  37.0, 'AC-EAV-001 utilisation is 37.0%');
select is((select sum(available_days)::int from equipment_metrics(array['25260000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'day')),
  27, 'AC-EAV-001 the day-by-day table sums to the same 27 available days');
select is((select count(*)::int from equipment_metrics(array['25260000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'week')),
  5, 'AC-EAV-001 weeks start on Monday (2026-09-01 is a Tuesday: five week buckets)');
-- ── AC-EAV-002 unrecorded days leave both terms and are named ──
select is((select unrecorded_days from equipment_metrics(array['25260000-0000-0000-0000-0000000000d5']::uuid[], '2026-09-01', '2026-09-30', 'month')),
  3, 'AC-EAV-002 three unrecorded days are counted');
select is((select availability_pct from equipment_metrics(array['25260000-0000-0000-0000-0000000000d5']::uuid[], '2026-09-01', '2026-09-30', 'month')),
  88.9, 'AC-EAV-002 availability is 24 of the 27 recorded days');
select is((select utilisation_pct from equipment_metrics(array['25260000-0000-0000-0000-0000000000d5']::uuid[], '2026-09-01', '2026-09-30', 'month')),
  41.7, 'AC-EAV-002 utilisation is 80 / (24 x 8)');
-- ── AC-EAV-011 only Approved usage counts; the pending entry is named ──
select is((select pending_usage_entries from equipment_metrics(array['25260000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'month')),
  1, 'AC-EAV-011 a Submitted entry is reported as pending, not counted');

select is((select utilisation_pct from equipment_metrics(array['25260000-0000-0000-0000-0000000000d5']::uuid[], '2026-09-01', '2026-09-03', 'month')), null::numeric,
  'AC-EAV-002 unrecorded days have no utilisation');

-- ── AC-EAV-005 status dates ──
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a6');   -- Engineer (field role) sets status
select throws_ok($$ select set_equipment_status('25260000-0000-0000-0000-0000000000d6', current_date + 1, 'ready') $$,
  '22023', 'the status date is in the future', 'AC-EAV-005 a future date is refused');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_equipment_ownership('25260000-0000-0000-0000-0000000000d6', 'owned', '2026-09-10') $$, 'an in-service date is recorded');
select throws_ok($$ select set_equipment_ownership('25260000-0000-0000-0000-0000000000d6', 'rented') $$, '22023', 'a rented asset needs a rental period', 'FR-EAV-001 rented ownership requires terms');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a6');
select throws_ok($$ select set_equipment_status('25260000-0000-0000-0000-0000000000d6', '2026-09-09', 'ready') $$,
  '22023', 'the status date precedes the asset''s in-service date', 'AC-EAV-005 a date before in-service is refused');
select lives_ok($$ select set_equipment_status('25260000-0000-0000-0000-0000000000d6', '2026-09-10', 'broken', 'hydraulic leak') $$, 'AC-EAV-005 the in-service date itself saves');
select lives_ok($$ select set_equipment_status('25260000-0000-0000-0000-0000000000d6', '2026-09-10', 'waiting_parts') $$, 'a status can be changed');
select is((select count(*)::int from equipment_status_history where asset_id = '25260000-0000-0000-0000-0000000000d6'), 2,
  'FR-EAV-004 both writes are kept in history');
select is((select actor_id from equipment_status_history where asset_id = '25260000-0000-0000-0000-0000000000d6' order by id desc limit 1),
  '25260000-0000-0000-0000-0000000000a6'::uuid, 'FR-EAV-004 history records the actor');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a1');
select throws_ok($$ select set_equipment_ownership('25260000-0000-0000-0000-0000000000d6', 'owned', '2026-09-11') $$, '22023', 'in-service date follows an existing status', 'AC-EAV-005 moving in-service date after status is refused');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a6');
select is(set_equipment_status_bulk('2026-09-11', '[{"asset_id":"25260000-0000-0000-0000-0000000000d6","status":"ready"},{"asset_id":"25260000-0000-0000-0000-0000000000d7","status":"standby"}]'::jsonb),
  2, 'FR-EAV-008 the bulk screen saves several assets in one call');
-- proof attaches to a down day only
select is((add_equipment_downtime_proof('25260000-0000-0000-0000-0000000000d6', '2026-09-10', 'leak.jpg', 'photo') ->> 'path') like '25260000-0000-0000-0000-00000000000a/25260000-0000-0000-0000-0000000000d6/%/leak.jpg',
  true, 'FR-EAV-007 a proof on a down day returns its storage path');
select throws_ok($$ select add_equipment_downtime_proof('25260000-0000-0000-0000-0000000000d6', '2026-09-11', 'x.jpg') $$,
  '22023', 'proof attaches to a down day', 'FR-EAV-007 a proof on a ready day is refused');

select lives_ok($$ insert into storage.objects (bucket_id, name)
  select 'equipment-proof', file_path from equipment_downtime_proofs where asset_id = '25260000-0000-0000-0000-0000000000d6' $$,
  'AC-EAV-013 the field controller can upload the registered proof');

create function pg_temp.proof_after_upload() returns boolean language plpgsql as $$
declare result boolean;
begin
  execute $q$ select proven from public.list_equipment_proofs(array['25260000-0000-0000-0000-0000000000d6']::uuid[], '2026-09-10') $q$ into result;
  return result;
exception when undefined_function then return null;
end $$;
select is(pg_temp.proof_after_upload(), true, 'AC-EAV-013 uploaded evidence is visible as proven');

-- ── AC-EAV-006 / 007 rental periods ──
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a2');   -- Finance edits terms
select lives_ok($$ select save_equipment_rental_term('{"asset_id":"25260000-0000-0000-0000-0000000000d7","vendor_id":"25260000-0000-0000-0000-0000000000e1","rate":"100.00","basis":"day","currency":"IDR","rented_from":"2026-01-01","rented_to":"2026-03-31"}'::jsonb) $$,
  'AC-EAV-006 a rental period saves');
select throws_ok($$ select save_equipment_rental_term('{"asset_id":"25260000-0000-0000-0000-0000000000d7","vendor_id":"25260000-0000-0000-0000-0000000000e1","rate":"100.00","basis":"day","currency":"IDR","rented_from":"2026-03-31","rented_to":"2026-06-30"}'::jsonb) $$,
  '23P01', 'rental periods of one asset cannot overlap', 'AC-EAV-006 an overlapping period is refused');
select lives_ok($$ select save_equipment_rental_term('{"asset_id":"25260000-0000-0000-0000-0000000000d7","vendor_id":"25260000-0000-0000-0000-0000000000e1","rate":"100.00","basis":"day","currency":"IDR","rented_from":"2026-04-01"}'::jsonb) $$,
  'AC-EAV-006 a disjoint period saves');
select throws_ok($$ select save_equipment_rental_term('{"asset_id":"25260000-0000-0000-0000-0000000000d7","basis":"day","currency":"IDR","rented_from":"2026-08-01"}'::jsonb) $$,
  '22023', 'a rented asset needs a vendor and a rate', 'FR-EAV-001 a rented asset without vendor or rate is refused');
select lives_ok($$ select change_equipment_rental_rate('25260000-0000-0000-0000-0000000000d7', '2026-06-01', 120.00) $$, 'AC-EAV-007 a rate change saves');
select is((select rate from equipment_rental_terms where asset_id = '25260000-0000-0000-0000-0000000000d7' and rented_from = '2026-04-01'), 100.00::numeric,
  'AC-EAV-007 the earlier period keeps the earlier rate');
select is((select rented_to from equipment_rental_terms where asset_id = '25260000-0000-0000-0000-0000000000d7' and rented_from = '2026-04-01'), '2026-05-31'::date,
  'AC-EAV-007 the earlier period ends the day before the change');
select is((select rate from equipment_rental_terms where asset_id = '25260000-0000-0000-0000-0000000000d7' and rented_from = '2026-06-01'), 120.00::numeric,
  'AC-EAV-007 the new period carries the new rate');

-- ── AC-EAV-003 / 004 escalation (run as the job owner) ──
reset role;
select is((select count(*)::int from equipment_downtime_escalations('25260000-0000-0000-0000-00000000000a', '2026-09-23') where asset_id = '25260000-0000-0000-0000-0000000000d4'), 0,
  'AC-EAV-004 an asset down only 2 days is not escalated');
select is(run_equipment_downtime_escalations('2026-09-24'), 1, 'AC-EAV-003 on day 24 exactly the open 3-day downtime is escalated');
select is((select count(*)::int from notifications where title = 'Equipment down more than 2 days' and org_id = '25260000-0000-0000-0000-00000000000a'), 2,
  'AC-EAV-003 the Admin and the Project Manager are notified once');
select is(run_equipment_downtime_escalations('2026-09-24'), 0, 'AC-EAV-003 a rerun the same day sends nothing');
select is((select count(*)::int from notifications where title = 'Equipment down more than 2 days'), 2, 'AC-EAV-003 no notice is repeated the same day');
select is(run_equipment_downtime_escalations('2026-09-29'), 0, 'FR-EAV-010 an asset with no status for the last day is not escalated');

insert into equipment_status_days (org_id, asset_id, status_date, status) values
 ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d7', '2026-09-20', 'broken'),
 ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d7', '2026-09-22', 'broken'),
 ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d7', '2026-09-23', 'broken');
select is((select count(*)::int from equipment_downtime_escalations('25260000-0000-0000-0000-00000000000a', '2026-09-23') where asset_id = '25260000-0000-0000-0000-0000000000d7'), 0,
  'AC-EAV-004 nonconsecutive down days do not escalate');

select is(has_table_privilege('authenticated', 'public.equipment_status_days', 'INSERT'), false, 'AC-EAV-012 no direct status insert grant');
select is(has_table_privilege('authenticated', 'public.equipment_rental_terms', 'UPDATE'), false, 'AC-EAV-012 no direct rental update grant');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('equipment_status_days','equipment_status_history','equipment_rental_terms','equipment_downtime_proofs') and cmd = 'SELECT'), 4, 'AC-EAV-012 each readable table has an RLS policy');

insert into equipment_assets (id, org_id, code, name, default_unit, archived_at) values
  ('25260000-0000-0000-0000-0000000000d8', '25260000-0000-0000-0000-00000000000a', 'EAV-8', 'Zoned', 'hours', '2026-09-01 20:00:00+00');
insert into equipment_status_days (org_id, asset_id, status_date, status) values
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000d8', '2026-09-01', 'ready');
update organizations set default_timezone = 'Asia/Jakarta' where id = '25260000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a3');
select is((select in_service_days from equipment_metrics(array['25260000-0000-0000-0000-0000000000d8']::uuid[], '2026-09-01', '2026-09-02', 'month')), 1, 'NFR-EAV-003 archive date follows the org calendar');
reset role;
update organizations set default_timezone = 'UTC' where id = '25260000-0000-0000-0000-00000000000a';

-- ── AC-EAV-012 tenancy and role ──
set local role authenticated;
select pg_temp.act_as('25260000-0000-0000-0000-0000000000b1');   -- another organisation's Admin
select is((select count(*)::int from equipment_status_days), 0, 'AC-EAV-012 another org reads no status rows');
create function pg_temp.foreign_proof_count() returns integer language plpgsql as $$
declare result integer;
begin
  execute $q$ select count(*)::int from public.list_equipment_proofs(array['25260000-0000-0000-0000-0000000000d6']::uuid[], '2026-09-10') $q$ into result;
  return result;
exception when undefined_function then return -1;
end $$;
select is(pg_temp.foreign_proof_count(), 0, 'AC-EAV-012 another org cannot read proof status');
select is(coalesce(has_function_privilege('anon', to_regprocedure('public.list_equipment_proofs(uuid[],date)'), 'EXECUTE'), false), false, 'AC-EAV-012 anon cannot call proof status');
select throws_ok($$ select set_equipment_status('25260000-0000-0000-0000-0000000000d1', '2026-09-30', 'ready') $$,
  'P0002', 'asset not found', 'AC-EAV-012 another org cannot write status on this asset');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a6');   -- Engineer: status yes, terms and metrics no
select throws_ok($$ select save_equipment_rental_term('{}'::jsonb) $$, '42501', 'not authorized', 'AC-EAV-012 a field controller cannot edit rental terms');
select throws_ok($$ select * from equipment_metrics(array['25260000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'month') $$,
  '42501', 'not authorized', 'AC-EAV-012 a field controller cannot read metrics');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a2');   -- Finance cannot set status
select throws_ok($$ select set_equipment_status('25260000-0000-0000-0000-0000000000d1', '2026-09-30', 'ready') $$,
  '42501', 'not authorized', 'AC-EAV-012 Finance cannot set status');

select * from finish();
rollback;
