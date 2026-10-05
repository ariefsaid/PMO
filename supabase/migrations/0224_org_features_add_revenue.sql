-- 0224_org_features_add_revenue.sql — add the 'revenue' entitlement key to the org_features CHECK
-- registry (0070, widened by 0107). The FE has declared `revenue` in FEATURE_KEYS (default OFF) since
-- the Finance section shipped (Sales Invoices, Incoming Payments, Revenue by Project), but the CHECK
-- never accepted it — operator_toggle_feature raised 23514, so no org could be entitled to the
-- section. Toggled via the existing operator_toggle_feature RPC; default-OFF stays an FE concern.
-- Guarded against drift by pmo-portal/src/lib/features.dbRegistry.test.ts.
-- Reversibility (ADR-0006): supabase db reset. Manual reverse (only after deleting 'revenue' rows):
--   alter table public.org_features drop constraint org_features_feature_key_check;
--   alter table public.org_features add constraint org_features_feature_key_check
--     check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
--                            'agent_assistant','user_views','m365_integration'));

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views','m365_integration','revenue'));
