-- Rollback of 1771: remove the policies, helpers, grants and the two capabilities (the 1539 CHECK list returns).
drop policy if exists work_order_billing_step_documents_select on public.work_order_billing_step_documents;
drop policy if exists work_order_billing_steps_select on public.work_order_billing_steps;
drop function if exists public.wo_step_readable(uuid, text, text[]);
drop function if exists public.actor_may_run_billing_steps();
drop function if exists public.actor_may_see_billing_steps();
delete from public.built_in_role_capabilities where capability in ('billing_steps_view', 'billing_steps_run');
alter table public.built_in_role_capabilities drop constraint built_in_role_capabilities_capability_check;
alter table public.built_in_role_capabilities add constraint built_in_role_capabilities_capability_check
  check (capability in ('sees_prices', 'daily_report_enter', 'daily_report_validate', 'people_documents_view', 'medical_documents_view'));
