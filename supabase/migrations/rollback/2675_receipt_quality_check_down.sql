-- Reverse 2675: restore the 0413 bodies, then drop the columns (no receipt may carry a check when this runs).
create or replace function public.stock_validate_payload(p_org uuid, p_kind text, p_header jsonb, p_lines jsonb) returns void
  language plpgsql stable security definer set search_path = public as $$
declare
  v_wh uuid := (p_header->>'warehouse_id')::uuid;
  v_to uuid := nullif(p_header->>'to_warehouse_id', '')::uuid;
  e jsonb; v_item record; v_q numeric; v_c numeric; v_cost numeric; v_dir text;
begin
  if p_kind is null or p_kind not in ('receive','transfer','issue','return','adjustment','count') then
    raise exception 'STK_INVALID: unknown document kind' using errcode = 'P0001'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'STK_INVALID: a document needs 1 to 200 lines' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.stock_warehouses w where w.id = v_wh and w.org_id = p_org) then
    raise exception 'STK_NOT_FOUND: the warehouse is not in your organisation' using errcode = 'P0001'; end if;
  if p_kind = 'transfer' then
    if v_to is null or v_to = v_wh then raise exception 'STK_INVALID: a transfer needs a different destination warehouse' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.stock_warehouses w where w.id = v_to and w.org_id = p_org) then          -- mut:xorg_dest
      raise exception 'STK_NOT_FOUND: the destination warehouse is not in your organisation' using errcode = 'P0001'; end if;
  elsif v_to is not null then
    raise exception 'STK_INVALID: only a transfer has a destination warehouse' using errcode = 'P0001'; end if;
  if exists (select 1 from public.stock_warehouses w where w.id in (v_wh, coalesce(v_to, v_wh)) and w.archived_at is not null) then
    raise exception 'STK_ARCHIVED: the warehouse is archived' using errcode = 'P0001'; end if;
  if nullif(p_header->>'procurement_id', '') is not null and p_kind <> 'receive' then
    raise exception 'STK_INVALID: only a receipt may cite a procurement case' using errcode = 'P0001'; end if;
  if p_kind not in ('issue','return') and nullif(p_header->>'project_id', '') is not null then
    raise exception 'STK_INVALID: only an issue or return names a project' using errcode = 'P0001'; end if;
  if p_kind = 'issue' and nullif(p_header->>'project_id', '') is null then
    raise exception 'STK_INVALID: an issue names a project' using errcode = 'P0001'; end if;
  if p_kind = 'adjustment' and nullif(btrim(p_header->>'reason'), '') is null then
    raise exception 'STK_INVALID: an adjustment needs a reason' using errcode = 'P0001'; end if;
  for e in select x from jsonb_array_elements(p_lines) as x loop
    select i.id, i.archived_at, u.whole_only into v_item
      from public.stock_items i join public.stock_units u on u.id = i.unit_id
     where i.id = (e->>'item_id')::uuid and i.org_id = p_org;
    if v_item.id is null then raise exception 'STK_NOT_FOUND: an item is not in your organisation' using errcode = 'P0001'; end if;
    if v_item.archived_at is not null then raise exception 'STK_ARCHIVED: an item is archived' using errcode = 'P0001'; end if;
    v_q := (e->>'quantity')::numeric;  v_c := (e->>'counted_quantity')::numeric;
    v_cost := (e->>'unit_cost')::numeric;  v_dir := e->>'direction';
    if p_kind = 'count' then
      if v_c is null or v_q is not null or v_c < 0 or v_c <> round(v_c, 3) or v_c >= 100000000000::numeric then
        raise exception 'STK_INVALID: a count line needs a counted quantity of 0 or more (3 decimals at most)' using errcode = 'P0001'; end if;
    else
      if v_q is null or v_c is not null or v_q <= 0 or v_q <> round(v_q, 3) or v_q >= 100000000000::numeric then
        raise exception 'STK_INVALID: a line needs a quantity above 0 (3 decimals at most)' using errcode = 'P0001'; end if;
    end if;
    if v_item.whole_only and coalesce(v_q, v_c) <> trunc(coalesce(v_q, v_c)) then
      raise exception 'STK_FRACTION: this item is counted in whole units' using errcode = 'P0001'; end if;
    if p_kind = 'receive' and (v_cost is null or v_cost < 0 or v_cost <> round(v_cost, 4)) then
      raise exception 'STK_INVALID: a receipt line needs a unit cost of 0 or more (4 decimals at most)' using errcode = 'P0001'; end if;
    if p_kind = 'count' and v_cost is not null and (v_cost < 0 or v_cost <> round(v_cost, 4)) then
      raise exception 'STK_INVALID: a unit cost is 0 or more (4 decimals at most)' using errcode = 'P0001'; end if;
    if p_kind = 'adjustment' and (coalesce(v_dir, '') not in ('in','out') or (v_cost is not null and (v_cost < 0 or v_cost <> round(v_cost, 4)))) then
      raise exception 'STK_INVALID: an adjustment line needs a direction (in or out)' using errcode = 'P0001'; end if;
    if v_cost is not null and (v_cost >= 10000000000::numeric or round(coalesce(v_q, v_c) * v_cost, 2) >= 1000000000000::numeric) then
      raise exception 'STK_INVALID: a unit cost or line value is too large' using errcode = 'P0001'; end if;   -- §5 precision, not a raw 22003
    if p_kind <> 'issue'  and nullif(e->>'boq_item_id', '')    is not null then raise exception 'STK_INVALID: only an issue line names a work item'   using errcode = 'P0001'; end if;
    if p_kind <> 'return' and nullif(e->>'source_line_id', '') is not null then raise exception 'STK_INVALID: only a return line cites an issue line' using errcode = 'P0001'; end if;
  end loop;
end $$;

create or replace function public.stock_insert_lines(p_doc public.stock_documents, p_lines jsonb) returns void
  language plpgsql volatile security definer set search_path = public as $$
begin
  insert into public.stock_document_lines (org_id, document_id, line_no, item_id, quantity, counted_quantity, direction, unit_cost, boq_item_id, source_line_id)
  select p_doc.org_id, p_doc.id, t.n::int, (t.e->>'item_id')::uuid,
         case when p_doc.kind <> 'count' then (t.e->>'quantity')::numeric end,
         case when p_doc.kind =  'count' then (t.e->>'counted_quantity')::numeric end,
         case when p_doc.kind = 'adjustment' then t.e->>'direction' end,
         case when p_doc.kind in ('receive','count') or (p_doc.kind = 'adjustment' and t.e->>'direction' = 'in') then (t.e->>'unit_cost')::numeric end,  -- mut:costignore
         case when p_doc.kind = 'issue'  then nullif(t.e->>'boq_item_id', '')::uuid end,
         case when p_doc.kind = 'return' then nullif(t.e->>'source_line_id', '')::uuid end
    from jsonb_array_elements(p_lines) with ordinality as t(e, n);
end $$;

alter table public.stock_document_lines
  drop constraint stock_document_lines_reject_note_len,
  drop constraint stock_document_lines_reject_note,
  drop constraint stock_document_lines_rejected_bound,
  drop column reject_note,
  drop column qty_rejected;
