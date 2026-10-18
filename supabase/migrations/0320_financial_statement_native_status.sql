-- Mark a native statement attempt before metadata is fetched, fenced by the active sweep lease
-- and the exact ERPNext binding epoch already admitted by the collector.
create function public.mark_erp_statement_report_refresh_attempt(
  p_org_id uuid,
  p_holder uuid,
  p_binding jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lock public.erp_sweep_lock%rowtype;
  v_binding public.external_org_bindings%rowtype;
  v_activated_at timestamptz;
begin
  if p_org_id is null or p_holder is null
     or jsonb_typeof(p_binding) is distinct from 'object'
     or (p_binding - array['id','activatedAt','versionMajor','company','projectMap']) <> '{}'::jsonb
     or not (p_binding ?& array['id','activatedAt','versionMajor','company','projectMap'])
     or jsonb_typeof(p_binding->'id') is distinct from 'string'
     or (p_binding->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(p_binding->'activatedAt') is distinct from 'string'
     or jsonb_typeof(p_binding->'versionMajor') is distinct from 'number'
     or (p_binding->>'versionMajor') !~ '^[0-9]+$'
     or jsonb_typeof(p_binding->'company') is distinct from 'string'
     or btrim(p_binding->>'company') = ''
     or jsonb_typeof(p_binding->'projectMap') is distinct from 'object' then
    raise exception 'invalid statement attempt identity' using errcode='22023';
  end if;
  begin
    v_activated_at := (p_binding->>'activatedAt')::timestamptz;
  exception when others then
    raise exception 'invalid statement attempt binding epoch' using errcode='22023';
  end;

  select * into v_lock
    from public.erp_sweep_lock
   where org_id=p_org_id
   for update;
  if not found or v_lock.holder is distinct from p_holder or v_lock.locked_until<=clock_timestamp() then
    raise exception 'statement lease is not current' using errcode='55000';
  end if;

  select * into v_binding
    from public.external_org_bindings
   where org_id=p_org_id and external_tier='erpnext'
   for update;
  if not found or not exists (
    select 1 from public.erp_sweep_lock l
     where l.org_id=p_org_id and l.holder=p_holder and l.locked_until>clock_timestamp()
  ) then
    raise exception 'statement lease expired while admitting attempt' using errcode='55000';
  end if;
  if v_binding.activated_at is null
     or v_binding.id is distinct from (p_binding->>'id')::uuid
     or v_binding.activated_at is distinct from v_activated_at
     or v_binding.version_major is distinct from 16
     or (p_binding->>'versionMajor')::integer is distinct from v_binding.version_major
     or v_binding.config->>'company' is distinct from p_binding->>'company'
     or coalesce(v_binding.config->'project_map','{}'::jsonb) is distinct from p_binding->'projectMap' then
    raise exception 'statement binding changed' using errcode='55000';
  end if;

  update public.external_org_bindings
     set statement_update_delayed=true
   where id=v_binding.id and org_id=p_org_id and external_tier='erpnext';
  if not found or not exists (
    select 1 from public.erp_sweep_lock l
     where l.org_id=p_org_id and l.holder=p_holder and l.locked_until>clock_timestamp()
  ) then
    raise exception 'statement lease expired during attempt admission' using errcode='55000';
  end if;
end;
$$;

revoke execute on function public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb) to service_role;
