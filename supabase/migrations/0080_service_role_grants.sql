-- 0080_service_role_grants.sql — restore service_role's schema-wide DML grants (regression fix).
--
-- WHY. 0075_explicit_api_grants.sql activated `auto_expose_new_tables = false` (config.toml) and
-- explicitly re-granted the per-table DML that USED to come from auto-expose — but it mirrored the
-- grants for `authenticated` / `anon` ONLY and never re-granted `service_role`. With auto-expose off,
-- nothing re-grants service_role on a `db reset`, so service_role lost DML on every business table.
-- Consequence (caught by e2e at the dev→main promote — pgTAP couldn't, it runs as the superuser
-- migration role which bypasses grants): `permission denied for table profiles` (42501) for the
-- service_role client → `admin-invite-user` (inserts profiles), agent persistence, and the dispatcher
-- would all fail in production.
--
-- FIX. Restore the STANDARD Supabase posture: service_role — the trusted backend key that BYPASSES
-- RLS and is NEVER exposed to a browser — holds full DML on all public tables/sequences/functions.
-- This does NOT weaken the 0075 lockdown, which was about the CLIENT roles (authenticated/anon);
-- service_role security rests on keeping the key server-side, not on table grants. ALTER DEFAULT
-- PRIVILEGES future-proofs new tables so this can't silently recur.
--
-- Idempotent / re-runnable (plain grants). Reversibility (ADR-0006): `supabase db reset`.

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- Future tables/sequences/functions created in `public` (by later migrations) auto-grant to
-- service_role again — closes the auto-expose-off gap permanently.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences  to service_role;
alter default privileges in schema public grant all on functions  to service_role;
