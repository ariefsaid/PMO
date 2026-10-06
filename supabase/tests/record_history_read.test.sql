-- record_history_read.test.sql — #719 record change history, the read API list_record_history (spec D3, Q5, Q7).
-- AC-CHG-020: own + child events newest first, kind filter, seq-cursor paging, RLS-scoped (a caller who cannot
-- read the record gets none of its events).
-- AC-CHG-021: the read-side union with audit_events — an Admin gets the record's non-covered audit lines, each
-- exactly once across pages; covered field-change actions and deletes never appear; a non-Admin gets none,
-- because audit_events is read under its own RLS.
-- Migration under test: 0260_record_change_history.sql.
-- Cast (org A): a1 Admin · a4 PM · a6 PM (disabled); b1 Admin of org B.
-- Fixture events are written directly by the owner with fixed times (so paging windows are exact);
-- trigger-generated fixture events are cleared first. Times below are HHMM UTC on 2026-10-01.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A'),
  ('07190000-0000-0000-0000-000000000002', 'CHG Org B');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a1', 'chg-admin@example.com'),
  ('07190000-0000-0000-0000-0000000000a4', 'chg-pm@example.com'),
  ('07190000-0000-0000-0000-0000000000a6', 'chg-off@example.com'),
  ('07190000-0000-0000-0000-0000000000b1', 'chg-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a1', '07190000-0000-0000-0000-000000000001', 'CHG Admin', 'chg-admin@example.com', 'Admin', 'active'),
  ('07190000-0000-0000-0000-0000000000a4', '07190000-0000-0000-0000-000000000001', 'CHG PM', 'chg-pm@example.com', 'Project Manager', 'active'),
  ('07190000-0000-0000-0000-0000000000a6', '07190000-0000-0000-0000-000000000001', 'CHG Off', 'chg-off@example.com', 'Project Manager', 'disabled'),
  ('07190000-0000-0000-0000-0000000000b1', '07190000-0000-0000-0000-000000000002', 'CHG XOrg', 'chg-xorg@example.com', 'Admin', 'active');
insert into projects (id, org_id, code, name, status) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Alpha', 'Ongoing Project');
insert into tasks (id, org_id, project_id, name, status) values
  ('07190000-0000-0000-0000-0000000000d1', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000c1', 'Survey', 'To Do');
delete from record_changes where org_id = '07190000-0000-0000-0000-000000000001';

insert into record_changes (org_id, entity_type, entity_id, parent_type, parent_id, op, actor_id, changes, created_at)
select '07190000-0000-0000-0000-000000000001', v.et, v.eid::uuid, v.pt, v.pid::uuid, 'update',
       '07190000-0000-0000-0000-0000000000a4', jsonb_build_object('name', jsonb_build_object('old', v.t, 'new', v.t || 'x')),
       ('2026-10-01 ' || v.t || '+00')::timestamptz
  from (values
    ('project', '07190000-0000-0000-0000-0000000000c1', null, null, '10:00'),
    ('task',    '07190000-0000-0000-0000-0000000000d1', 'project', '07190000-0000-0000-0000-0000000000c1', '10:10'),
    ('project', '07190000-0000-0000-0000-0000000000c1', null, null, '10:20'),
    ('task',    '07190000-0000-0000-0000-0000000000d1', 'project', '07190000-0000-0000-0000-0000000000c1', '10:30'),
    ('project', '07190000-0000-0000-0000-0000000000c1', null, null, '10:40')) v(et, eid, pt, pid, t)
 order by v.t;   -- seq follows time here

insert into audit_events (org_id, actor_id, action, entity_id, detail, created_at) values
  ('07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000a1', 'project_document.create',    '07190000-0000-0000-0000-0000000000c1', '{}', '2026-10-01 10:05+00'),
  ('07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000a1', 'project.contract_value.set', '07190000-0000-0000-0000-0000000000c1', '{}', '2026-10-01 10:15+00'),
  ('07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000a1', 'integration.trap_recovery',  '07190000-0000-0000-0000-0000000000d1', '{}', '2026-10-01 10:25+00'),
  ('07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000a1', 'release_outbox_hold',        '07190000-0000-0000-0000-0000000000c1', '{}', '2026-10-01 10:35+00'),
  ('07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000a1', 'project.delete',             '07190000-0000-0000-0000-0000000000c1', '{}', '2026-10-01 10:45+00');

-- one line per returned row, in the function's own order: <source initial><HHMM>
create function pg_temp.chg_line(p_children boolean, p_types text[] default null, p_before_seq bigint default null,
                                 p_before_at timestamptz default null, p_limit int default 50)
returns text language sql as $$
  select coalesce(string_agg(left(x.source, 1) || to_char(x.created_at at time zone 'UTC', 'HH24MI'), ',' order by x.ordinality), '')
    from public.list_record_history('project', '07190000-0000-0000-0000-0000000000c1', p_children, p_types,
                                    p_before_seq, p_before_at, p_limit) with ordinality as x
$$;
grant execute on function pg_temp.chg_line(boolean, text[], bigint, timestamptz, int) to authenticated;
create temp table chg_seq on commit drop as
  select to_char(created_at at time zone 'UTC', 'HH24MI') as t, seq from record_changes
   where org_id = '07190000-0000-0000-0000-000000000001';
grant select on chg_seq to authenticated;

-- ── Admin ───────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(pg_temp.chg_line(false), 'c1040,a1035,c1020,a1005,c1000',
  'AC-CHG-020 the record''s own events, newest first, with its non-covered audit lines interleaved (AC-CHG-021)');
select is(pg_temp.chg_line(true), 'c1040,a1035,c1030,c1020,c1010,a1005,c1000',
  'AC-CHG-020 with children: the task''s events roll up into the project''s history');
select is(pg_temp.chg_line(true, array['task']), 'c1030,c1010',
  'AC-CHG-020 the kind filter narrows to child tasks (and drops the project''s own audit lines)');
select is(
  (select count(*)::int from list_record_history('project', '07190000-0000-0000-0000-0000000000c1', true)
    where action in ('project.contract_value.set', 'project.delete', 'integration.trap_recovery')),
  0, 'AC-CHG-021 covered field-change actions, deletes and other records'' audit lines never appear');
select is(
  (select string_agg(coalesce(x.entity_type, '?') || '/' || coalesce(x.seq::text, 'null') || '/' || coalesce(x.action, '-'), ',' order by x.created_at)
     from list_record_history('project', '07190000-0000-0000-0000-0000000000c1') x where x.source = 'audit'),
  'project/null/project_document.create,project/null/release_outbox_hold',
  'AC-CHG-021 audit lines carry the record''s entity type, no seq, and their action');

-- paging, limit 2, with children: each audit line lands on exactly one page
select is(pg_temp.chg_line(true, null, null, null, 2), 'c1040,a1035,c1030',
  'AC-CHG-020 page 1 of 2-per-page: two change rows and the audit line inside their window');
select is(pg_temp.chg_line(true, null, (select seq from chg_seq where t = '1030'), '2026-10-01 10:30+00', 2), 'c1020,c1010',
  'AC-CHG-020 page 2 by seq cursor: the next two change rows; the covered 10:15 line stays out');
select is(pg_temp.chg_line(true, null, (select seq from chg_seq where t = '1010'), '2026-10-01 10:10+00', 2), 'a1005,c1000',
  'AC-CHG-021 last page: the remaining change row and every older audit line, none repeated');
select is(pg_temp.chg_line(true, null, (select seq from chg_seq where t = '1000'), '2026-10-01 10:00+00', 2), '',
  'AC-CHG-020 past the oldest event the page is empty');
select is(pg_temp.chg_line(false, null, null, null, 0), 'c1040',
  'AC-CHG-020 p_limit is clamped to at least 1');

-- ── non-Admin: no audit lines (audit_events RLS), same change rows ──────────────────────────────
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(pg_temp.chg_line(true), 'c1040,c1030,c1020,c1010,c1000',
  'AC-CHG-021 a PM gets the change rows and no audit line');
select is(pg_temp.chg_line(true, null, null, null, 2), 'c1040,c1030',
  'AC-CHG-021 a PM''s paged view has no audit line either');

-- ── negatives: cross-org and deactivated ────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(pg_temp.chg_line(true), '',
  'AC-CHG-020 an org-B Admin gets nothing for an org-A project, audit lines included');
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select is(pg_temp.chg_line(true), '',
  'AC-CHG-020 a deactivated member gets nothing');
reset role;
set local request.jwt.claims = '';

select * from finish();
rollback;
