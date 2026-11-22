-- 1880_procurement_line_work_order.sql — a work order on each purchase line (spec docs/specs/wo-per-purchase-line.spec.md).
-- FR-WPL-001..004, AC-WPL-001..003. Builds on ADR-0104 (work orders on the cost side).
-- A purchase line (procurement_items) gains an optional work order. It is the line's OWN value and always wins when cost is
-- read (1882); the purchase records' work orders (request, PO, receipt, bill) are the default for lines that name none.
-- The rule trigger refuses, for every writer, a work order of another project or org, a purchase with no project, and a
-- newly named cancelled work order. One write path for people: set_cost_attribution (source 'procurement_item'; a line takes
-- no discipline). Every change is audited per line. A purchase cannot move to another project while a line names a work order
-- of the old one. The column is new and NULL for every existing line, so no existing figure moves.
-- drops: set_cost_attribution's source-list line and its audit-filter line each gain 'procurement_item'; every other line is kept.
-- Proven by supabase/tests/1880_procurement_line_work_order.test.sql (mutation checks in its header).
-- Reverse: supabase/migrations/rollback/1880_procurement_line_work_order_down.sql (drops the column: line work orders are lost).

alter table public.procurement_items add column work_order_id uuid references public.work_orders(id);
create index procurement_items_work_order_idx on public.procurement_items (work_order_id) where work_order_id is not null;

create function public.check_procurement_line_work_order() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid; v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
  if new.work_order_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.work_order_id is not distinct from old.work_order_id
     and new.procurement_id is not distinct from old.procurement_id then
    return new;
  end if;
  select p.project_id into v_project from public.procurements p where p.id = new.procurement_id and p.org_id = new.org_id;
  if v_project is null then
    raise exception 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order' using errcode = '23514';
  end if;
  select w.org_id, w.project_id, w.status into v_wo_org, v_wo_project, v_wo_status
    from public.work_orders w where w.id = new.work_order_id;
  if v_wo_org is distinct from new.org_id or v_wo_project is distinct from v_project then   -- mut:line_project
    raise exception 'COST_WO_PROJECT: the work order belongs to another project' using errcode = '23514';
  end if;
  if v_wo_status = 'Cancelled' and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then   -- mut:line_cancelled
    raise exception 'COST_WO_CANCELLED: the work order is cancelled' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.check_procurement_line_work_order() from public, anon, authenticated;
create trigger procurement_items_zz_cost_attribution_check before insert or update of work_order_id, procurement_id
  on public.procurement_items for each row execute function public.check_procurement_line_work_order();

-- Audit at the table boundary, as 0951 does for timesheet lines, so a direct write and the RPC leave the same evidence.
create function public.audit_procurement_line_work_order() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before jsonb;
begin
  if tg_op = 'INSERT' then
    if new.work_order_id is null then return new; end if;
    v_before := jsonb_build_object('work_order_id', null, 'discipline_id', null);
  else
    if new.work_order_id is not distinct from old.work_order_id then return new; end if;
    v_before := jsonb_build_object('work_order_id', old.work_order_id, 'discipline_id', null);
  end if;
  perform public.log_audit('cost_attribution.set', new.org_id, auth.uid(), new.id,
    jsonb_build_object('source', 'procurement_item', 'before', v_before,
      'after', jsonb_build_object('work_order_id', new.work_order_id, 'discipline_id', null)));
  return new;
end $$;
revoke all on function public.audit_procurement_line_work_order() from public, anon, authenticated;
create trigger procurement_items_zz_cost_attribution_audit after insert or update of work_order_id on public.procurement_items
  for each row execute function public.audit_procurement_line_work_order();

-- A purchase keeps its lines' work orders on its project (same shape as 0951 §3 for the records).
create function public.guard_procurement_move_with_line_work_orders() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.project_id is distinct from old.project_id and exists (
       select 1 from public.procurement_items i join public.work_orders w on w.id = i.work_order_id
        where i.procurement_id = new.id and w.project_id is distinct from new.project_id) then
    raise exception 'COST_LINE_PROJECT_MOVE: lines of this purchase name a work order of its project. Clear their work orders before moving the purchase.'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_move_with_line_work_orders() from public, anon, authenticated;
create trigger a0_procurements_line_work_order_move_guard before update of project_id on public.procurements
  for each row execute function public.guard_procurement_move_with_line_work_orders();

-- The one write path for people. 1261's body, the light-account guard 1461 injects at apply time, and the lines marked.
create or replace function public.set_cost_attribution(p_source text, p_ids uuid[], p_work_order_id uuid, p_discipline_id uuid)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_priv boolean;
  v_ids uuid[];
  v_found int;
  v_allowed int;
  v_before jsonb;
  v_n int;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('purchase_request', 'purchase_order', 'goods_receipt', 'vendor_bill',
                                          'timesheet_entry', 'stock_document', 'equipment_usage', 'expense_claim', 'procurement_item') then
    raise exception 'unknown cost source' using errcode = '22023';
  end if;
  if p_source = 'procurement_item' and p_discipline_id is not null then
    raise exception 'COST_LINE_DISCIPLINE: a purchase line takes a work order only; the discipline stays on the purchase records' using errcode = '23514';
  end if;
  select coalesce(array_agg(distinct i), '{}') into v_ids from unnest(coalesce(p_ids, '{}')) i where i is not null;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 500 then
    raise exception 'name between 1 and 500 records' using errcode = '22023';
  end if;
  v_priv := v_role in ('Admin', 'Executive', 'Finance', 'Project Manager');

  -- Lock the rows, count those in the caller's org, and count those the caller may change.
  case p_source
    when 'purchase_request' then
      perform 1 from public.purchase_requests r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.purchase_requests r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'purchase_order' then
      perform 1 from public.purchase_orders r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.purchase_orders r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'goods_receipt' then
      perform 1 from public.procurement_receipts r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.procurement_receipts r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'vendor_bill' then
      perform 1 from public.procurement_invoices r where r.id = any(v_ids) and r.org_id = v_org for update of r;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', r.id, 'work_order_id', r.work_order_id, 'discipline_id', r.discipline_id))
        into v_found, v_allowed, v_before
        from public.procurement_invoices r join public.procurements p on p.id = r.procurement_id
       where r.id = any(v_ids) and r.org_id = v_org;
    when 'timesheet_entry' then
      perform 1 from public.timesheet_entries e where e.id = any(v_ids) and e.org_id = v_org for update of e;
      select count(*), count(*) filter (where v_priv or (t.user_id = v_uid and t.status = 'Draft')),
             jsonb_agg(jsonb_build_object('id', e.id, 'work_order_id', e.work_order_id, 'discipline_id', e.discipline_id))
        into v_found, v_allowed, v_before
        from public.timesheet_entries e join public.timesheets t on t.id = e.timesheet_id
       where e.id = any(v_ids) and e.org_id = v_org;
    when 'stock_document' then
      perform 1 from public.stock_documents d where d.id = any(v_ids) and d.org_id = v_org for update of d;
      select count(*), count(*) filter (where v_priv or d.created_by = v_uid),
             jsonb_agg(jsonb_build_object('id', d.id, 'work_order_id', d.work_order_id, 'discipline_id', d.discipline_id))
        into v_found, v_allowed, v_before
        from public.stock_documents d
       where d.id = any(v_ids) and d.org_id = v_org;
    when 'equipment_usage' then
      perform 1 from public.equipment_usage_entries u where u.id = any(v_ids) and u.org_id = v_org for update of u;
      select count(*), count(*) filter (where v_priv or (u.author_id = v_uid and u.status in ('Draft', 'Rejected') and u.archived_at is null)),
             jsonb_agg(jsonb_build_object('id', u.id, 'work_order_id', u.work_order_id, 'discipline_id', u.discipline_id))
        into v_found, v_allowed, v_before
        from public.equipment_usage_entries u
       where u.id = any(v_ids) and u.org_id = v_org;
    when 'procurement_item' then
      perform 1 from public.procurement_items it where it.id = any(v_ids) and it.org_id = v_org for update of it;
      select count(*), count(*) filter (where v_priv or p.requested_by_id = v_uid),
             jsonb_agg(jsonb_build_object('id', it.id, 'work_order_id', it.work_order_id, 'discipline_id', null))
        into v_found, v_allowed, v_before
        from public.procurement_items it join public.procurements p on p.id = it.procurement_id
       where it.id = any(v_ids) and it.org_id = v_org;
    when 'expense_claim' then
      perform 1 from public.expense_claims c where c.id = any(v_ids) and c.org_id = v_org for update of c;
      select count(*), count(*) filter (where v_priv or (c.claimant_id = v_uid and c.status in ('Draft', 'Rejected'))),
             jsonb_agg(jsonb_build_object('id', c.id, 'work_order_id', c.work_order_id, 'discipline_id', c.discipline_id))
        into v_found, v_allowed, v_before
        from public.expense_claims c
       where c.id = any(v_ids) and c.org_id = v_org;
  end case;

  if v_found <> cardinality(v_ids) then
    raise exception 'record not found' using errcode = 'P0002';   -- SECURITY: another org's id reads as absent
  end if;
  if v_allowed <> v_found then
    raise exception 'you cannot change the work order or discipline of this record' using errcode = '42501';
  end if;

  case p_source
    when 'purchase_request' then update public.purchase_requests set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'purchase_order'   then update public.purchase_orders   set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'goods_receipt'    then update public.procurement_receipts set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'vendor_bill'      then update public.procurement_invoices set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'timesheet_entry'  then update public.timesheet_entries set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'stock_document'   then update public.stock_documents   set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'expense_claim'    then update public.expense_claims    set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
    when 'procurement_item' then update public.procurement_items set work_order_id = p_work_order_id where id = any(v_ids);
    when 'equipment_usage'  then update public.equipment_usage_entries set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
  end case;
  get diagnostics v_n = row_count;

  -- One audit row per record, carrying what it named before.
  perform public.log_audit('cost_attribution.set', v_org, v_uid, (b->>'id')::uuid,
            jsonb_build_object('source', p_source, 'before', b - 'id',
                               'after', jsonb_build_object('work_order_id', p_work_order_id, 'discipline_id', p_discipline_id)))
     from jsonb_array_elements(v_before) b where p_source not in ('timesheet_entry', 'procurement_item');
  return v_n;
end $$;
revoke all on function public.set_cost_attribution(text, uuid[], uuid, uuid) from public, anon;
revoke all on function public.set_cost_attribution(text, uuid[], uuid, uuid) from public, anon;
grant execute on function public.set_cost_attribution(text, uuid[], uuid, uuid) to authenticated;
