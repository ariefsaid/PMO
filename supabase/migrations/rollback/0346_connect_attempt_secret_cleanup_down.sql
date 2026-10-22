-- Restore the 0259 cleanup implementation; its caller owns staged-secret deletion.
create or replace function public.cleanup_external_connect_attempt(
  p_org_id uuid, p_external_tier text, p_secret_ref text, p_actor_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_prev jsonb;
  v_found boolean;
begin
  if current_setting('role', true) <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  select true, config->'prev_binding' into v_found, v_prev
    from public.external_org_bindings
   where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref
     for update;
  if v_prev is not null then
    update public.external_org_bindings
       set secret_ref      = v_prev->>'secret_ref',
           status          = v_prev->>'status',
           connected_by    = (v_prev->>'connected_by')::uuid,
           connected_at    = (v_prev->>'connected_at')::timestamptz,
           disconnected_at = (v_prev->>'disconnected_at')::timestamptz,
           config          = config - 'prev_binding',
           updated_at      = now()
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
  elsif v_found then
    delete from public.external_org_bindings
     where org_id=p_org_id and external_tier=p_external_tier and secret_ref=p_secret_ref;
  end if;
  perform public.log_audit('integration.connect.cleanup',p_org_id,p_actor_id,null,
    jsonb_build_object('tier',p_external_tier,'actor',p_actor_id,
      'cleanup', case when v_prev is not null then 'restored_prior' else 'binding' end));
end;
$$;
revoke all on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.cleanup_external_connect_attempt(uuid,text,text,uuid) to service_role;
