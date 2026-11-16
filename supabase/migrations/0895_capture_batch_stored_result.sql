-- #2258: a retry of a capture request that already finished can read its stored result without a fresh ERP read.
-- Read-only; service role only, like capture_history_batch, so the API-client guard needs no entry.
create function public.capture_history_batch_result(p_actor_id uuid,p_project_id uuid,p_request_id uuid,p_revision text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_catalog as $$
declare
  v_org uuid; v_batch public.erp_capture_batches%rowtype; v_undone boolean;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'not authorized' using errcode='42501'; end if;
  select p.org_id into v_org from public.profiles p join auth.users u on u.id=p.id
    where p.id=p_actor_id and p.status='active' and p.role::text='Admin'
      and (u.banned_until is null or u.banned_until <= now());
  if v_org is null then raise exception 'not authorized' using errcode='42501'; end if;
  select * into v_batch from public.erp_capture_batches where org_id=v_org and request_id=p_request_id;
  if not found or v_batch.actor_id <> p_actor_id or v_batch.project_id is distinct from p_project_id
     or v_batch.reviewed_revision is distinct from p_revision then
    return jsonb_build_object('found',false);
  end if;
  select exists (select 1 from generate_series(0, v_batch.next_index - 1) i
    join public.erp_purchase_captures c on c.org_id=v_org and c.request_id=md5(p_request_id::text || ':group:' || i::text)::uuid
    where c.undone_at is not null) into v_undone;
  return jsonb_build_object('found',true,'complete',v_batch.next_index >= jsonb_array_length(v_batch.groups) and not v_undone,'results',v_batch.results);
end $$;
revoke all on function public.capture_history_batch_result(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.capture_history_batch_result(uuid,uuid,uuid,text) to service_role;
