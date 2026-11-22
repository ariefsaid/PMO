-- Rollback of 1510_org_setting_audit.sql. Audit rows already written stay.
drop trigger if exists zz_audit_org_setting_change on public.organizations;
drop trigger if exists zz_audit_org_setting_change on public.org_crew_tool_settings;
drop trigger if exists zz_audit_org_setting_change on public.org_revenue_plan_settings;
drop trigger if exists zz_audit_org_setting_change on public.work_order_stock_settings;
drop trigger if exists zz_audit_org_setting_change on public.org_purchase_type_settings;
drop trigger if exists zz_audit_org_setting_change on public.issue_closing_report_settings;
drop trigger if exists zz_audit_org_setting_change on public.purchase_order_settings;
drop trigger if exists zz_audit_org_setting_change on public.email_org_settings;
drop trigger if exists zz_audit_org_setting_change on public.email_event_settings;
drop function if exists public.audit_org_setting_change();
