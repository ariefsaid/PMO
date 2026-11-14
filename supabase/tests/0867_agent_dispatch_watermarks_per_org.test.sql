-- 0867_agent_dispatch_watermarks_per_org.test.sql — one dispatch cursor per (source, organization).
--
-- agent_dispatch_watermarks now carries a cursor per organization for each event source (issue 2255,
-- ADR-0101 shared-resource fairness): the (source, org_id) primary key holds one row per
-- organization, org_id cascades on organization delete, and every organization inherited the cursor
-- the source had at migration time. Grants and RLS are unchanged: anon/authenticated keep SELECT
-- only (0075; write verbs revoked 0105/0194) and the table stays RLS enabled + forced with no
-- policy — service_role only in practice (0109 proves the deny-default oracle).
--
-- Fixture namespace: 08670000-…. Org B = '08670000-…-0002' (org A = the default '00000000-…-0001').
begin;
select plan(14);

insert into organizations (id, name) values
  ('08670000-0000-0000-0000-000000000002','WM Per-Org Org B');

-- ── AC-2255-001: the primary key is (source, org_id) ────────────────────────────────────────
select is(
  (select string_agg(a.attname, ',' order by a.attnum)
     from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = 'agent_dispatch_watermarks'::regclass and i.indisprimary),
  'source,org_id',
  'AC-2255-001: primary key is (source, org_id)');

-- ── AC-2255-002: org_id is not null and cascades on organization delete ─────────────────────
select ok(
  (select attnotnull from pg_attribute
    where attrelid = 'agent_dispatch_watermarks'::regclass and attname = 'org_id'),
  'AC-2255-002a: org_id is not null');

select is(
  (select confdeltype from pg_constraint
    where conrelid = 'agent_dispatch_watermarks'::regclass and contype = 'f'
      and confrelid = 'organizations'::regclass),
  'c',
  'AC-2255-002b: org_id references organizations(id) on delete cascade');

-- ── AC-2255-003: the backfill gives each organization the source's cursor ───────────────────
-- The live table no longer holds a pre-migration row to inspect, so the backfill statement is
-- replayed against the pre-migration shape (sandbox temp tables) and its result asserted.
create temp table wm_backfill_old (
  source       text primary key,
  last_seen_id uuid,
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now()
);
create temp table wm_backfill_new (
  source       text,
  -- no FK here: constraints on temporary tables may reference only temporary tables; the live
  -- table's organizations FK + cascade are proven separately by AC-2255-002b and AC-2255-005.
  org_id       uuid,
  last_seen_id uuid,
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now(),
  -- the same primary key the migration installs
  primary key (source, org_id)
);

insert into wm_backfill_old (source, last_seen_id, last_seen_at, updated_at) values
  ('procurement_status_events', '08670000-0000-0000-0000-0000000000c0', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z');

-- The migration's backfill, verbatim against the sandbox:
insert into wm_backfill_new (source, org_id, last_seen_id, last_seen_at, updated_at)
select w.source, o.id, w.last_seen_id, w.last_seen_at, w.updated_at
from wm_backfill_old w
cross join organizations o;
delete from wm_backfill_new where org_id is null;

-- Every organization got the old cursor; the source-only row is gone.
select is(
  (select count(*) from wm_backfill_new),
  (select count(*) from organizations),
  'AC-2255-003a: backfill yields exactly one cursor row per organization');
select is(
  (select count(*) from wm_backfill_new
    where last_seen_id = '08670000-0000-0000-0000-0000000000c0'
      and last_seen_at = '2026-11-01T00:00:00Z'),
  (select count(*) from organizations),
  'AC-2255-003b: each organization carries the source''s previous cursor');
select is(
  (select count(*) from wm_backfill_new where org_id is null),
  0,
  'AC-2255-003c: no row keeps a null organization');

-- The live table behaves the same way: both fixture organizations can hold their own cursor for the
-- same source, each with its own values.
insert into agent_dispatch_watermarks (source, org_id, last_seen_id, last_seen_at) values
  ('procurement_status_events',
   '00000000-0000-0000-0000-000000000001', '08670000-0000-0000-0000-0000000000a0', '2026-11-02T00:00:00Z'),
  ('procurement_status_events',
   '08670000-0000-0000-0000-000000000002', '08670000-0000-0000-0000-0000000000b0', '2026-11-03T00:00:00Z');
select is(
  (select count(*) from agent_dispatch_watermarks where source = 'procurement_status_events'),
  2,
  'AC-2255-003d: two organizations each hold their own cursor for the same source');

-- ── AC-2255-004: grants unchanged — SELECT only for anon/authenticated, no write verbs ──────
select ok(
  has_table_privilege('anon', 'agent_dispatch_watermarks', 'SELECT')
  and has_table_privilege('authenticated', 'agent_dispatch_watermarks', 'SELECT'),
  'AC-2255-004a: anon and authenticated keep SELECT (0075, unchanged)');
select ok(
  not has_table_privilege('anon', 'agent_dispatch_watermarks', 'INSERT')
  and not has_table_privilege('anon', 'agent_dispatch_watermarks', 'UPDATE')
  and not has_table_privilege('anon', 'agent_dispatch_watermarks', 'DELETE')
  and not has_table_privilege('authenticated', 'agent_dispatch_watermarks', 'INSERT')
  and not has_table_privilege('authenticated', 'agent_dispatch_watermarks', 'UPDATE')
  and not has_table_privilege('authenticated', 'agent_dispatch_watermarks', 'DELETE'),
  'AC-2255-004b: anon and authenticated hold no write grants (0105/0194, unchanged)');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'agent_dispatch_watermarks'::regclass),
  'AC-2255-004c: RLS stays enabled + forced (0048, unchanged)');
select is(
  (select count(*) from pg_policies where tablename = 'agent_dispatch_watermarks'),
  0,
  'AC-2255-004d: still no RLS policy — service_role only (0048, unchanged)');

-- ── AC-2255-005: deleting an organization removes its cursor rows ───────────────────────────
insert into agent_dispatch_watermarks (source, org_id, last_seen_id, last_seen_at) values
  ('procurement_status_events_second', '08670000-0000-0000-0000-000000000002',
   '08670000-0000-0000-0000-0000000000d0', '2026-11-04T00:00:00Z');
select is(
  (select count(*) from agent_dispatch_watermarks
    where org_id = '08670000-0000-0000-0000-000000000002'),
  2,
  'AC-2255-005a: the organization''s cursor rows exist before delete (two sources)');
delete from organizations where id = '08670000-0000-0000-0000-000000000002';
select is(
  (select count(*) from agent_dispatch_watermarks
    where org_id = '08670000-0000-0000-0000-000000000002'),
  0,
  'AC-2255-005b: deleting the organization removes all of its cursor rows (on delete cascade)');
select is(
  (select count(*) from agent_dispatch_watermarks where source = 'procurement_status_events'),
  1,
  'AC-2255-005c: the other organization''s cursor is untouched');

select * from finish();
rollback;
