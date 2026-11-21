-- 1401_work_order_closeout_functions.sql — the close-out checklist's writers. #2593; FR-WCO-001, 010..013, 030, 031.
-- All SECURITY DEFINER: membership, role and organisation are re-asserted; the work-order row is locked FOR UPDATE first (the order
-- transition_work_order and confirm_work_order_acceptance take); every write leaves an audit event.

-- ── replace the organisation's list (Admin) ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_closeout_checklist(p_items jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_role user_role := public.auth_role();
  v_item jsonb;
  v_pos  int := 0;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role <> 'Admin' then
    raise exception 'only an Admin can set the organisation''s close-out checklist' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'the close-out checklist is a list of at most 20 items' using errcode = '22023', detail = 'items-shape';
  end if;
  -- One list per organisation: serialise concurrent replacements on the organisation row.
  perform 1 from public.organizations o where o.id = v_org for update;
  delete from public.closeout_checklist_templates t where t.org_id = v_org;
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' or coalesce(btrim(v_item ->> 'name'), '') = '' or length(btrim(v_item ->> 'name')) > 120 then
      raise exception 'every close-out item needs a name of 1 to 120 characters' using errcode = '23514', detail = 'item-name-invalid';
    end if;
    insert into public.closeout_checklist_templates (org_id, position, name, required)
    values (v_org, v_pos, btrim(v_item ->> 'name'), coalesce((v_item ->> 'required')::boolean, true));
  end loop;
  perform public.log_audit('closeout_checklist.set', v_org, auth.uid(), v_org, jsonb_build_object('items', v_pos));
  return v_pos;
end; $$;
revoke all on function public.set_closeout_checklist(jsonb) from public, anon;
grant execute on function public.set_closeout_checklist(jsonb) to authenticated, service_role;

-- ── shared: check the caller may record an item, lock its work order, return the locked item ────────────────────────────
create or replace function public.lock_closeout_item(p_item uuid) returns public.work_order_closeout_items
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid      := public.auth_org_id();
  v_role   user_role := public.auth_role();
  v_wo     uuid;
  v_status public.work_order_status;
  v_pm     uuid;
  v_i      public.work_order_closeout_items;
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or the project''s manager can record close-out items' using errcode = '42501';
  end if;
  select i.work_order_id into v_wo from public.work_order_closeout_items i where i.id = p_item and i.org_id = v_org;
  if not found then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  -- Same row lock as transition_work_order and confirm_work_order_acceptance.
  select w.status into v_status from public.work_orders w where w.id = v_wo and w.org_id = v_org for update;
  if v_status is distinct from 'Issued' then
    raise exception 'close-out items change only while the work order is issued' using errcode = '55000', detail = 'work-order-not-issued';
  end if;
  if v_role = 'Project Manager' then
    select p.project_manager_id into v_pm from public.work_orders w join public.projects p on p.id = w.project_id where w.id = v_wo;
    if v_pm is distinct from auth.uid() then
      raise exception 'only the project''s manager can record close-out items' using errcode = '42501';
    end if;
  end if;
  select * into v_i from public.work_order_closeout_items i where i.id = p_item for update;
  if v_i.done_on is not null then
    raise exception 'this close-out item is already done' using errcode = '55000', detail = 'item-already-done';
  end if;
  return v_i;
end; $$;
revoke all on function public.lock_closeout_item(uuid) from public, anon, authenticated;

-- ── attach a project document to an item ────────────────────────────────────────────────────────────────────────────────
create or replace function public.attach_closeout_item_document(p_item uuid, p_document uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_i      public.work_order_closeout_items;
  v_d_org  uuid;
  v_d_proj uuid;
  v_status public.doc_status;
  v_file   text;
begin
  if p_item is null then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  v_i := public.lock_closeout_item(p_item);
  select d.org_id, d.project_id, d.status, d.file_path into v_d_org, v_d_proj, v_status, v_file
    from public.project_documents d where d.id = p_document;
  if not found or v_d_org is distinct from v_org or v_d_proj is distinct from v_i.project_id then
    raise exception 'the document must be one of the work order''s project documents' using errcode = '23514', detail = 'item-document-invalid';
  end if;
  if v_status not in ('Issued','Approved') then
    raise exception 'only an issued or approved document can be attached' using errcode = '23514', detail = 'item-document-invalid';
  end if;
  if v_file is null or btrim(v_file) = '' then
    raise exception 'the document has no file attached' using errcode = '23514', detail = 'item-document-invalid';
  end if;
  update public.work_order_closeout_items i
     set document_id = p_document, attached_by = auth.uid(), attached_at = now()
   where i.id = p_item;
  perform public.log_audit('closeout_item.document.attach', v_org, auth.uid(), v_i.work_order_id,
    jsonb_build_object('item_id', p_item, 'position', v_i.position, 'document_id', p_document, 'document_status', v_status));
end; $$;
revoke all on function public.attach_closeout_item_document(uuid, uuid) from public, anon;
grant execute on function public.attach_closeout_item_document(uuid, uuid) to authenticated, service_role;

-- ── mark an item done (a required item waits only on earlier required items) ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.complete_closeout_item(p_item uuid, p_done_on date) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_i    public.work_order_closeout_items;
  v_prev date;
begin
  if p_item is null then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  v_i := public.lock_closeout_item(p_item);
  -- Order applies across REQUIRED items only: an optional item never holds the items after it, and an optional item itself
  -- can be marked done whenever its document is attached.
  if v_i.required and exists (select 1 from public.work_order_closeout_items i
              where i.work_order_id = v_i.work_order_id and i.required and i.position < v_i.position and i.done_on is null) then
    raise exception 'complete the earlier close-out items first' using errcode = '55000', detail = 'item-out-of-order';
  end if;
  if v_i.document_id is null then
    raise exception 'attach a document before marking this item done' using errcode = '55000', detail = 'item-document-missing';
  end if;
  if p_done_on is null or p_done_on > public.native_org_today(v_i.org_id) then
    raise exception 'the done date cannot be in the future' using errcode = '22023', detail = 'item-date-invalid';
  end if;
  select max(i.done_on) into v_prev from public.work_order_closeout_items i
   where i.work_order_id = v_i.work_order_id and i.required and v_i.required and i.position < v_i.position;
  if p_done_on < coalesce(v_prev, v_i.started_on) then
    raise exception 'an item cannot be done before the previous one' using errcode = '22023', detail = 'item-date-invalid';
  end if;
  update public.work_order_closeout_items i
     set done_on = p_done_on, done_by = auth.uid(), done_at = now()
   where i.id = v_i.id;
  -- A done required item starts the next required item; an optional item has been current since the work order was issued.
  if v_i.required then
    update public.work_order_closeout_items i set started_on = p_done_on
     where i.work_order_id = v_i.work_order_id
       and i.position = (select min(i2.position) from public.work_order_closeout_items i2
                          where i2.work_order_id = v_i.work_order_id and i2.required and i2.position > v_i.position);
  end if;
  perform public.log_audit('closeout_item.complete', v_i.org_id, auth.uid(), v_i.work_order_id,
    jsonb_build_object('item_id', v_i.id, 'position', v_i.position, 'done_on', p_done_on));
end; $$;
revoke all on function public.complete_closeout_item(uuid, date) from public, anon;
grant execute on function public.complete_closeout_item(uuid, date) to authenticated, service_role;
