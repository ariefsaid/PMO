-- 2787_work_order_reopen.sql — Admin-only audited reopen of a Closed work order (#3024).
-- Rollback: supabase/migrations/rollback/2787_work_order_reopen_down.sql
--
-- Moves a Closed work order with no confirmed final acceptance back to Issued (its last open status),
-- clearing closed_at and closed_by and recording a work_order.reopen audit event with the required reason.
-- Cancelled work orders stay locked. Work orders closed by a confirmed final acceptance (ADR-0091:
-- closing_acceptance_id is not null) stay locked so final-acceptance immutability is preserved.
create or replace function public.reopen_work_order(p_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_reason                text := nullif(btrim(p_reason), '');
  v_org                   uuid;
  v_project               uuid;
  v_status                public.work_order_status;
  v_closing_acceptance_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();

  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'WOR_REASON: give a reason of 3 to 500 characters' using errcode = '23514';
  end if;

  select org_id, project_id, status, closing_acceptance_id
    into v_org, v_project, v_status, v_closing_acceptance_id
    from public.work_orders
   where id = p_id
   for update;

  if v_org is null then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Admin-only gate (ADR-0019): server-enforced, never just a hidden button.
  if public.auth_role() is distinct from 'Admin' then -- mut:reopen_admin_only
    raise exception 'only an administrator can reopen a closed work order' using errcode = '42501';
  end if;

  if v_status = 'Cancelled' then
    raise exception 'a cancelled work order cannot be reopened' using errcode = 'P0001';
  end if;

  if v_status is distinct from 'Closed' then
    raise exception 'only a closed work order can be reopened' using errcode = 'P0001';
  end if;

  if v_closing_acceptance_id is not null then
    raise exception 'this work order was closed by a confirmed final acceptance and cannot be reopened' using errcode = 'P0001';
  end if;

  update public.work_orders
     set status    = 'Issued',
         closed_at = null,
         closed_by = null
   where id = p_id;

  perform public.log_audit(
    'work_order.reopen',
    v_org,
    auth.uid(),
    p_id,
    jsonb_build_object(
      'from',       'Closed',
      'to',         'Issued',
      'project_id', v_project,
      'reason',     v_reason
    )
  );
end; $$;

revoke all on function public.reopen_work_order(uuid, text) from public, anon;
grant execute on function public.reopen_work_order(uuid, text) to authenticated, service_role;
