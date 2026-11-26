-- 2702 (#2788): writes by a person who may not see prices keep the stored prices they cannot read.
-- A. save_equipment_plan replaces a plan's lines. A line id the plan already holds may now leave out rate and vendor_id when the
--    caller may not see prices (actor_shown_prices()): the stored rate and vendor stay. Every other line still needs both.
-- B. extend_rental_procurement: a carried-over line may leave out its rate and name original_line_id, a line of the rental being
--    extended; the rate is copied from that line.
-- C. procurement_item_add: a retry of an existing line id is compared without the rate when the caller may not see prices, so the
--    answer does not depend on a guessed rate.
-- drops: save_equipment_plan's line check no longer requires rate and vendor_id on every line (they are required after the stored
--        lines are read, except as above); procurement_item_add's retry comparison skips the rate for a caller who may not see prices;
--        nothing else is removed.
-- Rollback: rollback/2702_hide_prices_rewrite_paths_down.sql

create or replace function public.save_equipment_plan(p_id uuid, p_project uuid, p_month date, p_lines jsonb)
  returns public.equipment_plans language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype; v_line jsonb; v_kept jsonb;
  v_shown boolean := public.actor_shown_prices();
begin
  perform public.assert_is_active_member();
  if p_id is null or p_project is null or p_month is null or p_month <> date_trunc('month', p_month::timestamp)::date
     or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'EQP_INVALID: a plan needs a project, the first day of a month and up to 200 lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x) <> 'object'
       or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','work_order_id','category_id','equipment_asset_id','description','quantity','rate','vendor_id','date_from','date_to'))
       or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'quantity') is distinct from 'number'
       or (x ? 'rate' and jsonb_typeof(x->'rate') is distinct from 'number') or (x ? 'vendor_id' and jsonb_typeof(x->'vendor_id') is distinct from 'string')   -- 2702
       or jsonb_typeof(x->'date_from') is distinct from 'string' or jsonb_typeof(x->'date_to') is distinct from 'string') then
    raise exception 'EQP_INVALID: check the plan lines' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project and org_id = v_org) then
    raise exception 'EQP_REFERENCE: the project is not available' using errcode = '23503';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eqplan:' || v_org || p_project || p_month, 0));
  select * into v_plan from public.equipment_plans where org_id = v_org and project_id = p_project and plan_month = p_month for update;
  if not found then
    insert into public.equipment_plans (id, org_id, project_id, plan_month, created_by) values (p_id, v_org, p_project, p_month, auth.uid())
    returning * into v_plan;
  end if;
  if v_plan.created_by is distinct from auth.uid() then
    raise exception 'EQP_DENIED: only the author can change this plan' using errcode = '42501';
  end if;
  if v_plan.status <> 'Draft' then
    raise exception 'EQP_LOCKED: the plan is not a Draft, so it cannot change' using errcode = '55000';
  end if;
  -- 2702: the stored price of each line, kept where a caller who may not see prices leaves it out
  select coalesce(jsonb_object_agg(l.id::text, jsonb_build_object('rate', l.rate, 'vendor_id', l.vendor_id)), '{}'::jsonb) into v_kept
    from public.equipment_plan_lines l where l.plan_id = v_plan.id;
  if exists (select 1 from jsonb_array_elements(p_lines) x
              where (not (x ? 'rate') or not (x ? 'vendor_id')) and (v_shown or not (v_kept ? (x->>'id')))) then   -- mut:plan_keep_scope
    raise exception 'EQP_INVALID: check the plan lines' using errcode = '22023';
  end if;
  delete from public.equipment_plan_lines where plan_id = v_plan.id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.equipment_plan_lines (id, org_id, plan_id, work_order_id, category_id, equipment_asset_id, description, quantity, rate, vendor_id, date_from, date_to)
    values ((v_line->>'id')::uuid, v_org, v_plan.id, (v_line->>'work_order_id')::uuid, (v_line->>'category_id')::uuid,
            (v_line->>'equipment_asset_id')::uuid, nullif(btrim(v_line->>'description'), ''), (v_line->>'quantity')::numeric,
            case when v_line ? 'rate' then (v_line->>'rate')::numeric else (v_kept->(v_line->>'id')->>'rate')::numeric end,          -- 2702 mut:plan_keep_rate
            case when v_line ? 'vendor_id' then (v_line->>'vendor_id')::uuid else (v_kept->(v_line->>'id')->>'vendor_id')::uuid end,
            (v_line->>'date_from')::date, (v_line->>'date_to')::date);
  end loop;
  return v_plan;
end $$;

create or replace function public.extend_rental_procurement(p_id uuid, p_original uuid, p_from date, p_to date, p_items jsonb default null)
  returns public.procurements language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_o public.procurements%rowtype; v_items jsonb; v_header jsonb;
begin
  perform public.assert_not_light(); -- retained from 1480's apply-time field-account guard
  if p_items is null and public.order_receiving_line_blind(p_original) then
    raise exception 'RGO_BLIND_COPY: Enter your own request quantities; a blind receiver cannot copy ordered quantities.' using errcode='42501';
  end if;
  if auth.uid() is null or v_org is null or not coalesce(public.is_active_member(), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or p_original is null or p_from is null or p_to is null then
    raise exception 'PTYPE_INVALID: an extension needs the rental and a new period' using errcode = '22023';
  end if;
  select * into v_o from public.procurements where id = p_original and org_id = v_org;
  if not found then raise exception 'PTYPE_EXT_NOT_FOUND: the rental to extend is not available' using errcode = '23503'; end if;
  -- 2702: a line without a rate takes it from the original line it names; the naming key is not passed on
  if jsonb_typeof(p_items) = 'array' then
    if exists (select 1 from jsonb_array_elements(p_items) x
                where jsonb_typeof(x) = 'object' and not (x ? 'rate')
                  and not exists (select 1 from public.procurement_items i
                                   where i.id::text = x->>'original_line_id' and i.procurement_id = p_original and i.org_id = v_org)) then
      raise exception 'PTYPE_INVALID: each carried-over line needs a rate or the line it continues' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(case when jsonb_typeof(x) <> 'object' then x
                                   when x ? 'rate' then x - 'original_line_id'
                                   else (x - 'original_line_id') || jsonb_build_object('rate',
                                          (select i.rate from public.procurement_items i
                                            where i.id::text = x->>'original_line_id' and i.procurement_id = p_original and i.org_id = v_org)) end   -- mut:ext_fill_rate
                              order by o), '[]'::jsonb)
      into p_items from jsonb_array_elements(p_items) with ordinality as t(x, o);
  end if;
  v_items := coalesce(p_items, (
    select coalesce(jsonb_agg(jsonb_build_object('id', md5(p_id::text || i.id::text)::uuid, 'name', i.name,
                                                  'description', i.description, 'quantity', i.quantity, 'rate', i.rate)
                              order by i.id), '[]'::jsonb)
      from public.procurement_items i where i.procurement_id = p_original and i.org_id = v_org));
  v_header := jsonb_build_object('title', v_o.title || ' (' || p_from || ' – ' || p_to || ')', 'project_id', v_o.project_id,
      'vendor_id', v_o.vendor_id, 'budget_category', v_o.budget_category, 'is_subcontract', v_o.is_subcontract,
      'purchase_type_id', v_o.purchase_type_id, 'rental_from', p_from, 'rental_to', p_to, 'extends_procurement_id', p_original);
  return public.create_procurement_with_items(p_id, v_header, v_items);
end $$;

create or replace function public.procurement_item_add(p_procurement_id uuid, p_line jsonb) returns public.procurement_items_masked
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_old public.procurement_items; v_ret public.procurement_items_masked;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if jsonb_typeof(p_line) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_line) k where k not in ('id','name','description','quantity','rate','stock_item_id')) then
    raise exception 'Invalid line input' using errcode = '22023';
  end if;
  if not public.procurement_item_writer_ok(p_procurement_id) then                                       -- mut:item_add_gate
    raise exception 'not authorized' using errcode = '42501';
  end if;
  insert into public.procurement_items (id, org_id, procurement_id, name, description, quantity, rate, stock_item_id)
  values (coalesce((p_line->>'id')::uuid, gen_random_uuid()), public.auth_org_id(), p_procurement_id, p_line->>'name',
          p_line->>'description', (p_line->>'quantity')::numeric, (p_line->>'rate')::numeric, (p_line->>'stock_item_id')::uuid)
  on conflict (id) do nothing
  returning id into v_id;
  if v_id is null then   -- a retry of the same line: identical saved data returns it, anything else is a conflict
    select * into v_old from public.procurement_items where id = (p_line->>'id')::uuid;
    if v_old.procurement_id is distinct from p_procurement_id or v_old.name is distinct from p_line->>'name'
       or v_old.description is distinct from p_line->>'description' or v_old.stock_item_id is distinct from (p_line->>'stock_item_id')::uuid
       or v_old.quantity is distinct from round((p_line->>'quantity')::numeric, 2)
       or (public.actor_shown_prices() and v_old.rate is distinct from round((p_line->>'rate')::numeric, 2)) then   -- 2702 mut:item_add_retry_rate
      raise exception 'This line ID already has different saved data. Open the saved request to reconcile it before retrying.' using errcode = '23505';
    end if;
    v_id := v_old.id;
  end if;
  select * into v_ret from public.procurement_items_masked m where m.id = v_id;
  return v_ret;
end $$;
