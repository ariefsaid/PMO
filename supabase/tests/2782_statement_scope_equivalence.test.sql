-- AC-SCOPE-001: the set validator preserves the original scope and refusals.
begin;
select no_plan();
insert into public.organizations(id,name,default_currency,default_timezone) values
 ('06430000-0000-0000-0000-000000000001','State fixture A','IDR','UTC'),
 ('06430000-0000-0000-0000-000000000002','State fixture B','IDR','UTC');

insert into public.external_org_bindings(id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at) values
 ('06430000-0000-0000-0000-000000000011','06430000-0000-0000-0000-000000000001','erpnext','https://example.invalid','fixture',16,'{"company":"Fixture A","project_map":{}}','2026-10-18T09:00:00Z'),
 ('06430000-0000-0000-0000-000000000012','06430000-0000-0000-0000-000000000002','erpnext','https://example.invalid','fixture',16,'{"company":"Fixture B","project_map":{}}','2026-10-18T09:00:00Z');
insert into public.erp_sweep_lock(org_id,holder,locked_until) values
 ('06430000-0000-0000-0000-000000000001','06430000-0000-0000-0000-000000000101',clock_timestamp()+interval '15 minutes'),
 ('06430000-0000-0000-0000-000000000002','06430000-0000-0000-0000-000000000102',clock_timestamp()+interval '15 minutes');
insert into public.projects(id,org_id,name) select ('06430000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'06430000-0000-0000-0000-000000000001','Scope '||i from generate_series(1000,1133) i;
update public.external_org_bindings set config=jsonb_build_object('company','Fixture A','project_map',(select jsonb_object_agg(id::text,name) from public.projects where org_id='06430000-0000-0000-0000-000000000001')) where id='06430000-0000-0000-0000-000000000011';
create function pg_temp.original_context(p_org uuid,p_holder uuid,p_binding uuid,p_activation timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.erp_sweep_lock%rowtype; b public.external_org_bindings%rowtype;
 tz text; m jsonb; e record;
begin
 if p_org is null or p_holder is null or p_binding is null or p_activation is null then
   raise exception 'invalid statement scope' using errcode='22023';
 end if;
 select * into l from public.erp_sweep_lock where org_id=p_org for update;
 if not found or l.holder is distinct from p_holder or l.locked_until<=clock_timestamp() then
   raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 select * into b from public.external_org_bindings where org_id=p_org and external_tier='erpnext' for update;
 if not found or b.id is distinct from p_binding or b.activated_at is distinct from p_activation
    or b.activated_at is null or b.version_major is distinct from 16 or b.status='disconnected'
    or jsonb_typeof(b.config) is distinct from 'object'
    or jsonb_typeof(b.config->'company') is distinct from 'string' or btrim(b.config->>'company')='' then
   raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 select coalesce(nullif(btrim(default_timezone),''),'Asia/Jakarta') into tz from public.organizations where id=p_org for share;
 if not found or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then
   raise exception 'invalid statement metadata' using errcode='22023';
 end if;
 m:=coalesce(b.config->'project_map','{}'::jsonb);
 if jsonb_typeof(m) is distinct from 'object' then raise exception 'invalid statement metadata' using errcode='22023'; end if;
 for e in select key,value from jsonb_each(m) loop
   if e.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(e.value) is distinct from 'string' or btrim(e.value #>> '{}')='' then
     raise exception 'invalid statement metadata' using errcode='22023';
   end if;
   if not exists(select 1 from public.projects where id=e.key::uuid and org_id=p_org) then
     raise exception 'invalid statement metadata' using errcode='22023';
   end if;
 end loop;
 if exists(select 1 from jsonb_each_text(m) group by value having count(*)>1) then
   raise exception 'invalid statement metadata' using errcode='22023';
 end if;
 return jsonb_build_object('bindingId',b.id,'activatedAt',to_char(b.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'versionMajor',b.version_major,
   'company',b.config->>'company','projectMap',m,'timezone',tz);
end $$;


create function pg_temp.scope_outcome(use_original boolean) returns jsonb language plpgsql as $$
begin
 if use_original then
 return pg_temp.original_context('06430000-0000-0000-0000-000000000001','06430000-0000-0000-0000-000000000101','06430000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
 end if;
 return public._erp_statement_change_context('06430000-0000-0000-0000-000000000001','06430000-0000-0000-0000-000000000101','06430000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z');
exception when others then return jsonb_build_object('error',sqlstate,'message',sqlerrm);
end $$;
create temporary table scope_corpus(label text,map jsonb,expected_error text);
insert into scope_corpus select 'valid size '||n,coalesce((select jsonb_object_agg(id::text,name) from (select id,name from public.projects where org_id='06430000-0000-0000-0000-000000000001' order by id limit n) p),'{}'),null from generate_series(0,134) n;
insert into scope_corpus values
 ('null map','null','22023'),('array map','[]','22023'),('string map','"x"','22023'),
 ('invalid key','{"bad":"A"}','22023'),
 ('uppercase key','{"06430000-0000-0000-0000-000000000ABC":"A"}','22023'),
 ('absent project','{"06430000-0000-0000-0000-000000009999":"A"}','22023');
insert into scope_corpus select 'bad value '||v::text,jsonb_build_object('06430000-0000-0000-0000-000000001000',v),'22023' from (values ('null'::jsonb),('true'),('42'),('[]'),('{}'),('""'),('"   "')) t(v);
insert into scope_corpus values ('duplicate values','{"06430000-0000-0000-0000-000000001000":"same","06430000-0000-0000-0000-000000001001":"same"}','22023'),
 ('distinct whitespace values','{"06430000-0000-0000-0000-000000001000":"same","06430000-0000-0000-0000-000000001001":" same "}',null);
insert into public.projects(id,org_id,name) values ('06430000-0000-0000-0000-000000009998','06430000-0000-0000-0000-000000000002','Other org');
insert into scope_corpus values ('foreign project','{"06430000-0000-0000-0000-000000009998":"A"}','22023');
create function pg_temp.check_case(m jsonb) returns jsonb language plpgsql as $$
begin
 update public.external_org_bindings set config=jsonb_build_object('company','Fixture A','project_map',m) where id='06430000-0000-0000-0000-000000000011';
 return jsonb_build_object('old',pg_temp.scope_outcome(true),'new',pg_temp.scope_outcome(false));
end $$;
create temporary table scope_results as select *,pg_temp.check_case(map) result from scope_corpus;
select is(result->'new',result->'old','AC-SCOPE-001 equivalent: '||label) from scope_results;
select is(result->'new'->>'error',expected_error,'AC-SCOPE-001 expected outcome: '||label) from scope_results;
-- Admission checks remain on every call, including unchanged maps.
update public.external_org_bindings set config='{"company":"Fixture A"}' where id='06430000-0000-0000-0000-000000000011';
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 missing map defaults to empty');
update public.erp_sweep_lock set locked_until=clock_timestamp()-interval '1 second' where org_id='06430000-0000-0000-0000-000000000001';
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 expired lease equivalence');
select is(pg_temp.scope_outcome(false)->>'error','55000','AC-SCOPE-001 expired lease refused');
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '15 minutes',holder='06430000-0000-0000-0000-000000000999' where org_id='06430000-0000-0000-0000-000000000001';
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 replaced lease equivalence');
update public.erp_sweep_lock set holder='06430000-0000-0000-0000-000000000101' where org_id='06430000-0000-0000-0000-000000000001';
update public.external_org_bindings set activated_at=activated_at+interval '1 second' where id='06430000-0000-0000-0000-000000000011';
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 replaced activation equivalence');
select is(pg_temp.scope_outcome(false)->>'error','55000','AC-SCOPE-001 replaced activation refused');
update public.external_org_bindings set activated_at='2026-10-18T09:00:00Z' where id='06430000-0000-0000-0000-000000000011';
-- Initialize change state so unchanged-timezone fast path is exercised too.
select is(
  public.sync_erp_statement_change_scope('06430000-0000-0000-0000-000000000001','06430000-0000-0000-0000-000000000101','06430000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status',
  'initialized',
  'AC-SCOPE-001 state initialized for cached-timezone fast path'
);
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 unchanged cached timezone equivalence');
select is(
  public.sync_erp_statement_change_scope('06430000-0000-0000-0000-000000000001','06430000-0000-0000-0000-000000000101','06430000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status',
  'current',
  'AC-SCOPE-001 unchanged poll stays current'
);
update public.organizations set default_timezone='Asia/Jakarta' where id='06430000-0000-0000-0000-000000000001';
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 changed valid timezone equivalence');
select is(
  public.sync_erp_statement_change_scope('06430000-0000-0000-0000-000000000001','06430000-0000-0000-0000-000000000101','06430000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')->>'status',
  'scope_changed',
  'AC-SCOPE-001 changed valid timezone rotates scope'
);
-- Bypass the write-time trigger inside this rolled-back test to verify defence-in-depth timezone validation.
alter table public.organizations disable trigger organizations_timezone_valid;
update public.organizations set default_timezone='Invalid/Zone' where id='06430000-0000-0000-0000-000000000001';
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 invalid timezone equivalence');
select is(pg_temp.scope_outcome(false)->>'error','22023','AC-SCOPE-001 invalid timezone refused');
update public.organizations set default_timezone=' ' where id='06430000-0000-0000-0000-000000000001';
select is(pg_temp.scope_outcome(false),pg_temp.scope_outcome(true),'AC-SCOPE-001 default timezone equivalence');
alter table public.organizations enable trigger organizations_timezone_valid;
select * from finish();
rollback;
