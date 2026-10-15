begin;
drop function if exists public.upsert_fx_rates(jsonb);
drop function if exists public.fx_rate_on(text,text,date);
drop table if exists public.fx_rates;
drop function if exists public.audit_fx_rate();
drop function if exists public.stamp_fx_rate();
commit;
