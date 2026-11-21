-- Reverses 1331_mrq_usage_alerts.sql (run 1332's rollback first: mrq_submit calls mrq_usage_check).
drop function if exists public.mrq_usage_check(uuid);
drop table if exists public.material_request_usage_alerts;
