-- 0062_ops_admin_profile_status.sql — profile_status enum + profiles.status (FR-INV-001)
-- + is_active_member() helper (FR-INV-003). AC-INV-002 (disabled reads nothing) is proven by
-- pgTAP 0125 once 0063 conjoins the helper into every business-table policy.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.is_active_member();
--   alter table public.profiles drop column if exists status;
--   drop type if exists public.profile_status;

create type public.profile_status as enum ('active','disabled');

alter table public.profiles
  add column status public.profile_status not null default 'active';

-- is_active_member(): security DEFINER (mirrors auth_org_id()/auth_role() in 0002_rls.sql) so it
-- reads the raw profiles row BYPASSING RLS — this avoids recursion when the predicate is conjoined
-- into profiles_select itself (0063). A disabled user's JWT -> false -> every business-table
-- policy's conjunct denies (SELECT USING + write USING/WITH CHECK alike). Stable + pinned
-- search_path hardens against search_path injection (security-auditor surface, same as 0002).
create or replace function public.is_active_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;
