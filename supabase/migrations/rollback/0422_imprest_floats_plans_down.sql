-- 0422_imprest_floats_plans_down.sql — reverse of 0422 (#1515 site imprest S1), reverse dependency order.
drop function if exists public.transition_imprest_plan(uuid, text, text);
drop function if exists public.decide_imprest_float_change(uuid, boolean, text);
drop function if exists public.propose_imprest_float_amount(uuid, numeric);
drop function if exists public.establish_imprest_float(uuid, uuid, numeric);
drop function if exists public.set_imprest_procurement_limit(numeric);
drop table if exists public.imprest_plan_lines;      -- drops its trigger
drop table if exists public.imprest_plans;
drop table if exists public.imprest_replenishments;
drop table if exists public.imprest_float_changes;
drop table if exists public.imprest_floats;
drop table if exists public.org_imprest_settings;
drop function if exists public.sync_imprest_plan_total();
drop function if exists public.assert_imprest_plan_line_editable();
drop function if exists public.stamp_imprest_plan_org();
drop function if exists public.imprest_funded(uuid);
drop function if exists public.imprest_lock_float(uuid);
drop function if exists public.imprest_senior_route(uuid, uuid);
drop function if exists public.imprest_custodian_eligible(uuid, uuid, uuid);
-- (procurement_doc_counters rows with prefix IMP/REP are harmless; leave them.)
