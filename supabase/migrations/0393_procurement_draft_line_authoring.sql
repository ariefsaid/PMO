-- Preserve Draft line authoring while serializing case snapshots.
-- Rollback: supabase/migrations/rollback/0393_procurement_draft_line_authoring_down.sql

alter table public.external_command_outbox add column procurement_input_digest text;
create function public.procurement_case_uuid(p_value text) returns uuid
language plpgsql immutable strict security definer set search_path = pg_catalog as $$
begin
  return p_value::uuid;
exception when invalid_text_representation then
  return null;
end $$;
revoke all on function public.procurement_case_uuid(text) from public, anon, authenticated;

create index external_command_outbox_procurement_case_idx
  on public.external_command_outbox (org_id, public.procurement_case_uuid(payload->>'procurementId'))
  where domain = 'procurement';

create function public.procurement_case_has_external_evidence(p_org uuid, p_case uuid)
returns boolean language sql volatile security definer set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.external_command_outbox o
    where o.org_id = p_org and o.domain = 'procurement'
      and public.procurement_case_uuid(o.payload->>'procurementId') = p_case
  ) or exists (
    select 1 from public.procurement_erp_links l where l.org_id = p_org and l.procurement_id = p_case
  ) or exists (
    select 1 from public.external_refs x
    where x.org_id = p_org and x.domain = 'procurement' and x.pmo_record_id in (
      select id::text from public.purchase_requests where org_id = p_org and procurement_id = p_case
      union all select id::text from public.rfqs where org_id = p_org and procurement_id = p_case
      union all select id::text from public.procurement_quotations where org_id = p_org and procurement_id = p_case
      union all select id::text from public.purchase_orders where org_id = p_org and procurement_id = p_case
      union all select id::text from public.procurement_receipts where org_id = p_org and procurement_id = p_case
      union all select id::text from public.procurement_invoices where org_id = p_org and procurement_id = p_case
      union all select id::text from public.payments where org_id = p_org and procurement_id = p_case
    )
  );
$$;
revoke all on function public.procurement_case_has_external_evidence(uuid, uuid) from public, anon, authenticated;

create or replace function public.procurement_items_native_mirror_guard() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_parent public.procurements%rowtype;
begin
  if not public.domain_externally_owned(new.org_id, 'procurement') then return new; end if;
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
     and new.procurement_id is distinct from old.procurement_id then
    raise exception 'procurement item remains with its original case' using errcode = '42501';
  end if;
  perform 1 from public.procurements
   where org_id = new.org_id and id in (old.procurement_id, new.procurement_id)
   order by id for update;
  select * into v_parent from public.procurements where id = new.procurement_id and org_id = new.org_id;
  if coalesce(auth.jwt()->>'role', '') = 'service_role' then return new; end if;
  if new.erp_line_amount is distinct from old.erp_line_amount
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified then
    raise exception 'procurement item mirror fields are read-only' using errcode = '42501';
  end if;
  if (new.quantity is distinct from old.quantity or new.rate is distinct from old.rate)
     and (v_parent.id is null or v_parent.status <> 'Draft' or public.procurement_case_has_external_evidence(new.org_id, new.procurement_id)) then
    raise exception 'procurement item values are read-only for this case' using errcode = '42501';
  end if;
  return new;
end $$;

create function public.lock_procurement_item_parent() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid; v_case uuid;
begin
  if tg_op = 'DELETE' then v_org := old.org_id; v_case := old.procurement_id;
  else v_org := new.org_id; v_case := new.procurement_id; end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    perform 1 from public.procurements where id = v_case and org_id = v_org for update;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.lock_procurement_item_parent() from public, anon, authenticated;
create trigger procurement_items_zzz_parent_lock before insert or delete on public.procurement_items
  for each row execute function public.lock_procurement_item_parent();

create function public.procurement_item_values_editable(p_case uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare v_parent public.procurements%rowtype;
begin
  select * into v_parent from public.procurements where id = p_case and org_id = public.auth_org_id();
  if v_parent.id is null or v_parent.status <> 'Draft' or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_parent.org_id, 'procurement'), false)
     or not coalesce(v_parent.requested_by_id = auth.uid() or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'), false) then
    return false;
  end if;
  return not public.domain_externally_owned(v_parent.org_id, 'procurement')
    or not public.procurement_case_has_external_evidence(v_parent.org_id, p_case);
end $$;
revoke all on function public.procurement_item_values_editable(uuid) from public, anon;
grant execute on function public.procurement_item_values_editable(uuid) to authenticated;

-- Match the existing enqueue/claim lock order: outbox row first, then case.
-- This also covers the generic adapter insert when no line snapshot is captured.
create function public.lock_procurement_outbox_parent() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.domain = 'procurement' and new.payload->>'procurementId' is not null then
    perform 1 from public.procurements
      where org_id = new.org_id and id = public.procurement_case_uuid(new.payload->>'procurementId') for update;
  end if;
  return new;
end $$;
revoke all on function public.lock_procurement_outbox_parent() from public, anon, authenticated;
create trigger external_command_outbox_procurement_parent_lock after insert on public.external_command_outbox
  for each row execute function public.lock_procurement_outbox_parent();

create function public.insert_procurement_outbox_pending(
  p_org uuid, p_record_id text, p_key text, p_tier text, p_operation text,
  p_payload jsonb, p_digest text, p_actor uuid, p_case uuid, p_snapshot jsonb
) returns public.external_command_outbox
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.external_command_outbox; v_mismatch boolean; v_input_digest text;
begin
  if p_tier is distinct from 'erpnext' or p_operation is distinct from 'create'
     or public.procurement_case_uuid(p_payload->>'procurementId') is distinct from p_case
     or not coalesce(p_payload->>'erp_doc_kind' in ('purchase-order', 'goods-receipt', 'purchase-invoice'), false)
     or jsonb_typeof(p_snapshot) is distinct from 'array' then
    raise exception 'invalid procurement snapshot' using errcode = '22023';
  end if;
  if p_payload->>'erp_doc_kind' = 'goods-receipt' then
    v_input_digest := p_payload->'pmo_gr_snapshot'->>'raw_digest';
    if v_input_digest is null or v_input_digest !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid receipt witness' using errcode = '22023';
    end if;
  end if;
  insert into public.external_command_outbox
    (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload, payload_digest, actor_user_id, procurement_input_digest)
  values (p_org, 'procurement', p_record_id, p_key, p_tier, p_operation, 'pending', p_payload, p_digest, p_actor, v_input_digest)
  returning * into v_row;
  perform 1 from public.procurements where id = p_case and org_id = p_org for update;
  if not found then raise exception 'procurement case not found' using errcode = '42501'; end if;
  with current_lines as (
    select name, description, quantity::numeric as quantity, rate::numeric as rate
      from public.procurement_items where org_id = p_org and procurement_id = p_case
  ), snapshot_lines as (
    select x.name, x.description, x.quantity, x.rate
      from jsonb_to_recordset(p_snapshot) as x(name text, description text, quantity numeric, rate numeric)
  )
  select exists (
    (select * from current_lines except all select * from snapshot_lines)
    union all
    (select * from snapshot_lines except all select * from current_lines)
  ) into v_mismatch;
  if v_mismatch then raise exception 'procurement line snapshot changed' using errcode = '40001'; end if;
  return v_row;
end $$;
revoke all on function public.insert_procurement_outbox_pending(uuid,text,text,text,text,jsonb,text,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.insert_procurement_outbox_pending(uuid,text,text,text,text,jsonb,text,uuid,uuid,jsonb) to service_role;

-- Requester and Admin header edits share the existing record scope.
create or replace function public.update_procurement_header(p_id uuid, p_patch jsonb)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_case public.procurements%rowtype;
  v_project uuid;
  v_vendor uuid;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) as k where k not in ('title','project_id','vendor_id','budget_category'))
     or (p_patch ? 'title' and jsonb_typeof(p_patch->'title') <> 'string')
     or exists (select 1 from jsonb_each(p_patch) as e where e.key in ('project_id','vendor_id','budget_category') and jsonb_typeof(e.value) not in ('string','null')) then
    raise exception 'Invalid procurement header fields' using errcode = '22023';
  end if;
  if v_uid is null or v_org is null or not public.is_active_member()
     or not public.org_feature_enabled(v_org, 'procurement') then
    raise exception 'Procurement header edit is not permitted' using errcode = '42501';
  end if;
  select * into v_case from public.procurements where id=p_id and org_id=v_org for update;
  if not found or v_case.status not in ('Draft','Rejected')
     or (v_case.requested_by_id is distinct from v_uid and public.auth_role() is distinct from 'Admin') then
    raise exception 'Procurement header edit is not permitted' using errcode = '42501';
  end if;
  if p_patch ? 'project_id' then
    v_project := (p_patch->>'project_id')::uuid;
    if v_project is not null and not exists (select 1 from public.projects where id=v_project and org_id=v_org) then
      raise exception 'Project is not available' using errcode = '42501';
    end if;
  end if;
  if p_patch ? 'vendor_id' then
    v_vendor := (p_patch->>'vendor_id')::uuid;
    if v_vendor is not null and not exists (select 1 from public.companies where id=v_vendor and org_id=v_org) then
      raise exception 'Supplier is not available' using errcode = '42501';
    end if;
  end if;
  update public.procurements set
    title = case when p_patch ? 'title' then p_patch->>'title' else title end,
    project_id = case when p_patch ? 'project_id' then v_project else project_id end,
    vendor_id = case when p_patch ? 'vendor_id' then v_vendor else vendor_id end,
    budget_category = case when p_patch ? 'budget_category' then (p_patch->>'budget_category')::public.budget_category else budget_category end
  where id = v_case.id and org_id = v_org;
  return true;
end $$;
revoke all on function public.update_procurement_header(uuid,jsonb) from public, anon;
grant execute on function public.update_procurement_header(uuid,jsonb) to authenticated;
