-- Refresh completion is atomic for one connection generation and its granted scopes.
create or replace function public.m365_finish_refresh(
  p_org_id uuid, p_user_id uuid, p_connection_id uuid,
  p_expected_refresh_token_ciphertext bytea, p_status text, p_updated_at timestamptz,
  p_access_token_ciphertext bytea default null, p_refresh_token_ciphertext bytea default null,
  p_access_token_expires_at timestamptz default null, p_scopes text[] default null
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  if p_status not in ('active','stale','revoked') or p_updated_at is null then
    raise exception using errcode='22023',message='invalid refresh completion';
  end if;
  if p_status='active' and (p_access_token_ciphertext is null or p_refresh_token_ciphertext is null
    or p_access_token_expires_at is null or p_scopes is null) then
    raise exception using errcode='22023',message='incomplete refresh completion';
  end if;
  -- Parent-first lock order is shared with lifecycle and connection RPCs.
  perform 1 from public.profiles where id=p_user_id and org_id=p_org_id for update;
  perform 1 from public.org_features where org_id=p_org_id and feature_key='m365_integration' for update;
  update public.ms_graph_connections c set
    access_token_ciphertext=case when p_status='active' then p_access_token_ciphertext else c.access_token_ciphertext end,
    refresh_token_ciphertext=case when p_status='active' then p_refresh_token_ciphertext else c.refresh_token_ciphertext end,
    access_token_expires_at=case when p_status='active' then p_access_token_expires_at else c.access_token_expires_at end,
    scopes=case when p_status='active' then p_scopes else c.scopes end,
    last_refresh_at=case when p_status='active' then p_updated_at else c.last_refresh_at end,
    status=p_status, updated_at=p_updated_at
  where c.id=p_connection_id and c.org_id=p_org_id and c.user_id=p_user_id
    and c.status='active'
    and c.refresh_token_ciphertext=p_expected_refresh_token_ciphertext
    and (p_status<>'active' or p_scopes <@ c.scopes)
  returning c.id into v_id;
  return v_id;
end $$;
revoke all on function public.m365_finish_refresh(uuid,uuid,uuid,bytea,text,timestamptz,bytea,bytea,timestamptz,text[]) from public,anon,authenticated;
grant execute on function public.m365_finish_refresh(uuid,uuid,uuid,bytea,text,timestamptz,bytea,bytea,timestamptz,text[]) to service_role;
