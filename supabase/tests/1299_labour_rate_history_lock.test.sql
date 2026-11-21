-- 1299_labour_rate_history_lock.test.sql — the labour rate history lock holds whatever the switch says, and every
-- rate-setting write leaves an audit row.
-- Migration under test: 1299 (on top of 1250).
-- AC-LCM-005 the lock rule applies with the labour cost switch off as much as with it on: a rate that would re-price
--   an approved hour is refused either way.
-- AC-LCM-005 ending a rate later than its current end is refused when an approved hour in the added span is priced.
-- AC-LCM-005 switching the setting, ending a rate and archiving a rate each write an audit row.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency) values ('26970000-0000-0000-0000-00000000000a', 'Lock Org', 'IDR');
insert into auth.users (id, email) values
  ('26970000-0000-0000-0000-0000000000a1', 'lk-fin@example.com'),
  ('26970000-0000-0000-0000-0000000000a3', 'lk-w1@example.com'),
  ('26970000-0000-0000-0000-0000000000a4', 'lk-w2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26970000-0000-0000-0000-0000000000a1', '26970000-0000-0000-0000-00000000000a', 'Fin', 'lk-fin@example.com', 'Finance', 'active'),
  ('26970000-0000-0000-0000-0000000000a3', '26970000-0000-0000-0000-00000000000a', 'W1', 'lk-w1@example.com', 'Engineer', 'active'),
  ('26970000-0000-0000-0000-0000000000a4', '26970000-0000-0000-0000-00000000000a', 'W2', 'lk-w2@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26970000-0000-0000-0000-0000000000d1', '26970000-0000-0000-0000-00000000000a', 'LK Site', 'Ongoing Project', 'IDR');
set local session_replication_role = replica;
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('26970000-0000-0000-0000-000000000701', '26970000-0000-0000-0000-00000000000a', '26970000-0000-0000-0000-0000000000a3', '2026-11-02', 'Approved'),
  ('26970000-0000-0000-0000-000000000702', '26970000-0000-0000-0000-00000000000a', '26970000-0000-0000-0000-0000000000a4', '2026-11-02', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('26970000-0000-0000-0000-000000000711', '26970000-0000-0000-0000-00000000000a', '26970000-0000-0000-0000-000000000701', '26970000-0000-0000-0000-0000000000d1', '2026-11-03', 8),
  ('26970000-0000-0000-0000-000000000721', '26970000-0000-0000-0000-00000000000a', '26970000-0000-0000-0000-000000000702', '26970000-0000-0000-0000-0000000000d1', '2026-11-08', 8);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('26970000-0000-0000-0000-0000000000a1');

-- Seed: switch on (seeds the classes), then off, then the role rate W1 covers 11-01..11-04.
select public.save_labour_cost_settings(true);
create temp table cls as select (select id from public.labour_cost_classes where code = 'direct') as direct_id;
grant select on cls to authenticated;
select public.save_labour_cost_settings(false);
select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',(select direct_id from cls),
  'basis','hourly','amount',50000,'effective_from','2026-11-01','effective_to','2026-11-04'));
create temp table rates as select id, subject_kind, person_id, role_key, effective_from, effective_to from public.labour_cost_rates;
grant select on rates to authenticated;

-- 1. With the switch off, the lock still holds: a back-dated rate that would re-price W1's approved 11-03 hour
--    (already priced by the role rate) is refused.
reset role;
select is((select public.labour_rate_locked('26970000-0000-0000-0000-00000000000a', null, 'person',
           '26970000-0000-0000-0000-0000000000a3', null, '2026-11-02')), true,
  'AC-LCM-005 with the switch off, hours a rate prices still lock the subject');
set local role authenticated;
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','person','person_id','26970000-0000-0000-0000-0000000000a3','class_id',%L,'basis','hourly','amount',90000,'effective_from','2026-11-02'))$$, (select direct_id from cls)),
  '23514', null, 'AC-LCM-005 with the switch off, a rate starting over an already priced approved day is refused');
reset role;
delete from public.labour_cost_rates where person_id = '26970000-0000-0000-0000-0000000000a3';
set local role authenticated;

-- 2. Ending a rate later than its current end is refused when an approved hour in the added span is priced.
--    W2's approved 11-08 hour is priced by the person rate from 11-06; extending the role rate over it re-prices it.
select public.save_labour_cost_rate(jsonb_build_object('subject_kind','person','person_id','26970000-0000-0000-0000-0000000000a4','class_id',(select direct_id from cls),
  'basis','hourly','amount',75000,'effective_from','2026-11-06'));
create temp table rate2 as select id from public.labour_cost_rates where person_id = '26970000-0000-0000-0000-0000000000a4';
grant select on rate2 to authenticated;
select throws_ok(format($$select public.end_labour_cost_rate(%L, '2026-11-10')$$, (select id from rates)),
  '23514', null, 'AC-LCM-005 ending a rate later than its end is refused when the added span holds a priced approved hour');
select lives_ok(format($$select public.end_labour_cost_rate(%L, '2026-11-05')$$, (select id from rates)),
  'AC-LCM-005 ending a rate over an unpriced gap is accepted');
select is((select effective_to from public.labour_cost_rates where id = (select id from rates)), '2026-11-05'::date, 'AC-LCM-005 the accepted end date is stored');

-- 3. The switch, an end and an archive each leave an audit row. Every switch write so far left one.
--    (audit_events reads are Admin-only by policy, so the counts run as the superuser.)
reset role;
select is((select count(*)::int from public.audit_events where org_id = '26970000-0000-0000-0000-00000000000a' and action = 'labour_cost_settings.set'), 2,
  'control: each switch write so far (on, off) left one audit row');
set local role authenticated;
select public.save_labour_cost_settings(true);
reset role;
select is((select count(*)::int from public.audit_events where org_id = '26970000-0000-0000-0000-00000000000a' and action = 'labour_cost_settings.set'), 3,
  'AC-LCM-005 switching the setting writes an audit row');
set local role authenticated;
select public.end_labour_cost_rate((select id from rate2), '2026-12-31');
reset role;
select is((select count(*)::int from public.audit_events where org_id = '26970000-0000-0000-0000-00000000000a' and action = 'labour_cost_rate.end'), 2,
  'AC-LCM-005 each accepted rate end (the unpriced gap and the later date) writes an audit row');
set local role authenticated;
select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',(select direct_id from cls),
  'basis','hourly','amount',60000,'effective_from','2027-01-01'));
select public.archive_labour_cost_rate((select id from public.labour_cost_rates where effective_from = '2027-01-01'));
reset role;
select is((select count(*)::int from public.audit_events where org_id = '26970000-0000-0000-0000-00000000000a' and action = 'labour_cost_rate.archive'), 1,
  'AC-LCM-005 archiving a rate writes an audit row');
set local role authenticated;

select * from finish();
rollback;
