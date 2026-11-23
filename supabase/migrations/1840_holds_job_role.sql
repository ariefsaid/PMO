-- 1840_holds_job_role.sql — roles that decide: the ONE function that answers "this person fills job role X".
-- Spec docs/specs/roles-that-decide.spec.md §2.1 (FR-RTD-001..003). Proven by supabase/tests/roles_that_decide_function.test.sql.
-- Rollback: supabase/migrations/rollback/1840_holds_job_role_down.sql
--
-- A person fills job role X when X is a catalogue key, the person is an active member, and either
--   (holds) profiles.built_in_role = X, or
--   (an access level that includes it) the person holds no job role and profiles.role = built_in_role_base(X).
-- "Includes" is read from the one existing mapping, built_in_role_base: an access level includes every job role built on it, for a
-- person not yet given a job role. A person who holds a job role is judged by it alone.
-- It does not check the organisation: every caller compares org_id itself. Because it takes any profile id it is NOT executable by a
-- signed-in caller (no "does this id hold that role" answer about another person); definer bodies call it as the owner, and
-- policies reach it only through an actor-scoped gate.

create function public.holds_job_role(p_profile uuid, p_job_role text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select public.built_in_role_base(p_job_role) is not null
       and public.is_active_member(p.id)
       and (p.built_in_role = p_job_role                                                                  -- mut:holds
            or (p.built_in_role is null and p.role = public.built_in_role_base(p_job_role)))             -- mut:includes
      from public.profiles p
     where p.id = p_profile), false)
$$;

comment on function public.holds_job_role(uuid, text) is
  'roles-that-decide FR-RTD-001: true when the profile is active and holds the job role, or holds no job role and has the access '
  'level the job role is built on (built_in_role_base). Null or unknown key: false. No org check (callers compare org_id).';

revoke all on function public.holds_job_role(uuid, text) from public, anon, authenticated;
grant execute on function public.holds_job_role(uuid, text) to service_role;
