-- tm_assembly.test.sql — T2 of #1514, assembling a draft claim from approved timesheet hours.
-- Fixture F1: docs/plans/2026-11-02-time-and-materials-claims.md (copied from tm_rates.test.sql, then extended).
-- The withdraw RPC arrives in T3; here a withdrawal is simulated as the owner by flipping the claim and its
-- sources (the exact writes T3's withdraw performs), so the "offered again" rule is proven against the real index.
begin;
create extension if not exists pgtap;
select plan(61);

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


-- ── T2 fixture extension ────────────────────────────────────────────────────────────────────────
-- Finance 2 owns an Approved week with 4 h on p1 but is assigned to no rate line (unrated: no assignee).
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at, submitted_at) values
  ('15140000-0000-0000-0000-0000000000d7', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b2', '2026-10-05', 'Approved', '15140000-0000-0000-0000-0000000000b3', now(), now()),
  ('15140000-0000-0000-0000-0000000000d8', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-11-02', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d6', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b4', '2026-11-02', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now());
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-000000000e01', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d7', '15140000-0000-0000-0000-0000000000c1', '2026-10-05', 4),
  ('15140000-0000-0000-0000-000000000e02', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d8', '15140000-0000-0000-0000-0000000000c1', '2026-11-02', 5);
-- Project 2: three one-day labour lines for Engineer 1 (rounding case) and a rate that changes mid-claim for PM 1.
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d1', '15140000-0000-0000-0000-0000000000c2', '2026-10-05', 0.05),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d1', '15140000-0000-0000-0000-0000000000c2', '2026-10-06', 0.05),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d1', '15140000-0000-0000-0000-0000000000c2', '2026-10-07', 0.05),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d6', '15140000-0000-0000-0000-0000000000c2', '2026-11-02', 2),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d6', '15140000-0000-0000-0000-0000000000c2', '2026-11-03', 2),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d6', '15140000-0000-0000-0000-0000000000c2', '2026-11-04', 2),
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000d6', '15140000-0000-0000-0000-0000000000c2', '2026-11-05', 2);

create temp table _state (k text primary key, v text not null) on commit drop;
grant all on _state to authenticated;
-- Scalar probe that survives a missing relation/function, so the red run fails assertion by assertion.
create function pg_temp.sc(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  return r;
exception when undefined_table or undefined_function or undefined_column then return 'missing';
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then return sqlerrm;
end $$;
create function pg_temp.st(p_k text) returns text language sql as $$ select v from _state where k = p_k $$;
create function pg_temp.live(p_claim text) returns text language sql as $$
  select pg_temp.sc(format('select count(*) from public.tm_claim_sources where claim_id = %L and is_live', p_claim))
$$;

select has_table('public', 'tm_claims', 'AC-TM-003 claims table exists');
select has_table('public', 'tm_claim_lines', 'AC-TM-003 claim lines table exists');
select has_table('public', 'tm_claim_sources', 'AC-TM-003 claim sources table exists');

-- ── rate card for the claims (Finance sets it; PM and Engineer cannot) ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e1","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$, 'Fixture F1 Site engineer line (50,000.00/h)');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','15140000-0000-0000-0000-0000000000b6','2026-01-01','2026-12-31')$q$, 'Fixture F1 assigns Engineer 1');
-- Engineer 2 holds a different line whose rate ends 31 Oct: their Submitted and Rejected weeks would price if status were ignored,
-- and their Approved 2 Nov hours are assigned-but-unrated (no rate in force).
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e8","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Foreman","unit":"hour","rate":40000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-10-31"}')$q$, 'Foreman line ends 31 Oct');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e8','15140000-0000-0000-0000-0000000000b7','2026-01-01','2026-12-31')$q$, 'Engineer 2 is the Foreman');
-- Project 2: rounding lines A/B/C at 10.10 on three consecutive days, and a line whose rate changes on 4 Nov.
select lives_ok($q$select save_contract_rate_line(format('{"line_key":"15140000-0000-0000-0000-0000000000e%s","project_id":"15140000-0000-0000-0000-0000000000c2","kind":"labour","label":"Rounding %s","unit":"hour","rate":10.10,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}', k, k)::jsonb) from unnest(array['a','b','c']) k$q$, 'Rounding lines A, B and C');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c2', ('15140000-0000-0000-0000-0000000000e' || k)::uuid, '15140000-0000-0000-0000-0000000000b6', d::date, d::date) from (values ('a','2026-10-05'),('b','2026-10-06'),('c','2026-10-07')) v(k, d)$q$, 'Engineer 1 holds one line per day on project 2');
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e9","project_id":"15140000-0000-0000-0000-0000000000c2","kind":"labour","label":"Changing rate","unit":"hour","rate":100,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$, 'Changing-rate line v1');
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e9","expected_version":1,"project_id":"15140000-0000-0000-0000-0000000000c2","kind":"labour","label":"Changing rate","unit":"hour","rate":120,"currency":"IDR","effective_from":"2026-11-04","effective_to":"2026-12-31"}')$q$, 'Changing-rate line v2 from 4 Nov');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c2','15140000-0000-0000-0000-0000000000e9','15140000-0000-0000-0000-0000000000b4','2026-01-01','2026-12-31')$q$, 'PM 1 holds the changing-rate line on project 2');

-- ── AC-TM-001/002/005: the 120 h case ───────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'claim1', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-11-06',null,null)::text$q$,
  'AC-TM-001 the PM of the project assembles a claim for 5 Oct to 6 Nov');
select is(pg_temp.sc(format('select count(*) from tm_claim_lines where claim_id = %L', pg_temp.st('claim1'))), '1',
  'AC-TM-001 the 120 h case lists one line');
select is(pg_temp.sc(format('select units::text || '' x '' || rate::text || '' = '' || amount::text || '' '' || label from tm_claim_lines where claim_id = %L', pg_temp.st('claim1'))),
  '120.00 x 50000.00 = 6000000.00 Site engineer', 'AC-TM-001 the line is 120 h x 50,000.00 = 6,000,000.00, labelled and frozen');
select is(pg_temp.sc(format('select gross_amount::text || '' '' || currency || '' '' || status from tm_claims where id = %L', pg_temp.st('claim1'))),
  '6000000.00 IDR Draft', 'AC-TM-001 the Draft header carries the gross and the project currency');
select is(pg_temp.live(pg_temp.st('claim1')), '15', 'AC-TM-001 the 15 approved days are the claim sources');
select is(pg_temp.sc(format($f$select count(*) from tm_claim_sources s join timesheet_entries e on e.id = s.source_id
    where s.claim_id = %L and e.timesheet_id in ('15140000-0000-0000-0000-0000000000d4','15140000-0000-0000-0000-0000000000d5')$f$, pg_temp.st('claim1'))), '0',
  'AC-TM-002 Submitted and Rejected weeks are not offered');
select is(pg_temp.sc(format($f$select count(*) from tm_claim_sources s join timesheet_entries e on e.id = s.source_id
    where s.claim_id = %L and e.id in ('15140000-0000-0000-0000-000000000e01','15140000-0000-0000-0000-000000000e02')$f$, pg_temp.st('claim1'))), '0',
  'AC-TM-005 unrated hours are excluded from the claim sources');
reset role;
select is((select string_agg(unrated_reason, ',' order by unrated_reason) from tm_assignable_sources('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-11-06') where unrated_reason is not null),
  'no_assignee,no_rate', 'AC-TM-005 the unrated hours are listed with a reason (no assignee; assigned but no rate in force)');
select is((select sum(units) from tm_assignable_sources('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-11-06') where unrated_reason is not null),
  9.00, 'AC-TM-005 the unrated hours are 4 h + 5 h and stay out of the 6,000,000.00 total');

-- ── AC-TM-003: every source lives in at most one claim ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($q$select assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-11-06',null,null)$q$,
  'P0001', null, 'AC-TM-003 a second assembly finds every hour already in a live claim and writes nothing');
select is(pg_temp.sc('select count(*) from tm_claims'), '1', 'AC-TM-003 the refused assembly left no second claim');
-- Withdraw (T3 writes exactly this): the claim and its sources stop being live.
reset role;
update tm_claim_sources set is_live = false where claim_id = pg_temp.st('claim1')::uuid;
update tm_claims set status = 'Withdrawn' where id = pg_temp.st('claim1')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$insert into _state select 'claim2', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-16',null,null)::text$q$,
  'AC-TM-003 after the first claim is withdrawn its hours are offered again');
select is(pg_temp.sc(format('select units::text from tm_claim_lines where claim_id = %L', pg_temp.st('claim2'))), '80.00', 'AC-TM-003 the second claim takes the 80 h of 5 to 16 Oct');
select lives_ok($q$insert into _state select 'claim3', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-11-06',null,
    jsonb_build_array((select e.id from timesheet_entries e where e.timesheet_id = '15140000-0000-0000-0000-0000000000d3' and e.entry_date = '2026-10-23')))::text$q$,
  'AC-TM-003 a wider assembly with one hour deselected succeeds');
select is(pg_temp.sc(format('select units::text from tm_claim_lines where claim_id = %L', pg_temp.st('claim3'))), '32.00',
  'AC-TM-003 the wider assembly omits the 80 live hours and the deselected day (32 h left)');
select is(pg_temp.live(pg_temp.st('claim3')), '4', 'AC-TM-003 four days are sources of the wider claim');
reset role;
select throws_ok(format($q$insert into tm_claim_sources (org_id, claim_id, claim_line_id, source_kind, source_id, units)
    select s.org_id, %L::uuid, (select id from tm_claim_lines where claim_id = %L::uuid), s.source_kind, s.source_id, s.units
      from tm_claim_sources s where s.claim_id = %L::uuid limit 1$q$, pg_temp.st('claim3'), pg_temp.st('claim3'), pg_temp.st('claim2')),
  '23505', null, 'AC-TM-003 the unique live source refuses a second live claim even when the RPC is bypassed (concurrent case)');
select is((select count(*)::int from tm_assignable_sources('15140000-0000-0000-0000-0000000000c1','2026-10-23','2026-10-23') where unrated_reason is null), 1,
  'AC-TM-003 the deselected hour is still offered');

-- ── AC-TM-008: a live source holds its approved week ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($q$select transition_timesheet('15140000-0000-0000-0000-0000000000d3','Draft')$q$,
  '55000', null, 'AC-TM-008 reopen of an approved week in a live claim is refused');
select alike(pg_temp.err($q$select transition_timesheet('15140000-0000-0000-0000-0000000000d3','Draft')$q$), '%' || pg_temp.st('claim3') || '%',
  'AC-TM-008 the refusal names the claim');
select is((select status::text from timesheets where id = '15140000-0000-0000-0000-0000000000d3'), 'Approved', 'AC-TM-008 the refused reopen left the week Approved');
reset role;
update tm_claim_sources set is_live = false where claim_id = pg_temp.st('claim3')::uuid;
update tm_claims set status = 'Withdrawn' where id = pg_temp.st('claim3')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select lives_ok($q$select transition_timesheet('15140000-0000-0000-0000-0000000000d3','Draft')$q$,
  'AC-TM-008 after the claim is withdrawn the week reopens');
select is((select status::text from timesheets where id = '15140000-0000-0000-0000-0000000000d3'), 'Draft', 'AC-TM-008 the reopened week is Draft');

-- ── deselect on a Draft claim recomputes line and header; a withdrawn claim is closed ───────────
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($q$select deselect_tm_source(pg_temp.st('claim2')::uuid, (select min(id::text)::uuid from tm_claim_sources where claim_id = pg_temp.st('claim2')::uuid))$q$,
  'AC-TM-003 the preparer deselects one source of a Draft claim');
select is(pg_temp.sc(format('select units::text || '' '' || amount::text from tm_claim_lines where claim_id = %L', pg_temp.st('claim2'))), '72.00 3600000.00',
  'AC-TM-003 the line is recomputed from its remaining sources at the frozen rate');
select is(pg_temp.sc(format('select gross_amount::text from tm_claims where id = %L', pg_temp.st('claim2'))), '3600000.00', 'AC-TM-003 the header equals the lines');
select throws_ok($q$select deselect_tm_source(pg_temp.st('claim1')::uuid, gen_random_uuid())$q$,
  'P0001', null, 'AC-TM-003 a withdrawn claim cannot be changed');

-- ── AC-TM-013 / FR-TM-015: rounding once per line, frozen rate versions ─────────────────────────
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select lives_ok($q$insert into _state select 'round', assemble_tm_claim('15140000-0000-0000-0000-0000000000c2','2026-10-05','2026-10-07',null,null)::text$q$,
  'AC-TM-013 the PM of project 2 assembles the rounding case');
select is(pg_temp.sc(format('select string_agg(units::text || ''x'' || rate::text || ''='' || amount::text, '','') from tm_claim_lines where claim_id = %L', pg_temp.st('round'))),
  '0.05x10.10=0.51,0.05x10.10=0.51,0.05x10.10=0.51', 'AC-TM-013 each line (0.505) is rounded once, to 0.51');
select is(pg_temp.sc(format('select gross_amount::text from tm_claims where id = %L', pg_temp.st('round'))), '1.53',
  'AC-TM-013 the header equals the sum of the rounded lines (1.53, not the 1.52 of rounding the total)');
select lives_ok($q$insert into _state select 'versions', assemble_tm_claim('15140000-0000-0000-0000-0000000000c2','2026-11-02','2026-11-05',null,null)::text$q$,
  'FR-TM-015 a claim spanning a rate change assembles');
select is(pg_temp.sc(format('select string_agg(rate_version || '':'' || units || ''x'' || rate || ''='' || amount, '','' order by rate_version) from tm_claim_lines where claim_id = %L', pg_temp.st('versions'))),
  '1:4.00x100.00=400.00,2:4.00x120.00=480.00', 'FR-TM-015 two rate versions give two lines, each frozen at its own rate');
select is(pg_temp.sc(format('select gross_amount::text from tm_claims where id = %L', pg_temp.st('versions'))), '880.00', 'FR-TM-015 the header is 400.00 + 480.00');
reset role;
update contract_rate_lines set rate = 1 where line_key = '15140000-0000-0000-0000-0000000000e9';
select is(pg_temp.sc(format('select gross_amount::text from tm_claims where id = %L', pg_temp.st('versions'))), '880.00',
  'FR-TM-015 a later change to the rate card does not restate the claim');

-- ── access: who may assemble, who reads, no direct writes ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($q$select assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-16',null,null)$q$,
  '42501', null, 'AC-TM-011 an Engineer cannot assemble a claim');
select is(pg_temp.sc('select count(*) from tm_claims'), '0', 'AC-TM-011 an Engineer reads no claims');
select is(pg_temp.sc('select count(*) from tm_claim_lines'), '0', 'AC-TM-011 an Engineer reads no claim lines');
select is(pg_temp.sc('select count(*) from tm_claim_sources'), '0', 'AC-TM-011 an Engineer reads no claim sources');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($q$select assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-16',null,null)$q$,
  '42501', null, 'AC-TM-011 the PM of another project cannot assemble');
select is(pg_temp.sc('select count(*) from tm_claims'), '2', 'AC-TM-011 a PM reads only the claims of their own project');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b8","role":"authenticated"}';
select throws_ok($q$select assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-16',null,null)$q$,
  'P0002', null, 'AC-TM-011 another org cannot target the project');
select is(pg_temp.sc('select count(*) from tm_claims'), '0', 'AC-TM-011 another org reads no claims');
set local request.jwt.claims = '{"sub":"15140000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(pg_temp.sc('select count(*) from tm_claims'), '5', 'AC-TM-011 Finance reads every claim of the org');
select throws_ok($q$insert into tm_claims (org_id, project_id, period_from, period_to, currency, prepared_by)
  values ('15140000-0000-0000-0000-0000000000a1','15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-06','IDR','15140000-0000-0000-0000-0000000000b1')$q$,
  '42501', null, 'AC-TM-011 direct claim inserts are denied');
select throws_ok($q$update tm_claim_lines set units = 1$q$, '42501', null, 'AC-TM-011 direct line updates are denied');
select throws_ok($q$delete from tm_claim_sources$q$, '42501', null, 'AC-TM-011 direct source deletes are denied');
select throws_ok($q$select tm_assignable_sources('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-16')$q$,
  '42501', null, 'AC-TM-011 the assembly helper is not callable by clients');
reset role;
select ok(not has_function_privilege('anon', 'public.assemble_tm_claim(uuid,date,date,uuid,jsonb)', 'EXECUTE'), 'AC-TM-011 anon cannot call assemble_tm_claim');
select ok(not has_function_privilege('authenticated', 'public.tm_source_is_live(text,uuid)', 'EXECUTE'), 'AC-TM-011 clients cannot call the live-source helper');

select * from finish();
rollback;
