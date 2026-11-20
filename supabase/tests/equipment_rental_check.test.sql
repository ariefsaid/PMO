-- equipment_rental_check.test.sql — 0987 (#2526 slice 4, MONEY). The downtime deduction off a rental bill.
-- Mutation check (recorded in the PR): set `deducted` to `true` in equipment_rental_check (drop the proof filter) and
-- AC-EAV-009 turns red; restore.
begin;
create extension if not exists pgtap;
select plan(26);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25260000-0000-0000-0000-00000000000a', 'EAV Org A', 'IDR', 'UTC'),
  ('25260000-0000-0000-0000-00000000000b', 'EAV Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('25260000-0000-0000-0000-0000000000a1', 'eav-admin@example.com'),
  ('25260000-0000-0000-0000-0000000000a2', 'eav-fin@example.com'),
  ('25260000-0000-0000-0000-0000000000a5', 'eav-exec@example.com'),
  ('25260000-0000-0000-0000-0000000000a6', 'eav-eng@example.com'),
  ('25260000-0000-0000-0000-0000000000b2', 'eav-b-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25260000-0000-0000-0000-0000000000a1', '25260000-0000-0000-0000-00000000000a', 'EAV Admin', 'eav-admin@example.com', 'Admin', 'active'),
  ('25260000-0000-0000-0000-0000000000a2', '25260000-0000-0000-0000-00000000000a', 'EAV Fin',   'eav-fin@example.com',   'Finance', 'active'),
  ('25260000-0000-0000-0000-0000000000a5', '25260000-0000-0000-0000-00000000000a', 'EAV Exec',  'eav-exec@example.com',  'Executive', 'active'),
  ('25260000-0000-0000-0000-0000000000a6', '25260000-0000-0000-0000-00000000000a', 'EAV Eng',   'eav-eng@example.com',   'Engineer', 'active'),
  ('25260000-0000-0000-0000-0000000000b2', '25260000-0000-0000-0000-00000000000b', 'EAV B Fin', 'eav-b-fin@example.com',  'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('25260000-0000-0000-0000-0000000000e1', '25260000-0000-0000-0000-00000000000a', 'EAV Rental Co', 'Vendor');
-- r1 proven 3 days; r2 unproven 3 days; r3 down all 30 days; r4 owned; r5 mixed currencies
insert into equipment_assets (id, org_id, code, name, default_unit, ownership) values
  ('25260000-0000-0000-0000-0000000000f1', '25260000-0000-0000-0000-00000000000a', 'EAV-R1', 'Crane 1', 'hours', 'rented'),
  ('25260000-0000-0000-0000-0000000000f2', '25260000-0000-0000-0000-00000000000a', 'EAV-R2', 'Crane 2', 'hours', 'rented'),
  ('25260000-0000-0000-0000-0000000000f3', '25260000-0000-0000-0000-00000000000a', 'EAV-R3', 'Crane 3', 'hours', 'rented'),
  ('25260000-0000-0000-0000-0000000000f4', '25260000-0000-0000-0000-00000000000a', 'EAV-O4', 'Owned',   'hours', 'owned'),
  ('25260000-0000-0000-0000-0000000000f5', '25260000-0000-0000-0000-00000000000a', 'EAV-R5', 'Crane 5', 'hours', 'rented');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from)
select '25260000-0000-0000-0000-00000000000a', a, '25260000-0000-0000-0000-0000000000e1', 30000.00, 'month', 'IDR', '2026-09-01'
  from unnest(array['25260000-0000-0000-0000-0000000000f1','25260000-0000-0000-0000-0000000000f2','25260000-0000-0000-0000-0000000000f3']::uuid[]) a;
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from, rented_to) values
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000f5', '25260000-0000-0000-0000-0000000000e1', 100.00, 'day', 'IDR', '2026-09-01', '2026-09-15'),
  ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000f5', '25260000-0000-0000-0000-0000000000e1', 100.00, 'day', 'USD', '2026-09-16', null);
insert into equipment_status_days (org_id, asset_id, status_date, status)
select '25260000-0000-0000-0000-00000000000a', a, d::date, 'broken'
  from unnest(array['25260000-0000-0000-0000-0000000000f1','25260000-0000-0000-0000-0000000000f2']::uuid[]) a,
       generate_series('2026-09-21'::date, '2026-09-23'::date, interval '1 day') d;
insert into equipment_status_days (org_id, asset_id, status_date, status)
select '25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000f3', d::date, 'at_vendor'
  from generate_series('2026-09-01'::date, '2026-09-30'::date, interval '1 day') d;
-- the proof for r1's downtime (r2 and r3 have none)
insert into equipment_downtime_proofs (org_id, asset_id, proof_date, file_name, file_path)
values ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000f1', '2026-09-21', 'ticket.pdf',
        '25260000-0000-0000-0000-00000000000a/25260000-0000-0000-0000-0000000000f1/25260000-0000-0000-0000-0000000000aa/ticket.pdf');

-- An unfinished upload must not count as proof; the metadata row alone is not an attachment.
select is((select proven from public.equipment_downtime_days('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000f1', '2026-09-21', '2026-09-21')), false, 'AC-EAV-009 incomplete upload is unproven');
insert into storage.objects (bucket_id, name) values ('equipment-proof', '25260000-0000-0000-0000-00000000000a/25260000-0000-0000-0000-0000000000f1/25260000-0000-0000-0000-0000000000aa/ticket.pdf');

insert into equipment_assets (id, org_id, code, name, default_unit, ownership, in_service_on, archived_at)
values ('25260000-0000-0000-0000-0000000000f6', '25260000-0000-0000-0000-00000000000a', 'EAV-R6', 'Rental dates', 'hours', 'rented', '2026-09-10', '2026-09-20 00:00:00+00');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from)
values ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000f6', '25260000-0000-0000-0000-0000000000e1', 100, 'day', 'IDR', '2026-09-01');

insert into equipment_assets (id, org_id, code, name, default_unit, ownership)
values ('25260000-0000-0000-0000-0000000000f7', '25260000-0000-0000-0000-00000000000a', 'EAV-R7', 'Half cent', 'hours', 'rented');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from)
values ('25260000-0000-0000-0000-00000000000a', '25260000-0000-0000-0000-0000000000f7', '25260000-0000-0000-0000-0000000000e1', 0.01, 'month', 'IDR', '2026-09-01');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a2');   -- Finance

-- ── AC-EAV-008: 3 proven down days at a monthly rate of 30,000 ──
create temp table _r (k text primary key, v jsonb) on commit drop;
grant all on _r to authenticated;
insert into _r values ('r1', equipment_rental_check('25260000-0000-0000-0000-0000000000f1', '2026-09-01', '2026-09-30', 27500.00));
select is((select v->>'deduction' from _r where k = 'r1'), '3000.00', 'AC-EAV-008 the deduction is 3 x 1,000');
select is((select v->>'expected_amount' from _r where k = 'r1'), '27000.00', 'AC-EAV-008 the expected amount is 27,000');
select is((select v->>'rental_amount' from _r where k = 'r1'), '30000.00', 'AC-EAV-008 the period rental amount is 30,000');
select is((select v->>'difference' from _r where k = 'r1'), '500.00', 'AC-EAV-008 the entered invoice is compared: 500 over the expected amount');
select is((select jsonb_array_length(v->'days') from _r where k = 'r1'), 3, 'AC-EAV-008 the day-by-day list has the 3 down days');
select is((select jsonb_array_length(v->'days'->0->'proofs') from _r where k = 'r1'), 1, 'AC-EAV-008 each day lists its proof');
select is((select (v->'days'->0->>'proven')::boolean from _r where k = 'r1'), true, 'AC-EAV-008 a day with a proven period is proven');
select is((equipment_rental_check('25260000-0000-0000-0000-0000000000f1', '2026-09-01', '2026-09-30')->>'difference') is null, true,
  'FR-EAV-015 without an invoice amount only the expected amount is shown');

-- ── AC-EAV-009: unproven days are listed apart and not deducted unless a reason is given and stored ──
select is(equipment_rental_check('25260000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-30')->>'deduction', '0.00',
  'AC-EAV-009 an unproven day is not deducted');
select is(jsonb_array_length(equipment_rental_check('25260000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-30')->'unproven_days'), 3,
  'AC-EAV-009 unproven days are listed separately');
select throws_ok($$ select equipment_rental_check('25260000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-30', null, '   ') $$,
  '22023', 'including unproven downtime needs a reason', 'AC-EAV-009 including them without a reason is refused');
select is(equipment_rental_check('25260000-0000-0000-0000-0000000000f2', '2026-09-01', '2026-09-30', null, 'vendor ticket pending')->>'deduction', '3000.00',
  'AC-EAV-009 with a stated reason the unproven days are deducted');
select is((select count(*)::int from equipment_rental_checks where asset_id = '25260000-0000-0000-0000-0000000000f2' and included_unproven_reason = 'vendor ticket pending'), 1,
  'AC-EAV-009 the stated reason is stored');

-- ── AC-EAV-010: never more than the period's rental amount ──
select is(equipment_rental_check('25260000-0000-0000-0000-0000000000f3', '2026-09-01', '2026-09-30', null, 'down all month')->>'deduction', '30000.00',
  'AC-EAV-010 a deduction of every day equals, and never exceeds, the rental amount');
select is(equipment_rental_check('25260000-0000-0000-0000-0000000000f3', '2026-09-01', '2026-09-30', null, 'down all month')->>'expected_amount', '0.00',
  'AC-EAV-010 the expected amount floors at zero');

select is(equipment_rental_check('25260000-0000-0000-0000-0000000000f6', '2026-09-01', '2026-09-30')->>'rental_amount', '1000.00',
  'FR-EAV-015 only days in service enter the invoice check');

select is(equipment_rental_check('25260000-0000-0000-0000-0000000000f7', '2026-09-01', '2026-09-15')->>'rental_amount', '0.01',
  'NFR-EAV-003 monthly half cent rounds once without truncation');

select throws_ok($$ select equipment_rental_check('25260000-0000-0000-0000-0000000000f1', '2025-01-01', '2025-01-31') $$,
  '22023', 'no rental term covers the invoice period', 'FR-EAV-015 a period with no rental terms is refused');

-- ── guards ──
select throws_ok($$ select equipment_rental_check('25260000-0000-0000-0000-0000000000f4', '2026-09-01', '2026-09-30') $$,
  'P0002', 'rented asset not found', 'an owned asset has no rental check');
select throws_ok($$ select equipment_rental_check('25260000-0000-0000-0000-0000000000f5', '2026-09-01', '2026-09-30') $$,
  '22023', 'the period mixes currencies', 'a period spanning two currencies is refused, never summed');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a5');   -- Executive
select throws_ok($$ select equipment_rental_check('25260000-0000-0000-0000-0000000000f1', '2026-09-01', '2026-09-30') $$,
  '42501', 'not authorized', 'AC-EAV-012 an Executive cannot open the check');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000a6');   -- Engineer
select throws_ok($$ select equipment_rental_check('25260000-0000-0000-0000-0000000000f1', '2026-09-01', '2026-09-30') $$,
  '42501', 'not authorized', 'AC-EAV-012 a field controller cannot open the check');
select is((select count(*)::int from equipment_rental_checks), 0, 'AC-EAV-012 a field controller reads no stored checks');
select pg_temp.act_as('25260000-0000-0000-0000-0000000000b2');   -- another org's Finance
select throws_ok($$ select equipment_rental_check('25260000-0000-0000-0000-0000000000f1', '2026-09-01', '2026-09-30') $$,
  'P0002', 'rented asset not found', 'AC-EAV-012 another org cannot open this asset''s check');
select is((select count(*)::int from equipment_rental_checks), 0, 'AC-EAV-012 another org reads no stored checks');

select * from finish();
rollback;
