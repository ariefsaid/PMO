-- 0107_m365_disconnect_cascade.sql — security-definer RPC for offboard/disentitlement cascade
-- (FR-M365-151, NFR-M365-107). Called by:
--   • operator_toggle_feature when m365_integration is toggled OFF (Operator path).
--   • admin_set_user_status when a user is disabled (Admin path, via trigger or explicit call).
--   • Future org-disable automation (org_features status change).
-- Deletes ms_graph_connections rows and emits audit_events via log_audit().
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.m365_disconnect_cascade(uuid, uuid, text);

create or replace function public.m365_disconnect_cascade(
  p_org_id   uuid,
  p_user_id  uuid,      -- null = all users in org (operator disentitlement)
  p_reason   text       -- 'disentitled' | 'offboard' | 'org_disabled'
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_caller_org  uuid := public.auth_org_id();
  v_caller_role user_role := public.auth_role();
  v_deleted     int;
  v_conn_id     uuid;
  v_user_id     uuid;
  v_detail      jsonb;
begin
  -- Entry guard: only Operator (cross-org) or Admin-in-org may invoke.
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;

  if not (
    (public.is_operator() and p_org_id is not null)  -- Operator: must specify target org
    or (v_caller_org = p_org_id and v_caller_role = 'Admin')  -- Admin: own org only
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- If p_user_id provided, validate it belongs to p_org_id (defense-in-depth).
  if p_user_id is not null then
    if not exists (select 1 from public.profiles where id = p_user_id and org_id = p_org_id) then
      raise exception 'user_not_in_org' using errcode = '42501';
    end if;
  end if;

  -- Delete connections, capturing ids for audit.
  if p_user_id is not null then
    -- Single user (offboard path).
    delete from public.ms_graph_connections
     where org_id = p_org_id and user_id = p_user_id
     returning id into v_conn_id;
    get diagnostics v_deleted = row_count;
    if v_deleted = 1 then
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', p_user_id);
      perform public.log_audit('m365.connection.revoked', p_org_id, auth.uid(), v_conn_id, v_detail);
    end if;
  else
    -- All users in org (operator disentitlement / org disable).
    -- Iterate to audit each connection individually with its user_id.
    for v_conn_id, v_user_id in
      select id, user_id from public.ms_graph_connections where org_id = p_org_id
    loop
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', v_user_id);
      perform public.log_audit('m365.connection.revoked', p_org_id, auth.uid(), v_conn_id, v_detail);
    end loop;
    delete from public.ms_graph_connections where org_id = p_org_id;
    get diagnostics v_deleted = row_count;
  end if;

  -- No exception if zero rows deleted (idempotent).
end $$;

revoke all on function public.m365_disconnect_cascade(uuid, uuid, text) from public;
grant execute on function public.m365_disconnect_cascade(uuid, uuid, text) to authenticated;