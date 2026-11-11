-- 0449_subcontract_po_lines_down.sql — reverses 0449 (#1513 S1). Refuses while subcontract PO lines, revisions or
-- subcontract-flagged purchases exist (NFR-SCA-007): export (scripts/prod-read.sh / pg_dump -t) and remove them first.
-- Never copy rows into a table in `public`: that schema is API-exposed and an `as select *` copy carries no RLS.
do $$ begin
  if exists (select 1 from public.purchase_order_lines) or exists (select 1 from public.purchase_order_revisions) then
    raise exception 'rollback refused: subcontract PO lines exist — export and remove them first';
  end if;
  if exists (select 1 from public.procurements where is_subcontract) then
    raise exception 'rollback refused: subcontract purchases exist — export and reclassify them first';
  end if;
end $$;
drop trigger if exists purchase_orders_zz_subcontract_amount on public.purchase_orders;
drop function if exists public.issue_subcontract_po_lines(uuid);
drop function if exists public.set_subcontract_po_lines(uuid, jsonb);
drop table if exists public.purchase_order_revisions;
drop table if exists public.purchase_order_lines;
drop function if exists public.guard_purchase_order_subcontract_amount();
drop function if exists public.guard_purchase_order_revision();
drop function if exists public.guard_purchase_order_line();
drop function if exists public.po_effective_revision(uuid);
drop function if exists public.subcontract_po_lock(uuid);
-- restore create_procurement_with_items = 0406_procurement_atomic_create.sql:15-85
create or replace function public.create_procurement_with_items(p_id uuid, p_header jsonb, p_items jsonb)
returns public.procurements language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_parent public.procurements%rowtype; v_item record; v_existing public.procurement_items%rowtype;
  v_project uuid; v_vendor uuid; v_category public.budget_category;
  v_intent public.procurement_create_intents%rowtype;
begin
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or jsonb_typeof(p_header) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_header->'title') is distinct from 'string'
     or exists (select 1 from jsonb_object_keys(p_header) k where k not in ('title','project_id','vendor_id','budget_category'))
     or exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
          or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','name','description','quantity','rate'))
          or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'name') is distinct from 'string'
          or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'rate') is distinct from 'number'
          or (x ? 'description' and jsonb_typeof(x->'description') not in ('string','null'))) then
    raise exception 'Invalid procurement input' using errcode = '22023';
  end if;
  v_project := (p_header->>'project_id')::uuid; v_vendor := (p_header->>'vendor_id')::uuid;
  v_category := (p_header->>'budget_category')::public.budget_category;
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
  insert into public.procurements (id,org_id,requested_by_id,title,project_id,vendor_id,budget_category)
  values (p_id,v_org,v_uid,p_header->>'title',v_project,v_vendor,v_category)
  on conflict (id) do nothing;
  select * into v_parent from public.procurements where id=p_id for update;
  if v_parent.org_id is distinct from v_org or v_parent.requested_by_id is distinct from v_uid
     or v_parent.status <> 'Draft' then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if v_parent.title is distinct from p_header->>'title' or v_parent.project_id is distinct from v_project
     or v_parent.vendor_id is distinct from v_vendor or v_parent.budget_category is distinct from v_category then
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  for v_item in select * from jsonb_to_recordset(p_items) as x(id uuid,name text,description text,quantity numeric,rate numeric) loop
    insert into public.procurement_items (id,org_id,procurement_id,name,description,quantity,rate)
    values (v_item.id,v_org,p_id,v_item.name,v_item.description,v_item.quantity,v_item.rate)
    on conflict (id) do nothing;
    select * into v_existing from public.procurement_items where id=v_item.id;
    if v_existing.org_id is distinct from v_org or v_existing.procurement_id is distinct from p_id
       or v_existing.name is distinct from v_item.name or v_existing.description is distinct from v_item.description
       or v_existing.quantity is distinct from round(v_item.quantity,2) or v_existing.rate is distinct from round(v_item.rate,2) then
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
drop trigger if exists procurements_zz_subcontract_flag on public.procurements;
drop function if exists public.guard_procurement_subcontract_flag();
update public.record_history_config set captured = captured - 'is_subcontract' where table_name = 'procurements';
alter table public.procurements drop column if exists is_subcontract;
