-- 0104_revoke_client_truncate_refs_trigger.sql — security hardening, finding H4 (revoke
-- indefensible client-role privileges surfaced by the M365 Phase-1 max-rigor audit:
-- docs/spikes/2026-07-15-m365-phase1-security-audit.md). This migration is NOT the M365 work — it
-- tightens grants that pre-date and are independent of it. Supersedes nothing; runs after
-- 0075_explicit_api_grants.sql. Proof: supabase/tests/0142_revoke_client_truncate_refs_trigger.test.sql.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- `anon`/`authenticated` held TRUNCATE / REFERENCES / TRIGGER on every public business table. These
-- three privileges have NO legitimate PostgREST / client-role use:
--   • TRUNCATE  — bypasses RLS *and* per-row DELETE triggers entirely (Postgres fires no RLS policy
--     and no row-level trigger on TRUNCATE). Any client role holding TRUNCATE can wipe a table,
--     skipping every RLS + trigger-based control (e.g. the M365 offboard/disentitlement token-
--     deletion cascade could be defeated this way). NOT reachable today (PostgREST exposes no
--     TRUNCATE verb) -> latent landmine, not an active exploit — but indefensible; any future
--     raw-SQL / RPC / admin path would inherit the hole.
--   • REFERENCES — needed only to CREATE a foreign-key constraint that targets the table (DDL).
--     Client roles never create FKs; migrations run as the migration (superuser) role. Dead weight.
--   • TRIGGER   — needed only to CREATE triggers ON the table (DDL). Same: no client use.
--
-- ── ROOT CAUSE (why this is broader than 0075's explicit grants) ────────────────────────────────
-- 0075 explicitly granted these to anon/authenticated on 48 tables — but the SAME three privileges
-- ALSO come from Supabase's bootstrap DEFAULT PRIVILEGES (pg_default_acl): tables created in `public`
-- auto-inherit TRUNCATE/REFERENCES/TRIGGER for anon+authenticated. (`auto_expose_new_tables = false`
-- in config.toml only governs PostgREST *API exposure* — it does NOT touch these Postgres grants.)
-- Consequence: 17 public tables created by later migrations (0076–0103) ALSO hold these privileges
-- despite only doing `grant select`, and every future table would too. So a literal "revoke only on
-- 0075's 48" would (a) knowingly leave 17 vulnerable tables and (b) be instantly defeated by the
-- next migration. This migration closes it at the root:
--   STEP 1 — ALTER DEFAULT PRIVILEGES for the migration-creator role (`postgres`): future tables
--            created by migrations stop inheriting the three privileges.
--   STEP 2 — REVOKE on ALL current public base tables (0075's 48 + the 17 post-0075): present state.
-- (Precedent for adjusting Supabase defaults in-repo: 0080_service_role_grants.sql.)
--
-- ── ENVIRONMENT NOTE (supabase_admin defaults — accepted residual) ─────────────────────────────
-- pg_default_acl ALSO carries identical defaults attributed to `supabase_admin` (Supabase bootstrap).
-- They are NOT revoked here because the migration runner is `postgres`, which is neither superuser
-- nor a member of `supabase_admin` — `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` raises
-- `permission denied to change default privileges`. This is INERT for our threat model: EVERY public
-- business table is owned by `postgres` (migrations create tables as `postgres`), so tables inherit
-- the `postgres` creator's defaults at creation — NEVER supabase_admin's. The supabase_admin defaults
-- would only attach to a table created BY supabase_admin, which no migration does. The current-state
-- backstop (pgTAP AC-GRANT-007) catches any ACTUAL table that ends up with the privilege regardless
-- of creator, so the residual is covered. If a future migration ever sets role supabase_admin before
-- creating a public table, that table would inherit — AC-GRANT-007 would then fail loud, flagging it.
--
-- ── TIER 2 (anon write DML) — INTENTIONALLY NOT DONE HERE ─────────────────────────────────────
-- The audit also flagged that `anon` holds insert/update/delete on business tables. Investigation
-- proved NO anon write PATH exists (zero `for ... to anon` write RLS policies; RLS enabled on all
-- tables, never disabled; the whole FE is behind <RequireAuth/> and the auth flow uses supabase.auth.*
-- not public.* DML; edge-fn anon-key clients forward the CALLER's JWT behind a 401 gate, so the
-- effective role is `authenticated`, never `anon`). So the anon DML grant is dormant (RLS already
-- denies every anon write). HOWEVER, revoking it BREAKS an existing test: 0109_agent_dispatch_watermarks
-- _denydefault asserts RLS default-deny by performing an `anon UPDATE ... returning` and counting 0
-- rows — it *depends* on anon holding the UPDATE grant (so RLS, not the grant, is what denies). The
-- revoke turns that into a privilege error (42501) mid-test. Per the binding rule ("if revoking a
-- grant breaks an existing test, that is a SIGNAL the grant is actually needed — do not revoke; report
-- it"), Tier 2 is left for the Director. anon SELECT is also left intact (out of scope; conservative).
--
-- Idempotent / re-runnable: ALTER DEFAULT PRIVILEGES REVOKE and plain REVOKE are both idempotent.
--
-- Reversibility (ADR-0006):
--   • Pre-production rollback: delete this migration file and run `supabase db reset` — Supabase's
--     bootstrap re-establishes the defaults and 0075 re-grants the 48 explicit tables; the 17
--     post-0075 tables re-inherit from the defaults. Prior state fully restored.
--   • Manual restore (runnable): re-issue the inverse statements below (STEP 1 + STEP 2 mirrors).
--     They restore the prior state verbatim (SELECT/DML grants were never touched).
-- ==================================================================================================

-- ─────────────────────────────────────────────────────────────────────────── STEP 1: defaults ──
-- Close the root cause for migration tables: the migration runner is `postgres`, and every public
-- business table is owned by `postgres`, so tables inherit `postgres`'s public-schema table defaults
-- at creation. Revoking the three indefensible privileges from those defaults means the NEXT
-- migration's `create table` no longer auto-inherits them. (service_role defaults from 0080 are
-- untouched; SELECT/INSERT/UPDATE/DELETE defaults are untouched — only the three go. See the
-- ENVIRONMENT NOTE above for why `supabase_admin`'s parallel defaults are left in place.)

alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────── STEP 2: present state ──
-- Clear the SAME three privileges from ALL current public base tables (0075's 48 + 17 post-0075 =
-- 65 at the time of writing; the catalog loop is complete regardless of exact count). Revoking from
-- every public base table is correct — no client role has any legitimate use for any of the three on
-- any business table. (select/insert/update/delete on authenticated are untouched; anon DML is left
-- for the Director per the Tier-2 note above.)

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
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
    execute format('revoke truncate, references, trigger on public.%I from anon',            t);
  end loop;
end
$$;

-- ───────────────────────────────────────────────────────────────────── REVERSIBILITY (restore) ──
-- To undo this migration, run the inverse (STEP 1 re-grants the postgres defaults; STEP 2 re-grants
-- current tables). Uncomment to restore the prior state verbatim:
--
--   -- STEP 1 restore (postgres defaults):
--   alter default privileges for role postgres in schema public grant truncate, references, trigger on tables to anon, authenticated;
--   -- STEP 2 restore (current tables — re-grant on every public base table):
--   do $$
--   declare t text;
--   begin
--     for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname='public' and c.relkind='r' loop
--       execute format('grant truncate, references, trigger on public.%I to authenticated', t);
--       execute format('grant truncate, references, trigger on public.%I to anon',            t);
--     end loop;
--   end $$;
