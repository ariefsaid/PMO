-- Reverses 1330_mrq_usage_threshold_settings.sql.
drop function if exists public.mrq_set_usage_thresholds(numeric, numeric);
alter table public.material_request_settings
  drop constraint if exists material_request_settings_usage_pct_order,
  drop constraint if exists material_request_settings_usage_pct_2_range,
  drop constraint if exists material_request_settings_usage_pct_1_range,
  drop column if exists usage_warn_pct_2,
  drop column if exists usage_warn_pct_1;
