-- equipment_vendor_response.test.sql — 1372-1374 (#2702). Who records a vendor response (DB-enforced), the server
-- stamp, the date rules, tenancy and the per-breakdown / per-vendor read. Spec docs/specs/equipment-vendor-response.spec.md.
-- Mutation check (recorded, not run in this lane): drop the `p_responded_at < v_reported` guard in 1373 and
-- AC-EVR-003 (the first throws_ok) must go red.
begin;
create extension if not exists pgtap;
select plan(32);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27020000-0000-0000-0000-00000000000a', 'EVR Org A', 'IDR', 'UTC'),
  ('27020000-0000-0000-0000-00000000000b', 'EVR Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('27020000-0000-0000-0000-0000000000a1', 'evr-pm@example.com'),
  ('27020000-0000-0000-0000-0000000000a2', 'evr-fin@example.com'),
  ('27020000-0000-0000-0000-0000000000a3', 'evr-exec@example.com'),
  ('27020000-0000-0000-0000-0000000000a4', 'evr-eng@example.com'),
  ('27020000-0000-0000-0000-0000000000b1', 'evr-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27020000-0000-0000-0000-0000000000a1', '27020000-0000-0000-0000-00000000000a', 'EVR PM',   'evr-pm@example.com',   'Project Manager', 'active'),
  ('27020000-0000-0000-0000-0000000000a2', '27020000-0000-0000-0000-00000000000a', 'EVR Fin',  'evr-fin@example.com',  'Finance', 'active'),
  ('27020000-0000-0000-0000-0000000000a3', '27020000-0000-0000-0000-00000000000a', 'EVR Exec', 'evr-exec@example.com', 'Executive', 'active'),
  ('27020000-0000-0000-0000-0000000000a4', '27020000-0000-0000-0000-00000000000a', 'EVR Eng',  'evr-eng@example.com',  'Engineer', 'active'),
  ('27020000-0000-0000-0000-0000000000b1', '27020000-0000-0000-0000-00000000000b', 'EVR B Admin', 'evr-b-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('27020000-0000-0000-0000-0000000000e1', '27020000-0000-0000-0000-00000000000a', 'EVR Rental Co', 'Vendor');
-- d1 rented from 2024-01-01 (vendor e1); d2 owned; d3 rented only from 2024-06-01 (no term on the breakdown date)
insert into equipment_assets (id, org_id, code, name, default_unit, ownership) values
  ('27020000-0000-0000-0000-0000000000d1', '27020000-0000-0000-0000-00000000000a', 'EVR-1', 'Loader', 'hours', 'rented'),
  ('27020000-0000-0000-0000-0000000000d2', '27020000-0000-0000-0000-00000000000a', 'EVR-2', 'Truck', 'hours', 'owned'),
  ('27020000-0000-0000-0000-0000000000d3', '27020000-0000-0000-0000-00000000000a', 'EVR-3', 'Crane', 'hours', 'rented');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from) values
  ('27020000-0000-0000-0000-00000000000a', '27020000-0000-0000-0000-0000000000d1', '27020000-0000-0000-0000-0000000000e1', 100, 'day', 'IDR', '2024-01-01'),
  ('27020000-0000-0000-0000-00000000000a', '27020000-0000-0000-0000-0000000000d3', '27020000-0000-0000-0000-0000000000e1', 100, 'day', 'IDR', '2024-06-01');
-- breakdowns on d1: 03-04 (4..6 broken), 03-20, 04-02, 05-06 (awaiting); d2 and d3 break on 03-04
insert into equipment_status_days (org_id, asset_id, status_date, status)
select '27020000-0000-0000-0000-00000000000a', a, d::date, s
  from (values
    ('27020000-0000-0000-0000-0000000000d1'::uuid, '2024-03-03', 'ready'), ('27020000-0000-0000-0000-0000000000d1', '2024-03-04', 'broken'),
    ('27020000-0000-0000-0000-0000000000d1', '2024-03-05', 'broken'), ('27020000-0000-0000-0000-0000000000d1', '2024-03-06', 'at_vendor'),
    ('27020000-0000-0000-0000-0000000000d1', '2024-03-07', 'ready'), ('27020000-0000-0000-0000-0000000000d1', '2024-03-20', 'broken'),
    ('27020000-0000-0000-0000-0000000000d1', '2024-03-21', 'ready'), ('27020000-0000-0000-0000-0000000000d1', '2024-04-02', 'broken'),
    ('27020000-0000-0000-0000-0000000000d1', '2024-04-03', 'ready'), ('27020000-0000-0000-0000-0000000000d1', '2024-05-06', 'broken'),
    ('27020000-0000-0000-0000-0000000000d2', '2024-03-04', 'broken'), ('27020000-0000-0000-0000-0000000000d3', '2024-03-04', 'broken')
  ) v(a, d, s);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('27020000-0000-0000-0000-0000000000a1');   -- PM

-- ── AC-EVR-001/002 record, vendor stamped from the term, recorder and time stamped by the server ──
select lives_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-04', '2024-03-04 00:30+00') $$,
  'AC-EVR-001 a Project Manager records a vendor response');
select is((select vendor_id from equipment_vendor_responses where asset_id = '27020000-0000-0000-0000-0000000000d1' and period_start = '2024-03-04'),
  '27020000-0000-0000-0000-0000000000e1'::uuid, 'AC-EVR-001 the vendor is stamped from the rental term');
select is((select recorded_by from equipment_vendor_responses where asset_id = '27020000-0000-0000-0000-0000000000d1' and period_start = '2024-03-04'),
  '27020000-0000-0000-0000-0000000000a1'::uuid, 'AC-EVR-001 the recorder is the caller');
select ok((select recorded_at > now() - interval '1 minute' from equipment_vendor_responses where asset_id = '27020000-0000-0000-0000-0000000000d1' and period_start = '2024-03-04'),
  'AC-EVR-002 the recording time is the server time');
select throws_ok($$ insert into equipment_vendor_responses (org_id, asset_id, period_start, vendor_id, reported_at, responded_at, recorded_by, recorded_at)
  values ('27020000-0000-0000-0000-00000000000a', '27020000-0000-0000-0000-0000000000d1', '2024-04-02', '27020000-0000-0000-0000-0000000000e1',
          '2024-04-02 00:00+00', '2024-04-02 01:00+00', '27020000-0000-0000-0000-0000000000a2', '2000-01-01') $$,
  '42501', null, 'AC-EVR-002 a client cannot forge the recorder or the time (no write grant)');

-- ── AC-EVR-003/004/005 the date and vendor rules ──
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-20', '2024-03-20 07:00+00', '2024-03-20 08:00+00') $$,
  '22023', 'the response cannot precede the report', 'AC-EVR-003 a response before the report is refused');
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-20', now() + interval '1 day') $$,
  '22023', 'the response cannot be in the future', 'AC-EVR-003 a response in the future is refused');
select is((select count(*)::int from equipment_vendor_responses where asset_id = '27020000-0000-0000-0000-0000000000d1' and period_start = '2024-03-20'),
  0, 'AC-EVR-003 a refused call writes nothing');
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-20', '2024-03-20 09:00+00', '2024-03-19 23:00+00') $$,
  '22023', 'reported time precedes the breakdown', 'AC-EVR-004 a report before the breakdown began is refused');
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d2', '2024-03-04', '2024-03-04 02:00+00') $$,
  '22023', 'the breakdown has no rental vendor', 'AC-EVR-005 an owned asset has no vendor to hold');
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d3', '2024-03-04', '2024-03-04 02:00+00') $$,
  '22023', 'the breakdown has no rental vendor', 'AC-EVR-005 a rented asset with no term on the start date has no vendor');
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-05', '2024-03-05 02:00+00') $$,
  '22023', 'no breakdown starts on that date', 'AC-EVR-005 a date that is not a breakdown start is refused');

-- the field role records the other two (30 / 90 / 600 minutes in total)
select pg_temp.act_as('27020000-0000-0000-0000-0000000000a4');   -- Engineer
select lives_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-20', '2024-03-20 01:30+00') $$, 'an Engineer records a response (90 minutes)');
select lives_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-04-02', '2024-04-02 10:00+00') $$, 'an Engineer records a response (600 minutes)');

-- ── AC-EVR-006 only the status roles write; nobody writes the table directly ──
select pg_temp.act_as('27020000-0000-0000-0000-0000000000a2');   -- Finance
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-05-06', '2024-05-06 02:00+00') $$,
  '42501', 'not authorized', 'AC-EVR-006 Finance cannot record');
select throws_ok($$ select clear_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-04') $$,
  '42501', 'not authorized', 'AC-EVR-006 Finance cannot remove');
select pg_temp.act_as('27020000-0000-0000-0000-0000000000a3');   -- Executive
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-05-06', '2024-05-06 02:00+00') $$,
  '42501', 'not authorized', 'AC-EVR-006 Executive cannot record');
select pg_temp.act_as('27020000-0000-0000-0000-0000000000a1');   -- PM
select throws_ok($$ update equipment_vendor_responses set note = 'x' $$, '42501', null, 'AC-EVR-006 no direct update');
select throws_ok($$ delete from equipment_vendor_responses $$, '42501', null, 'AC-EVR-006 no direct delete');

-- ── AC-EVR-007 tenancy ──
select pg_temp.act_as('27020000-0000-0000-0000-0000000000b1');   -- another organisation
select throws_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-05-06', '2024-05-06 02:00+00') $$,
  'P0002', 'asset not found', 'AC-EVR-007 another org cannot record on this asset');
select is((select count(*)::int from equipment_vendor_responses), 0, 'AC-EVR-007 another org reads no responses');
select is((select count(*)::int from list_equipment_breakdowns(array['27020000-0000-0000-0000-0000000000d1']::uuid[], '2024-01-01', '2024-12-31')), 0,
  'AC-EVR-007 another org lists no breakdowns of this asset');

-- ── AC-EVR-008 the per-vendor summary: 30, 90, 600 minutes and one awaiting ──
select pg_temp.act_as('27020000-0000-0000-0000-0000000000a1');
create temp table evr_list on commit drop as
  select * from list_equipment_breakdowns(array['27020000-0000-0000-0000-0000000000d1']::uuid[], '2024-01-01', '2024-12-31');
select is((select count(*)::int from evr_list where response_minutes is not null), 3, 'AC-EVR-008 responded 3');
select is((select count(*)::int from evr_list where response_minutes is null), 1, 'AC-EVR-008 awaiting 1');
select is((select percentile_cont(0.5) within group (order by response_minutes)::numeric from evr_list), 90::numeric, 'AC-EVR-008 median 90');
select is((select avg(response_minutes)::numeric from evr_list), 240::numeric, 'AC-EVR-008 average 240');
select is((select max(response_minutes)::int from evr_list), 600, 'AC-EVR-008 slowest 600');

-- ── AC-EVR-010 a correction restamps; one row per breakdown; removal returns it to awaiting ──
select pg_temp.act_as('27020000-0000-0000-0000-0000000000a4');
select lives_ok($$ select record_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-04', '2024-03-04 00:45+00', null, 'corrected') $$,
  'AC-EVR-010 a response can be corrected');
select is((select recorded_by from equipment_vendor_responses where asset_id = '27020000-0000-0000-0000-0000000000d1' and period_start = '2024-03-04'),
  '27020000-0000-0000-0000-0000000000a4'::uuid, 'AC-EVR-010 the correction restamps the recorder');
select is((select count(*)::int from equipment_vendor_responses where asset_id = '27020000-0000-0000-0000-0000000000d1' and period_start = '2024-03-04'),
  1, 'AC-EVR-010 still one record per breakdown');
select lives_ok($$ select clear_equipment_vendor_response('27020000-0000-0000-0000-0000000000d1', '2024-03-04') $$, 'AC-EVR-010 a response can be removed');
select is((select response_minutes from list_equipment_breakdowns(array['27020000-0000-0000-0000-0000000000d1']::uuid[], '2024-03-04', '2024-03-04')),
  null::bigint, 'AC-EVR-010 the breakdown is awaiting again');

select * from finish();
rollback;
