-- Rollback of 0351_member_status_audit.sql.
drop trigger if exists profiles_audit_membership_change on public.profiles;
drop function if exists public.audit_profile_membership_change();
