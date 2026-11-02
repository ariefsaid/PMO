-- tm_rates.test.sql — T1 of #1514, contract rates and labour assignments.
-- Fixture F1: docs/plans/2026-11-02-time-and-materials-claims.md.
begin;
create extension if not exists pgtap;
select plan(50);

-- ── Fixture F1 ──────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('15140000-0000-0000-0000-0000000000a1', 'TM Org A', 'IDR', 'UTC'),
  ('15140000-0000-0000-0000-0000000000a2', 'TM Org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15140000-0000-0000-0000-0000000000b1', 'tm-fin1@example.com'),
  ('15140000-0000-0000-0000-0000000000b2', 'tm-fin2@example.com'),
  ('15140000-0000-0000-0000-0000000000b3', 'tm-admin@example.com'),
  ('15140000-0000-0000-0000-0000000000b4', 'tm-pm1@example.com'),
  ('15140000-0000-0000-0000-0000000000b5', 'tm-pm2@example.com'),
  ('15140000-0000-0000-0000-0000000000b6', 'tm-eng1@example.com'),
  ('15140000-0000-0000-0000-0000000000b7', 'tm-eng2@example.com'),
  ('15140000-0000-0000-0000-0000000000b8', 'tm-foreign-admin@example.com'),
  ('15140000-0000-0000-0000-0000000000b9', 'tm-exec@example.com');
insert into auth.users (id, email, banned_until) values
  ('15140000-0000-0000-0000-0000000000ba', 'tm-banned@example.com', now() + interval '1 day');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1', 'TM Finance 1', 'tm-fin1@example.com', 'Finance', 'active'),
  ('15140000-0000-0000-0000-0000000000b2', '15140000-0000-0000-0000-0000000000a1', 'TM Finance 2', 'tm-fin2@example.com', 'Finance', 'active'),
  ('15140000-0000-0000-0000-0000000000b3', '15140000-0000-0000-0000-0000000000a1', 'TM Admin', 'tm-admin@example.com', 'Admin', 'active'),
  ('15140000-0000-0000-0000-0000000000b4', '15140000-0000-0000-0000-0000000000a1', 'TM PM 1', 'tm-pm1@example.com', 'Project Manager', 'active'),
  ('15140000-0000-0000-0000-0000000000b5', '15140000-0000-0000-0000-0000000000a1', 'TM PM 2', 'tm-pm2@example.com', 'Project Manager', 'active'),
  ('15140000-0000-0000-0000-0000000000b6', '15140000-0000-0000-0000-0000000000a1', 'TM Engineer 1', 'tm-eng1@example.com', 'Engineer', 'active'),
  ('15140000-0000-0000-0000-0000000000b7', '15140000-0000-0000-0000-0000000000a1', 'TM Engineer 2', 'tm-eng2@example.com', 'Engineer', 'active'),
  ('15140000-0000-0000-0000-0000000000b8', '15140000-0000-0000-0000-0000000000a2', 'TM Foreign Admin', 'tm-foreign-admin@example.com', 'Admin', 'active'),
  ('15140000-0000-0000-0000-0000000000b9', '15140000-0000-0000-0000-0000000000a1', 'TM Executive', 'tm-exec@example.com', 'Executive', 'active'),
  ('15140000-0000-0000-0000-0000000000ba', '15140000-0000-0000-0000-0000000000a1', 'TM Banned Member', 'tm-banned@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('15140000-0000-0000-0000-0000000000c1', '15140000-0000-0000-0000-0000000000a1', 'TM Project 1', 'Ongoing Project', '15140000-0000-0000-0000-0000000000b4', 'IDR'),
  ('15140000-0000-0000-0000-0000000000c2', '15140000-0000-0000-0000-0000000000a1', 'TM Project 2', 'Ongoing Project', '15140000-0000-0000-0000-0000000000b5', 'IDR'),
  ('15140000-0000-0000-0000-0000000000cb', '15140000-0000-0000-0000-0000000000a2', 'TM Foreign Project', 'Ongoing Project', null, 'IDR');
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at, submitted_at) values
  ('15140000-0000-0000-0000-0000000000d1', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-05', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d2', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-12', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d3', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-19', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d4', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-10-05', 'Submitted', null, null, now()),
  ('15140000-0000-0000-0000-0000000000d5', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-10-12', 'Rejected', '15140000-0000-0000-0000-0000000000b1', now(), now());
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
select '15140000-0000-0000-0000-0000000000a1',
       case when n < 5 then '15140000-0000-0000-0000-0000000000d1'::uuid
            when n < 10 then '15140000-0000-0000-0000-0000000000d2'::uuid
            else '15140000-0000-0000-0000-0000000000d3'::uuid end,
       '15140000-0000-0000-0000-0000000000c1',
       date '2026-10-05' + ((n / 5) * 7 + (n % 5))::int, 8
  from generate_series(0, 14) as g(n);
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d4', '15140000-0000-0000-0000-0000000000c1', '2026-10-05', 8),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d5', '15140000-0000-0000-0000-0000000000c1', '2026-10-12', 8);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('15140000-0000-0000-0000-0000000000f1', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM signed document', 'Approved', '15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1/15140000-0000-0000-0000-0000000000c1/15140000-0000-0000-0000-0000000000f1/tm-signed.pdf'),
  ('15140000-0000-0000-0000-0000000000f2', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM document without file', 'Approved', '15140000-0000-0000-0000-0000000000b1', null);

create temp table _state (k text primary key, v jsonb not null) on commit drop;
grant all on _state to authenticated;
create function pg_temp.tm_rate_count(p_project uuid default null, p_line uuid default null) returns int
language plpgsql as $$
declare v_count int;
begin
  if to_regclass('public.contract_rate_lines') is null then return -1; end if;
  execute 'select count(*)::int from public.contract_rate_lines where ($1 is null or project_id = $1) and ($2 is null or line_key = $2)'
    into v_count using p_project, p_line;
  return v_count;
end $$;
create function pg_temp.tm_assignee_count(p_project uuid) returns int
language plpgsql as $$
declare v_count int;
begin
  if to_regclass('public.contract_rate_assignees') is null then return -1; end if;
  execute 'select count(*)::int from public.contract_rate_assignees where project_id = $1' into v_count using p_project;
  return v_count;
end $$;
create function pg_temp.tm_rate_end(p_line uuid) returns date
language plpgsql as $$
declare v_end date;
begin
  if to_regclass('public.contract_rate_lines') is null then return null; end if;
  execute 'select effective_to from public.contract_rate_lines where line_key = $1 and is_current' into v_end using p_line;
  return v_end;
end $$;
create function pg_temp.tm_rate_applies_to(p_line uuid, p_version int) returns date
language plpgsql as $$
declare v_applies_to date;
begin
  if to_regclass('public.contract_rate_lines') is null then return null; end if;
  execute 'select applies_to from public.contract_rate_lines where line_key = $1 and version = $2'
    into v_applies_to using p_line, p_version;
  return v_applies_to;
end $$;

select has_table('public', 'contract_rate_lines', 'AC-TM-011 contract rate lines exist');
select has_table('public', 'contract_rate_assignees', 'AC-TM-011 contract rate assignees exist');

set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- The shared fixture has the labour rate and project assignment used by later T&M slices.
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e1","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$,
  'Fixture F1 creates the Site engineer rate line');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','15140000-0000-0000-0000-0000000000b6','2026-01-01','2026-12-31')$q$,
  'Fixture F1 assigns Engineer 1 to the Site engineer line');
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e7","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Historical rate test","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$,
  'AC-TM-012 Finance creates a rate line before a later effective version');
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e7","expected_version":1,"project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Historical rate test","unit":"hour","rate":60000,"currency":"IDR","effective_from":"2026-06-01","effective_to":"2026-12-31"}')$q$,
  'AC-TM-012 a later effective rate version is accepted');
select is(pg_temp.tm_rate_applies_to('15140000-0000-0000-0000-0000000000e7', 1), '2026-05-31'::date,
  'AC-TM-012 the prior rate version remains applicable through the day before the new version');

select throws_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e3","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Wrong currency","unit":"hour","rate":100,"currency":"USD","effective_from":"2026-01-01"}')$q$,
  '23514', null, 'AC-TM-012 a rate in another currency is refused');
select throws_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e3","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Oversized rate","unit":"hour","rate":1000000000000,"currency":"IDR","effective_from":"2026-01-01"}')$q$,
  '22023', null, 'AC-TM-012 a rate beyond the numeric bound is refused');
select throws_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e7","expected_version":2,"project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Historical rate test","unit":"hour","rate":70000,"currency":"IDR","effective_from":"2025-12-01","effective_to":"2026-12-31"}')$q$,
  '23505', null, 'AC-TM-012 a version that rewrites applied history is refused');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e5","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"PM attempt","unit":"hour","rate":100,"currency":"IDR","effective_from":"2026-01-01"}')$q$,
  '42501', null, 'AC-TM-011 a PM cannot save a rate');
select throws_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','15140000-0000-0000-0000-0000000000b7','2027-01-01','2027-12-31')$q$,
  '42501', null, 'AC-TM-011 a PM cannot assign a rate line');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$insert into _state select 'finance_rate', save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e2","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Surveyor","unit":"hour","rate":100,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-06-30"}')$q$,
  'AC-TM-011 Finance saves a rate');
select lives_ok($q$update _state set v = save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e2","expected_version":1,"project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Surveyor","unit":"hour","rate":120,"currency":"IDR","effective_from":"2026-07-01","effective_to":"2026-12-31"}') where k='finance_rate'$q$,
  'AC-TM-011 Finance can save a later non-overlapping version');
reset role;
select ok(exists(select 1 from audit_events where action = 'contract_rate_line.update'
                  and entity_id = (select (v->>'id')::uuid from _state where k='finance_rate')
                  and detail ? 'before' and detail ? 'after'),
  'AC-TM-011 the rate update audit row has before and after');
set local role authenticated;
select throws_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e2","expected_version":1,"project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Surveyor","unit":"hour","rate":130,"currency":"IDR","effective_from":"2027-01-01"}')$q$,
  '40001', null, 'AC-TM-011 a stale expected_version is refused');
select lives_ok($q$update _state set v = save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e2","expected_version":2,"project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Surveyor","unit":"hour","rate":120,"currency":"IDR","effective_from":"2026-07-01","effective_to":"2026-12-31"}') where k='finance_rate'$q$,
  'AC-TM-011 an identical save is accepted without a new version');
select is((select (v->>'changed')::boolean from _state where k='finance_rate'), false,
  'AC-TM-011 an identical save reports no change');
select is(pg_temp.tm_rate_count(null, '15140000-0000-0000-0000-0000000000e2'), 2,
  'AC-TM-011 an identical save adds no version');

select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e4","project_id":"15140000-0000-0000-0000-0000000000c2","kind":"labour","label":"Project 2 rate","unit":"day","rate":1000,"currency":"IDR","effective_from":"2026-01-01"}')$q$,
  'Finance can create a rate for a second project');
select throws_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e2','15140000-0000-0000-0000-0000000000b6','2026-08-01','2026-10-01')$q$,
  '23505', null, 'AC-TM-012 one person cannot hold two labour lines on one date');
select throws_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e2','15140000-0000-0000-0000-0000000000ba','2026-08-01','2026-10-01')$q$,
  'P0002', null, 'AC-TM-011 a banned member cannot be assigned to a labour line');
select lives_ok($q$select end_contract_rate_line('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e2','2026-09-30',2)$q$,
  'Finance can end a rate line with the current expected version');
select is(pg_temp.tm_rate_end('15140000-0000-0000-0000-0000000000e2'),
  '2026-09-30'::date, 'the current rate version carries its end date');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select is(pg_temp.tm_rate_count('15140000-0000-0000-0000-0000000000c1', null), 6,
  'AC-TM-011 a Project Manager reads rates for their project');
select is(pg_temp.tm_rate_count('15140000-0000-0000-0000-0000000000c2', null), 0,
  'AC-TM-011 a Project Manager reads no rates for another project');
select is(pg_temp.tm_assignee_count('15140000-0000-0000-0000-0000000000c1'), 1,
  'AC-TM-011 a Project Manager reads assignments for their project');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is(pg_temp.tm_rate_count('15140000-0000-0000-0000-0000000000c2', null), 1,
  'AC-TM-011 a Project Manager reads rates for their own second project');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select is(pg_temp.tm_rate_count(null, null), 0, 'AC-TM-011 Engineers read no rates');
select is(pg_temp.tm_assignee_count(null), 0, 'AC-TM-011 Engineers read no assignments');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b8","role":"authenticated"}';
select is(pg_temp.tm_rate_count(null, null), 0, 'AC-TM-011 another org reads no rates');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($q$insert into contract_rate_lines (org_id, project_id, line_key, version, kind, label, unit, rate, effective_from)
  values ('15140000-0000-0000-0000-0000000000a1','15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e6',1,'labour','Direct write','hour',1,'2026-01-01')$q$,
  '42501', null, 'AC-TM-011 direct rate inserts are denied');
select throws_ok($q$update contract_rate_lines set rate=999 where line_key='15140000-0000-0000-0000-0000000000e1'$q$,
  '42501', null, 'AC-TM-011 direct rate updates are denied');
select throws_ok($q$insert into contract_rate_assignees (org_id, project_id, line_key, user_id, effective_from)
  values ('15140000-0000-0000-0000-0000000000a1','15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','15140000-0000-0000-0000-0000000000b7','2026-01-01')$q$,
  '42501', null, 'AC-TM-011 direct assignment inserts are denied');
select throws_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e6","project_id":"15140000-0000-0000-0000-0000000000cb","kind":"labour","label":"Foreign project","unit":"hour","rate":1,"currency":"IDR","effective_from":"2026-01-01"}')$q$,
  'P0002', null, 'AC-TM-011 a Finance user cannot target a foreign project');
select throws_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','15140000-0000-0000-0000-0000000000b8','2026-01-01','2026-01-31')$q$,
  'P0002', null, 'AC-TM-011 a foreign-org person cannot be assigned');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select end_contract_rate_line('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','2026-10-31',1)$q$,
  '42501', null, 'AC-TM-011 a Project Manager cannot end a rate line');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e6","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Admin rate","unit":"hour","rate":1,"currency":"IDR","effective_from":"2026-01-01"}')$q$,
  'AC-TM-011 an Admin can save a rate');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select end_contract_rate_assignee(
  '15140000-0000-0000-0000-0000000000c1',
  (select id from contract_rate_assignees where project_id='15140000-0000-0000-0000-0000000000c1'
     and line_key='15140000-0000-0000-0000-0000000000e1' and user_id='15140000-0000-0000-0000-0000000000b6'),
  '2026-10-31')$q$,
  '42501', null, 'AC-TM-011 a Project Manager cannot end an assignee window');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($q$select end_contract_rate_assignee(
  '15140000-0000-0000-0000-0000000000c1',
  (select id from contract_rate_assignees where project_id='15140000-0000-0000-0000-0000000000c1'
     and line_key='15140000-0000-0000-0000-0000000000e1' and user_id='15140000-0000-0000-0000-0000000000b6'),
  '2026-10-31')$q$,
  '42501', null, 'AC-TM-011 an Engineer cannot end an assignee window');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select end_contract_rate_assignee(
  '15140000-0000-0000-0000-0000000000c1',
  (select id from contract_rate_assignees where project_id='15140000-0000-0000-0000-0000000000c1'
     and line_key='15140000-0000-0000-0000-0000000000e1' and user_id='15140000-0000-0000-0000-0000000000b6'),
  '2026-10-31')$q$,
  'AC-TM-011 Finance can end an assignee window');
select is((select effective_to from contract_rate_assignees
            where project_id='15140000-0000-0000-0000-0000000000c1'
              and line_key='15140000-0000-0000-0000-0000000000e1'
              and user_id='15140000-0000-0000-0000-0000000000b6'),
  '2026-10-31'::date, 'AC-TM-011 ending an assignee window stores its final day');
reset role;
select ok(exists(
  select 1 from audit_events
   where action='contract_rate_assignee.end'
     and entity_id=(select id from contract_rate_assignees where project_id='15140000-0000-0000-0000-0000000000c1'
                     and line_key='15140000-0000-0000-0000-0000000000e1'
                     and user_id='15140000-0000-0000-0000-0000000000b6')
     and actor_id='15140000-0000-0000-0000-0000000000b1'
     and detail #>> '{before,effective_to}' = '2026-12-31'
     and detail #>> '{after,effective_to}' = '2026-10-31'),
  'AC-TM-011 ending an assignee window writes its before-and-after audit row');

set local role authenticated;
select throws_ok($q$select set_contract_rate_assignee(
  '15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e6',
  '15140000-0000-0000-0000-0000000000b6','2026-10-31',null)$q$,
  '23505', null, 'AC-TM-011 the assignee end day remains inclusive for overlap checks');
select lives_ok($q$insert into _state select 'next_assignment', jsonb_build_object('id', set_contract_rate_assignee(
  '15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e6',
  '15140000-0000-0000-0000-0000000000b6','2026-11-01',null))$q$,
  'AC-TM-011 a new assignee window can start the day after the old one ends');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b8","role":"authenticated"}';
select throws_ok($q$select end_contract_rate_assignee(
  '15140000-0000-0000-0000-0000000000c1',
  (select (v->>'id')::uuid from _state where k='next_assignment'),
  '2026-11-30')$q$,
  'P0002', null, 'AC-TM-011 an Admin from another organization cannot end an assignee window');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select end_contract_rate_assignee(
  '15140000-0000-0000-0000-0000000000c1',
  (select (v->>'id')::uuid from _state where k='next_assignment'),
  '2026-12-31')$q$,
  'AC-TM-011 an Admin can end an assignee window');
select is((select effective_to from contract_rate_assignees
            where id=(select (v->>'id')::uuid from _state where k='next_assignment')),
  '2026-12-31'::date, 'AC-TM-011 the Admin end date is recorded');

set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b9","role":"authenticated"}';
select ok(pg_temp.tm_rate_count(null, null) > 0, 'Executive can read contract rates');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select ok(pg_temp.tm_rate_count(null, null) > 0, 'Finance can read contract rates');

reset role;
select * from finish();
rollback;
