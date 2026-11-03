-- Reverse 0531_plan_catalogue.sql without deleting existing org_features overrides.
do $$
begin
  if exists (
    select 1 from public.org_features
     where feature_key not in (
       'incidents', 'crm', 'procurement', 'timesheets', 'import_export', 'agent_assistant',
       'user_views', 'm365_integration', 'revenue', 'feedback_surveys'
     )
  ) then
    raise exception 'cannot restore the prior org_features key check while new-key overrides exist';
  end if;
end $$;

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views','m365_integration','revenue','feedback_surveys'));

-- Plan assignments were introduced by this lane and have no representation in the pre-plan model.
-- Remove all assignments before deleting the referenced plan catalogue; the organizations and
-- their org_features override rows remain in place.
delete from public.org_plans;
delete from public.global_features;
delete from public.plan_features;
delete from public.plans;
