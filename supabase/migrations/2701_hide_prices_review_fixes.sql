-- 2701 (#2788): review fixes on the hide-prices database gate (2700), plus two defaults the owner may revisit.
-- 1. A requester who may not see prices edits their own draft's lines through three definer functions (add, edit, remove) with the
--    table's write rules (organisation, active member, procurement on, Draft, the requester or one of the four levels); the line comes
--    back through procurements' masked line view. The app calls them only while prices are hidden from that person.
-- 2. import_identity_facts carries an amount for imported orders and requests: masked in both views.
-- 3. create_purchase_order and create_procurement_quotation return their row without prices to a person who may not see them.
-- 4. Planned equipment rates (equipment_plan_lines): refused like the other priced tables; equipment_plan_lines_masked returns the
--    lines without rate and supplier, with the table's read rules (equipment_plans' rules copied, pinned by 2700's test).
-- 6. The masked views read with their owner's rights: they rely on the owner bypassing row security (as postgres does locally and
--    on the hosted project); 2700's test asserts the attribute locally.
-- Defaults (revisitable): a person who cannot see prices writes no rental term or rate (equipment_can_edit_terms); while prices are
-- hidden, only built-in roles that see prices may be named to order, and hiding cannot be switched on while such a role is named.
-- drops: create_purchase_order's early return gains the price mask; create_purchase_order, create_procurement_quotation and set_hide_prices_enabled pin search_path = public, pg_temp; guard_purchase_order_job_roles adds pg_temp last; equipment_can_edit_terms' last line gains the price test; nothing else is removed.
-- Rollback: rollback/2701_hide_prices_review_fixes_down.sql

create or replace view public.purchase_orders_masked with (security_invoker = false, security_barrier = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.created_at,
  x.currency,
  x.date,
  x.discipline_id,
  x.erp_amended_from,
  x.erp_cancelled_at,
  x.erp_docstatus,
  x.erp_modified,
  x.erp_attention,
  x.erp_census_seen_at,
  x.erp_read_at,
  x.erp_state,
  x.external_ref,
  x.id,
  x.import_batch_id,
  case when (select public.actor_may_see_prices_now()) then x.import_identity_facts end as import_identity_facts,
  x.import_identity_version,
  x.import_key,
  x.imported_at,
  x.org_id,
  x.po_number,
  x.procurement_id,
  x.reference_number,
  x.status,
  x.work_order_id
from public.purchase_orders x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases()) or exists (select 1 from public.procurements_masked p where p.id = x.procurement_id and p.requested_by_id = (select auth.uid())));

create or replace view public.purchase_requests_masked with (security_invoker = false, security_barrier = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.created_at,
  x.currency,
  x.date,
  x.discipline_id,
  x.erp_amended_from,
  x.erp_cancelled_at,
  x.erp_docstatus,
  x.erp_modified,
  x.external_ref,
  x.id,
  x.import_batch_id,
  case when (select public.actor_may_see_prices_now()) then x.import_identity_facts end as import_identity_facts,
  x.import_identity_version,
  x.import_key,
  x.imported_at,
  x.org_id,
  x.pr_number,
  x.procurement_id,
  x.reference_number,
  x.status,
  x.work_order_id
from public.purchase_requests x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases()) or exists (select 1 from public.procurements_masked p where p.id = x.procurement_id and p.requested_by_id = (select auth.uid())));

create policy price_hidden_deny on public.equipment_plan_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));

create view public.equipment_plan_lines_masked with (security_invoker = false, security_barrier = true) as
select
  x.id,
  x.org_id,
  x.plan_id,
  x.work_order_id,
  x.category_id,
  x.equipment_asset_id,
  x.description,
  x.quantity,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate,
  case when (select public.actor_may_see_prices_now()) then x.vendor_id end as vendor_id,
  x.date_from,
  x.date_to,
  x.procurement_id,
  x.created_at
from public.equipment_plan_lines x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and exists (select 1 from public.equipment_plans pl
               where pl.id = x.plan_id and pl.org_id = (select public.auth_org_id())
                 and ((select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager')
                      or pl.created_by = (select auth.uid())
                      or ((select public.auth_role()) = 'Engineer' and public.equipment_plan_engineer_on_project(pl.project_id))));
revoke all on public.equipment_plan_lines_masked from public, anon, authenticated;
grant select on public.equipment_plan_lines_masked to authenticated;

create function public.procurement_item_writer_ok(p_procurement_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.procurements p
                  where p.id = p_procurement_id and p.org_id = public.auth_org_id() and p.status = 'Draft'
                    and (p.requested_by_id = auth.uid() or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance')))
     and public.is_active_member() and not public.actor_is_light()
     and coalesce(public.org_feature_enabled(public.auth_org_id(), 'procurement'), false)
$$;
revoke all on function public.procurement_item_writer_ok(uuid) from public, anon, authenticated;

create function public.procurement_item_add(p_procurement_id uuid, p_line jsonb) returns public.procurement_items_masked
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
       or v_old.quantity is distinct from round((p_line->>'quantity')::numeric, 2) or v_old.rate is distinct from round((p_line->>'rate')::numeric, 2) then
      raise exception 'This line ID already has different saved data. Open the saved request to reconcile it before retrying.' using errcode = '23505';
    end if;
    v_id := v_old.id;
  end if;
  select * into v_ret from public.procurement_items_masked m where m.id = v_id;
  return v_ret;
end $$;

create function public.procurement_item_edit(p_id uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_proc uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if jsonb_typeof(p_patch) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('name','description','quantity','rate','stock_item_id')) then
    raise exception 'Invalid line input' using errcode = '22023';
  end if;
  select i.procurement_id into v_proc from public.procurement_items i where i.id = p_id and i.org_id = public.auth_org_id();
  if v_proc is null or not public.procurement_item_writer_ok(v_proc) then                                -- mut:item_edit_gate
    raise exception 'Line item not found or you do not have permission to edit it.' using errcode = 'P0002';
  end if;
  update public.procurement_items set
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    quantity = case when p_patch ? 'quantity' then (p_patch->>'quantity')::numeric else quantity end,
    rate = case when p_patch ? 'rate' then (p_patch->>'rate')::numeric else rate end,
    stock_item_id = case when p_patch ? 'stock_item_id' then (p_patch->>'stock_item_id')::uuid else stock_item_id end
  where id = p_id;
end $$;

create function public.procurement_item_remove(p_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_proc uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select i.procurement_id into v_proc from public.procurement_items i where i.id = p_id and i.org_id = public.auth_org_id();
  if v_proc is null or not public.procurement_item_writer_ok(v_proc) then                                -- mut:item_remove_gate
    raise exception 'Line item not found or you do not have permission to delete it.' using errcode = 'P0002';
  end if;
  delete from public.procurement_items where id = p_id;
end $$;
revoke all on function public.procurement_item_add(uuid, jsonb), public.procurement_item_edit(uuid, jsonb), public.procurement_item_remove(uuid) from public, anon;
grant execute on function public.procurement_item_add(uuid, jsonb), public.procurement_item_edit(uuid, jsonb), public.procurement_item_remove(uuid) to authenticated;

create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_orders language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_row public.purchase_orders; v_currency text; v_po_number text; v_status public.procurement_status;
  v_quote_amount numeric;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, currency, po_number, status into v_org, v_currency, v_po_number, v_status
    from public.procurements where id = p_procurement_id for update;   -- 0712: serializes with transition_procurement
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- 1842 roles-that-decide FR-RTD-009/010: today's four levels, or a person who fills an ordering job role on an approved purchase.
  if auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    if not public.actor_may_order_purchases() then                                                     -- mut:raise_gate
      raise exception 'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders'
        using errcode = '42501';
    end if;
    if v_status not in ('Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered') then                 -- mut:raise_approved
      raise exception 'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered'
        using errcode = '42501';
    end if;
  end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  select q.total_amount into v_quote_amount from public.procurement_quotations q
    where q.procurement_id = p_procurement_id and q.is_selected;
  if found then p_amount := v_quote_amount; end if;
  -- 0712: the order the transition minted (this purchase's PO number, nothing captured on it) is completed, not duplicated.
  if v_po_number is not null and p_import_key is null then
    update public.purchase_orders
       set reference_number = p_reference_number, status = coalesce(p_status, 'Draft'), date = p_date, amount = p_amount,
           external_ref = nullif(btrim(p_external_ref), ''), currency = v_currency
     where id = (select o.id from public.purchase_orders o
                  where o.procurement_id = p_procurement_id and o.po_number = v_po_number
                    and o.reference_number is null and (o.amount is null or (v_quote_amount is not null and o.amount = v_quote_amount)) and o.import_key is null
                    and o.external_ref is null and o.status = 'Issued'
                  order by o.created_at limit 1 for update)
    returning * into v_row;
    if found then
    if not public.actor_shown_prices() then v_row.amount := null; v_row.import_identity_facts := null; end if;   -- 2701
      return v_row;
    end if;   -- 2701
  end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref, currency)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''), v_currency)
    returning * into v_row;
  if not public.actor_shown_prices() then v_row.amount := null; v_row.import_identity_facts := null; end if;   -- 2701
  return v_row;
end; $$;

CREATE OR REPLACE FUNCTION public.create_procurement_quotation(p_procurement_id uuid, p_vendor_id uuid, p_total_amount numeric, p_received_date date, p_import_key text DEFAULT NULL::text, p_import_batch_id uuid DEFAULT NULL::uuid, p_imported_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS procurement_quotations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare v_org uuid; v_row public.procurement_quotations;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or (auth_role() not in ('Admin','Executive','Project Manager','Finance') and not public.actor_may_order_purchases())  -- mut:rr_buyer_quote_fn
  then raise exception 'not authorized' using errcode = '42501'; end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  insert into public.procurement_quotations
    (procurement_id, vendor_id, total_amount, received_date, vq_number,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_vendor_id, p_total_amount, p_received_date,
            next_procurement_doc_number(v_org, 'VQ'),
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  if not public.actor_shown_prices() then v_row.total_amount := null; v_row.import_identity_facts := null; v_row.vendor_id := null; end if;   -- 2701
  return v_row;
end; $function$;

create or replace function public.guard_purchase_order_job_roles() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.order_job_roles is not distinct from old.order_job_roles then return new; end if;
  new.order_job_roles := coalesce(array(select distinct k from unnest(new.order_job_roles) k order by k), array[]::text[]);
  if cardinality(new.order_job_roles) = 0 then return new; end if;
  if exists (select 1 from unnest(new.order_job_roles) k
              left join public.built_in_roles r on r.key = k
             where r.key is null or r.tier = 'field') then                                             -- mut:order_roles_valid
    raise exception 'PO_ORDER_ROLE_INVALID: choose built-in roles from the list; a field role cannot order' using errcode = '23514';
  end if;
  if not public.org_built_in_roles_enabled(new.org_id) then                                            -- mut:order_roles_setting
    raise exception 'PO_JOB_ROLE_OFF: turn on built-in roles before naming roles that order' using errcode = 'P0001';
  end if;
  if public.org_hide_prices_enabled(new.org_id) and exists (select 1 from unnest(new.order_job_roles) k
              where not public.built_in_role_sees_prices(k)) then                                         -- 2701 mut:order_roles_prices
    raise exception 'PO_ORDER_ROLE_NO_PRICES: while prices are hidden, only built-in roles that see prices can order' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function public.set_hide_prices_enabled(p_enabled boolean) returns boolean
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin can change the hide prices setting' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'the hide prices setting must be true or false' using errcode = '22023';
  end if;
  if p_enabled and exists (select 1 from public.purchase_order_settings s cross join lateral unnest(s.order_job_roles) k   -- 2701
                            where s.org_id = v_org and not public.built_in_role_sees_prices(k)) then             -- mut:hide_order_roles
    raise exception 'HIDE_PRICES_ORDER_ROLE: a built-in role that orders purchases cannot see prices; remove it from who can order first'
      using errcode = '23514';
  end if;
  update public.organizations set hide_prices_from_requesters = p_enabled where id = v_org;
  return p_enabled;
end
$$;


create or replace function public.equipment_can_edit_terms(p_role public.user_role) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_role = 'Finance' or public.equipment_manager_rights(p_role)
                  or public.actor_holds_job_role('equipment_officer'), false)   -- mut:officer_edit_terms
     and public.actor_shown_prices() $$;   -- 2701: a person who cannot see prices does not write a rate they cannot read
