-- 0474_po_variations_down.sql — reverses 0474 (#1513 S4). One-way once any variation exists (NFR-SCA-007): variations are
-- never deleted (the guard refuses DELETE under any setting) and issued PO revisions reference them, so this refuses while
-- a row exists and only runs on a database that never had one. Never copy rows into a table in `public`: that schema is
-- API-exposed and an `as select *` copy carries no RLS. Spend already raised by an approved variation
-- (procurements.total_value / approved_total_value) stands.
do $$ begin
  if exists (select 1 from public.po_variations) or exists (select 1 from public.po_variation_lines) then
    raise exception 'rollback refused: PO variations exist and cannot be removed';
  end if;
end $$;
drop function if exists public.project_subcontract_exposure(uuid);
drop function if exists public.subcontract_po_position(uuid);
-- restore the 0472 position read (no `disputed`)
create or replace function public.subcontract_po_position(p_po_id uuid)
  returns table (boq_item_id uuid, item_code text, description text, unit text, rate numeric, revision integer,
                 po_qty numeric, verified numeric, billed numeric, payable numeric, verified_not_on_po numeric,
                 verified_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  with rev as (select public.po_effective_revision(p_po_id) as r),
  bl as (select l.boq_item_id, sum(l.quantity) q from public.procurement_invoice_lines l
           join public.procurement_invoices i on i.id = l.invoice_id
          where i.po_id = p_po_id and public.subcontract_bill_is_live(i.erp_docstatus, i.erp_cancelled_at)
          group by l.boq_item_id),
  money as (select public.auth_role() in ('Admin','Executive','Project Manager','Finance') as ok)  -- D6 / 0350 ruling
  select pl.boq_item_id, b.item_code, b.description, pl.unit, pl.rate, pl.revision, pl.quantity,
         coalesce(v.quantity, 0),
         case when money.ok then coalesce(bl.q, 0) end,
         case when money.ok then greatest(least(coalesce(v.quantity, 0), pl.quantity) - coalesce(bl.q, 0), 0) end,
         greatest(coalesce(v.quantity, 0) - pl.quantity, 0),
         v.confirmed_at
    from rev cross join money join public.purchase_order_lines pl on pl.po_id = p_po_id and pl.revision = rev.r
    join public.boq_items b on b.id = pl.boq_item_id
    left join public.subcontract_verified(p_po_id) v on v.boq_item_id = pl.boq_item_id
    left join bl on bl.boq_item_id = pl.boq_item_id
   order by b.line_no nulls last, b.item_code
$$;
revoke all on function public.subcontract_po_position(uuid) from public, anon;
grant execute on function public.subcontract_po_position(uuid) to authenticated;
drop function if exists public.work_order_cost_variations(uuid);
drop function if exists public.link_po_variation(uuid, uuid, text);
drop function if exists public.issue_po_revision(uuid);
drop function if exists public.decide_po_variation(uuid, boolean, text);
drop function if exists public.po_variation_route(uuid);
drop function if exists public.request_po_variation(uuid, text, jsonb, text);
alter table public.purchase_order_revisions drop constraint if exists purchase_order_revisions_variation_fk;
drop table if exists public.po_variation_lines;
drop table if exists public.po_variations;
drop function if exists public.guard_po_variation_line();
drop function if exists public.guard_po_variation();
-- restore the payer checks (0368 §2 guard, 0373 §1 refusal) without the helper, then drop it
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
    if auth.uid() is not null and (auth.uid() = old.approved_by_id or auth.uid() = old.amount_approved_by_id) then
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
    elsif p_actor_user_id = v_proc.approved_by_id or p_actor_user_id = v_proc.amount_approved_by_id then
      v_refusal := 'separation_of_duties';
    elsif (v_proc.approved_by_id is not null or v_proc.approved_total_value is not null)
          and not coalesce((select c.ok from public.procurement_payment_within_ceiling(v_proc.id) c), false) then
      v_refusal := 'exceeds_approved_amount';
    end if;
  end if;
  return v_refusal;
end $$;
drop function if exists public.procurement_amount_approver(uuid, uuid);
