-- 0105_org_features_add_m365.sql — extend the org_features CHECK registry (0070) with the
-- 'm365_integration' entitlement key (ADR-0058 §Decision 3 two-switch; FR-M365-010). Operator-owned
-- entitlement switch; toggled via the EXISTING operator_toggle_feature RPC (no new RPC). Default-OFF
-- is an FE concern (FEATURE_ENV_DEFAULT.m365_integration=false) — absence of a row + env default false
-- keeps the integration hidden until an Operator entitles it. The inline CHECK from 0070 is auto-named
-- org_features_feature_key_check; drop+recreate to widen it.
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   alter table public.org_features drop constraint org_features_feature_key_check;
--   alter table public.org_features add constraint org_features_feature_key_check
--     check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
--                            'agent_assistant','user_views'));

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views','m365_integration'));
