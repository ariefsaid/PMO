-- 1261_set_cost_attribution_expense_claim.sql — #2732 (DD-SCWO-3): set_cost_attribution accepts source 'expense_claim'.
-- 0951 §5 verbatim plus the lines mentioning expense_claim. Who may: Admin, Executive, Finance, Project Manager any claim of
-- their org (audited, any status); the claimant only their own claim while Draft or Rejected. Rule trigger: 1260.
-- Proven by supabase/tests/1260_site_cash_work_order.test.sql. Reverse: rollback/1261_set_cost_attribution_expense_claim_down.sql.

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
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('purchase_request', 'purchase_order', 'goods_receipt', 'vendor_bill',
                                          'timesheet_entry', 'stock_document', 'equipment_usage', 'expense_claim') then
    raise exception 'unknown cost source' using errcode = '22023';
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
    when 'equipment_usage'  then update public.equipment_usage_entries set work_order_id = p_work_order_id, discipline_id = p_discipline_id where id = any(v_ids);
  end case;
  get diagnostics v_n = row_count;

  -- One audit row per record, carrying what it named before.
  perform public.log_audit('cost_attribution.set', v_org, v_uid, (b->>'id')::uuid,
            jsonb_build_object('source', p_source, 'before', b - 'id',
                               'after', jsonb_build_object('work_order_id', p_work_order_id, 'discipline_id', p_discipline_id)))
     from jsonb_array_elements(v_before) b where p_source <> 'timesheet_entry';
  return v_n;
end $$;
revoke all on function public.set_cost_attribution(text, uuid[], uuid, uuid) from public, anon;
revoke all on function public.set_cost_attribution(text, uuid[], uuid, uuid) from public, anon;
grant execute on function public.set_cost_attribution(text, uuid[], uuid, uuid) to authenticated;
