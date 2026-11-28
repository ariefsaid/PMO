-- Validate project mappings in one set and skip redundant timezone catalogue scans on unchanged state.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "tz text; m jsonb; e record;" | Validate the map in one guarded set read.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "if not found or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then" | Reuse the already-validated timezone stored in erp_statement_change_state before scanning pg_timezone_names.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "end if;" | Validate the map in one guarded set read.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "raise exception 'invalid statement metadata' using errcode='22023';" | Validate the map in one guarded set read.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "for e in select key,value from jsonb_each(m) loop" | Validate the map in one guarded set read.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "if e.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'" | Validate the map in one guarded set read.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "or jsonb_typeof(e.value) is distinct from 'string' or btrim(e.value #>> '{}')='' then" | Validate the map in one guarded set read.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "if not exists(select 1 from public.projects where id=e.key::uuid and org_id=p_org) then" | Validate the map in one guarded set read.
-- drops: _erp_statement_change_context(uuid,uuid,uuid,timestamptz) | "end loop;" | Validate the map in one guarded set read.
begin;
create or replace function public._erp_statement_change_context(p_org uuid,p_holder uuid,p_binding uuid,p_activation timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.erp_sweep_lock%rowtype; b public.external_org_bindings%rowtype;
 tz text; m jsonb;
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
 if not found or (
   not exists(select 1 from public.erp_statement_change_state s where s.org_id=p_org and s.binding_context->>'timezone'=tz)
   and not exists(select 1 from pg_catalog.pg_timezone_names where name=tz)
 ) then
   raise exception 'invalid statement metadata' using errcode='22023';
 end if;
 m:=coalesce(b.config->'project_map','{}'::jsonb);
 if jsonb_typeof(m) is distinct from 'object' then raise exception 'invalid statement metadata' using errcode='22023'; end if;
 if exists(
   select 1
   from jsonb_each(m) e
   left join public.projects p
     on p.id=case when e.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then e.key::uuid end and p.org_id=p_org
   where e.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(e.value) is distinct from 'string' or btrim(e.value #>> '{}')=''
      or p.id is null
 ) then
   raise exception 'invalid statement metadata' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_each_text(m) group by value having count(*)>1) then
   raise exception 'invalid statement metadata' using errcode='22023';
 end if;
 return jsonb_build_object('bindingId',b.id,'activatedAt',to_char(b.activated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'versionMajor',b.version_major,
   'company',b.config->>'company','projectMap',m,'timezone',tz);
end $$;

commit;
