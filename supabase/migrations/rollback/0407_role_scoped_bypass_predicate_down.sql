-- Rolling back 0407 must leave the surviving import-run entry point (0399) callable: this file
-- first restores its pre-0407 self-contained body (the inline session-role lookup 0399 originally
-- shipped on fix/audit-pr2 — create or replace preserves the function's ACL and owner, so the
-- restored surface behaves byte-equivalently to the pre-0407 state), and only then drops the
-- overload the delegating body called.
create or replace function public.start_procurement_import_run(p_org_id uuid default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_selected_role text := current_setting('role', true);
  v_bypass boolean;
  v_org uuid;
  v_id uuid;
begin
  if v_selected_role is null or v_selected_role = 'none' then v_selected_role := session_user; end if;
  select coalesce(r.rolbypassrls, false) into v_bypass from pg_catalog.pg_roles r where r.rolname = v_selected_role;
  if coalesce(v_bypass, false) then
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

drop function public.actor_bypasses_rls(p_role name);
