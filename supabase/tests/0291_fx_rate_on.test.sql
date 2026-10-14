-- AC-FX-003: one stable invoker selector returns the last publication on/before the request.
begin;
create extension if not exists pgtap;
select no_plan();

do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
begin
  insert into public.organizations(id,name,default_timezone) values(a,'Synthetic FX Selector A','Asia/Jakarta'),(b,'Synthetic FX Selector B','UTC');
  insert into auth.users(id,email) values(u_a,u_a::text||'@example.invalid'),(u_b,u_b::text||'@example.invalid');
  insert into public.profiles(id,org_id,full_name,email,role,status) values
    (u_a,a,'Synthetic FX Selector A',u_a::text||'@example.invalid','Finance','active'),
    (u_b,b,'Synthetic FX Selector B',u_b::text||'@example.invalid','Admin','active');
  perform set_config('fx.selector_org_a',a::text,true);
  perform set_config('fx.selector_org_b',b::text,true);
  perform set_config('fx.selector_actor_a',u_a::text,true);
  perform set_config('fx.selector_actor_b',u_b::text,true);
  insert into public.fx_rates(org_id,rate_date,rate) values
    (a,'2026-10-09',16234.56),(a,'2026-10-12',16300),(b,'2026-10-09',18000);

  -- A broad synthetic history keeps the selector and keyset-page checks representative without
  -- making the planner's chosen node a brittle assertion. The test transaction rolls these rows back.
  alter table public.fx_rates disable trigger user;
  insert into public.fx_rates(org_id,rate_date,rate)
  select a, date '2000-01-01' + day, 16000 + (day % 500)
    from generate_series(0,9000) as series(day);
  alter table public.fx_rates enable trigger user;
end $$;

select ok((select provolatile='s' and not prosecdef from pg_proc where oid='public.fx_rate_on(text,text,date)'::regprocedure),'AC-FX-003 selector is STABLE SECURITY INVOKER');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.selector_actor_a'),'role','authenticated')::text,true);
select is((select count(*)::integer from (
    select rate_date from public.fx_rates where org_id=public.auth_org_id()
    order by rate_date desc limit 51
  ) page),51,'AC-FX-003 keyset listing remains bounded to page plus sentinel across a large history');
select is((select rate::text||':'||rate_date::text from public.fx_rate_on('USD','IDR','2026-10-10')),
  '16234.560000:2026-10-09','AC-FX-003 Saturday uses Friday publication');
select is((select rate::text||':'||rate_date::text from public.fx_rate_on('USD','IDR','2026-10-09')),
  '16234.560000:2026-10-09','AC-FX-003 Friday selects exact publication');
select is((select rate::text||':'||rate_date::text from public.fx_rate_on('USD','IDR','2026-10-12')),
  '16300.000000:2026-10-12','AC-FX-003 Monday selects Monday publication');
select is((select count(*)::integer from public.fx_rate_on('USD','IDR','1999-12-31')),0,'AC-FX-003 earlier-than-history date returns absence');
select is((select count(*)::integer from public.fx_rate_on('USD','IDR',null)),0,'AC-FX-003 null date returns absence');
select is((select count(*)::integer from public.fx_rate_on('IDR','USD','2026-10-12')),0,'AC-FX-003 inverse pair returns absence');
select is((select count(*)::integer from public.fx_rate_on('USD','EUR','2026-10-12')),0,'AC-FX-003 unsupported pair returns absence');
select is((select count(*)::integer from public.fx_rates where org_id=current_setting('fx.selector_org_b')::uuid),0,'AC-FX-003 cross-org rows are invisible');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.selector_actor_b'),'role','authenticated')::text,true);
select is((select rate::text||':'||rate_date::text from public.fx_rate_on('USD','IDR','2026-10-10')),
  '18000.000000:2026-10-09','AC-FX-003 other organization gets only its own rate');
reset role;
select ok(not has_function_privilege('anon','public.fx_rate_on(text,text,date)','EXECUTE'),'AC-FX-003 anonymous cannot invoke selector');
select * from finish();
rollback;
