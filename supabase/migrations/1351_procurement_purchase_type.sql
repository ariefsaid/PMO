-- 1351_procurement_purchase_type.sql — #2697: a purchase may carry a type, a rental period and a link to the rental it extends.
-- Spec FR-PTR-005..008, 010..012 · proven by supabase/tests/procurement_purchase_type.test.sql and rental_extension.test.sql.
-- All four columns are nullable and unset for every existing row; a purchase with none of them behaves exactly as before.
-- They are set when the purchase is created (create_procurement_with_items, the single creation path) and never changed
-- afterwards by any role (OQ-PTR-1). The guard trigger below holds every rule, so a direct insert is held to it too.
-- REVERSE: rollback/1351_procurement_purchase_type_down.sql (restores the 0449 create_procurement_with_items body exactly;
-- refused while any purchase carries a type, period or link).

alter table public.procurements
  add column purchase_type_id uuid references public.purchase_types(id),
  add column rental_from date,
  add column rental_to date,
  add column extends_procurement_id uuid references public.procurements(id),
  add constraint procurements_rental_period check ((rental_from is null) = (rental_to is null) and (rental_to is null or rental_to >= rental_from)),
  add constraint procurements_extends_not_self check (extends_procurement_id is null or extends_procurement_id <> id),
  add constraint procurements_extends_needs_period check (extends_procurement_id is null or rental_from is not null);
create index procurements_purchase_type_idx on public.procurements (org_id, purchase_type_id) where purchase_type_id is not null;
create index procurements_extends_idx on public.procurements (extends_procurement_id) where extends_procurement_id is not null;

-- change history (#719 registry): the four columns are captured business fields.
update public.record_history_config
   set captured = captured || '{"purchase_type_id":"ref","rental_from":"date","rental_to":"date","extends_procurement_id":"ref"}'::jsonb
 where table_name = 'procurements';

create function public.guard_procurement_purchase_type() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_type public.purchase_types%rowtype; v_parent public.procurements%rowtype; v_parent_type public.purchase_types%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.purchase_type_id is distinct from old.purchase_type_id or new.rental_from is distinct from old.rental_from
       or new.rental_to is distinct from old.rental_to or new.extends_procurement_id is distinct from old.extends_procurement_id then
      raise exception 'PTYPE_FIXED: a purchase''s type, rental period and extension link are set when it is created' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.purchase_type_id is null and new.rental_from is null and new.extends_procurement_id is null then
    return new;                                     -- no type: exactly as before
  end if;
  if not public.purchase_types_enabled(new.org_id) then
    raise exception 'PTYPE_OFF: purchase types are not turned on' using errcode = '22023';
  end if;
  if new.purchase_type_id is not null then
    select * into v_type from public.purchase_types where id = new.purchase_type_id and org_id = new.org_id;
    if not found or not v_type.active then
      raise exception 'PTYPE_UNAVAILABLE: type not available' using errcode = '23503';
    end if;
  end if;
  if new.extends_procurement_id is not null then   -- the rental to extend must exist and be live before anything about the new period is judged
    select * into v_parent from public.procurements where id = new.extends_procurement_id and org_id = new.org_id;
    if not found then raise exception 'PTYPE_EXT_NOT_FOUND: the rental to extend is not available' using errcode = '23503'; end if;
    select * into v_parent_type from public.purchase_types where id = v_parent.purchase_type_id and org_id = new.org_id;
    if not found or not v_parent_type.is_rental or v_parent.rental_to is null
       or v_parent.status in ('Cancelled','Rejected') then
      raise exception 'PTYPE_EXT_NOT_LIVE_RENTAL: only a live rental can be extended' using errcode = '22023';
    end if;
  end if;
  -- The rental period belongs to a type that is flagged rental, and a rental type needs one. The flag decides, never the name.
  if coalesce(v_type.is_rental, false) and new.rental_from is null then
    raise exception 'PTYPE_PERIOD_REQUIRED: a rental purchase needs a rental period' using errcode = '22023';
  end if;
  if not coalesce(v_type.is_rental, false) and new.rental_from is not null then
    raise exception 'PTYPE_PERIOD_NOT_ALLOWED: only a rental purchase carries a rental period' using errcode = '22023';
  end if;
  if new.extends_procurement_id is not null then
    if new.purchase_type_id is distinct from v_parent.purchase_type_id then
      raise exception 'PTYPE_EXT_SAME_TYPE: an extension keeps the type of the rental it extends' using errcode = '22023';
    end if;
    if new.rental_from <= v_parent.rental_to then
      raise exception 'PTYPE_EXT_ORDER: the extension must start after % (the end of the rental it extends)', v_parent.rental_to
        using errcode = '22023';
    end if;
    if exists (select 1 from public.procurements s
                where s.extends_procurement_id = v_parent.id and s.id <> new.id and s.status not in ('Cancelled','Rejected')
                  and s.rental_from <= new.rental_to and s.rental_to >= new.rental_from) then
      raise exception 'PTYPE_EXT_OVERLAP: another extension of this rental already covers part of that period' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_purchase_type() from public, anon, authenticated;
create trigger procurements_zz_purchase_type before insert or update of purchase_type_id, rental_from, rental_to, extends_procurement_id
  on public.procurements for each row execute function public.guard_procurement_purchase_type();

-- Creation key: 0449 body; each changed line is marked `-- 1351`. Additive only.
create or replace function public.create_procurement_with_items(p_id uuid, p_header jsonb, p_items jsonb)
returns public.procurements language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_parent public.procurements%rowtype; v_item record; v_existing public.procurement_items%rowtype;
  v_project uuid; v_vendor uuid; v_category public.budget_category;
  v_intent public.procurement_create_intents%rowtype;
  v_subcontract boolean;                                                                          -- 0449
  v_ptype uuid; v_rfrom date; v_rto date; v_ext uuid;                                              -- 1351
begin
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or jsonb_typeof(p_header) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_header->'title') is distinct from 'string'
     or exists (select 1 from jsonb_object_keys(p_header) k where k not in ('title','project_id','vendor_id','budget_category','is_subcontract','purchase_type_id','rental_from','rental_to','extends_procurement_id'))   -- 0449, 1351
     or exists (select 1 from unnest(array['purchase_type_id','rental_from','rental_to','extends_procurement_id']) k
          where p_header ? k and jsonb_typeof(p_header->k) not in ('string','null'))                                                   -- 1351
     or (p_header ? 'is_subcontract' and jsonb_typeof(p_header->'is_subcontract') is distinct from 'boolean')                                      -- 0449
     or exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
          or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','name','description','quantity','rate'))
          or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'name') is distinct from 'string'
          or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'rate') is distinct from 'number'
          or (x ? 'description' and jsonb_typeof(x->'description') not in ('string','null'))) then
    raise exception 'Invalid procurement input' using errcode = '22023';
  end if;
  v_project := (p_header->>'project_id')::uuid; v_vendor := (p_header->>'vendor_id')::uuid;
  v_category := (p_header->>'budget_category')::public.budget_category;
  v_subcontract := coalesce((p_header->>'is_subcontract')::boolean, false);                       -- 0449
  v_ptype := (p_header->>'purchase_type_id')::uuid; v_rfrom := (p_header->>'rental_from')::date;     -- 1351
  v_rto := (p_header->>'rental_to')::date; v_ext := (p_header->>'extends_procurement_id')::uuid;      -- 1351
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
  insert into public.procurements (id,org_id,requested_by_id,title,project_id,vendor_id,budget_category,is_subcontract,purchase_type_id,rental_from,rental_to,extends_procurement_id)   -- 0449, 1351
  values (p_id,v_org,v_uid,p_header->>'title',v_project,v_vendor,v_category,v_subcontract,v_ptype,v_rfrom,v_rto,v_ext)                              -- 0449, 1351
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
     or v_parent.rental_to is distinct from v_rto or v_parent.extends_procurement_id is distinct from v_ext then          -- 1351
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
