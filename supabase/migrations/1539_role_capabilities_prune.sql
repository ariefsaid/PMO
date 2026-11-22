-- 1539: the role capability catalogue keeps the capabilities that something decides, and two that are held for a ruling
-- (daily_report_enter, daily_report_validate: see 2716). Five capabilities with no gate are removed, with the five helpers
-- that nothing calls (the tier column stays: it is catalogue data the role pickers read).
-- Rollback: supabase/migrations/rollback/1539_role_capabilities_prune_down.sql
-- Source of the removed bodies: 1200 (built_in_role_tier, built_in_role_may_approve/prepare/stand_in) and 1203 (actor_holds_built_in_role),
-- the only migrations that define them; no later migration redefines them.

delete from public.built_in_role_capabilities
 where capability in ('stock_post', 'stock_approve', 'crew_time_approve', 'billing_stage_run', 'invoice_raise');

alter table public.built_in_role_capabilities drop constraint built_in_role_capabilities_capability_check;
alter table public.built_in_role_capabilities add constraint built_in_role_capabilities_capability_check
  check (capability in ('sees_prices', 'daily_report_enter', 'daily_report_validate', 'people_documents_view', 'medical_documents_view'));

drop function public.actor_holds_built_in_role(text);
drop function public.built_in_role_may_stand_in(text, text);
drop function public.built_in_role_may_prepare(text);
drop function public.built_in_role_may_approve(text);
drop function public.built_in_role_tier(text);
