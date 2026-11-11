-- 0368 one purchase-payment rule for every path (#1319 slice G review; spec procurement-flexible-entry FR-PFE-016/017).
-- Rollback: supabase/migrations/rollback/0368_procurement_payment_allowed_down.sql
--
-- §1 procurement_payment_allowed: 0362's "Paid without an approved amount" rule, plus a closed purchase and a purchase
--    awaiting approval (Requested) refused outright. Asked by the ERP payment dispatch (paymentGate.ts), the Paid update
--    guard (§2) and the outbox claim (§4), so the three cannot disagree.
-- §2 guard_procurement_approved_total: 0362 §2 body; its Paid branch asks §1 (every 0362 conjunct is inside §1).
-- §3 procurement_gate_violation: 0360 body plus a Requested purchase refusing every ERP write kind (awaiting_approval);
--    procurement_gate_message: 0360 body plus that code's message.
-- §4 claim_outbox_for_commit: 0262 §6b body plus a purchase-payment branch that re-checks a queued payment under a row
--    lock on its purchase.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the payment rule. Null = allowed; otherwise a reason code. The approved-amount ceiling is a separate question
--      (procurement_payment_within_ceiling), asked whenever an approved amount exists.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create function public.procurement_payment_allowed(p_procurement_id uuid) returns text
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
revoke all on function public.procurement_payment_allowed(uuid) from public, anon, authenticated;
grant execute on function public.procurement_payment_allowed(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — the procurement update guard: 0362 §2 body; the Paid branch's approval rule now asks §1 (lines marked 0368).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — the org purchase rules: 0360 bodies plus the lines marked 0368.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.procurement_gate_message(p_code text) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select case p_code
    when 'gate_request_before_order'    then 'Your organization requires a purchase request before an order.'
    when 'gate_approval_before_order'   then 'Your organization requires an approval before an order.'
    when 'gate_receipt_before_invoice'  then 'Your organization requires a goods receipt before a vendor invoice.'
    when 'gate_approval_before_payment' then 'Your organization requires an approval before payment.'
    when 'awaiting_approval'            then 'This purchase is awaiting approval. Record its documents after it is approved.'  -- 0368
    else p_code end
$$;

create or replace function public.procurement_gate_violation(p_procurement_id uuid, p_step public.procurement_status)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  if not found or (auth.uid() is not null and v_row.org_id is distinct from public.auth_org_id()) then
    return 'purchase_not_found';
  end if;
  -- 0368: a purchase awaiting approval (Requested, including one a quote re-opened) takes no document of any kind —
  -- an order, receipt, invoice or payment would skip the pending approval.
  if v_row.status = 'Requested' then return 'awaiting_approval'; end if;                                 -- 0368
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

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — 0262 §6b's claim_outbox_for_commit, verbatim, plus the purchase-payment branch marked 0368. A queued ERP
-- payment (pending, or failed and revived) is re-checked when claimed: the purchase may have been cancelled, re-opened
-- or re-billed since dispatch, and the sweep's replay re-checks only the actor's role (authGuard.ts). Under a row lock on
-- the purchase: the payment rule (§1), the recorded actor is not one of its approvers, and the approved-amount ceiling.
-- A refusal is a raise (the timesheet/revenue branches' pattern): the row is never claimed, keeps its state, and the
-- caller records the named reason. A quarantined row is not re-gated: its claim only probes, then adopts the landed
-- Payment Entry or holds the row — a Payment Entry is never reissued (C-1, mutable anchor) — so refusing it would only
-- strand an ERP payment PMO cannot see. Lock order: outbox row, then the purchase (nothing locks them the other way).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
    v_proc public.procurements;                                                                          -- 0368
    v_refusal text;                                                                                      -- 0368
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
    -- ⚑ 0368 (#1319): a queued purchase payment is re-checked against its purchase (see the §4 header).
    if v_domain = 'procurement' then                                                                     -- 0368
      select * into v_row from public.external_command_outbox where id = p_id for update;
      if v_row.state in ('pending','failed') and v_row.operation = 'create'
         and v_row.payload ->> 'erp_doc_kind' = 'payment' then
        if coalesce(v_row.payload ->> 'procurementId', '') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
          select * into v_proc from public.procurements
           where id = (v_row.payload ->> 'procurementId')::uuid and org_id = v_row.org_id for update;
        end if;
        if v_proc.id is null then
          v_refusal := 'purchase_not_found';
        else
          v_refusal := public.procurement_payment_allowed(v_proc.id);
        end if;
        if v_refusal is null and v_row.actor_user_id is null then
          v_refusal := 'actor_missing';
        elsif v_refusal is null
              and (v_row.actor_user_id = v_proc.approved_by_id or v_row.actor_user_id = v_proc.amount_approved_by_id) then
          v_refusal := 'separation_of_duties';
        elsif v_refusal is null and (v_proc.approved_by_id is not null or v_proc.approved_total_value is not null)
              and not coalesce((select c.ok from public.procurement_payment_within_ceiling(v_proc.id) c), false) then
          v_refusal := 'exceeds_approved_amount';
        end if;
        if v_refusal is not null then
          raise exception 'procurement-payment-refused: %', v_refusal using errcode = 'P0001', detail = v_refusal;
        end if;
      end if;
    end if;                                                                                              -- 0368
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
