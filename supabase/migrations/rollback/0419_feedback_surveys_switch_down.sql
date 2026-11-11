-- Rolls back 0419. Any stored feedback_surveys row is deleted first (the narrower CHECK would reject it);
-- the org then reads as "on" again, which is the default.
drop function if exists public.admin_set_feedback_surveys(boolean);
drop policy if exists org_features_admin_feedback_update on public.org_features;
drop policy if exists org_features_admin_feedback_insert on public.org_features;
delete from public.org_features where feature_key = 'feedback_surveys';
alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views','m365_integration','revenue'));
