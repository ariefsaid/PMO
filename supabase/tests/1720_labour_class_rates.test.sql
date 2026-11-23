-- 1720_labour_class_rates.test.sql — class rates and labour class assignments (docs/specs/no-login-labour-cost.spec.md).
-- Migration under test: 1720_labour_class_rates.sql.
-- AC-NLL-009 class rate writes · AC-NLL-010 assignment writes, reads, org scope · AC-NLL-011 history locks (switch on and off).
-- Mutation check M4 (plan): `labour_class_locked` returning false turns AC-NLL-011 red; M3 (b) turns the PM read red.
-- 1937: drop the login test in save_labour_class_assignment (mut:no_login) -> 'AC-NLL-010 a person who signs in cannot be given a class' goes red.
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency) values
  ('17200000-0000-0000-0000-00000000000a', 'Class Rate Org A', 'IDR'),
  ('17200000-0000-0000-0000-00000000000b', 'Class Rate Org B', 'IDR');
insert into auth.users (id, email) values
  ('17200000-0000-0000-0000-0000000000a1', 'cr-admin@example.com'),
  ('17200000-0000-0000-0000-0000000000a2', 'cr-fin@example.com'),
  ('17200000-0000-0000-0000-0000000000a3', 'cr-pm@example.com'),
  ('17200000-0000-0000-0000-0000000000a4', 'cr-eng@example.com'),
  ('17200000-0000-0000-0000-0000000000a5', 'cr-exec@example.com'),
  ('17200000-0000-0000-0000-0000000000b1', 'cr-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17200000-0000-0000-0000-0000000000a1', '17200000-0000-0000-0000-00000000000a', 'A Admin', 'cr-admin@example.com', 'Admin', 'active'),
  ('17200000-0000-0000-0000-0000000000a2', '17200000-0000-0000-0000-00000000000a', 'A Fin', 'cr-fin@example.com', 'Finance', 'active'),
  ('17200000-0000-0000-0000-0000000000a3', '17200000-0000-0000-0000-00000000000a', 'A PM', 'cr-pm@example.com', 'Project Manager', 'active'),
  ('17200000-0000-0000-0000-0000000000a4', '17200000-0000-0000-0000-00000000000a', 'A Eng', 'cr-eng@example.com', 'Engineer', 'active'),
  ('17200000-0000-0000-0000-0000000000a5', '17200000-0000-0000-0000-00000000000a', 'A Exec', 'cr-exec@example.com', 'Executive', 'active'),
  ('17200000-0000-0000-0000-0000000000b1', '17200000-0000-0000-0000-00000000000b', 'B Admin', 'cr-b-admin@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('17200000-0000-0000-0000-0000000000d1', '17200000-0000-0000-0000-00000000000a', 'CR Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('17200000-0000-0000-0000-000000000401', '17200000-0000-0000-0000-00000000000a', '17200000-0000-0000-0000-0000000000d1', 'WO-1', 'One', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into crews (id, org_id, code, name) values
  ('17200000-0000-0000-0000-000000000c01', '17200000-0000-0000-0000-00000000000a', 'CR-A', 'Crew A');
insert into people (id, org_id, kind, code, name, profile_id) values
  ('17200000-0000-0000-0000-000000000f01', '17200000-0000-0000-0000-00000000000a', 'own', 'CR-N1', 'Worker One', null),
  ('17200000-0000-0000-0000-000000000f02', '17200000-0000-0000-0000-00000000000a', 'own', 'CR-N2', 'Worker Two', null),
  ('17200000-0000-0000-0000-000000000f03', '17200000-0000-0000-0000-00000000000a', 'own', 'CR-L3', 'Worker With Login', '17200000-0000-0000-0000-0000000000a4'),
  ('17200000-0000-0000-0000-000000000f09', '17200000-0000-0000-0000-00000000000b', 'own', 'CR-B9', 'Other Org Worker', null);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('17200000-0000-0000-0000-0000000000b1');
select public.save_labour_cost_settings(true);
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a2');
select public.save_labour_cost_settings(true);
reset role;
create temp table k as select org_id, code, id from labour_cost_classes
  where org_id in ('17200000-0000-0000-0000-00000000000a', '17200000-0000-0000-0000-00000000000b');
grant select on k to authenticated;
create or replace function pg_temp.cls(p_code text) returns uuid language sql stable as $$
  select id from k where org_id = '17200000-0000-0000-0000-00000000000a' and code = p_code $$;
create or replace function pg_temp.rate(p_class uuid, p_from text) returns jsonb language sql stable as $$
  select jsonb_build_object('subject_kind', 'class', 'class_id', p_class, 'basis', 'hourly', 'amount', 40000,
                            'overtime_multiplier', 1.5, 'effective_from', p_from) $$;
create or replace function pg_temp.assign(p_worker uuid, p_class uuid, p_from text, p_to text default null) returns jsonb
  language sql stable as $$
  select jsonb_build_object('worker_id', p_worker, 'class_id', p_class, 'effective_from', p_from, 'effective_to', p_to) $$;
set local role authenticated;
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a2');

-- ── AC-NLL-009 class rates ───────────────────────────────────────────────────────────────────────────────────
select lives_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('direct'), '2026-11-01')),
  'AC-NLL-009 Finance adds a class rate');
select is((select subject_kind || ':' || coalesce(person_id::text, 'null') || ':' || coalesce(role_key, 'null')
             from public.labour_cost_rates where subject_kind = 'class' and class_id = pg_temp.cls('direct')),
  'class:null:null', 'AC-NLL-009 a class rate names its class and no person or role');
select throws_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('direct'), '2026-11-01')),
  '23505', null, 'AC-NLL-009 a second class rate starting on the same date is refused');
select throws_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('direct'), '2026-12-01') || '{"amount": 0}'::jsonb),
  '22023', null, 'AC-NLL-009 a class rate with a bad amount is refused');
select throws_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('direct'), '2026-12-01') || '{"subject_kind": "crew"}'::jsonb),
  '22023', null, 'AC-NLL-009 an unknown subject kind is refused');
select throws_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$,
                        pg_temp.rate((select id from k where org_id = '17200000-0000-0000-0000-00000000000b' and code = 'direct'), '2026-12-01')),
  '22023', null, 'AC-NLL-009 another organisation''s class cannot be priced');
update public.labour_cost_classes set archived_at = now() where id = pg_temp.cls('guard');
select throws_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('guard'), '2026-12-01')),
  '22023', null, 'AC-NLL-009 an archived class cannot be priced');
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a3');
select throws_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('direct'), '2026-12-01')),
  '42501', null, 'AC-NLL-009 a Project Manager cannot add a class rate');
reset role;
select is((select count(*)::int from public.labour_rate_for('17200000-0000-0000-0000-00000000000a', '17200000-0000-0000-0000-0000000000a4', '2026-11-03')), 0,
  'AC-NLL-009 a class rate never prices a login''s timesheet');
set local role authenticated;

-- ── AC-NLL-010 class assignments ─────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a2');
select lives_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                       pg_temp.assign('17200000-0000-0000-0000-000000000f01', pg_temp.cls('direct'), '2026-11-01', '2026-11-20')),
  'AC-NLL-010 Finance assigns a class to a person with no login');
select is((select org_id from public.labour_class_assignments where worker_id = '17200000-0000-0000-0000-000000000f01'),
  '17200000-0000-0000-0000-00000000000a'::uuid, 'AC-NLL-010 the organisation is stamped by the server');
select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f01', pg_temp.cls('indirect'), '2026-11-01')),
  '23505', null, 'AC-NLL-010 a second assignment starting on the same date is refused');
select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f09', pg_temp.cls('direct'), '2026-11-01')),
  '22023', null, 'AC-NLL-010 a person of another organisation cannot be assigned');
select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f03', pg_temp.cls('direct'), '2026-11-01')),
  '23514', 'LCM_HAS_LOGIN: this person signs in, so their hours are costed on their timesheet; a class is for people with no login',
  'AC-NLL-010 a person who signs in cannot be given a class');
select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f01', pg_temp.cls('guard'), '2026-12-01')),
  '22023', null, 'AC-NLL-010 an archived class cannot be assigned');
select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f01', pg_temp.cls('direct'), '2026-12-10', '2026-12-01')),
  '22023', null, 'AC-NLL-010 an end before the start is refused');
select throws_ok($$insert into public.labour_class_assignments (worker_id, class_id, effective_from)
                   values ('17200000-0000-0000-0000-000000000f01', pg_temp.cls('indirect'), '2026-12-01')$$,
  '42501', null, 'AC-NLL-010 assignments are written only through the actions');
select lives_ok($$select public.end_labour_class_assignment((select id from public.labour_class_assignments
                   where worker_id = '17200000-0000-0000-0000-000000000f01' and effective_from = '2026-11-01'), '2026-11-30')$$,
  'AC-NLL-010 Finance ends an assignment');
select lives_ok(format($$select public.archive_labour_class_assignment(public.save_labour_class_assignment(%L::jsonb))$$,
                       pg_temp.assign('17200000-0000-0000-0000-000000000f01', pg_temp.cls('indirect'), '2026-12-01')),
  'AC-NLL-010 Finance archives an assignment');
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a3');
select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f02', pg_temp.cls('direct'), '2026-11-01')),
  '42501', null, 'AC-NLL-010 a Project Manager cannot assign a class');
select is((select count(*)::int from public.labour_class_assignments), 0, 'AC-NLL-010 a Project Manager reads no assignment');
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a4');
select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f02', pg_temp.cls('direct'), '2026-11-01')),
  '42501', null, 'AC-NLL-010 an Engineer cannot assign a class');
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from public.labour_class_assignments), 2, 'AC-NLL-010 Executive reads the assignments');

-- ── AC-NLL-011 history locks ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a2');
select public.save_labour_class_assignment(pg_temp.assign('17200000-0000-0000-0000-000000000f02', pg_temp.cls('direct'), '2026-11-01'));
reset role;
set local session_replication_role = replica;
insert into attendance_days (org_id, worker_id, work_order_id, project_id, crew_id, work_date, status, hours, source, submitted_at, approved_at, locked_at)
values ('17200000-0000-0000-0000-00000000000a', '17200000-0000-0000-0000-000000000f02', '17200000-0000-0000-0000-000000000401',
        '17200000-0000-0000-0000-0000000000d1', '17200000-0000-0000-0000-000000000c01', '2026-11-04', 'present', 8, 'roster_tick', now(), now(), now());
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('17200000-0000-0000-0000-0000000000a2');
create temp table a2 as select id from public.labour_class_assignments where worker_id = '17200000-0000-0000-0000-000000000f02';
create temp table r1 as select id from public.labour_cost_rates where subject_kind = 'class' and effective_from = '2026-11-01';

select throws_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                        pg_temp.assign('17200000-0000-0000-0000-000000000f02', pg_temp.cls('indirect'), '2026-11-03')),
  '23514', null, 'AC-NLL-011 an assignment starting on or before a costed day is refused');
select throws_like(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                          pg_temp.assign('17200000-0000-0000-0000-000000000f02', pg_temp.cls('indirect'), '2026-11-04')),
  '%LCM_CLASS_LOCKED%', 'AC-NLL-011 and names the refusal LCM_CLASS_LOCKED');
select lives_ok(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                       pg_temp.assign('17200000-0000-0000-0000-000000000f02', pg_temp.cls('indirect'), '2026-11-05')),
  'AC-NLL-011 an assignment starting after the last costed day is accepted');
select throws_like($$select public.end_labour_class_assignment((select id from a2), '2026-11-03')$$,
  '%LCM_CLASS_LOCKED%', 'AC-NLL-011 ending the assignment that prices a costed day before it is refused');
select throws_like($$select public.archive_labour_class_assignment((select id from a2))$$,
  '%LCM_CLASS_LOCKED%', 'AC-NLL-011 archiving the assignment that prices a costed day is refused');
select throws_like(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('direct'), '2026-11-02')),
  '%LCM_RATE_LOCKED%', 'AC-NLL-011 a class rate starting on or before a costed day of that class is refused');
select lives_ok(format($$select public.save_labour_cost_rate(%L::jsonb)$$, pg_temp.rate(pg_temp.cls('direct'), '2026-11-10')),
  'AC-NLL-011 a class rate starting after the last costed day is accepted');
select throws_like($$select public.end_labour_cost_rate((select id from r1), '2026-11-02')$$,
  '%LCM_RATE_LOCKED%', 'AC-NLL-011 ending the class rate that prices a costed day before it is refused');
select throws_like($$select public.archive_labour_cost_rate((select id from r1))$$,
  '%LCM_RATE_LOCKED%', 'AC-NLL-011 archiving the class rate that prices a costed day is refused');
select public.save_labour_cost_settings(false);
select throws_like(format($$select public.save_labour_class_assignment(%L::jsonb)$$,
                          pg_temp.assign('17200000-0000-0000-0000-000000000f02', pg_temp.cls('indirect'), '2026-11-04')),
  '%LCM_CLASS_LOCKED%', 'AC-NLL-011 the lock holds with the switch off');

select * from finish();
rollback;
