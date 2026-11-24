-- Order receiving: PMO-owned purchasing and inventory only. Reverse with rollback/2220_order_receiving_down.sql.
create table public.order_receiving_settings (
  org_id uuid primary key references public.organizations(id) default public.auth_org_id(),
  enabled boolean not null default false
);
alter table public.order_receiving_settings enable row level security;
alter table public.order_receiving_settings force row level security;
revoke all on public.order_receiving_settings from public, anon, authenticated;
grant select, insert, update on public.order_receiving_settings to authenticated;
create policy receiving_settings_read on public.order_receiving_settings for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy receiving_settings_write on public.order_receiving_settings for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) = 'Admin' and (select public.is_active_member()))
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) = 'Admin' and (select public.is_active_member()));

create function public.guard_order_receiving_setting() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.enabled and (coalesce(public.domain_externally_owned(new.org_id, 'procurement'), false)
                  or coalesce(public.domain_externally_owned(new.org_id, 'inventory'), false)) then
    raise exception 'RGO_EXTERNAL: Receiving against an order requires PMO to own purchasing and inventory. Continue receiving in your accounting system.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_order_receiving_setting() from public, anon, authenticated;
create trigger receiving_settings_guard before insert or update on public.order_receiving_settings
  for each row execute function public.guard_order_receiving_setting();

create function public.order_receiving_purchaser() returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
  select public.is_active_member() and not coalesce(public.actor_is_light(), false)
    and not coalesce(public.actor_holds_job_role('storekeeper'), false)
    and (public.auth_role() in ('Admin','Executive','Project Manager','Finance') or public.actor_may_order_purchases())
$$;
revoke all on function public.order_receiving_purchaser() from public, anon;
grant execute on function public.order_receiving_purchaser() to authenticated;

create table public.order_stock_mappings (
  item_id uuid primary key references public.procurement_items(id),
  stock_item_id uuid not null references public.stock_items(id),
  org_id uuid not null references public.organizations(id)
);
create table public.order_receiving_requests (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  po_id uuid not null references public.purchase_orders(id),
  receiver_id uuid not null references public.profiles(id),
  warehouse_id uuid not null references public.stock_warehouses(id),
  receipt_date date not null,
  counted_lines jsonb not null,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  approval_reason text,
  stock_document_id uuid unique references public.stock_documents(id),
  receipt_id uuid unique references public.procurement_receipts(id),
  fx_rate numeric,
  fx_date date,
  source_currency text,
  stock_currency text,
  created_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> receiver_id)
);
create table public.order_receiving_reversals (
  request_id uuid primary key references public.order_receiving_requests(id),
  org_id uuid not null references public.organizations(id),
  stock_document_id uuid not null unique references public.stock_documents(id),
  reason text not null,
  reversed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
-- No client table writes. The request and FX witnesses are returned only through role-scoped readers.
do $$ declare t text; begin
  foreach t in array array['order_stock_mappings','order_receiving_requests','order_receiving_reversals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

create function public.map_order_stock(p_item uuid, p_stock_item uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_proc uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not public.order_receiving_purchaser() then -- mut:rgo_mapping
    raise exception 'RGO_MAPPING_ROLE: Only a purchasing user can map an order line to stock.' using errcode = '42501';
  end if;
  select i.procurement_id into v_proc from public.procurement_items i where i.id = p_item and i.org_id = v_org; -- mut:rgo_mapping_org
  if not found then raise exception 'RGO_NOT_FOUND: Order line not found.' using errcode = 'P0002'; end if;
  perform 1 from public.procurements p where p.id = v_proc and p.org_id = v_org for update;
  if exists (select 1 from public.procurement_receipt_lines r where r.item_id = p_item)
     or exists (select 1 from public.order_receiving_requests r join public.purchase_orders po on po.id = r.po_id
                where po.procurement_id = v_proc and r.counted_lines @> jsonb_build_array(jsonb_build_object('item_id', p_item))) then -- mut:rgo_mapping_frozen
    raise exception 'RGO_MAPPING_FROZEN: This line has a receipt count; its stock item cannot change.' using errcode = '23514';
  end if;
  if p_stock_item is null then
    delete from public.order_stock_mappings where item_id = p_item and org_id = v_org;
  else
    if not exists (select 1 from public.stock_items s where s.id = p_stock_item and s.org_id = v_org and s.archived_at is null) then
      raise exception 'RGO_STOCK_ITEM: Choose an active stock item in this organisation.' using errcode = '23514';
    end if;
    insert into public.order_stock_mappings values (p_item, p_stock_item, v_org)
      on conflict (item_id) do update set stock_item_id = excluded.stock_item_id;
  end if;
  perform public.log_audit('order.stock_mapping', v_org, auth.uid(), p_item, jsonb_build_object('stock_item_id', p_stock_item));
end $$;

-- One purchase lock is shared by mapping, counts, approvals, reversals and the existing bill-match writers.
create function public.receiving_lock_order(p_po uuid) returns public.purchase_orders
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_po public.purchase_orders; v_proc public.procurements; v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  perform public.assert_feature_on(v_org, 'procurement');
  perform public.assert_feature_on(v_org, 'stock');
  if not exists (select 1 from public.order_receiving_settings s where s.org_id = v_org and s.enabled) then
    raise exception 'RGO_OFF: Receiving against an order is off.' using errcode = '23514';
  end if;
  if coalesce(public.domain_externally_owned(v_org, 'procurement'), false)
     or coalesce(public.domain_externally_owned(v_org, 'inventory'), false) then
    raise exception 'RGO_EXTERNAL: Continue receiving in your accounting system: PMO must own purchasing and inventory.' using errcode = '23514';
  end if;
  select * into v_po from public.purchase_orders po where po.id = p_po and po.org_id = v_org; -- mut:rgo_receipt_org
  if not found then raise exception 'RGO_ORDER_MISSING: Order not found.' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements p where p.id = v_po.procurement_id and p.org_id = v_org for update;
  if v_po.status not in ('Issued','Acknowledged') or v_proc.status::text not in ('Ordered','Received','Vendor Invoiced','Paid')
     or v_proc.is_subcontract or v_proc.record_only or v_po.erp_docstatus is not null then
    raise exception 'RGO_ORDER_STATE: Choose an approved, sent order for stock goods.' using errcode = '23514';
  end if;
  return v_po;
end $$;
revoke all on function public.receiving_lock_order(uuid) from public, anon, authenticated;

create function public.receive_order_goods(p_po uuid, p_warehouse uuid, p_date date, p_lines jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_po public.purchase_orders; v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_r public.order_receiving_requests; v_doc public.stock_documents; v_proc public.procurements;
  e jsonb; v_item public.procurement_items; v_stock uuid; v_qty numeric; v_received numeric;
  v_excess boolean := false; v_fx numeric; v_fx_date date; v_currency text; v_lines jsonb := '[]'; v_receipt uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_po := public.receiving_lock_order(p_po);
  perform public.stock_assert_keeper(v_org, p_warehouse, v_uid);
  perform public.stock_assert_dates(v_org, p_date);
  if p_request is null or p_date is null or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 200 then
    raise exception 'RGO_COUNTS: Enter counted quantities for at least one order line.' using errcode = '22023';
  end if;
  select * into v_r from public.order_receiving_requests where id = p_request;
  if found then
    if v_r.org_id <> v_org or v_r.receiver_id <> v_uid or v_r.po_id <> p_po or v_r.warehouse_id <> p_warehouse
       or v_r.receipt_date <> p_date or v_r.counted_lines <> p_lines then
      raise exception 'RGO_REFERENCE: This receipt reference already belongs to another count.' using errcode = '23505';
    end if;
    if v_r.stock_document_id is not null then return jsonb_build_object('id', p_request, 'status', 'posted', 'document_id', v_r.stock_document_id); end if;
  end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id;
  select default_currency into v_currency from public.organizations where id = v_org;
  if v_proc.currency = v_currency then v_fx := 1; v_fx_date := p_date;
  else select rate, rate_date into v_fx, v_fx_date from public.fx_rate_on(v_proc.currency, v_currency, p_date); end if;
  if v_fx is null then
    raise exception 'RGO_FX_MISSING: No exchange rate for %/% on %.', v_proc.currency, v_currency, p_date using errcode = '23514', detail=jsonb_build_object('base',v_proc.currency,'quote',v_currency,'date',p_date::text)::text;
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x group by x->>'item_id' having count(*) > 1) then
    raise exception 'RGO_DUPLICATE: Count each order line once.' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    if exists (select 1 from jsonb_object_keys(e) k where k not in ('item_id','quantity')) then
      raise exception 'RGO_FIELDS: Enter only the order line and counted quantity.' using errcode = '22023';
    end if;
    v_qty := (e->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty >= 100000000000 or v_qty <> round(v_qty,3) then
      raise exception 'RGO_QUANTITY: Enter a positive counted quantity with at most three decimals.' using errcode = '22023';
    end if;
    select * into v_item from public.procurement_items i where i.id = (e->>'item_id')::uuid and i.procurement_id = v_proc.id and i.org_id = v_org;
    if not found then raise exception 'RGO_NOT_FOUND: Order line not found.' using errcode = 'P0002'; end if;
    select m.stock_item_id into v_stock from public.order_stock_mappings m where m.item_id = v_item.id and m.org_id = v_org;
    if v_stock is null then raise exception 'RGO_UNMAPPED: This line follows the service or direct-use receiving path.' using errcode = '23514'; end if;
    select coalesce(sum(rl.quantity),0) into v_received from public.procurement_receipt_lines rl
      join public.procurement_receipts r on r.id = rl.receipt_id
      left join public.order_receiving_requests req on req.receipt_id = r.id
      left join public.order_receiving_reversals rev on rev.request_id = req.id
      where rl.item_id = v_item.id and coalesce(r.erp_docstatus,1) <> 2 and r.erp_cancelled_at is null and rev.request_id is null;
    v_excess := v_excess or v_qty > greatest(v_item.quantity - v_received,0); -- mut:rgo_excess
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('item_id',v_stock,'quantity',v_qty,'unit_cost',round(v_item.rate * v_fx,4))); -- mut:rgo_cost
  end loop;
  if v_r.id is null then
    insert into public.order_receiving_requests(id,org_id,po_id,receiver_id,warehouse_id,receipt_date,counted_lines)
      values(p_request,v_org,p_po,v_uid,p_warehouse,p_date,p_lines) returning * into v_r;
  end if;
  if v_excess and v_r.approved_by is null then
    return jsonb_build_object('id',p_request,'status','awaiting_approval');
  end if;
  perform public.stock_validate_payload(v_org,'receive',jsonb_build_object('warehouse_id',p_warehouse),v_lines);
  insert into public.stock_documents(org_id,number,kind,warehouse_id,procurement_id,occurred_on,created_by)
    values(v_org,public.next_procurement_doc_number(v_org,'GR'),'receive',p_warehouse,v_proc.id,p_date,v_uid) returning * into v_doc;
  update public.order_receiving_requests set stock_document_id = v_doc.id, fx_rate = v_fx, fx_date = v_fx_date,
    source_currency = v_proc.currency, stock_currency = v_currency where id = p_request;
  perform public.stock_insert_lines(v_doc,v_lines);
  perform public.stock_post_core(v_doc.id);
  insert into public.procurement_receipts(org_id,procurement_id,po_id,gr_number,receipt_date,status)
    values(v_org,v_proc.id,p_po,v_doc.number,p_date,'Partial') returning id into v_receipt;
  insert into public.procurement_receipt_lines(receipt_id,item_id,org_id,quantity,recorded_by)
    select v_receipt,(x->>'item_id')::uuid,v_org,(x->>'quantity')::numeric,v_uid from jsonb_array_elements(p_lines) x;
  update public.order_receiving_requests set receipt_id = v_receipt where id = p_request;
  perform public.log_audit('order.receive',v_org,v_uid,p_request,jsonb_build_object('stock_document_id',v_doc.id,'receipt_id',v_receipt));
  return jsonb_build_object('id',p_request,'status','posted','document_id',v_doc.id);
end $$;

create function public.approve_order_receiving(p_request uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.order_receiving_requests;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into r from public.order_receiving_requests where id = p_request and org_id = public.auth_org_id();
  if not found then raise exception 'RGO_COUNT_MISSING: Receipt count not found.' using errcode = 'P0002'; end if;
  perform public.receiving_lock_order(r.po_id);
  select * into r from public.order_receiving_requests where id=p_request for update;
  if not public.order_receiving_purchaser() or r.receiver_id = auth.uid() then -- mut:rgo_approval
    raise exception 'RGO_APPROVAL: A different purchasing user must approve this excess.' using errcode = '42501';
  end if;
  if r.stock_document_id is not null or r.approved_by is not null then raise exception 'RGO_DECIDED: This count is already decided.' using errcode = '23514'; end if;
  if nullif(btrim(p_reason),'') is null or length(p_reason) > 500 then raise exception 'RGO_REASON: Give a reason for accepting the excess.' using errcode = '22023'; end if;
  update public.order_receiving_requests set approved_by = auth.uid(),approved_at = now(),approval_reason = btrim(p_reason) where id = r.id;
  perform public.log_audit('order.receive_excess',r.org_id,auth.uid(),r.id,jsonb_build_object('reason',p_reason));
end $$;

create function public.read_order_receiving(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_po public.purchase_orders; v_purchaser boolean; v_lines jsonb; v_requests jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po and org_id = v_org;
  if not found then raise exception 'RGO_ORDER_MISSING: Order not found.' using errcode = 'P0002'; end if;
  if not exists(select 1 from public.order_receiving_settings where org_id=v_org and enabled) then return null; end if;
  v_purchaser := public.order_receiving_purchaser();
  if not v_purchaser and not public.actor_holds_job_role('storekeeper') and not exists
    (select 1 from public.stock_warehouse_keepers k where k.org_id=v_org and k.user_id=auth.uid()) then
    raise exception 'RGO_READ_ROLE: Receiving is for warehouse keepers and purchasing users.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'stock_item_id',m.stock_item_id,'stock_name',s.name,'unit',u.code)
    || case when v_purchaser then jsonb_build_object('ordered',i.quantity::text,'received',coalesce(rc.q,0)::text,
       'outstanding',greatest(i.quantity-coalesce(rc.q,0),0)::text,
       'status',case when coalesce(rc.q,0)=0 then 'not_received' when rc.q<i.quantity then 'partly_received' else 'fully_received' end) else '{}'::jsonb end order by i.id),'[]') into v_lines
    from public.procurement_items i left join public.order_stock_mappings m on m.item_id=i.id
    left join public.stock_items s on s.id=m.stock_item_id left join public.stock_units u on u.id=s.unit_id
    left join lateral (select sum(rl.quantity) q from public.procurement_receipt_lines rl join public.procurement_receipts r on r.id=rl.receipt_id
      left join public.order_receiving_requests req on req.receipt_id=r.id left join public.order_receiving_reversals rev on rev.request_id=req.id
      where rl.item_id=i.id and coalesce(r.erp_docstatus,1)<>2 and r.erp_cancelled_at is null and rev.request_id is null) rc on true
    where i.procurement_id=v_po.procurement_id and i.org_id=v_org;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'receiver_id',r.receiver_id,'warehouse_id',r.warehouse_id,'date',r.receipt_date,
    'lines',r.counted_lines,'approved',r.approved_by is not null,'document_id',r.stock_document_id,'reversed',rev.request_id is not null)
    order by r.created_at),'[]') into v_requests from public.order_receiving_requests r
    left join public.order_receiving_reversals rev on rev.request_id=r.id
    where r.po_id=p_po and r.org_id=v_org and (v_purchaser or r.receiver_id=auth.uid());
  return jsonb_build_object('purchaser',v_purchaser,'lines',v_lines,'requests',v_requests);
end $$;

create function public.list_receiving_orders() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light(); perform public.assert_is_active_member();
  if not public.order_receiving_purchaser() and not public.actor_holds_job_role('storekeeper') and not exists
    (select 1 from public.stock_warehouse_keepers k where k.org_id=public.auth_org_id() and k.user_id=auth.uid()) then return '[]'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',po.id,'number',coalesce(po.po_number,p.po_number,p.title)) order by po.created_at desc),'[]')
    from public.purchase_orders po join public.procurements p on p.id=po.procurement_id
    where po.org_id=public.auth_org_id() and po.status in ('Issued','Acknowledged') and po.erp_docstatus is null
      and p.status::text in ('Ordered','Received','Vendor Invoiced','Paid') and not p.is_subcontract and not p.record_only
      and exists(select 1 from public.order_receiving_settings s where s.org_id=po.org_id and s.enabled));
end $$;

-- Blind applies to raw tables and their security-invoker views, including an own-request order.
create function public.order_receiving_blind() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.actor_holds_job_role('storekeeper'),false) and exists
    (select 1 from public.order_receiving_settings s where s.org_id=public.auth_org_id() and s.enabled)
$$;
revoke all on function public.order_receiving_blind() from public, anon;
grant execute on function public.order_receiving_blind() to authenticated;
create policy receiving_blind_lines on public.procurement_items as restrictive for select to authenticated using (not (select public.order_receiving_blind()));
create policy receiving_blind_po_lines on public.purchase_order_lines as restrictive for select to authenticated using (not (select public.order_receiving_blind()));

-- Freeze all matched quantities for this new immutable receipt path, including direct-table and legacy RPC writes.
create function public.guard_order_receipt_immutable() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_receipt uuid;
begin
  if tg_table_name='procurement_receipts' then v_receipt:=old.id; else v_receipt:=old.receipt_id; end if;
  if exists(select 1 from public.order_receiving_requests where receipt_id=v_receipt) then
    raise exception 'RGO_IMMUTABLE: An order receipt is immutable; record a reversing movement.' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function public.guard_order_receipt_immutable() from public,anon,authenticated;
create trigger order_receipt_immutable before update or delete on public.procurement_receipts for each row execute function public.guard_order_receipt_immutable();
create trigger order_receipt_lines_immutable before update or delete on public.procurement_receipt_lines for each row execute function public.guard_order_receipt_immutable();

revoke all on function public.map_order_stock(uuid,uuid),public.receive_order_goods(uuid,uuid,date,jsonb,uuid),public.approve_order_receiving(uuid,text),
 public.read_order_receiving(uuid),public.list_receiving_orders() from public,anon;
grant execute on function public.map_order_stock(uuid,uuid),public.receive_order_goods(uuid,uuid,date,jsonb,uuid),public.approve_order_receiving(uuid,text),
 public.read_order_receiving(uuid),public.list_receiving_orders() to authenticated;

create function public.get_order_receiving_enabled() returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.order_receiving_settings where org_id=public.auth_org_id() and enabled)
$$;
revoke all on function public.get_order_receiving_enabled() from public,anon;
grant execute on function public.get_order_receiving_enabled() to authenticated;
create function public.set_order_receiving_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.assert_not_light(); perform public.assert_is_active_member();
 if public.auth_role() is distinct from 'Admin' then raise exception 'RGO_SETTING_ROLE: Only an Admin changes receiving settings.' using errcode='42501'; end if;
 insert into public.order_receiving_settings(org_id,enabled) values(public.auth_org_id(),coalesce(p_enabled,false))
 on conflict(org_id) do update set enabled=excluded.enabled;
 perform public.log_audit('order.receiving_setting',public.auth_org_id(),auth.uid(),public.auth_org_id(),jsonb_build_object('enabled',p_enabled));
end $$;
revoke all on function public.set_order_receiving_enabled(boolean) from public,anon;
grant execute on function public.set_order_receiving_enabled(boolean) to authenticated;
