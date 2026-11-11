-- Reverses 0368: restores 0262's claim_outbox_for_commit, 0360's procurement_gate_violation and procurement_gate_message,
-- and 0362's guard_procurement_approved_total, then drops procurement_payment_allowed (nothing calls it any more).

-- 0262 §6b claim_outbox_for_commit, verbatim (supabase/migrations/0262_billing_by_work_order.sql lines 353-419).
create or replace function public.claim_outbox_for_commit(
  p_id uuid, p_lease interval default interval '60 seconds'
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
  declare
    v public.external_command_outbox;
    v_domain text;
    v_record_id text;
    v_key text;
    v_status timesheet_status;
    v_approved_at timestamptz;
    v_witness timestamptz;
    v_row public.external_command_outbox;
  begin
    select domain, pmo_record_id, idempotency_key
      into v_domain, v_record_id, v_key
      from public.external_command_outbox where id = p_id;
    if v_domain = 'timesheets' then
      -- The canonical uuid text — the SAME identity §B stores and the Approved→Draft arm locks on
      -- (BLOCK 3). `domain` and `pmo_record_id` are immutable for the life of a row, so reading them
      -- before the lock is safe; everything that can CHANGE is read after it.
      v_record_id := (v_record_id::uuid)::text;
      perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || v_record_id, 0));
      select status, approved_at into v_status, v_approved_at
        from public.timesheets where id = v_record_id::uuid;
      if v_status is distinct from 'Approved' then
        raise exception 'timesheet-no-longer-approved' using errcode = 'P0001';
      end if;
      -- ⚑ THE GENERATION FENCE ON THE RE-DRIVE (Luna round-2 BLOCK 1). `Approved` is re-reachable: one
      -- correction cycle later the sheet is Approved AGAIN, as a DIFFERENT generation. A stale `failed`
      -- T1 row re-driven then (the foreground Retry, the sweep's mirror queue) would POST the
      -- SUPERSEDED hours and the corrected week would post as a SECOND ERP Timesheet. So this row's own
      -- persisted witness — its deterministic key (§A2), the SAME string §B refused to insert without —
      -- must equal the sheet's CURRENT `approved_at`. NULL ⇒ the row cannot prove its generation ⇒
      -- REFUSE (fail closed): an old or hand-written row is never given the benefit of the doubt over
      -- money. The refusal is a raise, never a NULL return — a NULL means "not claimable now" and would
      -- send the caller back into reconcileOutbox to try this same row forever.
      v_witness := public.timesheet_push_key_witness(v_key);
      if v_witness is null or v_witness is distinct from v_approved_at then
        raise exception 'timesheet-approval-superseded' using errcode = 'P0001';
      end if;
    end if;
    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4/5): a revenue command revived from `failed` is re-checked against its work order
    --   (and, for a claim's invoice, against the claim being withdrawn since) — the fence's own check, on the stored
    --   payload. The helper takes the work order's billing lock before it reads anything.
    if v_domain = 'revenue' then
      -- Rule: the row is locked before its state is read, so no other worker can move it to `failed` between this read
      -- and the claiming UPDATE. Lock order: outbox row, then the billing lock (no billing-lock holder waits on a row).
      select * into v_row from public.external_command_outbox where id = p_id for update;
      if v_row.state = 'failed' then
        perform public.assert_invoice_command_within_work_order(v_row.org_id, v_row.operation, v_row.pmo_record_id, v_row.payload);
      end if;
    end if;
    update public.external_command_outbox
       set state='committing',
           attempt_count = attempt_count + 1,
           claim_generation = claim_generation + 1,   -- fencing token (F4): monotonic per claim
           claimed_at = now(),
           updated_at = now()
     where id = p_id
       and ( state in ('pending','failed')
             or (state='quarantined' and reconcile_after is not null and reconcile_after < now()) )
    returning * into v;
    return v;   -- v.claim_generation is the caller's fencing token; null ⇒ not claimable now
  end; $$;
revoke all on function public.claim_outbox_for_commit(uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_outbox_for_commit(uuid, interval) to service_role;

-- 0360 procurement_gate_violation, verbatim (supabase/migrations/0360_procurement_flexible_foundation.sql lines 221-252;
-- `create` -> `create or replace`).
create or replace function public.procurement_gate_violation(p_procurement_id uuid, p_step public.procurement_status)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  if not found or (auth.uid() is not null and v_row.org_id is distinct from public.auth_org_id()) then
    return 'purchase_not_found';
  end if;
  if public.procurement_step_rank(p_step) >= 5 then
    if public.procurement_gate(v_row.org_id, 'request_before_order')
       and v_row.pr_number is null and public.procurement_step_rank(v_row.status) < 1
       and not exists (select 1 from public.purchase_requests r where r.procurement_id = v_row.id) then
      return 'gate_request_before_order';
    end if;
    if public.procurement_gate(v_row.org_id, 'approval_before_order') and v_row.approved_by_id is null then
      return 'gate_approval_before_order';
    end if;
  end if;
  if public.procurement_step_rank(p_step) >= 7
     and public.procurement_gate(v_row.org_id, 'receipt_before_invoice')
     and public.procurement_step_rank(v_row.status) < 6
     and not exists (select 1 from public.procurement_receipts r where r.procurement_id = v_row.id)
     and not exists (select 1 from public.procurement_erp_links l
                       join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                      where l.procurement_id = v_row.id and d.erp_doctype = 'Purchase Receipt' and d.erp_docstatus = 1) then
    return 'gate_receipt_before_invoice';
  end if;
  if p_step = 'Paid' and public.procurement_gate(v_row.org_id, 'approval_before_payment') and v_row.approved_by_id is null then
    return 'gate_approval_before_payment';
  end if;
  return null;
end $$;

-- 0360 procurement_gate_message, verbatim (lines 140-148; `create` -> `create or replace`).
create or replace function public.procurement_gate_message(p_code text) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select case p_code
    when 'gate_request_before_order'    then 'Your organization requires a purchase request before an order.'
    when 'gate_approval_before_order'   then 'Your organization requires an approval before an order.'
    when 'gate_receipt_before_invoice'  then 'Your organization requires a goods receipt before a vendor invoice.'
    when 'gate_approval_before_payment' then 'Your organization requires an approval before payment.'
    else p_code end
$$;

-- 0362 §2 guard_procurement_approved_total, verbatim (supabase/migrations/0362_procurement_start_anywhere.sql lines 99-149).
create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
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
    -- 0362 FR-PFE-017: Paid without an approved amount only for a purchase that never entered approval (no approver,
    -- no request number, no Requested/Approved event — so a pending or re-opened approval cannot be skipped) and only
    -- with approval_before_payment OFF. Status is changed only by definers, so the event read is not RLS-narrowed.
    if old.approved_total_value is null then
      if old.approved_by_id is not null or old.pr_number is not null
         or exists (select 1 from public.procurement_status_events e
                     where e.procurement_id = old.id
                       and e.to_status in ('Requested'::procurement_status, 'Approved'::procurement_status))
         or public.procurement_gate(old.org_id, 'approval_before_payment') then
        raise exception 'Cannot pay without a recorded approved amount.' using errcode = '23514';
      end if;
    elsif not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;

drop function if exists public.procurement_payment_allowed(uuid);
