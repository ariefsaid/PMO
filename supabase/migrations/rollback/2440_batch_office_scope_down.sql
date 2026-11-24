-- Reverse batch office scope and history integration.
create or replace function public.get_stock_movement_proof_status(p_status text default null, p_from date default null, p_to date default null)
  returns table (
    movement_id uuid, movement_number text, mode text, transfer_status text, movement_date date,
    from_warehouse_id uuid, from_warehouse_name text, to_warehouse_id uuid, to_warehouse_name text,
    tag_rules text[], required_proof text, has_paper boolean, has_confirmation boolean,
    proof_status text, missing text, proof_completed_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_org uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if p_status is not null and p_status not in ('outstanding', 'complete') then
    raise exception 'STK_INVALID: the proof status is outstanding or complete' using errcode = 'P0001'; end if;
  return query
  with one as (
    select d.id as movement_id, d.number as movement_number, 'one_step'::text as mode, d.status as transfer_status, d.occurred_on as movement_date,
           d.warehouse_id as from_id, d.to_warehouse_id as to_id, array['paper']::text[] as tag_rules,
           exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
                    where f.document_id = d.id and f.archived_at is null) as has_paper,
           false as has_confirmation,
           (select max(f.created_at) from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
             where f.document_id = d.id and f.archived_at is null) as last_evidence,
           null::text as to_label
      from public.stock_documents d
     where d.org_id = v_org and d.kind = 'transfer' and d.status = 'Posted' and d.two_step_id is null
       and exists (select 1 from public.stock_document_lines l join public.stock_items i on i.id = l.item_id join public.stock_tags t on t.id = i.tag_id
                    where l.document_id = d.id and t.zero_cost and t.paper_required)
  ), two as (
    select t.id as movement_id, t.number as movement_number, 'two_step'::text as mode, t.status as transfer_status, sd.occurred_on as movement_date,
           t.from_warehouse_id as from_id, t.to_warehouse_id as to_id,
           (select array_agg(distinct tg.proof_required order by tg.proof_required) from public.stock_transfer_lines l
              join public.stock_items i on i.id = l.item_id join public.stock_tags tg on tg.id = i.tag_id
             where l.transfer_id = t.id and tg.proof_required <> 'none') as tag_rules,
           exists (select 1 from public.stock_handover_confirmations c where c.transfer_id = t.id and c.proof_type = 'paper') as has_paper,
           exists (select 1 from public.stock_handover_confirmations c where c.transfer_id = t.id and c.proof_type = 'in_app' and c.stage = 'receive') as has_confirmation,
           (select max(c.confirmed_at) from public.stock_handover_confirmations c where c.transfer_id = t.id) as last_evidence,
           null::text as to_label
      from public.stock_transfers t join public.stock_documents sd on sd.id = t.send_document_id
     where t.org_id = v_org and t.status <> 'Cancelled'
  ), iss as (
    select d.id as movement_id, d.number as movement_number, 'one_step'::text as mode, d.status as transfer_status, d.occurred_on as movement_date,
           d.warehouse_id as from_id, null::uuid as to_id, array['paper']::text[] as tag_rules,
           exists (select 1 from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
                    where f.document_id = d.id and f.archived_at is null) as has_paper,
           false as has_confirmation,
           (select max(f.created_at) from public.stock_document_files f join storage.objects o on o.bucket_id = 'stock-documents' and o.name = f.file_path
             where f.document_id = d.id and f.archived_at is null) as last_evidence,
           coalesce(p.name, '') as to_label
      from public.stock_documents d left join public.projects p on p.id = d.project_id
     where d.org_id = v_org and d.kind = 'issue' and d.status = 'Posted'
       and public.stock_handover_scope_of(v_org) = 'transfers_and_issues'
  ), u as (
    select * from one union all select * from iss union all select * from two where tag_rules is not null
  )
  select x.movement_id, x.movement_number, x.mode, x.transfer_status, x.movement_date,
         x.from_id, fw.name, x.to_id, coalesce(tw.name, x.to_label),
         x.tag_rules, case when cardinality(x.tag_rules) = 1 then x.tag_rules[1] else 'mixed' end,
         x.has_paper, x.has_confirmation,
         case when m.missing is null then 'complete' else 'outstanding' end, m.missing,
         case when m.missing is null then x.last_evidence end
    from u x
    join public.stock_warehouses fw on fw.id = x.from_id
    left join public.stock_warehouses tw on tw.id = x.to_id
    cross join lateral (
      select nullif(array_to_string(array_remove(array[
          case when 'paper' = any (x.tag_rules) and not x.has_paper then 'paper' end,
          case when 'confirmation' = any (x.tag_rules) and not x.has_confirmation then 'confirmation' end,
          case when 'either' = any (x.tag_rules) and not (x.has_paper or x.has_confirmation) then 'either' end], null), ','), '') as missing) m
   where (p_from is null or x.movement_date >= p_from) and (p_to is null or x.movement_date <= p_to)
     and (p_status is null or p_status = case when m.missing is null then 'complete' else 'outstanding' end)
   order by x.movement_date desc, x.movement_number desc;
end $$;

create or replace function public.get_work_order_material_completion(p_work_order_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid; v_cost boolean; v_out jsonb;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not exists (select 1 from public.work_orders w where w.id = p_work_order_id and w.org_id = v_org) then
    raise exception 'STK_NOT_FOUND: the work order is not in your organisation' using errcode = 'P0001';
  end if;
  v_cost := public.stock_can_see_cost();

  with bal as (
    select (e->>'item_id')::uuid as item_id, sum((e->>'received_qty')::numeric) as received, sum((e->>'moved_out_qty')::numeric) as moved,
           sum((e->>'on_site_qty')::numeric) as on_site, sum(coalesce((e->>'on_site_value')::numeric, 0)) as on_site_value
      from jsonb_array_elements(public.get_work_order_stock_balance(p_work_order_id, null)) e group by 1
  ), led as (
    select l.item_id,
           sum(case when l.kind = 'issue'  and d.wo_transfer_id is null then -l.qty_delta else 0 end) as issued,
           sum(case when l.kind = 'return' and d.wo_transfer_id is null then  l.qty_delta else 0 end) as returned,
           sum(case when l.kind = 'issue'  and d.wo_transfer_id is null then -l.value_delta else 0 end) as issued_value,
           sum(case when l.kind = 'return' and d.wo_transfer_id is null then  l.value_delta else 0 end) as returned_value,
           sum(case when l.kind = 'count' then l.qty_delta else 0 end) as counted,
           sum(case when l.kind = 'count' and l.qty_delta > 0 then  l.qty_delta else 0 end) as count_gain,
           sum(case when l.kind = 'count' and l.qty_delta < 0 then -l.qty_delta else 0 end) as count_loss
      from public.stock_ledger l join public.stock_documents d on d.id = l.document_id
     where l.org_id = v_org and d.work_order_id = p_work_order_id group by l.item_id
  ), c as (
    select i.id as item_id, i.code as item_code, i.name as item_name, u.code as unit_code,
           coalesce(le.issued, 0) as issued, coalesce(le.returned, 0) as returned,
           coalesce(b.received, 0) - coalesce(le.count_gain, 0) as moved_in, coalesce(b.moved, 0) - coalesce(le.count_loss, 0) as moved_out,
           coalesce(le.counted, 0) as counted, coalesce(b.on_site, 0) as balance,
           coalesce(le.issued_value, 0) as issued_value, coalesce(le.returned_value, 0) as returned_value, coalesce(b.on_site_value, 0) as balance_value
      from (select item_id from bal union select item_id from led) k
      join public.stock_items i on i.id = k.item_id and i.org_id = v_org
      join public.stock_units u on u.id = i.unit_id
      left join bal b on b.item_id = k.item_id
      left join led le on le.item_id = k.item_id
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'item_code', c.item_code, 'item_name', c.item_name, 'unit_code', c.unit_code,
           'issued', trim_scale(c.issued)::text, 'returned', trim_scale(c.returned)::text, 'moved_in', trim_scale(c.moved_in)::text,
           'moved_out', trim_scale(c.moved_out)::text, 'counted_difference', trim_scale(c.counted)::text, 'balance', trim_scale(c.balance)::text)
           || case when v_cost then jsonb_build_object('issued_value', c.issued_value::text, 'returned_value', c.returned_value::text, 'balance_value', c.balance_value::text)
                   else '{}'::jsonb end
           order by c.item_code) from c), '[]'::jsonb),
    'totals', coalesce((select jsonb_agg(jsonb_build_object('unit_code', x.unit_code, 'issued', trim_scale(x.issued)::text, 'returned', trim_scale(x.returned)::text,
           'moved_in', trim_scale(x.moved_in)::text, 'moved_out', trim_scale(x.moved_out)::text, 'counted_difference', trim_scale(x.counted)::text,
           'balance', trim_scale(x.balance)::text) order by x.unit_code)
           from (select unit_code, sum(issued) issued, sum(returned) returned, sum(moved_in) moved_in, sum(moved_out) moved_out, sum(counted) counted, sum(balance) balance
                   from c group by unit_code) x), '[]'::jsonb),
    'value_totals', case when v_cost then (select jsonb_build_object('issued', coalesce(sum(issued_value), 0)::text, 'returned', coalesce(sum(returned_value), 0)::text,
                                                                      'balance', coalesce(sum(balance_value), 0)::text) from c) end)
    into v_out;
  return v_out;
end $$;

create or replace function public.po_needed_by_required_from_of(p_org uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select (select o.po_needed_by_required_from from public.organizations o where o.id = p_org) $$;

create or replace function public.set_po_needed_by_required(p_on boolean) returns boolean
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_old timestamptz;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                              -- mut:setting_admin
    raise exception 'only an Admin changes the needed-by rule' using errcode = '42501'; end if;
  if p_on is null then raise exception 'the needed-by rule is on or off' using errcode = '22023'; end if;
  select o.po_needed_by_required_from into v_old from public.organizations o where o.id = v_org for update;
  if p_on and v_old is null then
    update public.organizations set po_needed_by_required_from = now() where id = v_org;
  elsif not p_on and v_old is not null then
    update public.organizations set po_needed_by_required_from = null where id = v_org;
  else
    return v_old is not null;
  end if;
  perform public.log_audit('purchase.needed_by_required', v_org, auth.uid(), v_org, jsonb_build_object('on', p_on));
  return p_on;
end $$;

create or replace function public.set_procurement_needed_by(p_id uuid, p_needed_by date, p_lines jsonb default null) returns boolean
  language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_case public.procurements%rowtype; v_e jsonb; v_id uuid; v_d date;
begin
  if auth.uid() is null or v_org is null or not coalesce(public.is_active_member(), false) then
    raise exception 'the needed-by date is not permitted' using errcode = '42501'; end if;
  select * into v_case from public.procurements where id = p_id and org_id = v_org for update;
  if v_case.id is null
     or v_case.status not in ('Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected')                    -- mut:status
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false)
     or not coalesce(v_case.requested_by_id = auth.uid() or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'), false) then   -- mut:who
    raise exception 'the needed-by date is not permitted' using errcode = '42501'; end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then
    raise exception 'the lines are a list' using errcode = '22023'; end if;
  perform set_config('pmo.po_needed_by_write', 'on', true);
  update public.procurements set needed_by = p_needed_by where id = p_id;
  if p_needed_by is not null then
    update public.procurement_items set needed_by = p_needed_by
     where procurement_id = p_id and org_id = v_org and (needed_by is null or needed_by is not distinct from v_case.needed_by);
  end if;
  for v_e in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_id := (v_e->>'item_id')::uuid;
    v_d := coalesce(nullif(v_e->>'needed_by', '')::date, p_needed_by);
    update public.procurement_items set needed_by = v_d where id = v_id and procurement_id = p_id and org_id = v_org;
  end loop;
  perform set_config('pmo.po_needed_by_write', 'off', true);
  perform public.log_audit('purchase.needed_by', v_org, auth.uid(), p_id, jsonb_build_object('from', v_case.needed_by, 'to', p_needed_by));
  return true;
end $$;

create or replace function public.set_stock_handover_scope(p_scope text) returns text
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_old text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then                          -- mut:scope_admin
    raise exception 'STK_FORBIDDEN: only an Admin changes the handover scope' using errcode = '42501'; end if;
  if p_scope is null or p_scope not in ('transfers', 'transfers_and_issues') then
    raise exception 'STK_INVALID: the handover scope is transfers or transfers_and_issues' using errcode = 'P0001'; end if;
  select o.stock_handover_scope into v_old from public.organizations o where o.id = v_org for update;
  if v_old = p_scope then return v_old; end if;
  update public.organizations set stock_handover_scope = p_scope where id = v_org;
  perform public.log_audit('stock.handover_scope', v_org, auth.uid(), v_org, jsonb_build_object('from', v_old, 'to', p_scope));
  return p_scope;
end $$;

create or replace function public.stock_handover_scope_of(p_org uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select o.stock_handover_scope from public.organizations o where o.id = p_org), 'transfers') $$;

drop policy light_account_deny_select on public.org_setup_workflow_settings;
update public.record_history_config set captured = captured - 'needed_by' where table_name = 'procurements';
