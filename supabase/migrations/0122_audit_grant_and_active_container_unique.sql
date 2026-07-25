-- 0108_audit_grant_and_active_container_unique.sql
-- Grant execute on log_audit to service_role (Fix 4: audit not durable)
-- Add partial unique index on external_project_bindings for active containers (Fix 5: same List linkable twice)
-- Reversibility: supabase db reset. Manual reverse:
--   revoke execute on function public.log_audit(text, uuid, uuid, uuid, jsonb) from service_role;
--   drop index if exists external_project_bindings_active_container_uq;

-- Fix 4: Grant execute on log_audit to service_role
-- service_role is a trusted server context (not a client role) - safe to grant
-- (REMOVED 2026-07-17) `grant execute on function public.log_audit(...) to service_role;`
-- It was redundant and encoded a FALSE premise from a review claim that log_audit lacked a
-- service_role grant. `0080_service_role_grants.sql` already does `grant all on all functions in
-- schema public to service_role` + default privileges, so service_role always had EXECUTE
-- (verified: has_function_privilege('service_role','public.log_audit(...)','EXECUTE') = true with
-- this line removed). The disconnect-audit bug that actually shipped was the wrong ARG SHAPE at
-- the call site, proven in the edge fns' deno tests — not a missing grant.

-- Fix 5: Partial unique index to prevent the same List from being actively linked to multiple projects
-- Only one active (disconnected_at is null) binding per (external_tier, external_container_id) per org
create unique index if not exists external_project_bindings_active_container_uq
  on public.external_project_bindings (org_id, external_tier, external_container_id)
  where disconnected_at is null;

comment on index public.external_project_bindings_active_container_uq is
  'Prevents the same external container (e.g., ClickUp List) from being actively linked to multiple projects in the same org';