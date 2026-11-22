-- Rollback of 1376_billing_plan_candidates_read.sql: the read function only; no data is touched.
drop function if exists public.billing_plan_candidates(uuid);
