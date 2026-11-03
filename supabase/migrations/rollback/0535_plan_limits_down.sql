-- rollback/0535_plan_limits_down.sql — reverse of 0535_plan_limits.sql (ADR-0006).
--
-- Order matters: the cron job must stop before its function disappears, and the system-granted credits
-- rows must go before `granted_by` can be NOT NULL again.
--
-- ⚑ What this rollback does NOT do: it cannot put back a policy that let an org exceed its seats.
-- Removing the guards simply restores the pre-0535 behaviour (unlimited invites / projects that used
-- to be uncapped). Nothing else in the schema depends on them.

-- 1. Stop the job (idempotent: only if it is registered).
select cron.unschedule('plan-monthly-ai-allowance')
 where exists (select 1 from cron.job where jobname = 'plan-monthly-ai-allowance');

-- 2. The guards (both triggers per table: the invoker org guard and the definer cap/seat count).
drop trigger if exists projects_zz_plan_cap_guard on public.projects;
drop trigger if exists projects_zy_plan_org_guard on public.projects;
drop function if exists public.enforce_org_project_limit();
drop function if exists public.assert_project_plan_org();
drop trigger if exists profiles_zz_plan_seat_guard on public.profiles;
drop trigger if exists profiles_zy_plan_org_guard on public.profiles;
drop function if exists public.enforce_org_seat_limit();
drop function if exists public.assert_profile_plan_org();

-- 3. The allowance job, its ledger and its generated credits. The ledger records each generated
--    credit's ID so rollback removes those exact rows before dropping the ledger.
drop function if exists public.plan_monthly_ai_allowance_tick(date);
delete from public.credits c
 using public.org_ai_allowance_grants g
 where c.id = g.credit_id;
drop table if exists public.org_ai_allowance_grants;

-- 4. Attribution returns to the pre-0535 contract (safe: no system grant rows remain).
drop policy if exists credits_grant_source_operator_only on public.credits;
alter table public.credits drop constraint if exists credits_granted_by_source_check;
alter table public.credits drop constraint if exists credits_grant_source_check;
alter table public.credits drop column if exists grant_source;
alter table public.credits alter column granted_by set not null;

-- 5. The remaining helpers.
drop function if exists public.plan_ai_credit_unit_usd();
drop function if exists public.assert_seat_available(uuid);
drop function if exists public.plan_enforce_seat_limit(uuid);
drop function if exists public.plan_enforce_seat_limit(uuid, uuid);
drop function if exists public.org_seat_usage(uuid);
drop function if exists public.org_seat_usage(uuid, uuid);
drop function if exists public.org_plan_limits(uuid);
drop function if exists public.project_counts_toward_limit(public.project_status, timestamptz);

notify pgrst, 'reload schema';
