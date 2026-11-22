-- 1601_equipment_metrics_before_org_existed.test.sql — days before the organisation's first day are not "not recorded".
-- Mutation check: remove the `days.d < v_first` branch and the first assertion turns red (9 unrecorded days instead of 2); restore.
begin;
create extension if not exists pgtap;
select plan(3);

insert into organizations (id, name, default_currency, default_timezone, created_at) values
  ('16010000-0000-0000-0000-00000000000a', 'EMO Org', 'IDR', 'UTC', '2026-09-10 08:00:00+00');
insert into auth.users (id, email) values ('16010000-0000-0000-0000-0000000000a3', 'emo-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16010000-0000-0000-0000-0000000000a3', '16010000-0000-0000-0000-00000000000a', 'EMO PM', 'emo-pm@example.com', 'Project Manager', 'active');
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('16010000-0000-0000-0000-0000000000d1', '16010000-0000-0000-0000-00000000000a', 'EMO-1', 'Loader', 'hours'),
  ('16010000-0000-0000-0000-0000000000d2', '16010000-0000-0000-0000-00000000000a', 'EMO-2', 'Truck', 'hours');
-- d1 is recorded from 12 September on; the organisation was created on the 10th, so 10 and 11 are the only unrecorded days.
insert into equipment_status_days (org_id, asset_id, status_date, status)
select '16010000-0000-0000-0000-00000000000a', '16010000-0000-0000-0000-0000000000d1', d::date, 'ready'
  from generate_series('2026-09-12'::date, '2026-09-30'::date, interval '1 day') d;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('16010000-0000-0000-0000-0000000000a3');
select is((select unrecorded_days from equipment_metrics(array['16010000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'month')), 2,
  'AC-EQM-009 only the two days after the organisation was created are unrecorded, not the nine before it');
select is((select available_days from equipment_metrics(array['16010000-0000-0000-0000-0000000000d1']::uuid[], '2026-09-01', '2026-09-30', 'month')), 19,
  'AC-EQM-009 recorded days still count as available');
select is((select unrecorded_days from equipment_metrics(array['16010000-0000-0000-0000-0000000000d2']::uuid[], '2026-09-01', '2026-09-30', 'month')), 21,
  'AC-EQM-009 an asset with no status counts every day from the organisation first day (the 10th) as unrecorded');

select * from finish();
rollback;
