-- 1359_approve_equipment_plan.sql — #2700: approving a plan creates the rental purchases. Spec FR-EQP-010..016, AC-EQP-008..014.
-- One Draft purchase per plan line, through create_procurement_with_items as it is (1351; not re-created), of the
-- organisation's rental type found by the is_rental flag. Each is an ordinary Draft: no status, approval or amount is carried;
-- it takes the normal request, approval and spend routing. The requester is the approver (the creation path stamps the caller),
-- so the existing purchase SoD stops the plan approver approving that spend: intended.
-- Idempotent: the plan row is locked; a second call finds it Approved and creates nothing; purchase ids derive from line ids and
-- equipment_plan_lines.procurement_id is unique; everything is one transaction, so either every purchase exists or none does.
-- The work order: create_procurement_with_items makes no purchase_requests row and takes no work order, so the line's work order
-- is written into the purchase item's description (deviation recorded in the spec, OQ-EQP-3).
-- REVERSE: rollback/1359_approve_equipment_plan_down.sql
create function public.approve_equipment_plan(p_id uuid) returns public.equipment_plans
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype; v_type uuid; v_line record;
  v_pid uuid; v_name text; v_note text;
begin
  select * into v_plan from public.equipment_plans where id = p_id and org_id = v_org for update;
  if not found then raise exception 'EQP_NOT_FOUND: the plan is not available' using errcode = '23503'; end if;
  if v_plan.created_by = auth.uid() and not coalesce((select allow_self_approval from public.org_equipment_plan_settings where org_id = v_org), false) then
    raise exception 'EQP_SELF_APPROVAL: you cannot approve your own plan' using errcode = '42501';
  end if;
  if not public.equipment_plan_approver_ok(p_id) then
    raise exception 'EQP_NOT_APPROVER: you cannot approve or reject this plan' using errcode = '42501';
  end if;
  if v_plan.status = 'Approved' then return v_plan; end if;
  if v_plan.status <> 'Submitted' then raise exception 'EQP_STATE: only a submitted plan can be approved' using errcode = '55000'; end if;
  v_type := public.equipment_plan_rental_type(v_org);
  if v_type is null then
    raise exception 'EQP_NO_RENTAL_TYPE: purchase types must be on with an active rental type' using errcode = '55000';
  end if;
  for v_line in
    select l.*, w.wo_number, w.title as wo_title, a.name as asset_name, k.name as category_name
      from public.equipment_plan_lines l
      left join public.work_orders w on w.id = l.work_order_id
      left join public.equipment_assets a on a.id = l.equipment_asset_id
      left join public.equipment_plan_categories k on k.id = l.category_id
     where l.plan_id = p_id order by l.date_from, l.id
  loop
    if v_line.procurement_id is not null then continue; end if;
    v_pid := md5('eqplan:' || v_line.id::text)::uuid;
    v_name := left(coalesce(v_line.description, v_line.asset_name), 200);
    v_note := concat_ws(' · ', 'Monthly plan ' || to_char(v_plan.plan_month, 'YYYY-MM'),
                        case when v_line.work_order_id is not null then 'Work order ' || coalesce(v_line.wo_number, v_line.wo_title) end,
                        v_line.category_name);
    perform public.create_procurement_with_items(
      v_pid,
      jsonb_build_object('title', left(v_name, 150) || ' (' || to_char(v_line.date_from, 'YYYY-MM-DD') || ' – ' || to_char(v_line.date_to, 'YYYY-MM-DD') || ')',
                         'project_id', v_plan.project_id, 'vendor_id', v_line.vendor_id, 'purchase_type_id', v_type,
                         'rental_from', v_line.date_from, 'rental_to', v_line.date_to),
      jsonb_build_array(jsonb_build_object('id', md5('eqplanitem:' || v_line.id::text)::uuid, 'name', v_name,
                         'description', v_note, 'quantity', v_line.quantity, 'rate', v_line.rate)));
    update public.equipment_plan_lines set procurement_id = v_pid where id = v_line.id;
  end loop;
  update public.equipment_plans set status = 'Approved', approved_by = auth.uid(), approved_at = now() where id = p_id returning * into v_plan;
  return v_plan;
end $$;
revoke all on function public.approve_equipment_plan(uuid) from public, anon;
grant execute on function public.approve_equipment_plan(uuid) to authenticated;
