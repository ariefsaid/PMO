begin;
create table public.erp_statement_change_state (
 org_id uuid primary key references public.organizations(id) on delete cascade,
 enabled boolean not null default true,
 binding_id uuid not null references public.external_org_bindings(id),
 activated_at timestamptz not null,
 company text not null check (btrim(company) <> ''),
 binding_context jsonb not null check (jsonb_typeof(binding_context)='object'),
 scope_epoch uuid not null default gen_random_uuid(),
 dirty_revision bigint not null default 1 check (dirty_revision>=1),
 dirty_acked bigint not null default 0 check (dirty_acked>=0 and dirty_acked<=dirty_revision),
 intent_revision bigint not null default 0 check (intent_revision>=0),
 intent_acked bigint not null default 0 check (intent_acked>=0 and intent_acked<=intent_revision),
 intent_scope_floor bigint not null default 0 check (intent_scope_floor>=0 and intent_scope_floor<=intent_revision),
 last_manual_at timestamptz,
 next_check_at timestamptz not null default clock_timestamp(),
 diagnostic_result jsonb check (diagnostic_result is null or (jsonb_typeof(diagnostic_result)='object' and pg_column_size(diagnostic_result)<=16384)),
 next_nightly_date date not null,
 retry_failures integer not null default 0 check (retry_failures between 0 and 5),
 retry_at timestamptz not null default clock_timestamp()
);
alter table public.erp_statement_change_state enable row level security;
alter table public.erp_statement_change_state force row level security;
revoke all on public.erp_statement_change_state from public,anon,authenticated,service_role;
grant select on public.erp_statement_change_state to service_role;

-- Acquires the shared prefix in lease -> binding -> organization order.
create function public._erp_statement_change_context(p_org uuid,p_holder uuid,p_binding uuid,p_activation timestamptz)
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

create function public._erp_statement_change_lease_check(p_org uuid,p_holder uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.erp_sweep_lock where org_id=p_org and holder=p_holder and locked_until>clock_timestamp()) then
   raise exception 'statement scope unavailable' using errcode='55000';
 end if;
end $$;

create function public._erp_statement_change_validate(p_result jsonb,p_binding uuid,p_activation timestamptz,p_company text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare o jsonb; c jsonb; item jsonb; top_value jsonb; s text; seen text[]:=array[]::text[];
 stamp timestamp; activation timestamptz; field text; v text; observation_required boolean;
begin
 if p_result is null or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>16384
    or jsonb_typeof(p_result->'status') is distinct from 'string'
    or jsonb_typeof(p_result->'reason') is distinct from 'string' then
   raise exception 'invalid statement diagnostic' using errcode='22023';
 end if;
 observation_required := (p_result->>'status'='changed' and p_result->>'reason'='source_hint_changed')
   or (p_result->>'status'='unknown' and p_result->>'reason' in ('first_observation','unverified_dependencies'));
 if observation_required then
   if p_result->>'reason'='unverified_dependencies' then
     if (p_result - array['status','reason','hint','observation'])<>'{}'::jsonb
       or p_result->>'hint' is distinct from 'no_observed_change' or jsonb_typeof(p_result->'hint') is distinct from 'string' then
       raise exception 'invalid statement diagnostic' using errcode='22023';
     end if;
   elsif (p_result - array['status','reason','observation'])<>'{}'::jsonb then
     raise exception 'invalid statement diagnostic' using errcode='22023';
   end if;
 else
   if p_result->>'status'<>'unknown' or p_result->>'reason' not in ('context_mismatch','invalid_response','request_failed','cancelled','ambiguous_hint')
     or (p_result - array['status','reason'])<>'{}'::jsonb then
     raise exception 'invalid statement diagnostic' using errcode='22023';
   end if;
   return;
 end if;
 o:=p_result->'observation'; c:=o->'context';
 if jsonb_typeof(o) is distinct from 'object' or (o-array['version','context','sources'])<>'{}'::jsonb
    or not (o ?& array['version','context','sources']) or o->'version' is distinct from '1'::jsonb
    or jsonb_typeof(c) is distinct from 'object' or (c-array['bindingId','activatedAt','company','profile','fingerprint'])<>'{}'::jsonb
    or not (c ?& array['bindingId','activatedAt','company','profile','fingerprint']) then
   raise exception 'invalid statement diagnostic' using errcode='22023';
 end if;
 foreach field in array array['bindingId','activatedAt','company','profile','fingerprint'] loop
   v:=c->>field;
   if jsonb_typeof(c->field) is distinct from 'string' or length(v)>512 or btrim(v)='' or v ~ '[[:cntrl:]]' then
     raise exception 'invalid statement diagnostic' using errcode='22023';
   end if;
 end loop;
 begin activation:=(c->>'activatedAt')::timestamptz;
 exception when others then raise exception 'invalid statement diagnostic' using errcode='22023'; end;
 if c->>'bindingId' is distinct from p_binding::text or activation is distinct from p_activation
    or c->>'company' is distinct from p_company then
   raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 if c->>'profile' is distinct from '16.33.0/16.31.0' or jsonb_typeof(o->'sources') is distinct from 'array' then
   raise exception 'invalid statement diagnostic' using errcode='22023';
 end if;
 if jsonb_array_length(o->'sources')<>3 then raise exception 'invalid statement diagnostic' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(o->'sources') loop
   if jsonb_typeof(item) is distinct from 'object' or (item-array['source','top'])<>'{}'::jsonb
     or not (item ?& array['source','top']) or jsonb_typeof(item->'source') is distinct from 'string' then
     raise exception 'invalid statement diagnostic' using errcode='22023';
   end if;
   s:=item->>'source';
   if s not in ('GL Entry','Account','Period Closing Voucher') or s=any(seen) then
     raise exception 'invalid statement diagnostic' using errcode='22023';
   end if;
   seen:=array_append(seen,s); top_value:=item->'top';
   if top_value='null'::jsonb then continue; end if;
   if jsonb_typeof(top_value) is distinct from 'object' or (top_value-array['name','modified'])<>'{}'::jsonb
      or not (top_value ?& array['name','modified']) or jsonb_typeof(top_value->'name') is distinct from 'string'
      or btrim(top_value->>'name')='' or length(top_value->>'name')>512 or top_value->>'name' ~ '[[:cntrl:]]'
      or jsonb_typeof(top_value->'modified') is distinct from 'string'
      or top_value->>'modified' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?$' then
     raise exception 'invalid statement diagnostic' using errcode='22023';
   end if;
   begin stamp:=(top_value->>'modified')::timestamp;
   exception when others then raise exception 'invalid statement diagnostic' using errcode='22023'; end;
   if to_char(stamp,'YYYY-MM-DD HH24:MI:SS')<>left(top_value->>'modified',19) then
     raise exception 'invalid statement diagnostic' using errcode='22023';
   end if;
 end loop;
end $$;

create function public.sync_erp_statement_change_scope(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype; result_status text;
begin
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found then
   insert into public.erp_statement_change_state(org_id,binding_id,activated_at,company,binding_context,next_nightly_date)
   values(p_org_id,p_binding_id,p_activated_at,ctx->>'company',ctx,(clock_timestamp() at time zone (ctx->>'timezone'))::date)
   returning * into state;
   result_status:='initialized';
 elsif state.binding_id is distinct from p_binding_id or state.activated_at is distinct from p_activated_at
       or state.company is distinct from ctx->>'company' or state.binding_context is distinct from ctx then
   update public.erp_statement_change_state set binding_id=p_binding_id,activated_at=p_activated_at,
     company=ctx->>'company',binding_context=ctx,scope_epoch=gen_random_uuid(),dirty_revision=dirty_revision+1,
     intent_scope_floor=intent_revision,diagnostic_result=null,next_check_at=clock_timestamp()
    where org_id=p_org_id returning * into state;
   result_status:='scope_changed';
 else result_status:='current';
 end if;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 return jsonb_build_object('status',result_status,'enabled',state.enabled,'scope_epoch',state.scope_epoch,
  'dirty_revision',state.dirty_revision::text,'intent_revision',state.intent_revision::text);
end $$;

create function public.observe_erp_statement_change(p_org_id uuid,p_holder uuid,p_binding_id uuid,p_activated_at timestamptz,p_scope_epoch uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ctx jsonb; state public.erp_statement_change_state%rowtype;
begin
 if p_scope_epoch is null or p_result is null then raise exception 'invalid statement diagnostic' using errcode='22023'; end if;
 ctx:=public._erp_statement_change_context(p_org_id,p_holder,p_binding_id,p_activated_at);
 select * into state from public.erp_statement_change_state where org_id=p_org_id for update;
 if not found or state.binding_id is distinct from p_binding_id or state.activated_at is distinct from p_activated_at
    or state.binding_context is distinct from ctx or state.scope_epoch is distinct from p_scope_epoch then
   raise exception 'statement scope unavailable' using errcode='55000';
 end if;
 if not state.enabled then return jsonb_build_object('status','disabled'); end if;
 if clock_timestamp()<state.next_check_at then return jsonb_build_object('status','not_due'); end if;
 perform public._erp_statement_change_validate(p_result,p_binding_id,p_activated_at,state.company);
 update public.erp_statement_change_state set dirty_revision=dirty_revision+1,diagnostic_result=p_result,
   next_check_at=clock_timestamp()+interval '15 minutes' where org_id=p_org_id returning * into state;
 perform public._erp_statement_change_lease_check(p_org_id,p_holder);
 return jsonb_build_object('status','recorded','dirty_revision',state.dirty_revision::text,'next_check_at',state.next_check_at);
end $$;

alter function public._erp_statement_change_context(uuid,uuid,uuid,timestamptz) owner to postgres;
alter function public._erp_statement_change_lease_check(uuid,uuid) owner to postgres;
alter function public._erp_statement_change_validate(jsonb,uuid,timestamptz,text) owner to postgres;
alter function public.sync_erp_statement_change_scope(uuid,uuid,uuid,timestamptz) owner to postgres;
alter function public.observe_erp_statement_change(uuid,uuid,uuid,timestamptz,uuid,jsonb) owner to postgres;
revoke all on function public._erp_statement_change_context(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public._erp_statement_change_lease_check(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public._erp_statement_change_validate(jsonb,uuid,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.sync_erp_statement_change_scope(uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.observe_erp_statement_change(uuid,uuid,uuid,timestamptz,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sync_erp_statement_change_scope(uuid,uuid,uuid,timestamptz) to service_role;
grant execute on function public.observe_erp_statement_change(uuid,uuid,uuid,timestamptz,uuid,jsonb) to service_role;
commit;
