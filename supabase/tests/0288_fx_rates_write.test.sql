-- AC-FX-002: constrained, stamped and audited JISDOR reference rates.
begin;
create extension if not exists pgtap;
select no_plan();

do $$
declare v_org uuid;
begin
  insert into public.organizations(id, name, default_currency, default_timezone)
  values (gen_random_uuid(), 'Synthetic FX Test Org', 'IDR', 'Asia/Jakarta') returning id into v_org;
  perform set_config('fx.org', v_org::text, true);
end $$;

select has_table('public', 'fx_rates', 'AC-FX-002 table exists');
select has_column('public', 'fx_rates', 'id', 'AC-FX-002 id column');
select has_column('public', 'fx_rates', 'org_id', 'AC-FX-002 org_id column');
select has_column('public', 'fx_rates', 'rate_date', 'AC-FX-002 rate_date column');
select has_column('public', 'fx_rates', 'base_currency', 'AC-FX-002 base_currency column');
select has_column('public', 'fx_rates', 'quote_currency', 'AC-FX-002 quote_currency column');
select has_column('public', 'fx_rates', 'rate', 'AC-FX-002 rate column');
select has_column('public', 'fx_rates', 'source', 'AC-FX-002 source column');
select has_column('public', 'fx_rates', 'created_by', 'AC-FX-002 created_by column');
select has_column('public', 'fx_rates', 'updated_by', 'AC-FX-002 updated_by column');
select has_column('public', 'fx_rates', 'created_at', 'AC-FX-002 created_at column');
select has_column('public', 'fx_rates', 'updated_at', 'AC-FX-002 updated_at column');
select col_type_is('public', 'fx_rates', 'rate', 'numeric(18,6)', 'AC-FX-002 rate precision');

insert into public.fx_rates(org_id, rate_date, rate)
values(current_setting('fx.org')::uuid, '2026-10-09', 16234.56);
select is((select rate from public.fx_rates where org_id=current_setting('fx.org')::uuid),
          16234.56::numeric, 'AC-FX-002 rate retained exactly');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,rate) values(current_setting('fx.org')::uuid,'2026-10-08',0)$$,'23514',null,'AC-FX-002 zero rate rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,rate) values(current_setting('fx.org')::uuid,'2026-10-08',-1)$$,'23514',null,'AC-FX-002 negative rate rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,rate) values(current_setting('fx.org')::uuid,'2026-10-08','NaN'::numeric)$$,'23514',null,'AC-FX-002 non-finite rate rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,rate) values(current_setting('fx.org')::uuid,'2026-10-08',999)$$,'23514',null,'AC-FX-002 below-band rate rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,rate) values(current_setting('fx.org')::uuid,'2026-10-08',100001)$$,'23514',null,'AC-FX-002 above-band rate rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,base_currency,rate) values(current_setting('fx.org')::uuid,'2026-10-08','IDR',16000)$$,'23514',null,'AC-FX-002 unsupported base rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,quote_currency,rate) values(current_setting('fx.org')::uuid,'2026-10-08','USD',16000)$$,'23514',null,'AC-FX-002 unsupported quote rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,source,rate) values(current_setting('fx.org')::uuid,'2026-10-08','OTHER',16000)$$,'23514',null,'AC-FX-002 unsupported source rejected');
select throws_ok($$insert into public.fx_rates(org_id,rate_date,rate) values(current_setting('fx.org')::uuid,'2026-10-09',16000)$$,'23505',null,'AC-FX-002 duplicate date rejected');

do $$
declare v_actor uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values(v_actor,v_actor::text||'@example.invalid');
  insert into public.profiles(id,org_id,full_name,email,role,status)
    values(v_actor,current_setting('fx.org')::uuid,'Synthetic FX Finance',v_actor::text||'@example.invalid','Finance','active');
  perform set_config('fx.actor',v_actor::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('fx.actor'),'role','authenticated')::text,true);
insert into public.fx_rates(rate_date,rate) values('2026-10-13',16240);
reset role;
select is((select created_by from public.fx_rates where rate_date='2026-10-13'),current_setting('fx.actor')::uuid,'AC-FX-002 insert stamps created actor');
select is((select updated_by from public.fx_rates where rate_date='2026-10-13'),current_setting('fx.actor')::uuid,'AC-FX-002 insert stamps updated actor');
select ok((select created_at is not null and updated_at is not null from public.fx_rates where rate_date='2026-10-13'),'AC-FX-002 insert stamps timestamps');
select is((select count(*)::integer from public.audit_events where action='fx_rate.change' and entity_id=(select id from public.fx_rates where rate_date='2026-10-13')),1,'AC-FX-002 insert records one audit event');
select set_config('fx.before_updated_at',(select updated_at::text from public.fx_rates where rate_date='2026-10-13'),true);
select set_config('fx.before_audit_count',(select count(*)::text from public.audit_events where action='fx_rate.change' and entity_id=(select id from public.fx_rates where rate_date='2026-10-13')),true);
set local role authenticated;
update public.fx_rates set rate=16240 where rate_date='2026-10-13';
select is((select updated_at::text from public.fx_rates where rate_date='2026-10-13'),current_setting('fx.before_updated_at'),'AC-FX-002 identical update preserves witness');
reset role;
select is((select count(*)::text from public.audit_events where action='fx_rate.change' and entity_id=(select id from public.fx_rates where rate_date='2026-10-13')),current_setting('fx.before_audit_count'),'AC-FX-002 identical update adds no audit event');
set local role authenticated;
update public.fx_rates set rate=16241 where rate_date='2026-10-13';
reset role;
select is((select updated_by from public.fx_rates where rate_date='2026-10-13'),current_setting('fx.actor')::uuid,'AC-FX-002 changed rate stamps actor');
select is((select count(*)::integer from public.audit_events where action='fx_rate.change' and entity_id=(select id from public.fx_rates where rate_date='2026-10-13')),2,'AC-FX-002 changed rate adds audit event');
select is((select (detail->>'rate_date')||':'||(detail->>'old_rate')||':'||(detail->>'new_rate') from public.audit_events where action='fx_rate.change' and entity_id=(select id from public.fx_rates where rate_date='2026-10-13') and detail->>'new_rate'='16241.000000' limit 1),'2026-10-13:16240.000000:16241.000000','AC-FX-002 audit includes normalized before and after');
set local role authenticated;
select throws_ok($$insert into public.fx_rates(rate_date,rate) values('2099-01-01',16240)$$,'23514',null,'AC-FX-002 future publication is refused');
select throws_ok($$insert into public.fx_rates(rate_date,rate,created_by) values('2026-10-12',16240,auth.uid())$$,'42501',null,'AC-FX-002 authenticated insert cannot supply audit actor');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-10-10","rate":16240},{"rate_date":"2026-10-11","rate":999}]'::jsonb)$$,'23514',null,'AC-FX-002 invalid batch is rejected');
reset role;
select is((select count(*)::integer from public.fx_rates where rate_date in ('2026-10-10','2026-10-11')),0,'AC-FX-002 invalid batch writes no partial rows');
select is(public.upsert_fx_rates('[{"rate_date":"2026-10-13","rate":16241}]'::jsonb),'{"new":0,"changed":0,"unchanged":1}'::jsonb,'AC-FX-002 unchanged atomic upsert reports unchanged');
select throws_ok($$select public.upsert_fx_rates('[]'::jsonb)$$,'23514',null,'AC-FX-002 empty batch refused');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-10-01","rate":16234,"extra":true}]'::jsonb)$$,'23514',null,'AC-FX-002 unknown payload key refused');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-1-01","rate":16234}]'::jsonb)$$,'23514',null,'AC-FX-002 noncanonical date refused');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-13-01","rate":16234}]'::jsonb)$$,'22008',null,'AC-FX-002 impossible date has classified cast error');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-10-01","rate":16234.1234567}]'::jsonb)$$,'23514',null,'AC-FX-002 excess precision refused');
select throws_ok($$select public.upsert_fx_rates('[{"rate_date":"2026-10-01","rate":16234},{"rate_date":"2026-10-01","rate":16235}]'::jsonb)$$,'23514',null,'AC-FX-002 duplicate dates refused');

select * from finish();
rollback;
