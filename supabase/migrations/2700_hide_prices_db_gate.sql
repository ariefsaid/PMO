-- 2700 (#2788): the database applies the hide-prices setting on every way of reading the prices it names (OD-R1122-2).
-- While the setting is off nothing changes for anyone: the gate below is true for every person.
-- 1. actor_shown_prices(): false only while the organisation hides prices and this person may not see them (1215 rule).
--    Order receiving (2223) keeps hiding prices through the masked views only; it never takes rows away.
-- 2. price_hidden_deny: each table carrying a price the ruling names refuses its rows to that person (restrictive SELECT).
-- 3. The six masked views read with the owner's rights and carry their table's read rules in their WHERE (as they stand at
--    head), so that person keeps the rows without the prices. 2700_hide_prices_db_gate.test.sql pins view = table for ten
--    actors and pins the copied policies by hash. Read-only (select only), security barrier.
-- 4. The reads a requester's own job makes on the parent request go through procurements_masked (same rows, no price used):
--    adding a line to a draft, following status and receipts; the line-stamp and task-link triggers read the table first and
--    the masked view only when the table returned nothing (a script without a signed-in person keeps reading the table).
-- 5. Write responses and rental checks: a request comes back without its total; the rental checks refuse that person.
-- drops: create_procurement_with_items pins search_path = public, pg_temp (was pg_catalog, public); no other line is removed.
-- Rollback: rollback/2700_hide_prices_db_gate_down.sql

create function public.actor_shown_prices() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select not public.org_hide_prices_enabled(public.auth_org_id()) or public.actor_may_see_prices_now()
$$;
revoke all on function public.actor_shown_prices() from public, anon;
grant execute on function public.actor_shown_prices() to authenticated, service_role;

-- 2. The gate.
create policy price_hidden_deny on public.procurements as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.procurement_items as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.purchase_orders as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.purchase_requests as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.purchase_order_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.po_variations as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.po_variation_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.purchase_order_revisions as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.procurement_quotations as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.rfqs as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.procurement_invoices as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.procurement_invoice_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.procurement_bill_match_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.payments as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.erp_purchase_documents as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.equipment_rental_terms as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.equipment_rental_checks as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.hourly_rental_checks as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.contract_rate_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.rate_catalogue_rates as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.subcontract_certificate_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.subcontractor_rate_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));
create policy price_hidden_deny on public.odoo_stock_cost_lines as restrictive for select to authenticated using ((select public.actor_shown_prices()));

-- 3. The masked views: same names and columns as at head, owner rights, the table's read rules, prices NULL for that person.
create or replace view public.procurements_masked with (security_invoker = false, security_barrier = true) as
select
  x.amount_approved_by_id,
  x.approval_notes,
  x.approved_by_id,
  case when (select public.actor_may_see_prices_now()) then x.approved_total_value end as approved_total_value,
  x.budget_category,
  x.code,
  x.created_at,
  x.currency,
  x.id,
  x.import_batch_id,
  x.import_key,
  x.import_normalized_ref,
  x.imported_at,
  x.is_subcontract,
  x.org_id,
  x.origin,
  x.po_number,
  x.pr_number,
  x.project_id,
  x.rejection_notes,
  x.requested_by_id,
  x.status,
  x.title,
  case when (select public.actor_may_see_prices_now()) then x.total_value end as total_value,
  x.updated_at,
  case when (select public.actor_may_see_prices_now()) then x.vendor_id end as vendor_id,
  x.vendor_invoiced_at,
  x.purchase_type_id, x.rental_from, x.rental_to, x.extends_procurement_id
from public.procurements x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases()) or x.requested_by_id = (select auth.uid()));

create or replace view public.procurement_items_masked with (security_invoker = false, security_barrier = true) as
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
from public.procurement_items x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases())
       or exists (select 1 from public.procurements_masked p where p.id = x.procurement_id and p.requested_by_id = (select auth.uid())))
  and not (select public.order_receiving_line_blind(x.procurement_id));

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
  x.import_identity_facts,
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
  x.import_identity_facts,
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

create or replace view public.purchase_order_lines_masked with (security_invoker = false, security_barrier = true) as
select
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.boq_item_id,
  x.created_at,
  x.id,
  x.org_id,
  x.po_id,
  x.quantity,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate,
  x.revision,
  x.unit
from public.purchase_order_lines x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and not (select public.order_receiving_blind())
  and exists (select 1 from public.purchase_orders_masked po where po.id = x.po_id);

create or replace view public.po_variation_lines_masked with (security_invoker = false, security_barrier = true) as
select
  x.additional_quantity,
  case when (select public.actor_may_see_prices_now()) then x.amount end as amount,
  x.boq_item_id,
  x.org_id,
  case when (select public.actor_may_see_prices_now()) then x.rate end as rate,
  x.variation_id
from public.po_variation_lines x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and exists (select 1 from public.po_variations v
               where v.id = x.variation_id and v.org_id = (select public.auth_org_id())
                 and exists (select 1 from public.purchase_orders_masked po where po.id = v.po_id));

revoke all on public.procurements_masked, public.procurement_items_masked, public.purchase_orders_masked, public.purchase_requests_masked,
  public.purchase_order_lines_masked, public.po_variation_lines_masked from public, anon, authenticated;
grant select on public.procurements_masked, public.procurement_items_masked, public.purchase_orders_masked, public.purchase_requests_masked,
  public.purchase_order_lines_masked, public.po_variation_lines_masked to authenticated;

-- 4. A requester's own job reads the parent request through procurements_masked (same rows; the columns used are not prices).
alter policy procurement_items_draft_only on public.procurement_items with check (
  (exists (select 1 from public.procurements_masked p
            where p.id = procurement_items.procurement_id and p.org_id = (select public.auth_org_id()) and p.status = 'Draft'::procurement_status))
  and (select public.is_active_member())
  and (select public.org_feature_enabled((select public.auth_org_id()), 'procurement'::text)));
alter policy procurement_items_requester on public.procurement_items with check (
  (org_id = (select public.auth_org_id()))
  and (exists (select 1 from public.procurements_masked p
                where p.id = procurement_items.procurement_id and p.org_id = (select public.auth_org_id()) and p.requested_by_id = (select auth.uid())))
  and (select public.is_active_member())
  and (select public.org_feature_enabled((select public.auth_org_id()), 'procurement'::text)));
alter policy procurement_status_events_engineer_read_scope on public.procurement_status_events using (
  (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases())
  or exists (select 1 from public.procurements_masked p
              where p.id = procurement_status_events.procurement_id and p.requested_by_id = (select auth.uid())));
alter policy procurement_receipts_engineer_read_scope on public.procurement_receipts using (
  (select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases())
  or exists (select 1 from public.procurements_masked p
              where p.id = procurement_receipts.procurement_id and p.requested_by_id = (select auth.uid())));

create or replace function public.stamp_procurement_item_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  -- Only inherit when the client did not explicitly set org_id (i.e. it is null or the table default).
  if new.org_id is null
     or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select p.org_id into new.org_id
      from public.procurements p
     where p.id = new.procurement_id;
    if new.org_id is null then   -- 2700: a person who may not see prices reads the request through the masked view (same rows)
      select p.org_id into new.org_id from public.procurements_masked p where p.id = new.procurement_id;
    end if;
  end if;
  return new;
end; $$;

create or replace function public.check_task_record_link() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare
  v_type text; v_id uuid; v_org uuid; v_project uuid; v_status text;
  v_clash_id uuid; v_clash_name text;
  v_open boolean;
begin
  -- Close columns: written only by the database's close function (current_user is its owner there). A client role
  -- (authenticated / anon / service_role) can never forge a system close; no session value is consulted (FR-RLT-014/020).
  if ((tg_op = 'INSERT' and new.closed_by_record_type is not null)
      or (tg_op = 'UPDATE' and (new.closed_by_record_type, new.closed_by_record_status, new.closed_by_record_at)
            is distinct from (old.closed_by_record_type, old.closed_by_record_status, old.closed_by_record_at)))
     and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'the close reason is set by the system only' using errcode = '42501';
  end if;

  if new.procurement_id is not null then v_type := 'procurement';      v_id := new.procurement_id;
  elsif new.expense_claim_id is not null then v_type := 'expense_claim';    v_id := new.expense_claim_id;
  elsif new.material_request_id is not null then v_type := 'material_request'; v_id := new.material_request_id;
  else return new; end if;

  v_open := new.status <> 'Done' and new.archived_at is null and new.tombstoned_at is null;
  -- the link set or changed?
  if tg_op = 'INSERT'
     or (new.procurement_id, new.expense_claim_id, new.material_request_id)
        is distinct from (old.procurement_id, old.expense_claim_id, old.material_request_id) then
    if v_type = 'procurement' then
      select r.org_id, r.project_id, r.status::text into v_org, v_project, v_status from public.procurements r where r.id = v_id;
      if v_org is null then   -- 2700: a person who may not see prices reads the request through the masked view (same rows)
        select r.org_id, r.project_id, r.status::text into v_org, v_project, v_status from public.procurements_masked r where r.id = v_id;
      end if;
    elsif v_type = 'expense_claim' then
      select r.org_id, r.project_id, r.status::text into v_org, v_project, v_status from public.expense_claims r where r.id = v_id;
    else
      select r.org_id, r.project_id, r.status into v_org, v_project, v_status from public.material_requests r where r.id = v_id;
    end if;
    -- One message for "missing", "not readable" and "another organisation" (no existence oracle).
    if v_org is null or v_org is distinct from new.org_id then
      raise exception 'choose a record you can open' using errcode = '42501';
    end if;
    if v_project is not null and new.project_id is not null and v_project is distinct from new.project_id then
      raise exception 'the record belongs to a different project than the task' using errcode = '23514';
    end if;
    if public.record_status_is_end(v_type, v_status) then
      raise exception 'this record is already finished' using errcode = '23514';
    end if;
  end if;

  -- One open task per link (FR-RLT-006): a pre-insert guard names the existing task; the partial unique index is the
  -- concurrency backstop (a bare 23505 is mapped to the same wording by the app).
  if v_open and (tg_op = 'INSERT'
      or (new.procurement_id, new.expense_claim_id, new.material_request_id)
         is distinct from (old.procurement_id, old.expense_claim_id, old.material_request_id)
      or old.status = 'Done' or old.archived_at is not null or old.tombstoned_at is not null) then
    select t.id, t.name into v_clash_id, v_clash_name
      from public.tasks t
     where t.id <> new.id
       and t.status <> 'Done' and t.archived_at is null and t.tombstoned_at is null
       and ((v_type = 'procurement' and t.procurement_id = v_id)
         or (v_type = 'expense_claim' and t.expense_claim_id = v_id)
         or (v_type = 'material_request' and t.material_request_id = v_id))
     limit 1;
    if v_clash_id is not null then
      raise exception 'an open task already exists for this record' using errcode = '23505',
        detail = v_clash_id::text, hint = v_clash_name;
    end if;
  end if;
  return new;
end $$;

-- The masked open commitment keeps one row per request the person may read, amount NULL while prices are hidden from them
-- (the table read returns nothing to that person now, so the rows come from procurements_masked).
create or replace function public.procurement_open_commitments_masked(p_ids uuid[]) returns table (procurement_id uuid, amount numeric)
  language sql stable security invoker set search_path = public, pg_catalog as $$
  select u.procurement_id, case when (select public.actor_may_see_prices_now()) then u.amount end
    from public.procurement_open_commitments(p_ids) u
  union all   -- 2700
  select p.id, null::numeric from public.procurements_masked p where p.id = any (p_ids) and not (select public.actor_shown_prices())   -- 2700
$$;

-- 5. Write responses and rental checks.
create or replace function public.create_procurement_with_items(p_id uuid, p_header jsonb, p_items jsonb)
returns public.procurements language plpgsql security definer set search_path = public, pg_temp as $$
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
  if not public.actor_shown_prices() then                                                         -- 2700
    v_parent.total_value := null; v_parent.approved_total_value := null; v_parent.vendor_id := null;   -- 2700
  end if;                                                                                          -- 2700
  return v_parent;
end $$;

create or replace function public.check_hourly_rental(p_asset uuid, p_from date, p_to date,
  p_contracted numeric, p_invoice numeric, p_broken jsonb, p_state text default null, p_invoice_id uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_term public.equipment_rental_terms;
  v_day jsonb; v_date date; v_hours numeric; v_broken numeric := 0; v_billable numeric;
  v_proofs jsonb; v_days jsonb := '[]'; v_result jsonb; v_dates date[] := '{}';
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not (public.auth_role() in ('Admin','Finance') or public.equipment_manager_rights(public.auth_role()) or coalesce(public.actor_built_in_role() = 'equipment_officer', false)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.actor_shown_prices() then raise exception 'not authorized' using errcode = '42501'; end if;   -- 2700
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 399 then
    raise exception 'invalid rental period' using errcode = '22023';
  end if;
  if p_contracted is null or p_invoice is null or p_contracted::text in ('NaN','Infinity','-Infinity')
    or p_invoice::text in ('NaN','Infinity','-Infinity') or p_contracted < 0 or p_invoice < 0
    or p_contracted > 9600 or p_invoice > 9600 or round(p_contracted,2) <> p_contracted or round(p_invoice,2) <> p_invoice then
    raise exception 'invalid hours' using errcode = '22023';
  end if;
  if p_state is not null and p_state not in ('checked','disputed') then
    raise exception 'invalid check outcome' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets where id = p_asset and org_id = v_org and ownership = 'rented' and archived_at is null) then
    raise exception 'rented asset not found' using errcode = 'P0002';
  end if;
  select * into v_term from public.equipment_rental_terms
    where org_id = v_org and asset_id = p_asset and basis = 'hour'
    and rented_from <= p_from and coalesce(rented_to,'infinity'::date) >= p_to;
  if not found then raise exception 'one hourly term must cover the entire check period' using errcode = '22023'; end if;
  if p_broken is null or jsonb_typeof(p_broken) <> 'array' or jsonb_array_length(p_broken) > 400 then
    raise exception 'invalid broken hours' using errcode = '22023';
  end if;
  for v_day in select value from jsonb_array_elements(p_broken) loop
    v_date := (v_day->>'date')::date; v_hours := (v_day->>'hours')::numeric;
    if v_date is null or v_date < p_from or v_date > p_to or v_date = any(v_dates)
      or v_hours is null or v_hours::text in ('NaN','Infinity','-Infinity') or v_hours <= 0 or v_hours > 24 or round(v_hours,2) <> v_hours then
      raise exception 'invalid dated broken hours' using errcode = '22023';
    end if;
    v_dates := array_append(v_dates,v_date);
    select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'file_name',pr.file_name,'file_path',pr.file_path)), '[]') into v_proofs
      from public.equipment_downtime_proofs pr where pr.org_id = v_org and pr.asset_id = p_asset and pr.proof_date = v_date
      and exists (select 1 from storage.objects o where o.bucket_id = 'equipment-proof' and o.name = pr.file_path);
    if jsonb_array_length(v_proofs) > 0 then v_broken := v_broken + v_hours; end if;
    v_days := v_days || jsonb_build_array(jsonb_build_object('date',v_date,'hours',v_hours,'proven',jsonb_array_length(v_proofs)>0,'proofs',v_proofs));
  end loop;
  v_billable := greatest(0, p_contracted - v_broken);
  v_result := jsonb_build_object('contracted_hours',p_contracted::numeric(12,2)::text,
    'broken_hours',v_broken::numeric(12,2)::text,'billable_hours',v_billable::numeric(12,2)::text,
    'invoice_hours',p_invoice::numeric(12,2)::text,'rate',v_term.rate::text,'currency',v_term.currency,
    'deduction',round((p_contracted-v_billable)*v_term.rate,2)::numeric(14,2)::text,
    'expected_amount',round(v_billable*v_term.rate,2)::numeric(14,2)::text,'days',v_days,'state',p_state);
  if p_state is not null then
    if p_invoice_id is null or not exists (
      select 1 from public.procurement_invoices i join public.procurements p on p.id = i.procurement_id and p.org_id = v_org
      where i.id = p_invoice_id and i.org_id = v_org and p.vendor_id = v_term.vendor_id
    ) then raise exception 'choose a supplier invoice for this rental vendor' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_note,''))) > 1000 or (p_state = 'disputed' and nullif(btrim(p_note),'') is null) then
      raise exception 'a dispute needs a note of at most 1000 characters' using errcode = '22023';
    end if;
    v_result := v_result || jsonb_build_object('invoice_id',p_invoice_id,'note',nullif(btrim(p_note),''));
    insert into public.hourly_rental_checks(org_id,asset_id,period_from,period_to,result,invoice_id,note)
      values(v_org,p_asset,p_from,p_to,v_result,p_invoice_id,nullif(btrim(p_note),''));
    perform public.log_audit('equipment_rental.hourly_check',v_org,auth.uid(),p_asset,v_result);
  end if;
  return v_result;
end $$;

create or replace function public.equipment_rental_check(p_asset uuid, p_from date, p_to date, p_invoice_amount numeric default null,
                                              p_include_unproven_reason text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_reason text := nullif(btrim(coalesce(p_include_unproven_reason, '')), '');
  v_rental_units numeric; v_deduct_units numeric; v_ccy int; v_cur text; v_rental numeric; v_deduct numeric; v_expected numeric;
  v_days jsonb; v_unproven jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  -- 1600: the equipment manager reads the check; only Admin and Finance may state a reason to include
  -- unproven days, because that path stores a record and audits it. Nothing else here writes.
  if not (public.auth_role() in ('Admin','Finance') or public.equipment_manager_rights(public.auth_role()) or coalesce(public.actor_built_in_role() = 'equipment_officer', false))
     or (public.auth_role() not in ('Admin','Finance') and p_include_unproven_reason is not null) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.actor_shown_prices() then raise exception 'not authorized' using errcode = '42501'; end if;   -- 2700
  if p_include_unproven_reason is not null and v_reason is null then
    raise exception 'including unproven downtime needs a reason' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then raise exception 'the reason is at most 500 characters' using errcode = '22023'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then raise exception 'the invoice period is invalid or too long' using errcode = '22023'; end if;
  if p_invoice_amount is not null and (p_invoice_amount::text in ('NaN','Infinity') or p_invoice_amount < 0 or round(p_invoice_amount, 2) <> p_invoice_amount) then
    raise exception 'the invoice amount must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = p_asset and a.org_id = v_org and a.ownership = 'rented') then
    raise exception 'rented asset not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;

  if exists (select 1 from public.equipment_rental_terms where org_id = v_org and asset_id = p_asset and basis = 'hour' and rented_from <= p_to and coalesce(rented_to,'infinity'::date) >= p_from) then
    raise exception 'use the hourly rental check for hourly terms' using errcode = '22023';
  end if;

  select coalesce(sum(r.units), 0), count(distinct r.currency), min(r.currency) into v_rental_units, v_ccy, v_cur
    from public.equipment_rental_day_rates(v_org, p_asset, p_from, p_to) r;
  if v_ccy = 0 then raise exception 'no rental term covers the invoice period' using errcode = '22023'; end if;
  if v_ccy > 1 then raise exception 'the period mixes currencies' using errcode = '22023'; end if;

  -- every down day billed under a rental period, with its proof; deducted when proven (or when the user states a reason)
  with z as (
    select dd.status_date, dd.status, dd.proven, dd.period_start, r.units,
           (dd.proven or v_reason is not null) as deducted,   -- THE proof filter (AC-EAV-009): remove it and unproven days are deducted
           (select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'file_name', pr.file_name, 'file_path', pr.file_path) order by pr.created_at), '[]'::jsonb)
              from public.equipment_downtime_proofs pr
             where pr.org_id = v_org and pr.asset_id = p_asset and pr.proof_date >= dd.period_start
               and (dd.period_end is null or pr.proof_date < dd.period_end)
               and exists (select 1 from storage.objects o where o.bucket_id = 'equipment-proof' and o.name = pr.file_path)) as proofs
      from public.equipment_downtime_days(v_org, p_asset, p_from, p_to) dd
      join public.equipment_rental_day_rates(v_org, p_asset, p_from, p_to) r on r.d = dd.status_date
  )
  select coalesce(sum(z.units) filter (where z.deducted), 0),
         coalesce(jsonb_agg(jsonb_build_object('date', z.status_date, 'status', z.status, 'proven', z.proven, 'deducted', z.deducted, 'proofs', z.proofs)
                            order by z.status_date), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(z.status_date) order by z.status_date) filter (where not z.proven), '[]'::jsonb)
    into v_deduct_units, v_days, v_unproven
    from z;

  v_deduct_units := least(v_deduct_units, v_rental_units);            -- FR-EAV-017: never more than the period's rental amount
  v_rental := floor((v_rental_units + 188790) / 377580) / 100;
  v_deduct := least(floor((v_deduct_units + 188790) / 377580) / 100, v_rental);
  v_expected := v_rental - v_deduct;

  if v_reason is not null then   -- the stated reason is stored (AC-EAV-009) and audited
    insert into public.equipment_rental_checks (org_id, asset_id, period_from, period_to, invoice_amount, included_unproven_reason, deduction, expected_amount)
    values (v_org, p_asset, p_from, p_to, p_invoice_amount, v_reason, v_deduct, v_expected);
    perform public.log_audit('equipment_rental.check_unproven', v_org, auth.uid(), p_asset,
      jsonb_build_object('from', p_from, 'to', p_to, 'reason', v_reason, 'deduction', v_deduct));
  end if;

  return jsonb_build_object(
    'currency', v_cur,
    'rental_amount', to_char(v_rental, 'FM999999999990.00'),
    'deduction', to_char(v_deduct, 'FM999999999990.00'),
    'expected_amount', to_char(v_expected, 'FM999999999990.00'),
    'difference', case when p_invoice_amount is null then null else to_char(p_invoice_amount - v_expected, 'FM999999999990.00') end,
    'days', v_days, 'unproven_days', v_unproven, 'included_unproven_reason', v_reason);
end $$;
