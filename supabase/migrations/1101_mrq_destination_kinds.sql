-- 1101_mrq_destination_kinds.sql — #2608 (FR-MRQ-011): the transfer destination is a site, yard or staging location.
-- Draft validation accepts all three; the auto-pick needs exactly one; none and several are refused with their own wording.
-- Proven by supabase/tests/1101_mrq_destination_kinds.test.sql. REVERSE: rollback/1101_mrq_destination_kinds_down.sql

create or replace function public.mrq_create_transfer_core(p_request_id uuid, p_source_warehouse_id uuid) returns uuid
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r public.material_requests; v_to uuid; v_doc uuid; v_lines jsonb; v_n integer;
begin
  select * into r from public.material_requests x where x.id = p_request_id;
  if p_source_warehouse_id is null then
    raise exception 'MRQ_SOURCE_REQUIRED: choose the warehouse the material leaves from' using errcode = 'P0001'; end if;
  v_to := r.to_warehouse_id;
  if v_to is null then
    select count(*), case when count(*) = 1 then min(w.id::text)::uuid end into v_n, v_to
      from public.stock_warehouses w
     where w.org_id = r.org_id and w.kind in ('site', 'yard', 'staging') and w.project_id = r.project_id and w.archived_at is null;
    if v_n = 0 then
      raise exception 'MRQ_NO_DESTINATION: the work order''s project has no site, yard or staging location to deliver to' using errcode = 'P0001'; end if;
    if v_n > 1 then
      raise exception 'MRQ_MANY_DESTINATIONS: the project has several locations; name the one this request goes to' using errcode = 'P0001'; end if;
  end if;
  select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'quantity', l.quantity) order by l.line_no) into v_lines
    from public.material_request_lines l where l.request_id = r.id;
  v_doc := public.create_stock_document(
    jsonb_build_object('kind', 'transfer', 'warehouse_id', p_source_warehouse_id, 'to_warehouse_id', v_to,
                       'note', 'Material request ' || r.number),
    v_lines, false, null);
  -- #2517's rule trigger checks the work order belongs to the destination site's project.
  update public.stock_documents set work_order_id = r.work_order_id where id = v_doc;
  update public.material_requests
     set transfer_document_id = v_doc, transfer_cancelled = false, updated_at = now()
   where id = r.id;
  perform public.mrq_log(r, 'transfer_created', r.status, r.status, null, auth.uid(), null, null);
  return v_doc;
end $$;


create or replace function public.mrq_save_draft(p_request_id uuid, p_header jsonb, p_lines jsonb, p_client_request_id uuid default null)
  returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_uid uuid := auth.uid(); r public.material_requests; v_wo record; v_to uuid; v_needed date; v_id uuid;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  perform public.assert_feature_on(v_org, 'stock');
  if p_request_id is null and p_client_request_id is not null then
    select x.id into v_id from public.material_requests x
     where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_request_id is not null then
    select * into r from public.material_requests x where x.id = p_request_id and x.org_id = v_org for update;
    if not found then raise exception 'MRQ_NOT_FOUND: the request is not in your organisation' using errcode = 'P0001'; end if;
    if r.created_by <> v_uid then
      raise exception 'MRQ_NOT_AUTHOR: only the person who raised the request can change or submit it' using errcode = '42501'; end if;
    if r.status <> 'draft' then
      raise exception 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted' using errcode = 'P0001'; end if;
  end if;
  select w.id, w.project_id, w.status into v_wo from public.work_orders w
   where w.id = nullif(p_header->>'work_order_id', '')::uuid and w.org_id = v_org;
  if v_wo.id is null then raise exception 'MRQ_WORK_ORDER: the work order is not in your organisation' using errcode = 'P0001'; end if;
  if v_wo.status not in ('Draft','Issued') then
    raise exception 'MRQ_WORK_ORDER: the work order is closed or cancelled' using errcode = 'P0001'; end if;
  v_needed := nullif(p_header->>'needed_by', '')::date;
  if v_needed is null then raise exception 'MRQ_INVALID: a request needs a needed-by date' using errcode = 'P0001'; end if;
  v_to := nullif(p_header->>'to_warehouse_id', '')::uuid;
  if v_to is not null and not exists (select 1 from public.stock_warehouses w
        where w.id = v_to and w.org_id = v_org and w.kind in ('site', 'yard', 'staging') and w.project_id = v_wo.project_id and w.archived_at is null) then
    raise exception 'MRQ_DESTINATION: the destination must be a site, yard or staging location of the work order''s project' using errcode = 'P0001'; end if;
  if p_header->>'note' is not null and length(p_header->>'note') > 1000 then
    raise exception 'MRQ_INVALID: a note is 1000 characters at most' using errcode = 'P0001'; end if;
  perform public.mrq_validate_lines(v_org, p_lines);

  if p_request_id is null then
    insert into public.material_requests (org_id, number, work_order_id, project_id, to_warehouse_id, needed_by, note,
                                          client_request_id, created_by)
    values (v_org, public.next_procurement_doc_number(v_org, 'MRQ'), v_wo.id, v_wo.project_id, v_to, v_needed,
            nullif(btrim(p_header->>'note'), ''), p_client_request_id, v_uid)
    on conflict (org_id, created_by, client_request_id) where client_request_id is not null do nothing
    returning * into r;
    if r.id is null then                                                   -- lost a race to a concurrent replay
      select x.id into v_id from public.material_requests x
       where x.org_id = v_org and x.created_by = v_uid and x.client_request_id = p_client_request_id;
      return v_id;
    end if;
    perform public.mrq_log(r, 'created', null, 'draft', null, v_uid, null, null);
  else
    update public.material_requests
       set work_order_id = v_wo.id, project_id = v_wo.project_id, to_warehouse_id = v_to, needed_by = v_needed,
           note = nullif(btrim(p_header->>'note'), ''), updated_at = now()
     where id = r.id
    returning * into r;
    delete from public.material_request_lines where request_id = r.id;
  end if;
  insert into public.material_request_lines (org_id, request_id, line_no, item_id, quantity, over_plan_reason)
  select v_org, r.id, t.n::int, (t.e->>'item_id')::uuid, (t.e->>'quantity')::numeric, nullif(btrim(t.e->>'over_plan_reason'), '')
    from jsonb_array_elements(p_lines) with ordinality as t(e, n);
  return r.id;
end $$;
