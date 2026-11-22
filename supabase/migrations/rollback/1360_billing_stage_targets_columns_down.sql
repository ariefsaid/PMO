-- 1360 down. Run the later downs (1363, 1362, 1361) first. Refuses while any claim stage holds a skip, a target or an overdue
-- stamp: dropping the columns would erase how that claim reached its invoice.
do $$ begin
  if exists (select 1 from public.claim_billing_stages where skipped_on is not null or target_days is not null or overdue_notified_at is not null) then
    raise exception 'claim stages carry skips, targets or overdue stamps; 1360 cannot be rolled back' using errcode = 'P0001';
  end if;
end $$;
drop index if exists public.claim_billing_stages_overdue_idx;
alter table public.claim_billing_stages
  drop constraint if exists claim_billing_stages_skip_shape,
  drop constraint if exists claim_billing_stages_not_both,
  drop column if exists overdue_notified_at, drop column if exists skipped_reason, drop column if exists skipped_by,
  drop column if exists skipped_on, drop column if exists optional, drop column if exists target_days;
alter table public.billing_stage_templates drop column if exists optional, drop column if exists target_days;
