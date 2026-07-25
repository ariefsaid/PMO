-- 0110_m365_db_hardening.sql — LOW-1 (entra_tenant_id format CHECK) + quality #9 (PKCE sweep cron).
-- Implements:
--   LOW-1: ALTER TABLE ms_graph_connections ADD CONSTRAINT entra_tenant_id_fmt
--          CHECK (entra_tenant_id ~ '^[A-Za-z0-9._-]+$').
--   #9: pg_cron job sweeping abandoned m365_pkce_states every 15 minutes (mirrors 0094 pattern).
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   alter table public.ms_graph_connections drop constraint if exists ms_graph_connections_entra_tenant_id_fmt;
--   select cron.unschedule('m365-pkce-sweep');
--   drop function if exists public.m365_pkce_sweep_tick();

-- ============================================================================
-- 1. LOW-1: entra_tenant_id format CHECK constraint.
--    Fresh reset has no rows → safe to add. Pattern matches Entra tenant ID format
--    (alphanumeric + . _ -) and rejects path-traversal attempts (../ etc.).
-- ============================================================================
alter table public.ms_graph_connections
  add constraint ms_graph_connections_entra_tenant_id_fmt
  check (entra_tenant_id ~ '^[A-Za-z0-9._-]+$');

comment on constraint ms_graph_connections_entra_tenant_id_fmt on public.ms_graph_connections is
  'LOW-1: Defends SSRF in refresh/revoke URL construction. Rejects tenant IDs with path chars.';

-- ============================================================================
-- 2. QUALITY #9: pg_cron sweep for abandoned PKCE states (every 15 minutes).
--    Mirrors 0094_clickup_sweep_cron.sql pattern: SECURITY DEFINER helper + cron.schedule.
--    Reads nothing from Vault (no secrets needed — direct DELETE on owned table).
-- ============================================================================
create extension if not exists pg_cron;

create or replace function public.m365_pkce_sweep_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.m365_pkce_states where expires_at < now();
end;
$$;

revoke all on function public.m365_pkce_sweep_tick() from public;

-- Schedule: every 15 minutes (cron expression '*/15 * * * *').
-- cron.schedule upserts by name, so re-running the migration is idempotent.
select cron.schedule('m365-pkce-sweep', '*/15 * * * *', 'select public.m365_pkce_sweep_tick()');