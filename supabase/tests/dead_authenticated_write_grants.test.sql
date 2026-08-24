-- dead_authenticated_write_grants.test.sql — proves 0194_dead_authenticated_write_grants.sql (#511):
-- `authenticated` holds NO INSERT/UPDATE/DELETE that no write policy can let it use, on ANY public
-- base table. AC ids owned here: AC-DWG-001..015.
--
-- ── THE ORACLE, AND WHY THE OBVIOUS ONE IS WRONG ───────────────────────────────────────────────
-- has_table_privilege(role, tbl, 'INSERT') returns FALSE when the role holds only COLUMN-level
-- INSERT — which is the shape 0182/0184 left `profiles` in, and the shape DD-CUR-4 forces on any
-- table narrowed to an allow-list. A negative assertion built on it would therefore pass on a table
-- that is fully writable column by column. Every negative below uses
-- has_any_column_privilege() for INSERT/UPDATE (TRUE for a table-level OR any column-level grant)
-- and has_table_privilege() for DELETE, which has no column form.
--
-- pgTAP runs as the superuser migration role, which BYPASSES grants — these assertions read the
-- CATALOG via has_*_privilege(), so they do observe the real grant state (the 0137/0142 idiom).
--
-- ⚑ AC-DWG-011 is the authoritative one: the discovery query from #511, standing as a permanent
-- backstop over EVERY public base table, present and future. The ten per-table assertions above it
-- exist so a regression names its table in the failure line instead of only bumping a count.
--
-- ⚑ LOCAL ONLY. #490/#511 both note that hosted Supabase's grant defaults differ from local Docker
-- (the 0173/0185 episode), so a green run here is evidence about THIS database, not about prod.
-- Running this file against production is a separate, owner-gated step.
--
-- Reversibility (ADR-0006): pure catalog reads, no schema changes — re-running is a no-op.
begin;
create extension if not exists pgtap;
select plan(15);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — per-table negatives. Each names the privileges 0193 revoked from `authenticated`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

select ok(not has_table_privilege('authenticated', 'public.agent_attachments', 'DELETE'),
  'AC-DWG-001 authenticated has NO delete on agent_attachments (soft-archive only, no delete policy)');

select ok(not has_table_privilege('authenticated', 'public.agent_events', 'DELETE'),
  'AC-DWG-002 authenticated has NO delete on agent_events (append-only, no delete policy)');

select ok(not has_table_privilege('authenticated', 'public.agent_runs', 'DELETE'),
  'AC-DWG-003 authenticated has NO delete on agent_runs (no delete policy)');

select ok(not has_table_privilege('authenticated', 'public.agent_threads', 'DELETE'),
  'AC-DWG-004 authenticated has NO delete on agent_threads (no delete policy; a delete-conversation '
  'feature must add the policy and the grant together)');

select ok(not has_any_column_privilege('authenticated', 'public.agent_usage', 'UPDATE')
      and not has_table_privilege     ('authenticated', 'public.agent_usage', 'DELETE'),
  'AC-DWG-005 authenticated has NO update/delete on agent_usage (append-only ledger)');

select ok(not has_any_column_privilege('authenticated', 'public.credits', 'UPDATE')
      and not has_table_privilege     ('authenticated', 'public.credits', 'DELETE'),
  'AC-DWG-006 authenticated has NO update/delete on credits (append-only ledger; balance is a SUM)');

select ok(not has_any_column_privilege('authenticated', 'public.agent_dispatch_watermarks', 'INSERT')
      and not has_any_column_privilege('authenticated', 'public.agent_dispatch_watermarks', 'UPDATE')
      and not has_table_privilege     ('authenticated', 'public.agent_dispatch_watermarks', 'DELETE'),
  'AC-DWG-007 authenticated has NO write DML on agent_dispatch_watermarks (service-role bookkeeping)');

select ok(not has_any_column_privilege('authenticated', 'public.error_events', 'INSERT')
      and not has_any_column_privilege('authenticated', 'public.error_events', 'UPDATE')
      and not has_table_privilege     ('authenticated', 'public.error_events', 'DELETE'),
  'AC-DWG-008 authenticated has NO write DML on error_events (edge functions write it on service_role)');

select ok(not has_any_column_privilege('authenticated', 'public.procurement_doc_counters', 'INSERT')
      and not has_any_column_privilege('authenticated', 'public.procurement_doc_counters', 'UPDATE')
      and not has_table_privilege     ('authenticated', 'public.procurement_doc_counters', 'DELETE'),
  'AC-DWG-009 authenticated has NO write DML on procurement_doc_counters (definer next_procurement_doc_number only)');

select ok(not has_any_column_privilege('authenticated', 'public.procurement_status_events', 'INSERT')
      and not has_any_column_privilege('authenticated', 'public.procurement_status_events', 'UPDATE')
      and not has_table_privilege     ('authenticated', 'public.procurement_status_events', 'DELETE'),
  'AC-DWG-010 authenticated has NO write DML on procurement_status_events (definer transition_procurement only)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — THE BACKSTOP. The #511 discovery query, over every public base table: zero (table, privilege)
-- pairs where `authenticated` can ATTEMPT a write that no policy applying to it permits.
--   • polroles = '{0}' is the PUBLIC pseudo-role — every policy in this repo is written `to public`,
--     so matching only the literal 'authenticated' would match nothing and report every table.
--   • polcmd '*' is FOR ALL and counts as a write policy for all three verbs.
-- A future table that grants write DML without a matching policy fails HERE, loudly, and so does a
-- re-grant on any of the ten above.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
with tbls as (
  select c.oid, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
priv as (
  select t.*,
         has_any_column_privilege('authenticated', t.oid, 'INSERT') as ins,
         has_any_column_privilege('authenticated', t.oid, 'UPDATE') as upd,
         has_table_privilege     ('authenticated', t.oid, 'DELETE') as del
    from tbls t
),
pol as (
  select p.polrelid,
         bool_or(p.polcmd in ('a','*')) filter (where r.applies) as pol_ins,
         bool_or(p.polcmd in ('w','*')) filter (where r.applies) as pol_upd,
         bool_or(p.polcmd in ('d','*')) filter (where r.applies) as pol_del
    from pg_policy p
    cross join lateral (
      select (p.polroles = '{0}'::oid[]
              or 'authenticated'::regrole::oid = any(p.polroles)) as applies
    ) r
   group by p.polrelid
),
dead as (
  select p.relname, x.priv
    from priv p
    left join pol on pol.polrelid = p.oid
    cross join lateral (values
      ('INSERT', p.ins and not coalesce(pol.pol_ins, false)),
      ('UPDATE', p.upd and not coalesce(pol.pol_upd, false)),
      ('DELETE', p.del and not coalesce(pol.pol_del, false))
    ) as x(priv, is_dead)
   where x.is_dead
)
select is(
  coalesce((select string_agg(relname || '.' || priv, ', ' order by relname, priv) from dead), 'none'),
  'none',
  'AC-DWG-011 NO public base table grants authenticated a write privilege that no write policy permits');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — positive controls: the revoke was SURGICAL. Without these, revoking everything everywhere
-- would also pass §1 and §2.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from (values
      ('public.agent_attachments'), ('public.agent_events'), ('public.agent_runs'),
      ('public.agent_threads'), ('public.agent_usage'), ('public.credits')) as t(rel)
    where has_any_column_privilege('authenticated', t.rel::regclass, 'INSERT')),
  6,
  'AC-DWG-012 authenticated KEEPS insert on all six tables that have an insert policy');

select is(
  (select count(*)::int from (values
      ('public.agent_attachments'), ('public.agent_events'),
      ('public.agent_runs'), ('public.agent_threads')) as t(rel)
    where has_any_column_privilege('authenticated', t.rel::regclass, 'UPDATE')),
  4,
  'AC-DWG-013 authenticated KEEPS update on all four tables that have an update policy');

select is(
  (select count(*)::int from (values
      ('public.agent_attachments'), ('public.agent_dispatch_watermarks'), ('public.agent_events'),
      ('public.agent_runs'), ('public.agent_threads'), ('public.agent_usage'), ('public.credits'),
      ('public.error_events'), ('public.procurement_doc_counters'),
      ('public.procurement_status_events')) as t(rel)
    where has_table_privilege('authenticated', t.rel::regclass, 'SELECT')),
  10,
  'AC-DWG-014 authenticated KEEPS select on all ten swept tables (reads are RLS-gated, untouched)');

select is(
  (select count(*)::int from (values
      ('public.agent_attachments'), ('public.agent_dispatch_watermarks'), ('public.agent_events'),
      ('public.agent_runs'), ('public.agent_threads'), ('public.agent_usage'), ('public.credits'),
      ('public.error_events'), ('public.procurement_doc_counters'),
      ('public.procurement_status_events')) as t(rel)
    where has_table_privilege('service_role', t.rel::regclass, 'INSERT')
      and has_table_privilege('service_role', t.rel::regclass, 'UPDATE')
      and has_table_privilege('service_role', t.rel::regclass, 'DELETE')),
  10,
  'AC-DWG-015 service_role KEEPS full write DML on all ten (the shipped writers — edge functions, '
  'the historical importer, e2e cleanup — are untouched)');

select * from finish();
rollback;
