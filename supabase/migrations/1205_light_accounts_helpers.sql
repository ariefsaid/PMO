-- 1205 (#2710): light accounts. A light account is an active profile whose built_in_role is foreman or field_user (OD-SCOPE-4).
-- Rollback: supabase/migrations/rollback/1205_light_accounts_helpers_down.sql
-- Nothing activates until built_in_roles_enabled is on and someone holds a light key (1201/1202): for every other person
-- these helpers return false / 'full' and every rule built on them is inert.

-- The ONE place the two light keys are named. Frontend mirror: pmo-portal/src/auth/lightAccount.ts.
create function public.is_light_role_key(p_key text) returns boolean
  language sql immutable security invoker set search_path = pg_catalog as $$
  select coalesce(p_key in ('foreman', 'field_user'), false)
$$;

-- Seat type of a person: 'light' for a light role, 'full' for everyone else (a NULL key is 'full').
create function public.profile_seat_type(p_profile uuid) returns text
  language sql stable security invoker set search_path = pg_catalog, public as $$
  select case when public.is_light_role_key((select p.built_in_role from public.profiles p where p.id = p_profile))
              then 'light' else 'full' end
$$;

-- The signed-in, ACTIVE person (never the view-as role) is a light account.
create function public.actor_is_light() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.status = 'active' and public.is_light_role_key(p.built_in_role))
$$;
revoke all on function public.actor_is_light() from public, anon;
grant execute on function public.actor_is_light() to authenticated;

-- Refusal used at the top of read-side definer RPCs (1209). Returns true so it can sit in a FROM/WHERE of a SQL body.
create function public.assert_not_light() returns boolean
  language plpgsql stable security invoker set search_path = pg_catalog, public as $$
begin
  if public.actor_is_light() then
    raise exception 'LIGHT_ACCOUNT: this account has one phone home screen and cannot read this' using errcode = '42501';
  end if;
  return true;
end $$;
revoke all on function public.assert_not_light() from public, anon, authenticated;

-- Own-crew tests for the restrictive policies (1206). All are scoped to the caller's organisation and "today" (org-local).
-- A crew is visible to a light account when it is the field controller, or a current member through people.profile_id.
create function public.light_can_see_crew(p_crew uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.crews c
     where c.id = p_crew and c.org_id = public.auth_org_id()
       and (c.field_controller_id = auth.uid()
            or exists (select 1 from public.crew_members m join public.people w on w.id = m.worker_id
                        where m.crew_id = c.id and w.profile_id = auth.uid()
                          and public.equipment_org_today(c.org_id) between m.valid_from and coalesce(m.valid_to, 'infinity'::date))))
$$;
revoke all on function public.light_can_see_crew(uuid) from public, anon;
grant execute on function public.light_can_see_crew(uuid) to authenticated;

-- A crew-member row is visible to the crew's Foreman (field controller) and to the member themself.
create function public.light_can_see_crew_member(p_crew uuid, p_worker uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.crews c where c.id = p_crew and c.org_id = public.auth_org_id()
                  and c.field_controller_id = auth.uid())
      or exists (select 1 from public.people w where w.id = p_worker and w.org_id = public.auth_org_id()
                  and w.profile_id = auth.uid())
$$;
revoke all on function public.light_can_see_crew_member(uuid, uuid) from public, anon;
grant execute on function public.light_can_see_crew_member(uuid, uuid) to authenticated;

-- A work order is visible to a light account when a crew it can see is rostered on it today.
create function public.light_can_see_work_order(p_wo uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.work_order_crews r
     where r.work_order_id = p_wo and r.org_id = public.auth_org_id()
       and public.equipment_org_today(r.org_id) between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
       and public.light_can_see_crew(r.crew_id))
$$;
revoke all on function public.light_can_see_work_order(uuid) from public, anon;
grant execute on function public.light_can_see_work_order(uuid) to authenticated;
