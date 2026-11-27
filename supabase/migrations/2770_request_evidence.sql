-- Request planning and evidence reads.
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
  x.purchase_type_id, x.rental_from, x.rental_to, x.extends_procurement_id, x.needed_by
from public.procurements x
where x.org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_is_light()) is not true
  and ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance') or (select public.actor_may_order_purchases()) or x.requested_by_id = (select auth.uid()));

create policy purchase_request_files_requester_insert on public.purchase_request_files for insert to authenticated
with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
 and not (select public.actor_is_light()) and (select public.org_feature_enabled((select public.auth_org_id()), 'procurement'))
 and uploaded_by_id = (select auth.uid())
 and exists (select 1 from public.purchase_requests_masked r join public.procurements_masked p on p.id = r.procurement_id
 where r.id = purchase_request_id and p.requested_by_id = (select auth.uid())
 and (file_path is null or (split_part(file_path, '/', 1) = purchase_request_files.org_id::text
 and split_part(file_path, '/', 2) = p.id::text and split_part(file_path, '/', 3) = 'purchase_request'
 and array_length(string_to_array(file_path, '/'), 1) = 5
 and split_part(file_path, '/', 4) <> '' and split_part(file_path, '/', 5) <> ''))));

alter policy purchase_request_files_engineer_read_scope on public.purchase_request_files
using ((select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')
 or (select public.actor_may_order_purchases())
 or exists (select 1 from public.purchase_requests_masked r join public.procurements_masked p on p.id = r.procurement_id
 where r.id = purchase_request_id and p.requested_by_id = (select auth.uid())));

create policy storage_objects_requester_request_insert on storage.objects for insert to authenticated
with check (bucket_id = 'procurement-files' and split_part(name, '/', 1) = (select public.auth_org_id())::text
 and array_length(string_to_array(name, '/'), 1) = 5 and split_part(name, '/', 3) = 'purchase_request'
 and (select public.is_active_member()) and not (select public.actor_is_light())
 and (select public.org_feature_enabled((select public.auth_org_id()), 'procurement'))
 and exists (select 1 from public.procurements_masked p where p.id::text = split_part(name, '/', 2)
 and p.requested_by_id = (select auth.uid())));

create policy storage_objects_requester_request_read on storage.objects for select to authenticated
using (bucket_id = 'procurement-files' and split_part(name, '/', 1) = (select public.auth_org_id())::text
 and array_length(string_to_array(name, '/'), 1) = 5 and split_part(name, '/', 3) = 'purchase_request'
 and (select public.is_active_member()) and not (select public.actor_is_light())
 and exists (select 1 from public.procurements_masked p where p.id::text = split_part(name, '/', 2)
 and p.requested_by_id = (select auth.uid())));

-- drops: guard_procurement_file_path() | "or coalesce(public.auth_role() not in ('Admin','Executive','Project Manager','Finance'), true)" | Request evidence uses its scoped parent projection.
create or replace function public.guard_procurement_file_path() returns trigger
language plpgsql set search_path = public, pg_catalog, pg_temp as $$
declare
  v_parent uuid;
  v_org uuid;
  v_proc uuid;
begin
  -- A client never re-points an existing file row, whatever its role or the new key.
  if tg_op = 'UPDATE' and new.file_path is distinct from old.file_path and not public.actor_bypasses_rls() then
    raise exception 'Procurement file storage key cannot be changed.' using errcode = '42501';
  end if;
  v_parent := (to_jsonb(new)->>tg_argv[0])::uuid;
  if tg_table_name = 'purchase_request_files' and not public.actor_bypasses_rls() then
    select org_id, procurement_id into v_org, v_proc from public.purchase_requests_masked where id = v_parent;
  else
  execute format('select org_id, procurement_id from public.%I where id = $1', tg_argv[1])
    into v_org, v_proc using v_parent;
  end if;
  -- Keep the established RLS denial authoritative for unauthorized callers.
  if not public.actor_bypasses_rls() and (
       v_org is distinct from public.auth_org_id()
       or new.org_id is distinct from public.auth_org_id()
       or (tg_table_name <> 'purchase_request_files' and coalesce(public.auth_role() not in ('Admin','Executive','Project Manager','Finance'), true))
     ) then return new; end if;
  if new.file_path is null then return new; end if;
  if v_org is null or new.org_id is distinct from v_org
     or split_part(new.file_path, '/', 1) is distinct from v_org::text
     or split_part(new.file_path, '/', 2) is distinct from v_proc::text
     or split_part(new.file_path, '/', 3) is distinct from tg_argv[2]
     or array_length(string_to_array(new.file_path, '/'), 1) <> 5
     or split_part(new.file_path, '/', 4) = '' or split_part(new.file_path, '/', 5) = '' then
    raise exception 'Procurement file storage key does not match its record.' using errcode = '23514';
  end if;
  return new;
end; $$;

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
  p_line := p_line || jsonb_build_object('rate', coalesce((p_line->>'rate')::numeric, 0));
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

-- drops: guard_procurement_file_path() | "or array_length(string_to_array(new.file_path, '/'), 1) <> 5 then" | Evidence path segments remain nonempty.
