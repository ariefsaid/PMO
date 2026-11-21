-- Rollback 1290 (run after rolling back 1292 and 1291).
create or replace function public.audit_spend_approver_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('spend_approver.add', new.org_id, auth.uid(), new.id,
      jsonb_build_object('project_id', new.project_id, 'profile_id', new.profile_id));
    return new;
  end if;
  perform public.log_audit('spend_approver.remove', old.org_id, auth.uid(), old.id,
    jsonb_build_object('project_id', old.project_id, 'profile_id', old.profile_id));
  return old;
end; $$;
revoke all on function public.audit_spend_approver_change() from public, anon, authenticated;
revoke insert (min_amount) on public.spend_approvers from authenticated;
alter table public.spend_approvers drop column if exists min_amount;
drop table if exists public.spend_approval_settings;
drop function if exists public.audit_spend_approval_settings_change();
drop function if exists public.touch_spend_approval_settings();
