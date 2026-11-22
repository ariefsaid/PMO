-- 1202 (#2709): profiles.built_in_role — the stable key of the built-in role a person holds (NULL = none, every existing person).
-- Rollback: supabase/migrations/rollback/1202_profiles_built_in_role_down.sql
--
-- profiles.role stays the base access level. While a key is held, role = built_in_role_base(key), kept by the trigger below.
-- Who may assign: the EXISTING profile-administration rule (profiles_hierarchy_update, ADR-0070) is evaluated on the post-image
-- role this trigger writes, so no one may assign a key whose base level they may not assign. Nobody changes their own key.
-- While the organization setting is off (1201) no key may be set.

alter table public.profiles
  add column built_in_role text references public.built_in_roles(key);

comment on column public.profiles.built_in_role is
  '#2709 stable key of the built-in role (public.built_in_roles). NULL = the person holds one of the five access levels only. '
  'role is forced to built_in_role_base(built_in_role) while this is set. Assigned only through the profile-administration rule.';

grant update (built_in_role) on public.profiles to authenticated;

create function public.profiles_built_in_role_sync() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and new.built_in_role is not distinct from old.built_in_role then
    -- Key untouched: while one is held the access level moves only with it.
    if new.built_in_role is not null and new.role is distinct from old.role then
      raise exception 'this person holds a built-in role; change the built-in role, not the access level'
        using errcode = '23514', hint = 'built_in_role_holds_access_level';
    end if;
    return new;
  end if;

  if new.built_in_role is null then
    -- INSERT without a key (every existing path) or a key being cleared: the access level stays as written.
    if tg_op = 'UPDATE' and auth.uid() is not null and new.id = auth.uid() then
      raise exception 'you cannot change your own built-in role' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null and new.id = auth.uid() then
    raise exception 'you cannot change your own built-in role' using errcode = '42501';
  end if;
  if not public.org_built_in_roles_enabled(new.org_id) then
    raise exception 'built-in roles are not turned on for this organization'
      using errcode = 'P0001', hint = 'built_in_roles_disabled';
  end if;
  new.role := public.built_in_role_base(new.built_in_role);
  return new;
end
$$;

revoke all on function public.profiles_built_in_role_sync() from public, anon, authenticated;

create trigger profiles_built_in_role_sync
  before insert or update on public.profiles
  for each row execute function public.profiles_built_in_role_sync();
