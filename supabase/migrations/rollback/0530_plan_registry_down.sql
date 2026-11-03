-- Reverse 0530_plan_registry.sql in dependency order. Existing organization data is untouched.
drop table if exists public.global_features;
drop table if exists public.org_plans;
drop table if exists public.plan_features;
drop table if exists public.plans;
