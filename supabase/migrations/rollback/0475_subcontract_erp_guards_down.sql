-- 0475_subcontract_erp_guards_down.sql — reverses 0475 (#1513 S5). Creates no table, so there are no rows to refuse on:
-- it restores the three shipped function bodies it replaced (payment rule from 0368 §1, the Paid guard and the create
-- refusal from 0474) and drops the three new functions. Bill lines written by attribute_subcontract_bill_lines stay.
create or replace function public.procurement_payment_allowed(p_procurement_id uuid) returns text
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  if not found or (auth.uid() is not null and v_row.org_id is distinct from public.auth_org_id()) then
    return 'purchase_not_found';
  end if;
  if v_row.status is null or v_row.status::text in ('Cancelled','Rejected') then return 'purchase_closed'; end if;
  -- Awaiting approval, including a purchase a quote above its approved amount sent back.
  if v_row.status = 'Requested' then return 'awaiting_approval'; end if;
  -- 0362 FR-PFE-017: without an approved amount, only a purchase that never entered approval (no approver, no request
  -- number, no Requested/Approved event) and only with approval_before_payment OFF.
  if v_row.approved_total_value is null then
    if v_row.approved_by_id is not null or v_row.pr_number is not null
       or exists (select 1 from public.procurement_status_events e
                   where e.procurement_id = v_row.id
                     and e.to_status in ('Requested'::procurement_status, 'Approved'::procurement_status)) then
      return 'approval_missing';
    end if;
    if public.procurement_gate(v_row.org_id, 'approval_before_payment') then
      return 'gate_approval_before_payment';
    end if;
  end if;
  return null;
end $$;

create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
declare v_reason text;                                                                                   -- 0368
begin
  if tg_op = 'UPDATE' and not public.actor_bypasses_rls()
     and (new.approved_total_value is distinct from old.approved_total_value
          or new.amount_approved_by_id is distinct from old.amount_approved_by_id) then
    raise exception 'Approved amount is server managed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'Requested' and new.status = 'Approved' then
    -- The actor whose quote selection returned the request for approval may not approve it.
    -- Enforced here (not in an RPC branch) so no path and no role, Admin included, skips it.
    if auth.uid() is not null and auth.uid() = (
      select e.actor_id from public.procurement_status_events e
       where e.procurement_id = old.id and e.from_status = 'Vendor Quoted'::procurement_status
         and e.to_status = 'Requested'::procurement_status
       order by e.created_at desc, e.id desc limit 1
    ) then
      raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
    end if;
    new.approved_total_value := public.procurement_request_amount(new.id);
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
        and new.total_value > old.approved_total_value then
    -- The selected quote is retained, but the old decision is invalid. The normal
    -- Requested -> Approved transition re-runs spend_approval_route on this amount.
    new.status := 'Requested';
    new.approved_by_id := null;
    new.approved_total_value := null;
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and new.status = 'Paid' and old.status is distinct from 'Paid' then
    -- 0362 FR-PFE-016: approver ≠ payer on EVERY path to Paid (transition, a Paid payment, a linked Payment Entry).
    if auth.uid() is not null and public.procurement_amount_approver(old.id, auth.uid()) then                -- 0474
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
    -- 0368: the payment rule (§1) — closed, awaiting approval, or 0362 FR-PFE-017's "never entered approval and
    -- approval_before_payment OFF" when no approved amount is recorded. This is a BEFORE trigger, so §1 reads the
    -- row as it stands before this update (the old values).
    v_reason := public.procurement_payment_allowed(old.id);                                              -- 0368
    if v_reason is not null then                                                                         -- 0368
      raise exception '%', case v_reason                                                                 -- 0368
          when 'awaiting_approval' then public.procurement_gate_message('awaiting_approval')            -- 0368
          when 'purchase_closed' then 'This purchase is closed.'                                         -- 0368
          else 'Cannot pay without a recorded approved amount.' end                                      -- 0368
        using errcode = '23514', detail = v_reason;                                                      -- 0368
    elsif old.approved_total_value is not null                                                          -- 0368
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

create or replace function public.procurement_create_refusal(
  p_org_id uuid, p_procurement_id uuid, p_erp_doc_kind text, p_actor_user_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_step public.procurement_status;
  v_proc public.procurements;
  v_refusal text;
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

drop function if exists public.attribute_subcontract_bill_lines(uuid, jsonb);
drop function if exists public.po_revision_push_refusal(uuid, uuid, integer, boolean);
drop function if exists public.subcontract_cap_exceptions(uuid);
revoke execute on function public.subcontract_bill_is_live(smallint, timestamptz) from service_role;
