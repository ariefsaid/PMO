-- tm_reads.test.sql — T4 of #1514: the two reads (list_tm_claims, preview_tm_claim), the contract-billing payload proof and the
-- OAuth API-client tiers. Fixture F1: docs/plans/2026-11-02-time-and-materials-claims.md (copied from tm_signoff.test.sql, extended).
-- Ids: 15140000-… (synthetic). Users: b1 fin1, b2 fin2, b3 admin, b4 pm1 (project c1), b5 pm2 (c2), b6 eng1, b7 eng2, b8 foreign admin, ba exec.
begin;
create extension if not exists pgtap;
select plan(74);

-- ── Fixture F1 ──────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('15140000-0000-0000-0000-0000000000a1', 'TM Org A', 'IDR', 'UTC'),
  ('15140000-0000-0000-0000-0000000000a2', 'TM Org B', 'IDR', 'UTC'),
  ('15140000-0000-0000-0000-0000000000a3', 'TM Org C (one member)', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15140000-0000-0000-0000-0000000000b1', 'tm-fin1@example.com'),
  ('15140000-0000-0000-0000-0000000000b2', 'tm-fin2@example.com'),
  ('15140000-0000-0000-0000-0000000000b3', 'tm-admin@example.com'),
  ('15140000-0000-0000-0000-0000000000b4', 'tm-pm1@example.com'),
  ('15140000-0000-0000-0000-0000000000b5', 'tm-pm2@example.com'),
  ('15140000-0000-0000-0000-0000000000b6', 'tm-eng1@example.com'),
  ('15140000-0000-0000-0000-0000000000b7', 'tm-eng2@example.com'),
  ('15140000-0000-0000-0000-0000000000b8', 'tm-foreign-admin@example.com'),
  ('15140000-0000-0000-0000-0000000000b9', 'tm-sole@example.com'),
  ('15140000-0000-0000-0000-0000000000ba', 'tm-exec@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1', 'TM Finance 1', 'tm-fin1@example.com', 'Finance', 'active'),
  ('15140000-0000-0000-0000-0000000000b2', '15140000-0000-0000-0000-0000000000a1', 'TM Finance 2', 'tm-fin2@example.com', 'Finance', 'active'),
  ('15140000-0000-0000-0000-0000000000b3', '15140000-0000-0000-0000-0000000000a1', 'TM Admin', 'tm-admin@example.com', 'Admin', 'active'),
  ('15140000-0000-0000-0000-0000000000b4', '15140000-0000-0000-0000-0000000000a1', 'TM PM 1', 'tm-pm1@example.com', 'Project Manager', 'active'),
  ('15140000-0000-0000-0000-0000000000b5', '15140000-0000-0000-0000-0000000000a1', 'TM PM 2', 'tm-pm2@example.com', 'Project Manager', 'active'),
  ('15140000-0000-0000-0000-0000000000b6', '15140000-0000-0000-0000-0000000000a1', 'TM Engineer 1', 'tm-eng1@example.com', 'Engineer', 'active'),
  ('15140000-0000-0000-0000-0000000000b7', '15140000-0000-0000-0000-0000000000a1', 'TM Engineer 2', 'tm-eng2@example.com', 'Engineer', 'active'),
  ('15140000-0000-0000-0000-0000000000b8', '15140000-0000-0000-0000-0000000000a2', 'TM Foreign Admin', 'tm-foreign-admin@example.com', 'Admin', 'active'),
  ('15140000-0000-0000-0000-0000000000b9', '15140000-0000-0000-0000-0000000000a3', 'TM Sole Finance', 'tm-sole@example.com', 'Finance', 'active'),
  ('15140000-0000-0000-0000-0000000000ba', '15140000-0000-0000-0000-0000000000a1', 'TM Executive', 'tm-exec@example.com', 'Executive', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency, contract_value, tax_treatment, tax_amount) values
  ('15140000-0000-0000-0000-0000000000c1', '15140000-0000-0000-0000-0000000000a1', 'TM Project 1', 'Ongoing Project', '15140000-0000-0000-0000-0000000000b4', 'IDR', 5000000, 'exclusive', 0),
  ('15140000-0000-0000-0000-0000000000c2', '15140000-0000-0000-0000-0000000000a1', 'TM Project 2', 'Ongoing Project', '15140000-0000-0000-0000-0000000000b5', 'IDR', 1000000, 'exclusive', 0),
  ('15140000-0000-0000-0000-0000000000c3', '15140000-0000-0000-0000-0000000000a3', 'TM Project 3', 'Ongoing Project', null, 'IDR', 1000000, 'exclusive', 0),
  ('15140000-0000-0000-0000-0000000000cb', '15140000-0000-0000-0000-0000000000a2', 'TM Foreign Project', 'Ongoing Project', null, 'IDR', 1000000, 'exclusive', 0);
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at, submitted_at) values
  ('15140000-0000-0000-0000-0000000000d1', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-05', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d2', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-12', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d3', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-10-19', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000d4', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-10-05', 'Submitted', null, null, now()),
  ('15140000-0000-0000-0000-0000000000d5', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-10-12', 'Rejected', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b6', '2026-11-02', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now()),
  ('15140000-0000-0000-0000-0000000000db', '15140000-0000-0000-0000-0000000000a3', '15140000-0000-0000-0000-0000000000b9', '2026-10-05', 'Approved', '15140000-0000-0000-0000-0000000000b9', now(), now());
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
-- Week of 2 Nov: four days, assembled in different claims below.
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-000000000e10', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-03', 8),
  ('15140000-0000-0000-0000-000000000e11', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-04', 8),
  ('15140000-0000-0000-0000-000000000e12', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-05', 8),
  ('15140000-0000-0000-0000-000000000e13', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000da', '15140000-0000-0000-0000-0000000000c1', '2026-11-06', 8);
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-0000000000a3', '15140000-0000-0000-0000-0000000000db', '15140000-0000-0000-0000-0000000000c3', '2026-10-05', 10);
insert into project_documents (id, org_id, project_id, category, title, status, author_id, file_path) values
  ('15140000-0000-0000-0000-0000000000f1', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM signed document', 'Approved', '15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1/15140000-0000-0000-0000-0000000000c1/15140000-0000-0000-0000-0000000000f1/tm-signed.pdf'),
  ('15140000-0000-0000-0000-0000000000f2', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM document without file', 'Approved', '15140000-0000-0000-0000-0000000000b1', null),
  ('15140000-0000-0000-0000-0000000000f6', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'Contract', 'TM draft document', 'Draft', '15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1/15140000-0000-0000-0000-0000000000c1/15140000-0000-0000-0000-0000000000f6/tm-draft.pdf'),
  ('15140000-0000-0000-0000-0000000000f7', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c2', 'Contract', 'Other project document', 'Approved', '15140000-0000-0000-0000-0000000000b1', '15140000-0000-0000-0000-0000000000a1/15140000-0000-0000-0000-0000000000c2/15140000-0000-0000-0000-0000000000f7/other.pdf'),
  ('15140000-0000-0000-0000-0000000000f8', '15140000-0000-0000-0000-0000000000a3', '15140000-0000-0000-0000-0000000000c3', 'Contract', 'Sole org signed document', 'Approved', '15140000-0000-0000-0000-0000000000b9', '15140000-0000-0000-0000-0000000000a3/15140000-0000-0000-0000-0000000000c3/15140000-0000-0000-0000-0000000000f8/tm-signed.pdf');
-- Work orders on project 1: f3 is worth less than the 120 h claim, f4 more.
insert into work_orders (id, org_id, project_id, title, status, wo_number, order_value, tax_treatment, tax_amount, currency) values
  ('15140000-0000-0000-0000-0000000000f3', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'TM WO small', 'Issued', 'WO-TM-3', 5000000, 'exclusive', 0, 'IDR'),
  ('15140000-0000-0000-0000-0000000000f4', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'TM WO large', 'Issued', 'WO-TM-4', 10000000, 'exclusive', 0, 'IDR');
-- Another organisation's own rate card: a foreign-org API client must read this row and never Org A's (read tier, #1514 T4).
insert into contract_rate_lines (id, org_id, project_id, line_key, version, kind, label, unit, rate, effective_from, created_by) values
  ('15140000-0000-0000-0000-0000000000e6', '15140000-0000-0000-0000-0000000000a2', '15140000-0000-0000-0000-0000000000cb',
   '15140000-0000-0000-0000-0000000000e7', 1, 'labour', 'Foreign site engineer', 'hour', 60000, '2026-01-01', '15140000-0000-0000-0000-0000000000b8');
insert into contract_rate_assignees (id, org_id, project_id, line_key, user_id, effective_from, created_by) values
  ('15140000-0000-0000-0000-0000000000e8', '15140000-0000-0000-0000-0000000000a2', '15140000-0000-0000-0000-0000000000cb',
   '15140000-0000-0000-0000-0000000000e7', '15140000-0000-0000-0000-0000000000b8', '2026-01-01', '15140000-0000-0000-0000-0000000000b8');

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
create function pg_temp.status(p_claim text) returns text language sql as $$
  select pg_temp.sc(format('select status from public.tm_claims where id = %L', p_claim))
$$;

-- Engineer 2 (no rate assignment) has an Approved week on project 1: those hours are unrated in the preview.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at, submitted_at) values
  ('15140000-0000-0000-0000-0000000000dc', '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000b7', '2026-10-26', 'Approved', '15140000-0000-0000-0000-0000000000b1', now(), now());
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000dc', '15140000-0000-0000-0000-0000000000c1', '2026-10-27', 4);

create function pg_temp.req(p_sub text, p_path text, p_method text default 'POST') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'client_id', 'pmo-cli')::text, true),
         set_config('request.method', p_method, true), set_config('request.path', p_path, true), set_config('request.headers', '{}', true);
$$;
create function pg_temp.as_user(p_sub text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
$$;

-- ── rate card ───────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b1');
select lives_ok($q$select save_contract_rate_line('{"line_key":"15140000-0000-0000-0000-0000000000e1","project_id":"15140000-0000-0000-0000-0000000000c1","kind":"labour","label":"Site engineer","unit":"hour","rate":50000,"currency":"IDR","effective_from":"2026-01-01","effective_to":"2026-12-31"}')$q$, 'Fixture F1 Site engineer line (50,000.00/h)');
select lives_ok($q$select set_contract_rate_assignee('15140000-0000-0000-0000-0000000000c1','15140000-0000-0000-0000-0000000000e1','15140000-0000-0000-0000-0000000000b6','2026-01-01','2026-12-31')$q$, 'Fixture F1 assigns Engineer 1');

-- ── AC-TM-011 (reads): preview_tm_claim ─────────────────────────────────────────────────────
-- 120 h of Engineer 1 are priced (6,000,000.00); Engineer 2's 4 h have no assignee and come back unrated, never priced by guess.
select is(pg_temp.sc($q$select count(*) from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30')$q$), '2',
  'AC-TM-011 Finance previews one priced group and one unrated group');
select is(pg_temp.sc($q$select units::text || ' x ' || rate::text || ' = ' || amount::text || ' ' || label || ' v' || rate_version::text
  from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30') where unrated_reason is null$q$),
  '120.00 x 50000.00 = 6000000.00 Site engineer v1', 'AC-TM-011 the priced group carries units, rate, amount, label and rate version');
select is(pg_temp.sc($q$select unrated_reason || ' ' || units::text || ' ' || coalesce(amount::text, 'no amount')
  from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30') where unrated_reason is not null$q$),
  'no_assignee 4.00 no amount', 'AC-TM-011 the unrated group names the reason and has no amount');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b3');
select is(pg_temp.sc($q$select count(*) from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30')$q$), '2', 'AC-TM-011 Admin previews');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000ba');
select is(pg_temp.sc($q$select count(*) from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30')$q$), '2', 'AC-TM-011 Executive previews');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b4');
select is(pg_temp.sc($q$select count(*) from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30')$q$), '2', 'AC-TM-011 the Project Manager of the project previews');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b5');
select throws_ok($q$select * from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30')$q$, '42501', null,
  'AC-TM-011 the Project Manager of another project cannot preview');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b6');
select throws_ok($q$select * from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30')$q$, '42501', null,
  'AC-TM-011 an Engineer cannot preview');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b8');
select throws_ok($q$select * from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-30')$q$, 'P0002', null,
  'AC-TM-011 another organisation''s admin cannot target this organisation''s project');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b1');
select throws_ok($q$select * from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-30','2026-10-05')$q$, '22023', null,
  'AC-TM-011 a reversed date range is refused');
select is(pg_temp.sc($q$select count(*) from tm_claims$q$), '0', 'AC-TM-011 previewing writes nothing');

-- ── a signed-off claim and a draft claim ────────────────────────────────────────────────────
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b4');
select lives_ok($q$insert into _state select 'claimA', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-10-23',null,null)::text$q$, 'the PM assembles the 120 h claim');
select lives_ok($q$select prepare_tm_signoff(pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000f1', 'client signed the hours 23 Oct')$q$, 'the PM prepares the sign-off');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b2');
select lives_ok($q$select confirm_tm_signoff(pg_temp.st('claimA')::uuid)$q$, 'a second Finance user confirms');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b4');
select lives_ok($q$insert into _state select 'claimB', assemble_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-11-03','2026-11-06',null,null)::text$q$, 'the PM assembles a second, Draft claim (32 h)');
select is(pg_temp.sc($q$select count(*) from preview_tm_claim('15140000-0000-0000-0000-0000000000c1','2026-10-05','2026-11-30') where unrated_reason is null$q$), '0',
  'AC-TM-011 hours already in a live claim are not previewed again');

-- ── AC-TM-011 (reads): list_tm_claims ───────────────────────────────────────────────────────
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b1');
select is(pg_temp.sc($q$select count(*) from list_tm_claims('15140000-0000-0000-0000-0000000000c1')$q$), '2', 'AC-TM-011 Finance lists both claims');
select is(pg_temp.sc(format($q$select status || ' ' || gross_amount::text || ' ' || (confirmed_by is not null)::text || ' ' || jsonb_array_length(lines)::text
  from list_tm_claims('15140000-0000-0000-0000-0000000000c1') where id = %L$q$, pg_temp.st('claimA'))), 'SignedOff 6000000.00 true 1',
  'AC-TM-011 the signed-off claim lists its status, gross, confirmer and line count');
select is(pg_temp.sc(format($q$select (lines -> 0 ->> 'units') || ' x ' || (lines -> 0 ->> 'rate') || ' = ' || (lines -> 0 ->> 'amount') || ' ' || (lines -> 0 ->> 'label')
  from list_tm_claims('15140000-0000-0000-0000-0000000000c1') where id = %L$q$, pg_temp.st('claimA'))), '120.00 x 50000.00 = 6000000.00 Site engineer',
  'AC-TM-011 each line carries units, rate, amount and label');
select is(pg_temp.sc(format($q$select status || ' ' || gross_amount::text from list_tm_claims('15140000-0000-0000-0000-0000000000c1') where id = %L$q$, pg_temp.st('claimB'))), 'Draft 1600000.00',
  'AC-TM-011 the Draft claim lists with its gross');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b3');
select is(pg_temp.sc($q$select count(*) from list_tm_claims('15140000-0000-0000-0000-0000000000c1')$q$), '2', 'AC-TM-011 Admin lists');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000ba');
select is(pg_temp.sc($q$select count(*) from list_tm_claims('15140000-0000-0000-0000-0000000000c1')$q$), '2', 'AC-TM-011 Executive lists');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b4');
select is(pg_temp.sc($q$select count(*) from list_tm_claims('15140000-0000-0000-0000-0000000000c1')$q$), '2', 'AC-TM-011 the Project Manager of the project lists');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b5');
select throws_ok($q$select * from list_tm_claims('15140000-0000-0000-0000-0000000000c1')$q$, '42501', null, 'AC-TM-011 the Project Manager of another project cannot list');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b6');
select throws_ok($q$select * from list_tm_claims('15140000-0000-0000-0000-0000000000c1')$q$, '42501', null, 'AC-TM-011 an Engineer cannot list');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b8');
select throws_ok($q$select * from list_tm_claims('15140000-0000-0000-0000-0000000000c1')$q$, 'P0002', null, 'AC-TM-011 another organisation''s admin cannot list this organisation''s project');
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b1');
select is(pg_temp.sc($q$select count(*) from list_tm_claims('15140000-0000-0000-0000-0000000000c2')$q$), '0', 'AC-TM-011 a project with no claims lists nothing');

-- ── AC-TM-009 (payload): the T&M invoice is in the existing contract-billing payload ────────
reset role;
set local request.jwt.claims = '{}';
insert into sales_invoices (id, org_id, project_id, si_number, invoice_date, amount, erp_outstanding_amount, tax_treatment, tax_amount, currency, status, erp_docstatus) values
  (pg_temp.st('claimA')::uuid, '15140000-0000-0000-0000-0000000000a1', '15140000-0000-0000-0000-0000000000c1', 'SI-TM-A', '2026-10-30', 6000000, 6000000, 'exclusive', 0, 'IDR', 'Unpaid', 1);
set local role authenticated;
select pg_temp.as_user('15140000-0000-0000-0000-0000000000b1');
select is((select billing_kind from sales_invoices where id = pg_temp.st('claimA')::uuid), 'contract', 'AC-TM-009 the T&M invoice is contract billing');
select is((get_project_finances('15140000-0000-0000-0000-0000000000c1') ->> 'contract_invoiced')::numeric, 6000000::numeric,
  'AC-TM-009 get_project_finances carries the T&M invoice in contract billing');
select is((get_project_finances('15140000-0000-0000-0000-0000000000c1') -> 'contract_excess' ->> 'amount')::numeric, 1000000::numeric,
  'AC-TM-009 a total above the 5,000,000.00 contract value shows the excess');
select is(get_project_finances('15140000-0000-0000-0000-0000000000c1') -> 'contract_excess' -> 'contributors' -> 0 ->> 'invoice_id', pg_temp.st('claimA'),
  'AC-TM-009 and lists the T&M invoice as the contributor');

-- ── grants ──────────────────────────────────────────────────────────────────────────────────
select ok(has_function_privilege('authenticated', 'public.list_tm_claims(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.preview_tm_claim(uuid, date, date)', 'EXECUTE'),
  'AC-TM-011 signed-in users can call both reads');
select ok(not has_function_privilege('anon', 'public.list_tm_claims(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.preview_tm_claim(uuid, date, date)', 'EXECUTE'),
  'AC-TM-011 anon cannot');

-- ── AC-TM-011 (API tiers): api_client_request_guard ─────────────────────────────────────────
-- Finance and Admin clients: the rate and sign-off writers plus the reads. Executive and Project Manager clients: reads only.
-- Engineer clients: nothing. Sub ids: b1 Finance, b3 Admin, ba Executive, b4 PM, b6 Engineer.
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/save_contract_rate_line');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may save a rate');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/end_contract_rate_line');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may end a rate');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/set_contract_rate_assignee');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may assign a rate');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/end_contract_rate_assignee');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may end an assignment');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/assemble_tm_claim');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may assemble a claim');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/deselect_tm_source');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may deselect a source');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/prepare_tm_signoff');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may prepare a sign-off');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/withdraw_tm_signoff');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may withdraw a sign-off');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/confirm_tm_signoff');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may confirm a sign-off');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/list_tm_claims');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may list claims');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/preview_tm_claim');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may preview a claim');
select pg_temp.req('15140000-0000-0000-0000-0000000000b3', '/rpc/confirm_tm_signoff');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 an Admin API client may confirm a sign-off');
select pg_temp.req('15140000-0000-0000-0000-0000000000b3', '/rpc/save_contract_rate_line');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 an Admin API client may save a rate');
select pg_temp.req('15140000-0000-0000-0000-0000000000ba', '/rpc/list_tm_claims');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 an Executive API client may list claims');
select pg_temp.req('15140000-0000-0000-0000-0000000000b4', '/rpc/preview_tm_claim');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Project Manager API client may preview a claim');
select pg_temp.req('15140000-0000-0000-0000-0000000000ba', '/rpc/confirm_tm_signoff');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 an Executive API client may not confirm a sign-off');
select pg_temp.req('15140000-0000-0000-0000-0000000000b4', '/rpc/save_contract_rate_line');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 a Project Manager API client may not save a rate');
select pg_temp.req('15140000-0000-0000-0000-0000000000b4', '/rpc/assemble_tm_claim');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 a Project Manager API client may not assemble a claim');
select pg_temp.req('15140000-0000-0000-0000-0000000000b6', '/rpc/save_contract_rate_line');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 an Engineer API client may not save a rate');
select pg_temp.req('15140000-0000-0000-0000-0000000000b6', '/rpc/confirm_tm_signoff');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 an Engineer API client may not confirm a sign-off');
select pg_temp.req('15140000-0000-0000-0000-0000000000b6', '/rpc/assemble_tm_claim');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 an Engineer API client may not assemble a claim');
select pg_temp.req('15140000-0000-0000-0000-0000000000b6', '/rpc/list_tm_claims');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 an Engineer API client may not list claims');
select pg_temp.req('15140000-0000-0000-0000-0000000000b6', '/rpc/preview_tm_claim');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 an Engineer API client may not preview a claim');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/rpc/list_equipment_costing');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 an earlier tier (equipment reads) is unchanged');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/tm_claims', 'GET');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 the claim tables are not exposed to API clients directly');

-- ── AC-TM-011 (rate-card read tier): contract_rate_lines / contract_rate_assignees ──────────
-- The rate card is a read the CLI needs, so both tables join the operator read tier. The guard widens *reach*;
-- RLS still narrows the rows to the client's own organisation and its projects (the guard is not the tenancy rule).
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/contract_rate_lines', 'GET');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may read the rate card');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/contract_rate_assignees', 'GET');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 a Finance API client may read rate assignments');
select is(pg_temp.sc('select count(*) from public.contract_rate_lines'), '1',
  'AC-TM-011 the Finance client reads its own organisation''s rate lines only');
select is(pg_temp.sc('select count(*) from public.contract_rate_assignees'), '1',
  'AC-TM-011 the Finance client reads its own organisation''s assignments only');
select pg_temp.req('15140000-0000-0000-0000-0000000000b3', '/contract_rate_lines', 'GET');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 an Admin API client may read the rate card');
select pg_temp.req('15140000-0000-0000-0000-0000000000b3', '/contract_rate_assignees', 'GET');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 an Admin API client may read rate assignments');
select pg_temp.req('15140000-0000-0000-0000-0000000000b6', '/contract_rate_lines', 'GET');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 an Engineer API client is refused the rate card');
select is(pg_temp.sc('select count(*) from public.contract_rate_lines'), '0',
  'AC-TM-011 and RLS hides every rate line from an Engineer');
select is(pg_temp.sc('select count(*) from public.contract_rate_assignees'), '0',
  'AC-TM-011 RLS hides every assignment from an Engineer');
select pg_temp.req('15140000-0000-0000-0000-0000000000b8', '/contract_rate_lines', 'GET');
select lives_ok('select public.api_client_request_guard()', 'AC-TM-011 another organisation''s Admin API client may read its own rate card');
select is(pg_temp.sc($q$select count(*)::text || ' own / ' || (count(*) filter (where org_id = '15140000-0000-0000-0000-0000000000a1'))::text || ' foreign'
  from public.contract_rate_lines$q$), '1 own / 0 foreign',
  'AC-TM-011 the foreign-org client sees its own rate line and none of this organisation''s');
select is(pg_temp.sc($q$select count(*)::text || ' own / ' || (count(*) filter (where org_id = '15140000-0000-0000-0000-0000000000a1'))::text || ' foreign'
  from public.contract_rate_assignees$q$), '1 own / 0 foreign',
  'AC-TM-011 the foreign-org client sees its own assignment and none of this organisation''s');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/tm_claim_lines', 'GET');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 a table outside the read tier is still refused');
select pg_temp.req('15140000-0000-0000-0000-0000000000b1', '/contract_rate_lines', 'POST');
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-TM-011 the rate card stays read-only for API clients');

select * from finish();
rollback;
