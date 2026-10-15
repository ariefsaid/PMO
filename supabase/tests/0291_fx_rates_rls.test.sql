-- AC-FX-001: active-member organization reads and Finance/Admin-only writes.
begin;
create extension if not exists pgtap;
select no_plan();

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  actor uuid;
  role_name text;
  status_name text;
  actor_key text;
  roles text[] := array['Admin','Finance','Executive','Project Manager','Engineer','Finance','Admin'];
  states text[] := array['active','active','active','active','active','disabled','active'];
  orgs uuid[];
  keys text[] := array['admin','finance','executive','pm','engineer','disabled','other'];
  i integer;
begin
  insert into public.organizations(id,name,default_currency,default_timezone) values
    (a,'Synthetic FX Org A','IDR','Asia/Jakarta'),(b,'Synthetic FX Org B','IDR','UTC');
  orgs := array[a,a,a,a,a,a,b];
  for i in 1..7 loop
    actor := gen_random_uuid(); role_name := roles[i]; status_name := states[i]; actor_key := keys[i];
    insert into auth.users(id,email) values(actor, actor::text || '@example.invalid');
    insert into public.profiles(id,org_id,full_name,email,role,status)
      values(actor,orgs[i],'Synthetic FX '||actor_key,actor::text||'@example.invalid',role_name::public.user_role,status_name::public.profile_status);
    perform set_config('fx.'||actor_key,actor::text,true);
  end loop;
  perform set_config('fx.org_a',a::text,true);
  perform set_config('fx.org_b',b::text,true);
  insert into public.fx_rates(org_id,rate_date,rate) values
    (a,'2026-10-09',16234.56),(b,'2026-10-09',18000);
end $$;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.admin'),'role','authenticated')::text,true);
select is((select count(*)::integer from public.fx_rates),1,'AC-FX-001 Admin reads one own-org rate');
select lives_ok($$insert into public.fx_rates(rate_date,rate) values('2026-10-08',16235)$$,'AC-FX-001 Admin inserts own-org rate');
select lives_ok($$update public.fx_rates set rate=16236 where rate_date='2026-10-08'$$,'AC-FX-001 Admin updates own-org rate');
select throws_ok($$update public.fx_rates set org_id='00000000-0000-0000-0000-000000000000' where rate_date='2026-10-08'$$,'42501',null,'AC-FX-001 Admin cannot update organization stamp');
select throws_ok($$update public.fx_rates set created_by='00000000-0000-0000-0000-000000000000' where rate_date='2026-10-08'$$,'42501',null,'AC-FX-001 Admin cannot update audit stamp');

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.finance'),'role','authenticated')::text,true);
select is((select count(*)::integer from public.fx_rates),2,'AC-FX-001 Finance reads only its own organization');
select lives_ok($$insert into public.fx_rates(rate_date,rate) values('2026-10-07',16234)$$,'AC-FX-001 Finance inserts own-org rate');
select lives_ok($$update public.fx_rates set rate=16237 where rate_date='2026-10-07'$$,'AC-FX-001 Finance updates rate');
select is((select count(*)::integer from public.fx_rates where org_id=current_setting('fx.org_b')::uuid),0,'AC-FX-001 Finance cannot read foreign rows');
with changed as (
  update public.fx_rates set rate=19000
   where org_id=current_setting('fx.org_b')::uuid and rate_date='2026-10-09' returning 1
)
select is((select count(*)::integer from changed),0,'AC-FX-001 Finance direct update affects no foreign rows');
select lives_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-10-06","rate":16234.56}]'::jsonb)$$,'AC-FX-001 Finance calls atomic writer');
select is(public.upsert_fx_rates('[{"rate_date":"2026-10-06","rate":16234.56}]'::jsonb),'{"new":0,"changed":0,"unchanged":1}'::jsonb,'AC-FX-002 identical writer call is unchanged');
select is(public.upsert_fx_rates('[{"rate_date":"2026-10-06","rate":16235}]'::jsonb),'{"new":0,"changed":1,"unchanged":0}'::jsonb,'AC-FX-002 changed writer call reports changed');

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.executive'),'role','authenticated')::text,true);
select is((select count(*)::integer from public.fx_rates),4,'AC-FX-001 Executive reads own-org rates');
select throws_ok($$insert into public.fx_rates(rate_date,rate) values('2026-10-05',16234)$$,'42501',null,'AC-FX-001 Executive direct insert denied');
update public.fx_rates set rate=17000 where rate_date='2026-10-09';
select is((select rate::text from public.fx_rates where rate_date='2026-10-09'),'16234.560000','AC-FX-001 Executive update affects no rows');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-10-05","rate":16234}]'::jsonb)$$,'42501',null,'AC-FX-001 Executive writer denied');

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.pm'),'role','authenticated')::text,true);
select is((select count(*)::integer from public.fx_rates),4,'AC-FX-001 PM reads own-org rates');
select throws_ok($$insert into public.fx_rates(rate_date,rate) values('2026-10-04',16234)$$,'42501',null,'AC-FX-001 PM direct insert denied');
update public.fx_rates set rate=17000 where rate_date='2026-10-09';
select is((select rate::text from public.fx_rates where rate_date='2026-10-09'),'16234.560000','AC-FX-001 PM update affects no rows');

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.engineer'),'role','authenticated')::text,true);
select is((select count(*)::integer from public.fx_rates),4,'AC-FX-001 Engineer reads own-org rates');
select throws_ok($$insert into public.fx_rates(rate_date,rate) values('2026-10-03',16234)$$,'42501',null,'AC-FX-001 Engineer direct insert denied');
update public.fx_rates set rate=17000 where rate_date='2026-10-09';
select is((select rate::text from public.fx_rates where rate_date='2026-10-09'),'16234.560000','AC-FX-001 Engineer update affects no rows');

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.disabled'),'role','authenticated')::text,true);
select is((select count(*)::integer from public.fx_rates),0,'AC-FX-001 disabled member reads none');
select throws_ok($$insert into public.fx_rates(rate_date,rate) values('2026-10-02',16234)$$,'42501',null,'AC-FX-001 disabled Finance insert denied');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-10-02","rate":16234}]'::jsonb)$$,'42501',null,'AC-FX-001 disabled Finance writer denied');

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.other'),'role','authenticated')::text,true);
select is((select count(*)::integer from public.fx_rates),1,'AC-FX-001 other-org Admin reads only own-org rate');
select lives_ok($$insert into public.fx_rates(rate_date,rate) values('2026-09-30',16234)$$,'AC-FX-001 other-org Admin may write in its own organization');
select is((select org_id from public.fx_rates where rate_date='2026-09-30'),current_setting('fx.org_b')::uuid,'AC-FX-001 write is stamped into the caller organization');

reset role;
set local role anon;
select throws_ok($$select * from public.fx_rates$$,'42501',null,'AC-FX-001 anonymous select denied');
select throws_ok($$insert into public.fx_rates(rate_date,rate) values('2026-10-01',16000)$$,'42501',null,'AC-FX-001 anonymous write denied');
reset role;
select ok(not has_table_privilege('authenticated','public.fx_rates','DELETE'),'AC-FX-001 no authenticated DELETE privilege');
select ok(not has_column_privilege('authenticated','public.fx_rates','org_id','UPDATE'),'AC-FX-001 org_id is not updateable');
select ok(not has_column_privilege('authenticated','public.fx_rates','created_by','INSERT'),'AC-FX-001 created_by is not insertable');
select ok(not has_column_privilege('authenticated','public.fx_rates','created_at','UPDATE'),'AC-FX-001 timestamps are not updateable');
select ok(not has_table_privilege('anon','public.fx_rates','SELECT'),'AC-FX-001 anonymous reads are not granted');
select ok(not has_table_privilege('anon','public.fx_rates','INSERT'),'AC-FX-001 anonymous writes are not granted');

select * from finish();
rollback;
