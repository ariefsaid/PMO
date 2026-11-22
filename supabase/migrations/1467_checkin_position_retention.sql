-- 1467_checkin_position_retention.sql -- a check-in's position is kept 90 days after its decision, then removed.
-- The daily job nulls latitude, longitude and accuracy on phone_check_ins 90 days after the decision (the check-in
-- time while a request is pending or the check-in went unrecorded); the check-in record itself stays: outcome,
-- decision and hours are the business history. Period per docs/retention.md, like the other fixed-period purges.
-- `cron.schedule` upserts by name. Rollback: supabase/migrations/rollback/1467_checkin_position_retention_down.sql

select cron.schedule(
  'phone-check-in-position-purge',
  '35 3 * * *',
  $$update public.phone_check_ins
       set lat = null, lng = null, accuracy_m = null
     where coalesce(decided_at, checked_in_at) < now() - interval '90 days'
       and (lat is not null or lng is not null or accuracy_m is not null)$$
);
