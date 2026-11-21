-- 1182_third_party_inspection_purchase.sql — #2580 MONEY PATH (ships alone): the purchase link of an inspection.
-- Spec FR-TPI-006, FR-TPI-007, FR-TPI-021 (OD-TPI-6). Proven by supabase/tests/1182_third_party_inspection_purchase.test.sql.
--   §1 tpi_raise_purchase: creates a Draft procurement case through the SHIPPED create_procurement_with_items (no direct insert
--      into any procurement table), or links an existing unlinked case of the inspection's project, then attributes that case's
--      existing records to the inspection's work order through the SHIPPED set_cost_attribution. It never calls
--      create_purchase_request / create_purchase_order and never copies the estimate anywhere.
--   §2 a trigger on the four purchase record tables fills work_order_id on a NEW record that names none when its case is linked
--      from a live inspection. It touches only work_order_id and never overwrites; check_cost_attribution (0951) then validates it.
-- No approval, SoD, match, payment or outbox code is touched (FR-TPI-010): procurement's own rules pass through unchanged.
-- ── REVERSE (rollback/1182_third_party_inspection_purchase_down.sql): drop the four a1_tpi triggers, the trigger function, tpi_raise_purchase.

create function public.tpi_raise_purchase(p_id uuid, p_procurement_id uuid default null, p_title text default null)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.third_party_inspections; v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_case public.procurements; v_pid uuid; r record;
begin
  perform public.assert_is_active_member(); -- also inside tpi_load_for_update; named here so the standing AC-AMG-001 sweep sees the gate
  v := public.tpi_load_for_update(p_id);
  if public.auth_role() not in ('Admin','Project Manager','Finance') then
    raise exception 'you cannot raise the purchase of an inspection' using errcode = '42501';
  end if;
  if v.status <> 'requested' then
    raise exception 'TPI_STEP: the purchase can be raised only while the inspection is requested' using errcode = '23514';
  end if;

  if p_procurement_id is null then
    -- A Draft case on the inspection's project with its vendor; the caller is the requester (procurement's own SoD then applies).
    v_pid := gen_random_uuid();
    perform public.create_procurement_with_items(v_pid,
      jsonb_strip_nulls(jsonb_build_object('title', coalesce(nullif(btrim(p_title), ''), 'Inspection: ' || v.title),
                                           'project_id', v.project_id, 'vendor_id', v.vendor_id)),
      '[]'::jsonb);
  else
    select * into v_case from public.procurements p where p.id = p_procurement_id and p.org_id = v_org for update;
    if not found or v_case.project_id is distinct from v.project_id then
      raise exception 'TPI_LINK_SCOPE: the purchase is not on this inspection''s project' using errcode = '23514';
    end if;
    if exists (select 1 from public.third_party_inspections o where o.procurement_id = p_procurement_id and o.id <> p_id) then
      raise exception 'TPI_LINK_HELD: another inspection already holds this purchase' using errcode = '23514';
    end if;
    if exists (select 1 from (
          select work_order_id from public.purchase_requests    where procurement_id = p_procurement_id
          union all select work_order_id from public.purchase_orders      where procurement_id = p_procurement_id
          union all select work_order_id from public.procurement_receipts where procurement_id = p_procurement_id
          union all select work_order_id from public.procurement_invoices where procurement_id = p_procurement_id) x
        where x.work_order_id is not null and x.work_order_id <> v.work_order_id) then
      raise exception 'TPI_LINK_WO: records of this purchase name another work order' using errcode = '23514';
    end if;
    v_pid := p_procurement_id;
  end if;

  begin
    update public.third_party_inspections set status = 'purchase_raised', procurement_id = v_pid,
           purchase_raised_at = now(), purchase_raised_by = v_uid, updated_at = now() where id = p_id;
  exception when unique_violation then
    raise exception 'TPI_LINK_HELD: another inspection already holds this purchase' using errcode = '23514';
  end;

  if p_procurement_id is not null then
    -- attribute the case's existing records, keeping each record's own discipline (set_cost_attribution sets both columns)
    for r in
      select 'purchase_request'::text as source, id, discipline_id from public.purchase_requests
        where procurement_id = v_pid and work_order_id is null
      union all select 'purchase_order', id, discipline_id from public.purchase_orders
        where procurement_id = v_pid and work_order_id is null
      union all select 'goods_receipt', id, discipline_id from public.procurement_receipts
        where procurement_id = v_pid and work_order_id is null
      union all select 'vendor_bill', id, discipline_id from public.procurement_invoices
        where procurement_id = v_pid and work_order_id is null and voided_at is null and erp_cancelled_at is null
    loop
      perform public.set_cost_attribution(r.source, array[r.id], v.work_order_id, r.discipline_id);
    end loop;
  end if;

  perform public.log_audit('third_party_inspection.raise_purchase', v.org_id, v_uid, p_id,
    jsonb_build_object('procurement_id', v_pid, 'linked_existing', p_procurement_id is not null));
  return v_pid;
end $$;
revoke all on function public.tpi_raise_purchase(uuid, uuid, text) from public, anon;
grant execute on function public.tpi_raise_purchase(uuid, uuid, text) to authenticated;

-- §2 FR-TPI-021 / OD-TPI-6
create function public.tpi_stamp_cost_attribution() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.work_order_id is null and new.procurement_id is not null then
    -- a cancelled work order takes no new cost (check_cost_attribution), so a case whose work order was cancelled stays unstamped
    select i.work_order_id into new.work_order_id
      from public.third_party_inspections i join public.work_orders w on w.id = i.work_order_id
     where i.procurement_id = new.procurement_id and i.status <> 'cancelled' and w.status <> 'Cancelled';
  end if;
  return new;
end $$;
revoke all on function public.tpi_stamp_cost_attribution() from public, anon, authenticated;

-- 'a1_' sorts before 'zz_cost_attribution_check', so the stamped value is validated by the shipped rule like any other.
create trigger a1_tpi_stamp_cost_attribution before insert on public.purchase_requests
  for each row execute function public.tpi_stamp_cost_attribution();
create trigger a1_tpi_stamp_cost_attribution before insert on public.purchase_orders
  for each row execute function public.tpi_stamp_cost_attribution();
create trigger a1_tpi_stamp_cost_attribution before insert on public.procurement_receipts
  for each row execute function public.tpi_stamp_cost_attribution();
create trigger a1_tpi_stamp_cost_attribution before insert on public.procurement_invoices
  for each row execute function public.tpi_stamp_cost_attribution();
