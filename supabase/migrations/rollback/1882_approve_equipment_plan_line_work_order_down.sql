-- Reverse 1882: restore 1472's approve_equipment_plan (work order as description text), with the light-account guard.
create or replace function public.approve_equipment_plan(p_id uuid) returns public.equipment_plans
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype; v_type uuid; v_line record;
  v_pid uuid; v_name text; v_note text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
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
  -- Every line's reference is checked before anything is created: a reference held by someone else is refused as such.
  for v_line in
    select l.id from public.equipment_plan_lines l where l.plan_id = p_id and l.procurement_id is null
  loop
    v_pid := md5('eqplan:' || v_line.id::text)::uuid;
    if exists (select 1 from public.procurements p where p.id = v_pid and p.requested_by_id is distinct from auth.uid()) then
      raise exception 'EQP_PID_TAKEN: one of this plan''s purchase references is already in use; save the line again in the Draft plan to pick a new one'
        using errcode = '42501';
    end if;
  end loop;
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
