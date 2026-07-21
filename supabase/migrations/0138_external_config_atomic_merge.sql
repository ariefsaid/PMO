-- 0138_external_config_atomic_merge.sql — MEDIUM-4
-- Atomic patches for integration config jsonb. Callers must never read/merge/write this field: a
-- concurrent writer can otherwise replace the row with a stale object and erase sibling keys.

create or replace function public.merge_external_org_binding_config(
  p_org_id uuid,
  p_external_tier text,
  p_patch jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'config patch must be a JSON object' using errcode = '22023';
  end if;

  update public.external_org_bindings
     set config = coalesce(config, '{}'::jsonb) || p_patch
   where org_id = p_org_id
     and external_tier = p_external_tier;
end;
$$;

create or replace function public.merge_external_project_binding_config(
  p_org_id uuid,
  p_external_tier text,
  p_container_id text,
  p_patch jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'config patch must be a JSON object' using errcode = '22023';
  end if;

  update public.external_project_bindings
     set config = coalesce(config, '{}'::jsonb) || p_patch
   where org_id = p_org_id
     and external_tier = p_external_tier
     and external_container_id = p_container_id
     and disconnected_at is null;
end;
$$;

revoke all on function public.merge_external_org_binding_config(uuid,text,jsonb) from public;
grant execute on function public.merge_external_org_binding_config(uuid,text,jsonb) to service_role;
revoke all on function public.merge_external_project_binding_config(uuid,text,text,jsonb) from public;
grant execute on function public.merge_external_project_binding_config(uuid,text,text,jsonb) to service_role;

comment on function public.merge_external_org_binding_config(uuid,text,jsonb) is
  'Atomically merge a patch into an external org binding config without clobbering sibling keys.';
comment on function public.merge_external_project_binding_config(uuid,text,text,jsonb) is
  'Atomically merge a patch into an external project binding config without clobbering sibling keys.';
