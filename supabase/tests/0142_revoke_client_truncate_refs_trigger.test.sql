-- 0142_revoke_client_truncate_refs_trigger.test.sql — security hardening, finding H4: proves
-- migration 0104_revoke_client_truncate_refs_trigger.sql left `anon` and `authenticated` with NO
-- truncate / references / trigger on ANY public business table, AND closed the root cause so the
-- privilege can't silently return on future tables. ALSO proves Tier 2 (migration
-- 0105_revoke_anon_write_dml.sql): `anon` holds NO insert/update/delete on ANY public business table,
-- and the postgres-default root cause is closed for those too (AC-GRANT-010..013).
--
-- Two catalog-driven backstops are authoritative:
--   • AC-GRANT-007 sweeps EVERY current public base table by OID (relkind 'r') -> 0 grant any of the
--     three privileges to authenticated or anon. A re-grant on any table fails here, loud.
--   • AC-GRANT-008 sweeps the DEFAULT PRIVILEGES (pg_default_acl) for public -> the bootstrap no
--     longer auto-grants any of the three to anon/authenticated, so a brand-new table cannot inherit
--     them. This is the root-cause guard (without it the next migration's table would re-open H4).
-- The spot checks (AC-GRANT-001..006) name security-critical tables explicitly for grep-ability, and
-- AC-GRANT-009 is a positive control proving the revoke was SURGICAL (authenticated keeps the
-- RLS-gated DML the app genuinely uses — only the three indefensible privileges went).
--
-- SCOPE NOTE: Tier 2 (revoking anon write DML) is now DONE in migration 0105_revoke_anon_write_dml.sql
-- (Director-approved) and asserted below as AC-GRANT-010..013. 0109_agent_dispatch_watermarks
-- _denydefault was updated to the privilege-denial mechanism (throws_ok 42501) since anon UPDATE/DELETE
-- grants no longer exist — see 0105's header for why that is a STRENGTHENING, not a weakening-to-pass.
--
-- pgTAP runs as the superuser migration role which BYPASSES grants — these assertions check the
-- *catalog* grant via has_table_privilege(role, ...) / pg_default_acl, so they DO catch the real grant
-- state (same idiom as 0137_service_role_grants.test.sql).
--
-- AC ids owned here: AC-GRANT-001..009. Reversibility (ADR-0006): this file makes no schema changes
-- (pure catalog reads); `supabase db reset` / re-run is a no-op.
begin;
select plan(13);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tier 1 — spot checks: authenticated & anon hold NO truncate/references/trigger on representative
-- security-critical tables. (The authoritative sweep is AC-GRANT-007 below.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════

select is(has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'), false,
  'AC-GRANT-001 authenticated has NO truncate on profiles');
select is(has_table_privilege('authenticated', 'public.profiles', 'REFERENCES'), false,
  'AC-GRANT-002 authenticated has NO references on profiles');
select is(has_table_privilege('authenticated', 'public.profiles', 'TRIGGER'), false,
  'AC-GRANT-003 authenticated has NO trigger on profiles');

select is(has_table_privilege('anon', 'public.projects', 'TRUNCATE'), false,
  'AC-GRANT-004 anon has NO truncate on projects');
select is(has_table_privilege('anon', 'public.projects', 'REFERENCES'), false,
  'AC-GRANT-005 anon has NO references on projects');
select is(has_table_privilege('anon', 'public.projects', 'TRIGGER'), false,
  'AC-GRANT-006 anon has NO trigger on projects');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tier 1 — authoritative CURRENT-STATE backstop: NO public base table grants truncate/references/
-- trigger to authenticated OR anon. Uses pg_class BY OID (relkind 'r') — authoritative, no name-
-- resolution phantoms. Covers 0075's 48 explicit-grant tables AND the 17 post-0075 tables that
-- inherited the same privileges from the bootstrap defaults. A future re-grant fails here, loudly.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', c.oid, 'REFERENCES')
        or has_table_privilege('authenticated', c.oid, 'TRIGGER')
        or has_table_privilege('anon', c.oid, 'TRUNCATE')
        or has_table_privilege('anon', c.oid, 'REFERENCES')
        or has_table_privilege('anon', c.oid, 'TRIGGER'))),
  0,
  'AC-GRANT-007 NO public base table grants truncate/references/trigger to authenticated or anon');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tier 1 — authoritative ROOT-CAUSE backstop: the `postgres` creator's public-schema DEFAULT
-- PRIVILEGES no longer grant truncate/references/trigger to anon or authenticated. Every public
-- business table is owned by postgres (migrations create tables as postgres), so this is the
-- creator whose defaults future migration tables inherit — closing it stops the next migration's
-- table from silently re-opening H4. (supabase_admin's parallel defaults are inert for migration
-- tables and not revokable by the non-superuser migration runner; AC-GRANT-007 catches any ACTUAL
-- table that ends up with the privilege regardless of creator.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
with exploded as (
  select (aclexplode(d.defaclacl)).grantee::regrole::text as grantee,
         (aclexplode(d.defaclacl)).privilege_type         as priv
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public' and d.defaclobjtype = 'r'
     and d.defaclrole = 'postgres'::regrole
)
select is(
  (select count(*)::int from exploded
    where grantee in ('anon','authenticated')
      and priv in ('TRUNCATE','REFERENCES','TRIGGER')),
  0,
  'AC-GRANT-008 postgres public table DEFAULT PRIVILEGES grant NO truncate/references/trigger to anon or authenticated (migration-table root cause closed)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Positive control — the revoke was SURGICAL: authenticated still has the full RLS-gated DML on
-- profiles (select/insert/update/delete). Proves 0104 only stripped the three indefensible
-- privileges, not the DML the app genuinely uses.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (has_table_privilege('authenticated', 'public.profiles', 'SELECT')
   and has_table_privilege('authenticated', 'public.profiles', 'INSERT')
   and has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
   and has_table_privilege('authenticated', 'public.profiles', 'DELETE')),
  true,
  'AC-GRANT-009 authenticated keeps full DML on profiles (revoke was surgical)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tier 2 (migration 0105) — authoritative CURRENT-STATE backstop: NO public base table grants
-- insert/update/delete to `anon`. Same OID catalog sweep as AC-GRANT-007. anon is the
-- UNAUTHENTICATED PostgREST role; it has zero write RLS policies anywhere, so no public table has
-- any legitimate anon write. (authenticated DML and anon SELECT are untouched by 0105.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE'))),
  0,
  'AC-GRANT-010 NO public base table grants insert/update/delete to anon');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tier 2 — authoritative ROOT-CAUSE backstop: the `postgres` creator's public-schema DEFAULT
-- PRIVILEGES no longer grant insert/update/delete to `anon`. Every public business table is owned
-- by postgres (migrations create tables as postgres), so this is the creator whose defaults future
-- migration tables inherit — closing it stops the next migration's table from silently re-opening
-- the anon-DML hole. (Same residual/coverage reasoning as AC-GRANT-008 for supabase_admin's parallel
-- defaults.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
with exploded_dml as (
  select (aclexplode(d.defaclacl)).grantee::regrole::text as grantee,
         (aclexplode(d.defaclacl)).privilege_type         as priv
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public' and d.defaclobjtype = 'r'
     and d.defaclrole = 'postgres'::regrole
)
select is(
  (select count(*)::int from exploded_dml
    where grantee = 'anon'
      and priv in ('INSERT','UPDATE','DELETE')),
  0,
  'AC-GRANT-011 postgres public table DEFAULT PRIVILEGES grant NO insert/update/delete to anon (migration-table root cause closed)');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tier 2 — spot checks: anon holds NO insert/update/delete on named security-critical tables (for
-- grep-ability). agent_dispatch_watermarks is the 0109 proof target; audit_events and error_events
-- are the other deny-default tables whose anon INSERTs already used throws_ok 42501.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (has_table_privilege('anon','public.agent_dispatch_watermarks','INSERT')
   or has_table_privilege('anon','public.agent_dispatch_watermarks','UPDATE')
   or has_table_privilege('anon','public.agent_dispatch_watermarks','DELETE')
   or has_table_privilege('anon','public.audit_events','INSERT')
   or has_table_privilege('anon','public.audit_events','UPDATE')
   or has_table_privilege('anon','public.audit_events','DELETE')
   or has_table_privilege('anon','public.error_events','INSERT')
   or has_table_privilege('anon','public.error_events','UPDATE')
   or has_table_privilege('anon','public.error_events','DELETE')),
  false,
  'AC-GRANT-012 anon has NO insert/update/delete on agent_dispatch_watermarks, audit_events, error_events');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tier 2 — surgical positive control: the revoke was SURGICAL. anon still holds SELECT on profiles
-- (0105 stripped only insert/update/delete from anon, not select — out of scope, conservative). Pairs
-- with AC-GRANT-009 (authenticated keeps full DML) to prove neither migration over-revoked.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
select is(has_table_privilege('anon', 'public.profiles', 'SELECT'), true,
  'AC-GRANT-013 anon keeps SELECT on profiles (Tier-2 revoke was surgical: only DML went, not SELECT)');

select * from finish();
rollback;
