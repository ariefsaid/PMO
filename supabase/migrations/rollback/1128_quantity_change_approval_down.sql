-- Reverses 1128_quantity_change_approval.sql.
drop function if exists public.qcr_record_decision(uuid, text, date, text);
drop function if exists public.qcr_record_sent(uuid, date, text);
drop function if exists public.qcr_return(uuid, text);
drop function if exists public.qcr_approve(uuid);
drop function if exists public.qcr_assert_approver(public.quantity_change_requests);
drop function if exists public.qcr_org_today(uuid);
