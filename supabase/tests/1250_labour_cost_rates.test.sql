-- 1250_labour_cost_rates.test.sql — #2670. Migration under test: 1250_labour_cost_settings.sql.
-- AC-LCM-003 seed on first turn-on · AC-LCM-012 rate lock · AC-LCM-013 role gates · AC-LCM-014 org isolation · AC-LCM-016 validation.
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency) values
  ('26700000-0000-0000-0000-00000000000a', 'Labour Org A', 'IDR'),
  ('26700000-0000-0000-0000-00000000000b', 'Labour Org B', 'IDR');
insert into auth.users (id, email) values
  ('26700000-0000-0000-0000-0000000000a1', 'lc-admin@example.com'),
  ('26700000-0000-0000-0000-0000000000a2', 'lc-fin@example.com'),
  ('26700000-0000-0000-0000-0000000000a3', 'lc-pm@example.com'),
  ('26700000-0000-0000-0000-0000000000a4', 'lc-eng@example.com'),
  ('26700000-0000-0000-0000-0000000000a5', 'lc-exec@example.com'),
  ('26700000-0000-0000-0000-0000000000b1', 'lc-b-admin@example.com'),
  ('26700000-0000-0000-0000-0000000000b2', 'lc-b-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26700000-0000-0000-0000-0000000000a1', '26700000-0000-0000-0000-00000000000a', 'A Admin', 'lc-admin@example.com', 'Admin', 'active'),
  ('26700000-0000-0000-0000-0000000000a2', '26700000-0000-0000-0000-00000000000a', 'A Fin', 'lc-fin@example.com', 'Finance', 'active'),
  ('26700000-0000-0000-0000-0000000000a3', '26700000-0000-0000-0000-00000000000a', 'A PM', 'lc-pm@example.com', 'Project Manager', 'active'),
  ('26700000-0000-0000-0000-0000000000a4', '26700000-0000-0000-0000-00000000000a', 'A Eng', 'lc-eng@example.com', 'Engineer', 'active'),
  ('26700000-0000-0000-0000-0000000000a5', '26700000-0000-0000-0000-00000000000a', 'A Exec', 'lc-exec@example.com', 'Executive', 'active'),
  ('26700000-0000-0000-0000-0000000000b1', '26700000-0000-0000-0000-00000000000b', 'B Admin', 'lc-b-admin@example.com', 'Admin', 'active'),
  ('26700000-0000-0000-0000-0000000000b2', '26700000-0000-0000-0000-00000000000b', 'B Eng', 'lc-b-eng@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26700000-0000-0000-0000-0000000000d1', '26700000-0000-0000-0000-00000000000a', 'LC Site', 'Ongoing Project', 'IDR');
set local session_replication_role = replica;
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('26700000-0000-0000-0000-000000000701', '26700000-0000-0000-0000-00000000000a', '26700000-0000-0000-0000-0000000000a4', '2026-11-02', 'Approved');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('26700000-0000-0000-0000-000000000711', '26700000-0000-0000-0000-00000000000a', '26700000-0000-0000-0000-000000000701', '26700000-0000-0000-0000-0000000000d1', '2026-11-03', 8);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

-- Engineer cannot write; Finance can.
select pg_temp.act_as('26700000-0000-0000-0000-0000000000a4');
select throws_ok($$select public.save_labour_cost_settings(true)$$, '42501', 'not authorized', 'AC-LCM-013 an Engineer cannot turn the switch on');
select pg_temp.act_as('26700000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.save_labour_cost_settings(true)$$, '42501', 'not authorized', 'AC-LCM-013 a Project Manager cannot turn the switch on');

select pg_temp.act_as('26700000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.labour_cost_classes), 0, 'AC-LCM-003 before the first turn-on there are no classes (existing orgs see nothing)');
select lives_ok($$select public.save_labour_cost_settings(true)$$, 'Finance turns the switch on');
select is((select array_agg(code order by code) from public.labour_cost_classes), array['direct','guard','indirect']::text[],
  'AC-LCM-003 the first turn-on creates direct, indirect and guard');
update public.labour_cost_classes set name = 'Site guard' where code = 'guard';
select is((select name from public.labour_cost_classes where code = 'guard'), 'Site guard', 'AC-LCM-003 a class is renameable');
select public.save_labour_cost_settings(false);
select public.save_labour_cost_settings(true);
select is((select count(*)::int from public.labour_cost_classes), 3, 'AC-LCM-003 turning it on again creates no class');
select throws_ok($$update public.labour_cost_classes set code = 'x' where code = 'guard'$$, '42501', null, 'class code is not client-writable');

-- Rates: validation.
create temp table k as select (select id from public.labour_cost_classes where code = 'direct') as direct_id;
grant select on k to authenticated;
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',%L,'basis','hourly','amount',0,'effective_from','2026-01-01'))$$, (select direct_id from k)),
  '22023', 'amount must be greater than 0 with at most 2 decimals', 'AC-LCM-016 zero amount refused');
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',%L,'basis','hourly','amount',10,'overtime_multiplier',0.5,'effective_from','2026-01-01'))$$, (select direct_id from k)),
  '22023', 'overtime multiplier must be between 1 and 5', 'AC-LCM-016 multiplier below 1 refused');
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',%L,'basis','hourly','amount',10,'day_hours',30,'effective_from','2026-01-01'))$$, (select direct_id from k)),
  '22023', 'day length must be between 1 and 24 hours', 'AC-LCM-016 day length out of range refused');
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',%L,'basis','hourly','amount',10,'effective_from','2026-02-01','effective_to','2026-01-01'))$$, (select direct_id from k)),
  '22023', 'end date is before the start date', 'AC-LCM-016 reversed dates refused');
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Wizard','class_id',%L,'basis','hourly','amount',10,'effective_from','2026-01-01'))$$, (select direct_id from k)),
  '22023', 'a rate field is missing or not valid', 'AC-LCM-016 an unknown role refused (cast to user_role)');

-- Lock rule: Engineer has 8 approved hours on 2026-11-03.
select public.save_labour_cost_rate(jsonb_build_object('subject_kind','role','role_key','Engineer','class_id',(select direct_id from k),'basis','hourly','amount',50000,'effective_from','2026-01-01'));
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','person','person_id','26700000-0000-0000-0000-0000000000a4','class_id',%L,'basis','hourly','amount',60000,'effective_from','2026-11-03'))$$, (select direct_id from k)),
  '23514', null, 'AC-LCM-012 a rate starting on or before a priced approved day is refused');
select lives_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','person','person_id','26700000-0000-0000-0000-0000000000a4','class_id',%L,'basis','hourly','amount',60000,'effective_from','2026-11-04'))$$, (select direct_id from k)),
  'AC-LCM-012 a rate starting after the last priced day is accepted');
select throws_ok(format($$select public.archive_labour_cost_rate(%L)$$, (select id from public.labour_cost_rates where subject_kind = 'role')),
  '23514', null, 'AC-LCM-012 a rate that priced hours cannot be archived');
select throws_ok(format($$select public.end_labour_cost_rate(%L, '2026-10-31')$$, (select id from public.labour_cost_rates where subject_kind = 'role')),
  '23514', null, 'AC-LCM-012 a rate cannot be ended before hours it priced');

-- Visibility.
select pg_temp.act_as('26700000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.labour_cost_rates), 0, 'AC-LCM-013 a Project Manager reads no rate');
select pg_temp.act_as('26700000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.labour_cost_rates), 2, 'AC-LCM-013 an Executive reads rates');
select pg_temp.act_as('26700000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.labour_cost_rates) + (select count(*)::int from public.labour_cost_classes), 0, 'AC-LCM-014 another organisation sees no rate or class');
select throws_ok(format($$select public.save_labour_cost_rate(jsonb_build_object('subject_kind','person','person_id','26700000-0000-0000-0000-0000000000a4','class_id',%L,'basis','hourly','amount',1,'effective_from','2026-12-01'))$$, (select direct_id from k)),
  '22023', null, 'AC-LCM-014 another organisation cannot name this one''s class or person');

select * from finish();
rollback;
