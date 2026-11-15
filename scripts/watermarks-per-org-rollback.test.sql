-- Migration 0867 down/up round trip (issue #2255). The harness expands the actual shipped migration
-- files: the rollback collapses the per-organization dispatch cursors to the earliest one per
-- source, is safe to run twice, and re-applying the migration restores the per-organization shape.
-- Everything runs inside ONE transaction that rolls back at the end, so the database is left
-- exactly as the test found it.
begin;
create extension if not exists pgtap;
select plan(16);

-- Fixture: the cursor table is dispatcher bookkeeping (service_role-only, deny-default RLS). Clear
-- it inside this transaction — the final rollback undoes this — then seed two organizations with
-- different cursors for one source plus a third organization with no cursor row at all.
delete from agent_dispatch_watermarks;
insert into organizations (id, name) values
  ('0867c000-0000-0000-0000-000000000001', 'Rollback Org A (earliest cursor)'),
  ('0867c000-0000-0000-0000-000000000002', 'Rollback Org B (later cursor)'),
  ('0867c000-0000-0000-0000-000000000003', 'Rollback Org C (no cursor)');
insert into agent_dispatch_watermarks (source, org_id, last_seen_id, last_seen_at, updated_at) values
  ('procurement_status_events', '0867c000-0000-0000-0000-000000000001',
   '0867c000-0000-0000-0000-0000000000a1', '2026-07-06T08:00:00Z', '2026-07-06T08:00:01Z'),
  ('procurement_status_events', '0867c000-0000-0000-0000-000000000002',
   '0867c000-0000-0000-0000-0000000000b1', '2026-07-06T09:00:00Z', '2026-07-06T09:00:01Z');

-- Run the shipped migration files inside probes so a failure is ASSERTED (with its SQLSTATE shown
-- in the diagnostic) instead of aborting the whole file silently.
create function pg_temp.exec_down() returns text language plpgsql as $probe$
begin
  execute $down$
-- @0867_DOWN@
$down$;
  return 'ok';
exception when others then return sqlstate || ':' || sqlerrm;
end $probe$;

create function pg_temp.exec_up() returns text language plpgsql as $probe$
begin
  execute $up$
-- @0867_UP@
$up$;
  return 'ok';
exception when others then return sqlstate || ':' || sqlerrm;
end $probe$;

-- ── Run the rollback once: the per-organization rows collapse to the earliest cursor ───────────

select is(pg_temp.exec_down(), 'ok',
  'AC-2255 reversibility: the down migration runs');

select is((select count(*)::int from agent_dispatch_watermarks), 1,
  'the collapse leaves one cursor row per source');
select is((select last_seen_id::text from agent_dispatch_watermarks),
  '0867c000-0000-0000-0000-0000000000a1',
  'the surviving cursor is the EARLIEST organization cursor (org A, not the later org B)');
select is((select last_seen_at from agent_dispatch_watermarks), '2026-07-06T08:00:00Z'::timestamptz,
  'the surviving cursor carries the earliest organization''s last_seen_at');

select is(
  (select string_agg(a.attname, ',' order by a.attnum)
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'agent_dispatch_watermarks'::regclass and i.indisprimary),
  'source',
  'the primary key is (source) again');
select ok(not exists (select 1 from information_schema.columns
                       where table_schema = 'public'
                         and table_name = 'agent_dispatch_watermarks'
                         and column_name = 'org_id'),
  'the organization column is gone');

-- ── Run the rollback a second time: idempotent, no error ────────────────────────────────────────

select is(pg_temp.exec_down(), 'ok',
  'running the down migration a second time is not an error');
select is((select count(*)::int from agent_dispatch_watermarks), 1,
  'the second run leaves the collapsed state untouched');
select is((select last_seen_id::text from agent_dispatch_watermarks),
  '0867c000-0000-0000-0000-0000000000a1',
  'the second run keeps the earliest cursor');

-- ── Re-apply the up migration: the per-organization shape is restored ──────────────────────────

select is(pg_temp.exec_up(), 'ok',
  'the up migration re-applies cleanly after the rollback');

select is(
  (select string_agg(a.attname, ',' order by a.attnum)
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'agent_dispatch_watermarks'::regclass and i.indisprimary),
  'source,org_id',
  'the per-organization primary key (source, org_id) is restored');
select ok(
  (select attnotnull from pg_attribute
    where attrelid = 'agent_dispatch_watermarks'::regclass and attname = 'org_id'),
  'org_id is not null again');
select is(
  (select confdeltype from pg_constraint
    where conrelid = 'agent_dispatch_watermarks'::regclass and contype = 'f'
      and confrelid = 'organizations'::regclass),
  'c',
  'org_id references organizations(id) on delete cascade again');

select is((select count(*)::int from agent_dispatch_watermarks),
  (select count(*)::int from organizations),
  're-applying the up migration leaves one cursor row per organization');
select is((select count(*)::int from agent_dispatch_watermarks
            where org_id = '0867c000-0000-0000-0000-000000000003'), 1,
  'the organization that had no cursor row inherited a cursor in the backfill too');
select is((select last_seen_id::text from agent_dispatch_watermarks
            where org_id = '0867c000-0000-0000-0000-000000000003'),
  '0867c000-0000-0000-0000-0000000000a1',
  'the inherited cursor is the collapsed earliest one');

select * from finish();
rollback;
