-- One trust-boundary predicate, two entry points — and the definer that needs the caller-role form.
--
-- (1) The name-parameter overload: the no-arg actor_bypasses_rls() (0174) reads current_user, which
-- is correct for the SECURITY INVOKER guards it serves, but inside a SECURITY DEFINER function
-- current_user is the function owner, never the caller — a definer that called the no-arg form
-- would exempt every caller. The parameterized form lets a definer resolve the CALLER's session
-- role and feed it through the same lookup, so 0168 AC-UPS-053's rule holds: exactly one
-- definition of the predicate, and it lives under the actor_bypasses_rls name.
--
-- (2) The import-run entry point (0399) is a SECURITY DEFINER that needs exactly this caller-role
-- resolution, so its body is replaced here with the delegating form. Its original inline copy is
-- restored verbatim by this migration's rollback before the overload is dropped, so a rollback
-- leaves the function callable with its pre-0407 behavior.
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

create or replace function public.start_procurement_import_run(p_org_id uuid default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid;
  v_id uuid;
begin
  -- SECURITY DEFINER: current_user inside this body is the owner, never the caller, so the bypass
  -- check resolves the CALLER's session role and hands it to the one shared trust-boundary
  -- predicate through its name-parameter entry point (0168 AC-UPS-053: exactly one copy of the
  -- catalog lookup, under the actor_bypasses_rls name). The no-arg form would always read postgres
  -- here and exempt every caller.
  if public.actor_bypasses_rls(coalesce(nullif(current_setting('role', true), 'none'), session_user)) then
    v_org := p_org_id;
  else
    perform public.assert_is_active_member();
    v_org := public.auth_org_id();
    if p_org_id is not null and p_org_id is distinct from v_org then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;
  if v_org is null then raise exception 'organization required' using errcode = '42501'; end if;
  loop
    v_id := gen_random_uuid();
    begin
      insert into public.procurement_import_runs(id, org_id, identity_version) values (v_id, v_org, 2);
      return v_id;
    exception when unique_violation then null;
    end;
  end loop;
end $$;
