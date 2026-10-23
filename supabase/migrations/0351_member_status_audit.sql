-- 0351_member_status_audit.sql — record profile status and role transitions in audit_events.
-- Table-level capture covers RPC, direct RLS-authorized updates, and service-role writes.
-- Rollback: supabase/migrations/rollback/0351_member_status_audit_down.sql.

create or replace function public.audit_profile_membership_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    perform public.log_audit(
      'member.status_changed', new.org_id, auth.uid(), new.id,
      jsonb_build_object('from', old.status::text, 'to', new.status::text)
    );
  end if;

  if old.role is distinct from new.role then
    perform public.log_audit(
      'member.role_changed', new.org_id, auth.uid(), new.id,
      jsonb_build_object('from', old.role::text, 'to', new.role::text)
    );
  end if;
  return new;
end; $$;

revoke all on function public.audit_profile_membership_change() from public, anon, authenticated;

drop trigger if exists profiles_audit_membership_change on public.profiles;
create trigger profiles_audit_membership_change
  after update of status, role on public.profiles
  for each row execute function public.audit_profile_membership_change();
