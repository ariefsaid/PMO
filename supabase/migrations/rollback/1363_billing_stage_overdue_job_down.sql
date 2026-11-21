-- 1363 down.
select cron.unschedule('billing-stage-overdue');
drop function if exists public.notify_overdue_billing_stages();
drop function if exists public.billing_stage_overdue_recipients(public.claim_billing_stages);
drop function if exists public.billing_stage_due_on(public.claim_billing_stages);
