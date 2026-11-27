begin;
create or replace function public._erp_statement_change_context(p_org uuid,p_holder uuid,p_binding uuid,p_activation timestamptz)
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

commit;
