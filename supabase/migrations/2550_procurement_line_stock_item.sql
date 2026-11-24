-- 2550_procurement_line_stock_item.sql — purchase request lines keep optional standard item identity (TC-PFE-13).
-- drops: create_procurement_with_items extends four single lines (allowed p_items keys, jsonb_to_recordset columns, procurement_items insert, and replay comparison) to carry optional stock_item_id; no rule is removed.
--   * procurement_items gains nullable stock_item_id referencing public.stock_items(id).
--   * check_procurement_item_stock_item refuses cross-org or archived items when inserting or changing stock_item_id
--     (23514 PRC_STOCK_ITEM); editing other fields on an existing line whose item was later archived stays allowed.
--   * procurement_items_masked appends stock_item_id (restated from 1881; money columns stay masked).
--   * create_procurement_with_items accepts optional stock_item_id on p_items (restated from 1580; all existing checks kept).
--   * Receiving (order_stock_mappings, map_order_stock, receive_order_goods, read_order_receiving) is deliberately untouched.
-- Reverse: rollback/2550_procurement_line_stock_item_down.sql.

alter table public.procurement_items
  add column stock_item_id uuid references public.stock_items(id);

create index procurement_items_stock_item_idx
  on public.procurement_items (stock_item_id)
  where stock_item_id is not null;

create or replace function public.check_procurement_item_stock_item() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.stock_item_id is not null
     and (tg_op = 'INSERT' or new.stock_item_id is distinct from old.stock_item_id) then
    if not exists (
      select 1 from public.stock_items s
       where s.id = new.stock_item_id
         and s.org_id = new.org_id
         and s.archived_at is null                                      -- mut:pr_line_stock_item
    ) then
      raise exception 'PRC_STOCK_ITEM: Choose an active item from your organisation''s item list.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_procurement_item_stock_item() from public, anon, authenticated;

create trigger procurement_items_zz_stock_item_check
  before insert or update of stock_item_id on public.procurement_items
  for each row execute function public.check_procurement_item_stock_item();

create or replace view public.procurement_items_masked with (security_invoker = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.description,
  x.erp_docstatus,
  case when (select public.actor_may_see_prices_now()) then x.erp_line_amount end as erp_line_amount,
  x.erp_modified,
  x.id,
  x.name,
  x.org_id,
  x.procurement_id,
  x.quantity,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate,
  x.work_order_id,
  x.discipline_id,
  x.stock_item_id
from public.procurement_items x;
grant select on public.procurement_items_masked to authenticated;

create or replace function public.create_procurement_with_items(p_id uuid, p_header jsonb, p_items jsonb)
returns public.procurements language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_parent public.procurements%rowtype; v_item record; v_existing public.procurement_items%rowtype;
  v_project uuid; v_vendor uuid; v_category public.budget_category;
  v_intent public.procurement_create_intents%rowtype;
  v_subcontract boolean;                                                                          -- 0449
  v_ptype uuid; v_rfrom date; v_rto date; v_ext uuid;                                              -- 1351
  v_wo uuid; v_disc uuid;                                                                          -- 1580
begin
  perform public.assert_not_light();
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or jsonb_typeof(p_header) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_header->'title') is distinct from 'string'
     or exists (select 1 from jsonb_object_keys(p_header) k where k not in ('title','project_id','vendor_id','budget_category','is_subcontract','purchase_type_id','rental_from','rental_to','extends_procurement_id','work_order_id','discipline_id'))   -- 0449, 1351, 1580
     or exists (select 1 from unnest(array['purchase_type_id','rental_from','rental_to','extends_procurement_id']) k
          where p_header ? k and jsonb_typeof(p_header->k) not in ('string','null'))                                                   -- 1351
     or exists (select 1 from unnest(array['work_order_id','discipline_id']) k
          where p_header ? k and jsonb_typeof(p_header->k) not in ('string','null'))                                                   -- 1580
     or (p_header ? 'is_subcontract' and jsonb_typeof(p_header->'is_subcontract') is distinct from 'boolean')                                      -- 0449
     or exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
          or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','name','description','quantity','rate','stock_item_id'))   -- 2550
          or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'name') is distinct from 'string'
          or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'rate') is distinct from 'number'
          or (x ? 'description' and jsonb_typeof(x->'description') not in ('string','null'))
          or (x ? 'stock_item_id' and jsonb_typeof(x->'stock_item_id') not in ('string','null'))) then   -- 2550
    raise exception 'Invalid procurement input' using errcode = '22023';
  end if;
  v_project := (p_header->>'project_id')::uuid; v_vendor := (p_header->>'vendor_id')::uuid;
  v_category := (p_header->>'budget_category')::public.budget_category;
  v_subcontract := coalesce((p_header->>'is_subcontract')::boolean, false);                       -- 0449
  v_ptype := (p_header->>'purchase_type_id')::uuid; v_rfrom := (p_header->>'rental_from')::date;     -- 1351
  v_rto := (p_header->>'rental_to')::date; v_ext := (p_header->>'extends_procurement_id')::uuid;      -- 1351
  v_wo := (p_header->>'work_order_id')::uuid; v_disc := (p_header->>'discipline_id')::uuid;           -- 1580
  if (v_project is not null and not exists (select 1 from public.projects where id=v_project and org_id=v_org))
     or (v_vendor is not null and not exists (select 1 from public.companies where id=v_vendor and org_id=v_org)) then
    raise exception 'Reference is not available' using errcode = '23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x group by (x->>'id')::uuid having count(*) > 1) then
    raise exception 'Duplicate line ID' using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_intent from public.procurement_create_intents where procurement_id=p_id;
  if found and (v_intent.org_id is distinct from v_org or v_intent.actor_id is distinct from v_uid
      or v_intent.header is distinct from p_header or v_intent.items is distinct from p_items) then
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  insert into public.procurements (id,org_id,requested_by_id,title,project_id,vendor_id,budget_category,is_subcontract,purchase_type_id,rental_from,rental_to,extends_procurement_id,work_order_id,discipline_id)   -- 0449, 1351, 1580
  values (p_id,v_org,v_uid,p_header->>'title',v_project,v_vendor,v_category,v_subcontract,v_ptype,v_rfrom,v_rto,v_ext,v_wo,v_disc)                  -- 0449, 1351, 1580
  on conflict (id) do nothing;
  select * into v_parent from public.procurements where id=p_id for update;
  if v_parent.org_id is distinct from v_org or v_parent.requested_by_id is distinct from v_uid
     or v_parent.status <> 'Draft' then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if v_parent.title is distinct from p_header->>'title' or v_parent.project_id is distinct from v_project
     or v_parent.vendor_id is distinct from v_vendor or v_parent.budget_category is distinct from v_category
     or v_parent.is_subcontract is distinct from v_subcontract                                                          -- 0449
     or v_parent.purchase_type_id is distinct from v_ptype or v_parent.rental_from is distinct from v_rfrom
     or v_parent.rental_to is distinct from v_rto or v_parent.extends_procurement_id is distinct from v_ext
     or v_parent.work_order_id is distinct from v_wo or v_parent.discipline_id is distinct from v_disc then   -- 1351, 1580
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  for v_item in select * from jsonb_to_recordset(p_items) as x(id uuid,name text,description text,quantity numeric,rate numeric,stock_item_id uuid) loop   -- 2550
    insert into public.procurement_items (id,org_id,procurement_id,name,description,quantity,rate,stock_item_id)   -- 2550
    values (v_item.id,v_org,p_id,v_item.name,v_item.description,v_item.quantity,v_item.rate,v_item.stock_item_id)   -- 2550
    on conflict (id) do nothing;
    select * into v_existing from public.procurement_items where id=v_item.id;
    if v_existing.org_id is distinct from v_org or v_existing.procurement_id is distinct from p_id
       or v_existing.name is distinct from v_item.name or v_existing.description is distinct from v_item.description
       or v_existing.quantity is distinct from round(v_item.quantity,2) or v_existing.rate is distinct from round(v_item.rate,2)
       or v_existing.stock_item_id is distinct from v_item.stock_item_id then   -- 2550
      raise exception 'Saved procurement line differs from request' using errcode = '23505';
    end if;
  end loop;
  if exists (select 1 from public.procurement_items i where i.procurement_id=p_id and i.org_id=v_org
       and not exists (select 1 from jsonb_array_elements(p_items) x where (x->>'id')::uuid=i.id)) then
    raise exception 'Saved procurement lines differ from request' using errcode = '23505';
  end if;
  insert into public.procurement_create_intents (procurement_id,org_id,actor_id,header,items)
  values (p_id,v_org,v_uid,p_header,p_items) on conflict (procurement_id) do nothing;
  return v_parent;
end $$;
revoke all on function public.create_procurement_with_items(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.create_procurement_with_items(uuid,jsonb,jsonb) to authenticated;
