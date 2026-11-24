-- Rollback for 2590_stock_count_work_order.sql: restores check_cost_attribution (1580),
-- guard_warehouse_move_with_work_orders (1161), create_stock_document (2228),
-- save_stock_draft (0534 + 1461), and stock_issue_cost_lines (2240).

create or replace function public.check_cost_attribution() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
  if tg_table_name = 'expense_claims' then
    if new.kind = 'advance' and (new.work_order_id is not null or new.discipline_id is not null) then
      raise exception 'COST_ADVANCE: a cash advance is not a cost; name the work order on the claim that settles it' using errcode = '23514';
    end if;
  end if;
  if new.work_order_id is not null then
    case tg_table_name
      when 'timesheet_entries', 'equipment_usage_entries', 'expense_claims', 'procurements' then
        v_project := new.project_id;
      when 'stock_documents' then
        if new.kind in ('issue', 'return') then
          v_project := new.project_id;
        elsif new.kind = 'transfer' then
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.to_warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');
        elsif new.kind = 'receive' then
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');
        end if;
      else
        select p.project_id into v_project from public.procurements p
         where p.id = new.procurement_id and p.org_id = new.org_id;
    end case;
    if v_project is null then
      raise exception 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order' using errcode = '23514';
    end if;
    select w.org_id, w.project_id, w.status into v_wo_org, v_wo_project, v_wo_status
      from public.work_orders w where w.id = new.work_order_id;
    if v_wo_org is distinct from new.org_id or v_wo_project is distinct from v_project then
      raise exception 'COST_WO_PROJECT: the work order belongs to another project' using errcode = '23514';
    end if;
    if v_wo_status = 'Cancelled' and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
      raise exception 'COST_WO_CANCELLED: the work order is cancelled' using errcode = '23514';
    end if;
  end if;
  if new.discipline_id is not null and (tg_op = 'INSERT' or new.discipline_id is distinct from old.discipline_id) then
    if not exists (select 1 from public.cost_disciplines d
                    where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
      raise exception 'COST_DISCIPLINE: the discipline is not on this organisation''s list' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_cost_attribution() from public, anon, authenticated;

create or replace function public.guard_warehouse_move_with_work_orders() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.project_id is distinct from old.project_id or new.kind is distinct from old.kind)
     and exists (select 1 from public.stock_documents d
       join public.work_orders w on w.id = d.work_order_id
       where ((d.to_warehouse_id = new.id and d.kind = 'transfer') or (d.warehouse_id = new.id and d.kind = 'receive'))
         and (new.kind not in ('site', 'yard', 'staging') or w.project_id is distinct from new.project_id)) then
    raise exception 'COST_WO_PROJECT_MOVE: transfers to this warehouse name a work order of its project' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_warehouse_move_with_work_orders() from public, anon, authenticated;

create or replace function public.create_stock_document(p_header jsonb, p_lines jsonb, p_post boolean default false, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_kind text; v_wh uuid; v_occ date; v_doc public.stock_documents; v_id uuid; v_override boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  v_org := public.auth_org_id();
  if v_org is null then raise exception 'STK_NOT_FOUND: no organisation' using errcode = 'P0001'; end if;
  if p_client_request_id is not null then
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(p_post, false) then perform public.stock_assert_standalone(v_org); end if;
  v_kind := p_header->>'kind';
  if v_kind = 'receive' and exists(select 1 from public.order_receiving_settings where org_id=v_org and enabled) then
    raise exception 'RGO_USE_ORDER: Receive these goods against their purchase order.' using errcode='23514';
  end if;
  perform public.stock_validate_payload(v_org, v_kind, p_header, p_lines);
  v_wh := (p_header->>'warehouse_id')::uuid;
  v_override := public.stock_assert_keeper(v_org, v_wh, v_uid);
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, public.stock_org_today(v_org));
  perform public.stock_assert_dates(v_org, v_occ);
  insert into public.stock_documents (org_id, number, kind, warehouse_id, to_warehouse_id, project_id, procurement_id, reason, note,
                                      occurred_on, client_request_id, created_by)
  values (v_org, public.next_procurement_doc_number(v_org, public.stock_doc_prefix(v_kind)), v_kind, v_wh,
          nullif(p_header->>'to_warehouse_id', '')::uuid, case when v_kind = 'issue' then nullif(p_header->>'project_id', '')::uuid end,
          nullif(p_header->>'procurement_id', '')::uuid, nullif(btrim(p_header->>'reason'), ''), nullif(btrim(p_header->>'note'), ''),
          v_occ, p_client_request_id, v_uid)
  on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
  returning * into v_doc;
  if v_doc.id is null then
    select d.id into v_id from public.stock_documents d where d.org_id = v_org and d.created_by = v_uid and d.client_request_id = p_client_request_id;
    return v_id;
  end if;
  perform public.stock_insert_lines(v_doc, p_lines);
  perform public.stock_apply(v_doc, false);
  if coalesce(p_post, false) then perform public.stock_post_core(v_doc.id);
  elsif v_override then
    perform public.log_audit('stock.admin_author', v_org, v_uid, v_doc.id, jsonb_build_object('kind', v_kind, 'warehouse_id', v_wh, 'number', v_doc.number));
  end if;
  return v_doc.id;
end $$;

create or replace function public.save_stock_draft(p_document_id uuid, p_header jsonb, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid(); d public.stock_documents; v_occ date; v_old jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  select * into d from public.stock_documents x where x.id = p_document_id and x.org_id = v_org for update;
  if not found then raise exception 'STK_NOT_FOUND: the document is not in your organisation' using errcode = 'P0001'; end if;
  if d.status <> 'Draft' then raise exception 'STK_IMMUTABLE: only a draft can be edited' using errcode = 'P0001'; end if;
  if d.created_by <> v_uid then raise exception 'only the author edits a draft' using errcode = '42501'; end if;
  perform public.assert_feature_on(public.auth_org_id(), 'stock');
  if coalesce(p_header->>'kind', d.kind) <> d.kind then raise exception 'STK_INVALID: a document''s kind cannot change' using errcode = 'P0001'; end if;
  perform public.stock_validate_payload(v_org, d.kind, p_header, p_lines);
  if public.stock_assert_keeper(v_org, (p_header->>'warehouse_id')::uuid, v_uid) then
    perform public.log_audit('stock.admin_author', v_org, v_uid, d.id, jsonb_build_object('kind', d.kind, 'warehouse_id', p_header->>'warehouse_id', 'number', d.number));
  end if;
  v_occ := coalesce(nullif(p_header->>'occurred_on', '')::date, d.occurred_on);
  perform public.stock_assert_dates(v_org, v_occ);
  update public.stock_documents set warehouse_id = (p_header->>'warehouse_id')::uuid, to_warehouse_id = nullif(p_header->>'to_warehouse_id', '')::uuid,
         project_id = case when d.kind = 'issue' then nullif(p_header->>'project_id', '')::uuid else d.project_id end, procurement_id = nullif(p_header->>'procurement_id', '')::uuid,
         reason = nullif(btrim(p_header->>'reason'), ''), note = nullif(btrim(p_header->>'note'), ''), occurred_on = v_occ,
         revision = d.revision + 1
   where id = d.id returning * into d;
  select coalesce(jsonb_agg(o), '[]'::jsonb) into v_old from (
    select distinct on (l.item_id, l.direction) l.item_id, l.direction, l.unit_cost from public.stock_document_lines l
     where l.document_id = d.id and l.unit_cost is not null order by l.item_id, l.direction, l.line_no) o;
  delete from public.stock_document_lines where document_id = d.id;
  perform public.stock_insert_lines(d, p_lines);
  if d.kind in ('adjustment','count') then
    update public.stock_document_lines n set unit_cost = (o->>'unit_cost')::numeric
      from jsonb_array_elements(v_old) o
     where n.document_id = d.id and n.unit_cost is null and n.item_id = (o->>'item_id')::uuid
       and n.direction is not distinct from (o->>'direction') and (d.kind = 'count' or n.direction = 'in');
  end if;
  perform public.stock_apply(d, false);
end $$;

create or replace function public.stock_issue_cost_lines(p_project uuid)
returns table(record_id uuid, work_order_id uuid, discipline_id uuid, occurred_on date, reference text, currency text, amount numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform public.assert_not_light();
 if not public.is_active_member() or public.auth_role() is null or public.auth_role() not in ('Admin','Executive','Finance','Project Manager') then
   raise exception 'not authorized' using errcode='42501';
 end if;
 if not exists(select 1 from public.projects p where p.id=p_project and p.org_id=public.auth_org_id()) then
   raise exception 'project not found' using errcode='P0002';
 end if;
 if public.org_reads_erp_ledger() then return; end if;
 return query select d.id,d.work_order_id,d.discipline_id,d.occurred_on,d.number,p.currency,
    case when p.currency=o.default_currency then -sum(l.value_delta) end
 from public.stock_documents d
 join public.stock_issue_cost_settings s on s.org_id=d.org_id and d.occurred_on>=s.effective_on
 join public.stock_ledger l on l.document_id=d.id and l.org_id=d.org_id
 join public.projects p on p.id=d.project_id and p.org_id=d.org_id
 join public.organizations o on o.id=d.org_id
 where d.org_id=public.auth_org_id() and d.project_id=p_project and d.kind in ('issue','return') and d.status='Posted'
 group by d.id,p.currency,o.default_currency;
end $$;
