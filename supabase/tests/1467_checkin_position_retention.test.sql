-- 1467_checkin_position_retention.test.sql — a check-in's position is kept 90 days after its decision, then removed.
-- Migration under test: 1467_checkin_position_retention.sql (the phone-check-in-position-purge job).
-- The job nulls latitude, longitude and accuracy 90 days after the decision (the check-in time while one is
-- pending or unrecorded); the check-in record itself stays: outcome, decision and hours are business history.
-- Runs the command text stored in cron.job, so the shipped SQL is what is tested.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   change the interval to '1000 days' in the job ......... 'positions older than 90 days are gone, the record stays'
--   drop the lat/lng/accuracy assignments in the job ...... 'positions older than 90 days are gone, the record stays'
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('14670000-0000-0000-0000-00000000000a', 'RET Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('14670000-0000-0000-0000-0000000000a1', 'ret-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('14670000-0000-0000-0000-0000000000a1', '14670000-0000-0000-0000-00000000000a', 'RET Admin', 'ret-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('14670000-0000-0000-0000-0000000000d1', '14670000-0000-0000-0000-00000000000a', 'RET Site', 'Ongoing Project', '14670000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('14670000-0000-0000-0000-000000000401', '14670000-0000-0000-0000-00000000000a', '14670000-0000-0000-0000-0000000000d1', 'RET WO', 'Issued', 1000, 'exclusive', 0);
insert into people (id, org_id, kind, code, name) values
  ('14670000-0000-0000-0000-000000000f01', '14670000-0000-0000-0000-00000000000a', 'own', 'P-1', 'RET Person');

insert into phone_check_ins (id, org_id, work_order_id, worker_id, requester_id, work_date, hours, lat, lng, accuracy_m,
                             outcome, status, decided_by, decided_at, checked_in_at) values
  ('14670000-0000-0000-0000-000000001001', '14670000-0000-0000-0000-00000000000a', '14670000-0000-0000-0000-000000000401',
   '14670000-0000-0000-0000-000000000f01', '14670000-0000-0000-0000-0000000000a1', current_date - 91, 8,
   -6.2, 106.8, 12, 'outside', 'approved', '14670000-0000-0000-0000-0000000000a1', now() - interval '91 days', now() - interval '91 days'),
  ('14670000-0000-0000-0000-000000001002', '14670000-0000-0000-0000-00000000000a', '14670000-0000-0000-0000-000000000401',
   '14670000-0000-0000-0000-000000000f01', '14670000-0000-0000-0000-0000000000a1', current_date - 89, 8,
   -6.2, 106.8, 12, 'inside', 'recorded', null, null, now() - interval '89 days'),
  ('14670000-0000-0000-0000-000000001003', '14670000-0000-0000-0000-00000000000a', '14670000-0000-0000-0000-000000000401',
   '14670000-0000-0000-0000-000000000f01', '14670000-0000-0000-0000-0000000000a1', current_date - 91, 8,
   -6.2, 106.8, 12, 'outside', 'pending', null, null, now() - interval '91 days'),
  ('14670000-0000-0000-0000-000000001004', '14670000-0000-0000-0000-00000000000a', '14670000-0000-0000-0000-000000000401',
   '14670000-0000-0000-0000-000000000f01', '14670000-0000-0000-0000-0000000000a1', current_date - 89, 8,
   -6.2, 106.8, 12, 'outside', 'approved', '14670000-0000-0000-0000-0000000000a1', now() - interval '89 days', now() - interval '89 days');

create or replace function pg_temp.run_job(p text) returns void language plpgsql as $$
declare c text;
begin
  select command into strict c from cron.job where jobname = p and active;
  execute c;
end $$;

select is((select count(*)::int from phone_check_ins), 4, 'the fixtures hold four check-ins');

select pg_temp.run_job('phone-check-in-position-purge');

select is((select count(*)::int from phone_check_ins), 4, 'positions older than 90 days are gone, the record stays');
select is((select lat from phone_check_ins where id = '14670000-0000-0000-0000-000000001001'), null::double precision,
  'an approved check-in decided 91 days ago keeps no position');
select is((select accuracy_m from phone_check_ins where id = '14670000-0000-0000-0000-000000001003'), null::double precision,
  'an old undecided request keeps no position');
select is((select lat from phone_check_ins where id = '14670000-0000-0000-0000-000000001002'), -6.2::double precision,
  'a 89-day-old check-in keeps its position');
select is((select lng from phone_check_ins where id = '14670000-0000-0000-0000-000000001004'), 106.8::double precision,
  'a decision inside the window keeps its position');
select is((select array_agg(status order by status) from phone_check_ins), array['approved','approved','pending','recorded'],
  'the check-ins themselves are all still there');

select is((select count(*)::int from cron.job where jobname = 'phone-check-in-position-purge' and active), 1,
  'the position purge job is scheduled and active');
select is((select schedule from cron.job where jobname = 'phone-check-in-position-purge'), '35 3 * * *',
  'the position purge runs daily at 03:35');
select ok((select command from cron.job where jobname = 'phone-check-in-position-purge') like '%90 days%',
  'the position purge keep period is 90 days');

select * from finish();
rollback;
