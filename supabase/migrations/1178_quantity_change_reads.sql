-- 1178_quantity_change_reads.sql — #2578: the guarded reads the screens need.
-- Spec: docs/specs/quantity-change-requests.spec.md (FR-QCR-001, 011, 021, 024); AC-QCR-001, 002, 013, 028.
-- Reversal: rollback/1178_quantity_change_reads_down.sql.
--   qcr_over_contract(project, only_over)  every contract line with C, P (and the source that set it), E, the over flags, and
--                                          the open request on it; one set-based read (NFR-QCR-002).
--   qcr_work_order_budget(work_order)      request count and the organisation limit, shown together.
--   qcr_approval_state(request)            what the approve button needs: may the caller approve, and if not why; and whether
--                                          anyone at all could (the queue says so when nobody can).

create function public.qcr_over_contract(p_project_id uuid, p_only_over boolean default false)
returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, earning_basis text,
               contract_quantity numeric, progress_quantity numeric, progress_source text, forecast_quantity numeric,
               over_progress boolean, over_forecast boolean, open_request_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select p.org_id into v_org from public.projects p where p.id = p_project_id;
  if v_org is distinct from public.auth_org_id() then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return query
  select b.id, b.item_code, b.description, b.unit, b.rate, f.earning_basis, f.contract_quantity, f.progress_quantity,
         f.progress_source, f.forecast_quantity, f.over_progress, f.over_forecast, ol.request_id
    from public.qcr_figures(array(select x.id from public.boq_items x where x.project_id = p_project_id)) f
    join public.boq_items b on b.id = f.boq_item_id
    left join public.quantity_change_request_lines ol on ol.boq_item_id = b.id and ol.is_open
   where (not p_only_over or f.over_progress or f.over_forecast)
   order by b.line_no nulls last, b.created_at, b.id;
end; $$;
revoke all on function public.qcr_over_contract(uuid, boolean) from public, anon;
grant execute on function public.qcr_over_contract(uuid, boolean) to authenticated;

create function public.qcr_work_order_budget(p_work_order_id uuid)
returns table (request_count integer, request_limit integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select w.org_id into v_org from public.work_orders w where w.id = p_work_order_id;
  if v_org is distinct from public.auth_org_id() then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;
  return query select public.qcr_request_count(p_work_order_id),
                      (select o.quantity_change_limit from public.organizations o where o.id = v_org);
end; $$;
revoke all on function public.qcr_work_order_budget(uuid) from public, anon;
grant execute on function public.qcr_work_order_budget(uuid) to authenticated;

create function public.qcr_approval_state(p_request_id uuid)
returns table (can_approve boolean, reason text, eligible_approver_exists boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_req public.quantity_change_requests; v_reason text;
begin
  perform public.assert_is_active_member();
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id;
  if not found or v_req.org_id is distinct from public.auth_org_id() then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  v_reason := case
    when public.auth_role() not in ('Admin','Executive','Finance') then 'role'
    when v_uid = v_req.author_id then 'author'
    when v_uid = any (v_req.editor_ids) then 'editor'
    when v_uid is not distinct from v_req.submitted_by then 'submitter'
    when v_req.status <> 'pending_approval' then 'status'
  end;
  return query select v_reason is null, v_reason,
    exists (select 1 from public.profiles p
             where p.org_id = v_req.org_id and public.is_active_member(p.id) and p.role in ('Admin','Executive','Finance')
               and p.id <> v_req.author_id and p.id <> all (v_req.editor_ids)
               and p.id is distinct from v_req.submitted_by);
end; $$;
revoke all on function public.qcr_approval_state(uuid) from public, anon;
grant execute on function public.qcr_approval_state(uuid) to authenticated;
