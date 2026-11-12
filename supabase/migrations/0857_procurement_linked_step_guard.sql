-- The linked document state is shared by the outbox and the dispatch boundary.
create function public.linked_step_state(p_org_id uuid, p_procurement_id uuid, p_step text)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_doctype text; v_name text;
begin
  if not exists (select 1 from public.procurements where id = p_procurement_id and org_id = p_org_id) then
    raise exception 'purchase not found' using errcode = '42501';
  end if;
  v_doctype := case p_step when 'goods-receipt' then 'Purchase Receipt' when 'purchase-invoice' then 'Purchase Invoice' else null end;
  if v_doctype is null then return 'not_applicable'; end if;
  if exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents d
      on d.id = l.erp_purchase_document_id and d.org_id = l.org_id
      where l.org_id = p_org_id and l.procurement_id = p_procurement_id and d.erp_doctype = v_doctype) then
    return 'already_in_erp';
  end if;
  select d.erp_name into v_name from public.erp_purchase_documents d
    where d.org_id = p_org_id and d.erp_doctype = v_doctype and d.erp_docstatus = 1 and not d.is_return
      and exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents po
        on po.id = l.erp_purchase_document_id and po.org_id = l.org_id
        where l.org_id = p_org_id and l.procurement_id = p_procurement_id
          and po.erp_doctype = 'Purchase Order' and po.erp_name = any(d.purchase_orders))
      and not exists (select 1 from public.procurement_erp_links l where l.org_id = p_org_id and l.erp_purchase_document_id = d.id)
      and not public.erp_document_recorded_by_pmo(p_org_id, d.erp_doctype, d.erp_name)
    order by d.erp_name limit 1;
  if v_name is not null then return 'already_in_erp_unlinked:' || v_name; end if;
  if exists (select 1 from public.procurement_erp_links l where l.org_id = p_org_id and l.procurement_id = p_procurement_id) then
    return 'new_step';
  end if;
  return 'not_applicable';
end $$;
revoke all on function public.linked_step_state(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.linked_step_state(uuid,uuid,text) to service_role;

create function public.guard_linked_procurement_step() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_case uuid; v_state text;
begin
  if new.external_tier = 'erpnext' and new.domain = 'procurement' and new.operation = 'create'
     and new.payload->>'erp_doc_kind' in ('goods-receipt','purchase-invoice') then
    v_case := public.procurement_case_uuid(new.payload->>'procurementId');
    perform 1 from public.procurements where id = v_case and org_id = new.org_id for update;
    if not found then return new; end if;
    v_state := public.linked_step_state(new.org_id, v_case, new.payload->>'erp_doc_kind');
    if v_state like 'already_in_erp_unlinked:%' then
      raise exception 'ERP % already records this; link it instead of sending a new one.', substr(v_state, 25) using errcode = 'P0001';
    end if;
    if v_state = 'already_in_erp' then
      raise exception 'step_already_recorded' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_linked_procurement_step() from public, anon, authenticated;
create trigger external_command_outbox_zz_linked_step before insert on public.external_command_outbox
for each row execute function public.guard_linked_procurement_step();

create or replace function public.procurement_create_refusal(
  p_org_id uuid, p_procurement_id uuid, p_erp_doc_kind text, p_actor_user_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_step public.procurement_status;
  v_proc public.procurements;
  v_refusal text;
  v_linked_state text;
begin
  v_step := case p_erp_doc_kind
    when 'purchase-order'   then 'Ordered'::public.procurement_status
    when 'goods-receipt'    then 'Received'::public.procurement_status
    when 'purchase-invoice' then 'Vendor Invoiced'::public.procurement_status
    when 'payment'          then 'Paid'::public.procurement_status
  end;
  -- The foreground gate asks nothing of other kinds; neither does this.
  if v_step is null then return null; end if;
  if p_procurement_id is not null then
    select * into v_proc from public.procurements
     where id = p_procurement_id and org_id = p_org_id for update;
  end if;
  if v_proc.id is null then return 'purchase_not_found'; end if;
  if p_erp_doc_kind in ('goods-receipt','purchase-invoice') then
    v_linked_state := public.linked_step_state(p_org_id, p_procurement_id, p_erp_doc_kind);
    if v_linked_state like 'already_in_erp_unlinked:%' then
      return 'ERP ' || substr(v_linked_state, 25) || ' already records this; link it instead of sending a new one.';
    elsif v_linked_state = 'already_in_erp' then
      return 'step_already_recorded';
    end if;
  end if;
  if p_erp_doc_kind = 'purchase-invoice' and v_proc.is_subcontract                                       -- 0475
     and exists (select 1 from public.purchase_order_revisions r where r.procurement_id = v_proc.id) then -- 0475
    return 'subcontract_bill_lines_required';  -- PQ-9: #1505 replaces this with the cap over the payload  -- 0475
  end if;                                                                                                 -- 0475
  -- A payment: 0368's payment rule first (closed / awaiting approval / approval missing), then the order-step rules.
  if p_erp_doc_kind = 'payment' then
    v_refusal := public.procurement_payment_allowed(v_proc.id);
  end if;
  if v_refusal is null then
    v_refusal := public.procurement_gate_violation(v_proc.id, v_step);
  end if;
  if v_refusal is null and p_erp_doc_kind = 'payment' then
    if p_actor_user_id is null then
      v_refusal := 'actor_missing';
    elsif public.procurement_amount_approver(v_proc.id, p_actor_user_id) then                                 -- 0474
      v_refusal := 'separation_of_duties';
    elsif (v_proc.approved_by_id is not null or v_proc.approved_total_value is not null)
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(v_proc.id) c), false) then
      v_refusal := 'exceeds_approved_amount';
    end if;
  end if;
  return v_refusal;
end $$;
