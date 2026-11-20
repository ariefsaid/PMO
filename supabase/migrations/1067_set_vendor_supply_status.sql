-- 1067_set_vendor_supply_status.sql — #2583 slice 2b: the ONE client write path for a supplier's supply-risk status
-- (FR-VSR-002, 004, 005, 013). SECURITY DEFINER; active member; Admin or Finance only (OD-VSR-3; the user_role enum has
-- no purchasing role); the company must be a Vendor of the caller's org and not archived; a reason (1-500 chars) is
-- required for at_risk and inactive; audited (company.supply_risk.change: from, to, reason, actor); and, when the
-- status CHANGES to at_risk or inactive, each project manager of a project with an exposed work order is notified once
-- through notify_workflow_user (0237; never the acting user) with the SUPPLIER as the notification's entity. Setting
-- the status it already has changes nothing and notifies nobody. Moving back to active notifies nobody (OQ-VSR-4).
-- The status never blocks an order, a transition or a payment (OD-VSR-4).
--
-- Rollback: supabase/migrations/rollback/1067_set_vendor_supply_status_down.sql.

create or replace function public.set_vendor_supply_status(p_company_id uuid, p_status text, p_reason text default null)
  returns public.companies language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row    public.companies;
  v_reason text := nullif(btrim(p_reason), '');
  v_from   text;
  v_from_reason text;
  r        record;
begin
  perform public.assert_is_active_member();
  if auth_role() not in ('Admin', 'Finance') then
    raise exception 'Only Admin or Finance can set a supplier''s supply-risk status' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('active', 'at_risk', 'inactive') then
    raise exception 'unknown supply-risk status' using errcode = '22023';
  end if;
  if p_status <> 'active' and v_reason is null then
    raise exception 'a reason is required for at_risk and inactive' using errcode = '23514';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'the reason is at most 500 characters' using errcode = '23514';
  end if;

  select * into v_row from public.companies where id = p_company_id and org_id = auth_org_id() for update;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if v_row.type <> 'Vendor' then
    raise exception 'only a vendor has a supply-risk status' using errcode = 'P0001';
  end if;
  if v_row.archived_at is not null then
    raise exception 'an archived company has no supply-risk status to set' using errcode = 'P0001';
  end if;

  v_from := v_row.supply_risk_status;
  v_from_reason := v_row.supply_risk_reason;
  if v_from = p_status and v_from_reason is not distinct from v_reason then
    return v_row;                                         -- nothing changes: no audit, no notification
  end if;

  perform set_config('pmo.vendor_supply_risk_write', 'on', true);
  update public.companies
     set supply_risk_status = p_status,
         supply_risk_reason = v_reason,
         supply_risk_set_by = auth.uid(),
         supply_risk_set_at = now()
   where id = p_company_id
   returning * into v_row;
  -- Cleared at once: the flag is transaction-local, so leaving it on would let a later direct UPDATE in the same
  -- transaction past the guard (0252's rule).
  perform set_config('pmo.vendor_supply_risk_write', '', true);

  perform public.log_audit('company.supply_risk.change', v_row.org_id, auth.uid(), v_row.id,
    jsonb_build_object('from', v_from, 'to', p_status, 'reason', v_reason, 'from_reason', v_from_reason));

  if p_status in ('at_risk', 'inactive') and v_from is distinct from p_status then
    for r in
      select e.project_id, e.project_manager_id, e.project_name,
             string_agg(coalesce(e.wo_number || ' ', '') || e.title, ', ' order by e.wo_number, e.title) as wos
        from (select distinct x.project_id, x.project_manager_id, x.project_name, x.work_order_id, x.wo_number, x.title
                from public.vendor_exposed_work_orders(p_company_id) x
               where x.kind = 'work_order' and x.project_manager_id is not null) e
       group by e.project_id, e.project_manager_id, e.project_name
    loop
      perform public.notify_workflow_user(v_row.org_id, r.project_manager_id,
        case p_status when 'at_risk' then 'Supplier marked at risk' else 'Supplier marked inactive' end,
        v_row.name || ' (' || r.project_name || '): ' || r.wos,
        'warning', 'company', v_row.id, v_row.name);
    end loop;
  end if;
  return v_row;
end; $$;
revoke all on function public.set_vendor_supply_status(uuid, text, text) from public, anon;
grant execute on function public.set_vendor_supply_status(uuid, text, text) to authenticated;
comment on function public.set_vendor_supply_status(uuid, text, text) is
  '#2583 (FR-VSR-002): sets a supplier''s supply-risk status. Active Admin/Finance member of the vendor''s org; vendor, '
  'not archived; reason required unless active; audited (company.supply_risk.change); notifies the exposed projects'' '
  'managers once per change. The only client path past companies_supply_risk_guard.';

notify pgrst, 'reload schema';
