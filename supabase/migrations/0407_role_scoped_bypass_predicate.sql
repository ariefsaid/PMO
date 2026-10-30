-- One trust-boundary predicate, two entry points. The no-arg actor_bypasses_rls() (0174) reads
-- current_user, which is correct for the SECURITY INVOKER guards it serves. Inside a SECURITY
-- DEFINER function current_user is the function owner, never the caller — a definer that called the
-- no-arg form would exempt every caller. The name-parameter form lets a definer resolve the
-- CALLER's session role and feed it through the same rolbypassrls lookup, so 0168 AC-UPS-053's
-- rule holds: exactly one definition of the predicate, and it lives in actor_bypasses_rls.
create or replace function public.actor_bypasses_rls(p_role name)
returns boolean
language sql stable set search_path = pg_catalog, public as $$
  select coalesce((select rolbypassrls from pg_catalog.pg_roles where rolname = p_role), false)
$$;

comment on function public.actor_bypasses_rls(name) is
  'True when the NAMED role bypasses RLS (postgres / service_role / supabase_admin). The '
  'definer-context entry point of the shared trust-boundary predicate: a SECURITY DEFINER body '
  'resolves the caller''s session role (current_setting(''role'', true) with the session_user '
  'fallback) and passes it here, because current_user inside a definer is the owner, not the '
  'caller. Must stay SECURITY INVOKER and read-only.';

-- Same surface as the no-arg helper (0175): read-only predicate, executable by the client roles.
grant execute on function public.actor_bypasses_rls(name) to authenticated, anon;
