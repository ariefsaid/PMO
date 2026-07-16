-- 0105_revoke_anon_write_dml.sql — security hardening, finding H4 Tier 2 (Director-approved
-- escalation of the M365 Phase-1 max-rigor audit: docs/spikes/2026-07-15-m365-phase1-security-audit.md).
-- Companion to 0104_revoke_client_truncate_refs_trigger.sql (Tier 1 stripped truncate/references/
-- trigger from anon+authenticated). This migration strips the remaining indefensible client-role
-- privilege: anon write DML (insert/update/delete) on public base tables.
-- Proof: supabase/tests/0142_revoke_client_truncate_refs_trigger.test.sql (AC-GRANT-010..013).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- `anon` — the unauthenticated PostgREST role a request has BEFORE a valid JWT is presented — held
-- INSERT/UPDATE/DELETE on every public business table (0075 explicitly granted them on 48 tables,
-- 0090 on one more; the remainder inherited them from Supabase's bootstrap DEFAULT PRIVILEGES — the
-- same root cause Tier 1 closed for truncate/refs/trigger). These three privileges have NO legitimate
-- anon use: there are ZERO `for ... to anon` write RLS policies anywhere in the codebase (verified —
-- `grep -rniE "policy\b.*\bto anon\b" supabase/migrations` returns nothing), so anon was NEVER able
-- to actually complete a write: RLS default-deny stopped every attempt and the grant was dormant.
-- But "dormant" is not "denied": the ONLY thing standing between an unauthenticated request and a
-- mutation was an RLS policy, on every table, forever. Defense-in-depth demands a second, independent
-- barrier — the table-level privilege grant. Revoking it means an unauthenticated role can no longer
-- even ATTEMPT the statement: Postgres raises 42501 (permission denied) at the privilege check,
-- BEFORE RLS is evaluated. RLS stops being the sole barrier for the unauthenticated role.
--
-- ── TEST MECHANISM CHANGE (0109) — STRENGTHENING, NOT WEAKENING ────────────────────────────────
-- 0109_agent_dispatch_watermarks_denydefault previously proved "anon cannot mutate
-- agent_dispatch_watermarks" by performing an `anon UPDATE ... returning` / `DELETE ... returning`
-- and asserting 0 rows affected (RLS row-denial). Those assertions DEPENDED on anon holding the
-- UPDATE/DELETE grants (so the statement was *executable*, and RLS — not the grant — was what denied).
-- With the grants revoked, those same statements now raise 42501 at the privilege check. The test's
-- GOAL-ORACLE ("anon cannot mutate agent_dispatch_watermarks") is UNCHANGED; only the MECHANISM
-- proving it changes — from "UPDATE/DELETE affects 0 rows (RLS row-denial)" to "UPDATE/DELETE raises
-- 42501 (privilege denial)". That is strictly STRONGER: anon can no longer even attempt the
-- statement. This is therefore a test STRENGTHENING, not a weakening-to-pass. (0109's anon INSERT
-- already used throws_ok 42501; only its UPDATE/DELETE assertions change mechanism here.) The 0128
-- and 0133 tests already used throws_ok 42501 for their anon INSERTs, so they stay green unchanged.
--
-- ── SCOPE ──────────────────────────────────────────────────────────────────────────────────────
-- REVOKED from anon, on ALL public base tables (catalog sweep, relkind 'r'): INSERT, UPDATE, DELETE.
-- NOT touched:
--   • anon SELECT — left intact (out of scope for Tier 2; RLS gates reads, and breaking an anon read
--     path would be a visible regression). NOTE for the Director: the same investigation shows anon
--     also has zero read RLS policies, so anon SELECT on business tables is likewise dormant — but
--     revoking it is a separate, explicit decision, not bundled here.
--   • authenticated DML (select/insert/update/delete) — UNTOUCHED. The entire FE operates as
--     `authenticated` behind <RequireAuth/>; it needs full RLS-gated DML. Only the unauthenticated
--     role is locked down.
--   • service_role grants (0080) — UNTOUCHED (different grantee; bypasses RLS by design).
--
-- ── ROOT CAUSE (same as Tier 1) ────────────────────────────────────────────────────────────────
-- Supabase's bootstrap DEFAULT PRIVILEGES (pg_default_acl) auto-grant insert/update/delete to anon
-- for tables created in `public` by the `postgres` creator. So even tables whose migrations only did
-- `grant select` silently inherited anon DML from the defaults — and every future migration's table
-- would too. STEP 1 closes the root cause (postgres defaults); STEP 2 clears the present state (all
-- current public base tables). See 0104's ENVIRONMENT NOTE re: the inert supabase_admin parallel
-- defaults — the same applies here: migration tables are owned by postgres, so they inherit postgres's
-- defaults (never supabase_admin's); AC-GRANT-011 catches any ACTUAL table that ends up with the
-- privilege regardless of creator, so the supabase_admin residual is covered.
--
-- Idempotent / re-runnable: ALTER DEFAULT PRIVILEGES REVOKE and plain REVOKE are both idempotent.
--
-- Reversibility (ADR-0006):
--   • Pre-production rollback: delete this migration file and run `supabase db reset` — Supabase's
--     bootstrap re-establishes the defaults and 0075/0090 re-grant the explicit tables. Prior state
--     fully restored.
--   • Manual restore (runnable): re-issue the inverse statements below (STEP 1 + STEP 2 mirrors).
--     They restore the prior anon-DML state verbatim (every public base table had anon insert/update/
--     delete via the bootstrap defaults, so re-granting all of them is faithful).
-- ==================================================================================================

-- ─────────────────────────────────────────────────────────────────────────── STEP 1: defaults ──
-- Close the root cause for migration tables: every public business table is owned by `postgres`
-- (migrations create tables as postgres), so they inherit postgres's public-schema table defaults at
-- creation. Revoking insert/update/delete from anon in those defaults means the NEXT migration's
-- `create table` no longer auto-inherits them. (authenticated defaults and service_role defaults from
-- 0080 are untouched; anon SELECT defaults are untouched.)
alter default privileges for role postgres in schema public revoke insert, update, delete on tables from anon;

-- ─────────────────────────────────────────────────────────────────────── STEP 2: present state ──
-- Clear insert/update/delete from anon on ALL current public base tables (0075's 48 + 0090's 1 + the
-- post-0075 inheritors). Revoking from every public base table is correct — anon has zero write RLS
-- policies, so no public table has any legitimate anon write. (authenticated DML and anon SELECT are
-- untouched.)
do $$
declare
  t text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end
$$;

-- ───────────────────────────────────────────────────────────────────── REVERSIBILITY (restore) ──
-- To undo this migration, run the inverse (STEP 1 re-grants the postgres defaults; STEP 2 re-grants
-- current tables). Uncomment to restore the prior anon-DML state verbatim:
--
--   -- STEP 1 restore (postgres defaults):
--   alter default privileges for role postgres in schema public grant insert, update, delete on tables to anon;
--   -- STEP 2 restore (current tables — re-grant on every public base table):
--   do $$
--   declare t text;
--   begin
--     for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r' loop
--       execute format('grant insert, update, delete on public.%I to anon', t);
--     end loop;
--   end $$;
