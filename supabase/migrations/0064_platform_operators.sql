-- 0064_platform_operators.sql — platform_operators (platform-level grant, NOT a 6th role) +
-- is_operator() helper. FR-OPR-001/002, AC-OPR-001/002.
--
-- Design (ADR-0049): RLS enabled+FORCED; EXACTLY ONE policy — FOR SELECT USING (user_id = auth.uid())
-- (a member confirms ONLY their own membership). NO write policy for any role → append-only-by-
-- omission (FR-AUC-007 pattern); Operators are provisioned via seed/SQL only (0063 seed + the
-- per-client runbook). is_operator() is plain SECURITY INVOKER (NOT definer) — it does NOT bypass
-- RLS; it leans on that SELECT policy: under an Operator's JWT the sub-select sees their own row →
-- true; under any other JWT → 0 rows → false. Without that SELECT policy, forced RLS would hide
-- every row and is_operator() would ALWAYS return false → every Operator RPC dead.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.is_operator();
--   drop table if exists public.platform_operators;

create table public.platform_operators (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.profiles(id)
);
comment on table public.platform_operators is
  'Platform-level Operator grant (ADR-0049). NOT a user_role. Provisioned via seed/SQL only.';

alter table public.platform_operators enable row level security;
alter table public.platform_operators force  row level security;

-- The ONE policy: a user confirms ONLY their own membership. This is what makes is_operator()
-- return true for an Operator (their own row is visible to them) and false for everyone else.
create policy platform_operators_self_select on public.platform_operators
  for select using (user_id = auth.uid());
-- DELIBERATELY no INSERT/UPDATE/DELETE policy => default-deny writes for every ordinary role;
-- only service_role (RLS bypass) / seed SQL ever writes it (FR-OPR-001 / FR-OPR-003). NOTE:
-- is_active_member() is intentionally NOT conjoined here (0063's pass excluded this table) — a
-- disabled Operator's platform grant is a platform concern, not an org-membership concern, and
-- conjoining would make is_operator() false for a disabled operator, which is out of scope for v1.

-- is_operator(): plain SECURITY INVOKER (NOT definer). Under an Operator's JWT the sub-select sees
-- their own row (visible via the SELECT policy above) → true; under any other JWT → 0 rows → false.
create or replace function public.is_operator() returns boolean
  language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.platform_operators where user_id = auth.uid())
$$;
