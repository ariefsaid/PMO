-- 1242_leave_settings.sql — #2708: the only write path for the leave settings. The organisations table has no
-- generic settings write route with an Admin check (each setting has its own, e.g. 1043), so this is an Admin-only
-- security-definer setter, audited. The approver role is a role key: today a base role, shaped so a built-in role
-- key can be accepted later by relaxing the check below.
--
-- ── REVERSE (also supabase/migrations/rollback/1242_leave_settings_down.sql) ──
--   drop function set_leave_settings.
create function public.set_leave_settings(p_enabled boolean, p_approver_role text)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_role text := nullif(btrim(p_approver_role), '');
begin
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can change the leave settings' using errcode = '42501';
  end if;
  if v_role is not null and v_role not in (select e::text from unnest(enum_range(null::public.user_role)) e) then
    raise exception 'LV_ROLE: unknown approver role' using errcode = '22023';
  end if;
  update public.organizations set leave_requests_enabled = coalesce(p_enabled, false), leave_approver_role = v_role
   where id = v_org;
  perform public.log_audit('org.leave_settings.change', v_org, auth.uid(), v_org,
            jsonb_build_object('enabled', coalesce(p_enabled, false), 'approver_role', v_role));
end $$;
revoke all on function public.set_leave_settings(boolean, text) from public, anon;
grant execute on function public.set_leave_settings(boolean, text) to authenticated;
