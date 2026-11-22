-- 1285_performance_indices_settings.sql — #2597: organisation settings for the cost and schedule performance panels.
-- Spec: docs/specs/work-order-performance-indices.spec.md (AC-CSP-019, AC-CSP-020). Proven by
-- supabase/tests/performance_indices_settings.test.sql.
--   performance_indices_enabled  the panels change existing screens, so they are OFF until an Admin turns them on.
--   performance_band_low / high  the reading bands (OD-SCOPE-2: limits are settings, not code); 0 < low < 1 < high.
-- Written by an Admin of the own organisation only: the existing own-org, active-member, Admin-only organisation
-- update policy applies (0207/0231); this migration adds a column-scoped grant and no policy.
-- Reverse: rollback/1285_performance_indices_settings_down.sql.
alter table public.organizations
  add column performance_indices_enabled boolean not null default false,
  add column performance_band_low  numeric(3,2) not null default 0.90,
  add column performance_band_high numeric(3,2) not null default 1.10,
  add constraint organizations_performance_bands check (performance_band_low > 0 and performance_band_low < 1 and performance_band_high > 1);

grant update (performance_indices_enabled, performance_band_low, performance_band_high) on public.organizations to authenticated;
