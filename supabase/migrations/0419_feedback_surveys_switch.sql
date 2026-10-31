-- 0419_feedback_surveys_switch.sql — the org Admin switch for the feedback widget and surveys (#1532 S9).
-- Proven by supabase/tests/0419_feedback_surveys_switch.test.sql (AC-PHO-090).
--
-- Owner ruling (2026-10-31): the demo deployment has feedback and surveys on; a real org has them on by
-- default and its Admin can switch them off. Absence of a row = on (FR-ENT-004), so no backfill.
--
-- Shape: one new `org_features` key, written ONLY through `admin_set_feedback_surveys` (security definer,
-- active Admin of the caller's own org). Every other key stays Operator-only: the new policy is pinned to
-- this one key and to insert/update (no delete), so the Operator path in 0070 is unchanged.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse: supabase/migrations/rollback/0419_feedback_surveys_switch_down.sql

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views','m365_integration','revenue','feedback_surveys'));

-- Table is `force row level security`, so the definer below is itself subject to RLS (see 0070): these two
-- policies are what let it write, and they only ever match the feedback_surveys key of the caller's org.
create policy org_features_admin_feedback_insert on public.org_features for insert
  with check (feature_key = 'feedback_surveys' and org_id = public.auth_org_id()
              and public.is_active_member() and public.auth_role() = 'Admin');
create policy org_features_admin_feedback_update on public.org_features for update
  using (feature_key = 'feedback_surveys' and org_id = public.auth_org_id()
         and public.is_active_member() and public.auth_role() = 'Admin')
  with check (feature_key = 'feedback_surveys' and org_id = public.auth_org_id()
              and public.is_active_member() and public.auth_role() = 'Admin');

create or replace function public.admin_set_feedback_surveys(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  insert into public.org_features (org_id, feature_key, enabled, updated_by)
    values (public.auth_org_id(), 'feedback_surveys', p_enabled, auth.uid())
  on conflict (org_id, feature_key) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
end $$;

revoke all on function public.admin_set_feedback_surveys(boolean) from public;
grant execute on function public.admin_set_feedback_surveys(boolean) to authenticated;
