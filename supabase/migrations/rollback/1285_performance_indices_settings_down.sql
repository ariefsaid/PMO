-- Reverses 1285_performance_indices_settings.sql (drop 1286 first).
alter table public.organizations
  drop constraint if exists organizations_performance_bands,
  drop column if exists performance_indices_enabled,
  drop column if exists performance_band_low,
  drop column if exists performance_band_high;
