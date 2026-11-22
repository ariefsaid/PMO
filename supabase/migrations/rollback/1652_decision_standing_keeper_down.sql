-- 1652 down: standing without the keeper fact (the 1560 body).
create or replace function public.my_decision_standing() returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  perform public.assert_not_light();
  if v_role is null or v_uid is null then return false; end if;
  if v_role in ('Admin', 'Executive', 'Project Manager', 'Finance') then return true; end if;
  return exists (select 1 from public.approval_chain_steps s where s.org_id = v_org and s.role = v_role)
      or exists (select 1 from public.approval_step_pins pin where pin.approver_id = v_uid)
      or exists (select 1 from public.approval_stand_ins si where si.org_id = v_org and si.stand_in_id = v_uid and si.revoked_at is null
                  and si.ends_on >= public.native_org_today(v_org))
      or exists (select 1 from public.profiles m where m.org_id = v_org and m.manager_id = v_uid and m.status = 'active');
end; $$;
revoke all on function public.my_decision_standing() from public, anon;
grant execute on function public.my_decision_standing() to authenticated;
