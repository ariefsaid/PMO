-- Roll back 0284's item rollup and restore the pre-0284 procurement routing fence and transition RPC.
drop trigger if exists procurement_items_sync_total on public.procurement_items;
drop function if exists public.sync_procurement_item_total();
drop function if exists public.reconcile_procurement_line_totals();

create or replace function public.assert_procurement_routing_inputs_frozen() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() or old.status in ('Draft','Rejected') then return new; end if;
  if new.project_id is distinct from old.project_id then
    raise exception 'procurements.project_id cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  if new.budget_category is distinct from old.budget_category then
    raise exception 'procurements.budget_category cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  if new.total_value is distinct from old.total_value then
    raise exception 'procurements.total_value cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  if new.currency is distinct from old.currency then
    raise exception 'procurements.currency cannot change after the request is submitted: approval routing was decided on it' using errcode = '42501';
  end if;
  return new;
end; $$;

create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from        procurement_status;
  v_org         uuid;
  v_requester   uuid;
  v_approver    uuid;
  v_project     uuid;                    -- 0243
  v_category    public.budget_category;  -- 0243
  v_currency    text;                    -- 0243
  v_amount      numeric;                 -- 0243
  v_route       record;                  -- 0243
  v_role        user_role := auth_role();
  v_uid         uuid      := auth.uid();
  v_is_admin    boolean;
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled'),
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled'),
    'Vendor Quoted',   jsonb_build_array('Quote Selected','Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled'),
    'Ordered',         jsonb_build_array('Received','Cancelled'),
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled'),
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array()
  );
  v_allowed_roles text[];
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller. public.capture_vendor_invoice also calls this, but it
  -- is itself a definer invoked under the caller's JWT, so auth.uid() flows through unchanged.
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select status, org_id, requested_by_id, approved_by_id,
         project_id, budget_category, currency                       -- 0243
    into v_from, v_org, v_requester, v_approver,
         v_project, v_category, v_currency                           -- 0243
    from public.procurements where id = p_id for update;
  if v_from is null then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver): the requester may not Approve/Reject their own procurement.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-approve (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;

  -- SoD-b (approver ≠ payer): the approver may not mark their own approved procurement Paid.
  -- SECURITY: this check MUST run OUTSIDE the Admin-skip — Admin cannot self-pay (OD-PROC-8).
  if v_from = 'Vendor Invoiced' and p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0243 (#803, FR-APR-010…019): approval routing by budget. Narrows who may decide; never widens.
  -- The line lock serializes concurrent approvals on one (project, category) so two cannot both spend
  -- the same headroom (FR-APR-018). The classify statement below runs AFTER the lock is held, so its
  -- snapshot sees any approval that committed while we waited (READ COMMITTED, volatile caller).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') then                         -- 0243
    if v_project is not null and v_category is not null then                               -- 0243
      perform pg_advisory_xact_lock(                                                       -- 0243
        hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0)); -- 0243
    end if;                                                                                -- 0243
    v_amount := public.procurement_request_amount(p_id);                                   -- 0243
    select * into v_route                                                                  -- 0243
      from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester, -- 0243
             v_uid, public.procurement_submitted_at(p_id));                                -- 0243
    -- coalesce: a NULL here must refuse, never pass (an `if` on NULL does not fire). A NULL route is  -- 0243
    -- treated as the senior route (DD-APR-5): only a named approver or an Admin passes.  -- 0243
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin                      -- 0243
       and not coalesce(v_uid = any (v_route.approver_ids), false) then                    -- 0243
      if v_route.route = 'admin' then                                                      -- 0243
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', -- 0243
          v_route.reason using errcode = '42501';                                          -- 0243
      end if;                                                                              -- 0243
      raise exception 'approval routing: % requires a named approver',                    -- 0243
        coalesce(v_route.reason, 'unknown') using errcode = '42501';                       -- 0243
    end if;                                                                                -- 0243
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,             -- 0243
      jsonb_build_object(                                                                  -- 0243
        'to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,                -- 0243
        'request_amount', v_amount, 'line_budget', v_route.line_budget,                    -- 0243
        'line_used', v_route.line_used, 'budget_category', v_category::text,               -- 0243
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin         -- 0243
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));    -- 0243
  end if;                                                                                  -- 0243

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          -- 0268 (OD-PROC-1): submit is the requester's act; Admin keeps break-glass via the skip above.
          when v_from = 'Draft'           and p_to = 'Requested'       then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested'       and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'        and p_to = 'Draft'           then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'        and p_to = 'Vendor Quoted'   then array['Project Manager','Finance']
          when v_from = 'Approved'        and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Vendor Quoted'   and p_to = 'Quote Selected'  then array['Project Manager','Finance']
          when v_from = 'Quote Selected'  and p_to = 'Ordered'         then array['Project Manager','Finance']
          when v_from = 'Ordered'         and p_to = 'Received'        then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when v_from = 'Received'        and p_to = 'Vendor Invoiced' then array['Finance']
          when v_from = 'Vendor Invoiced' and p_to = 'Paid'            then array['Finance']
          else array[]::text[]
        end;
      end if;

      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- Atomic single update: + FR-FIN-DEBT-002 vendor_invoiced_at stamp (fires ONLY on →'Vendor Invoiced',
  -- coalesce so a re-entry can't blank it; mirrors the approved_by_id/pr_number conditional stamps).
  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected' then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to = 'Vendor Invoiced' then now() else vendor_invoiced_at end,
    updated_at         = now()
  where id = p_id;

  -- FR-PR-016 / OQ-3: write the just-minted number onto the owning RECORD row (idempotent per [PD-3]).
  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_requests pr
                        where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.purchase_orders po
                        where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    insert into public.payments (procurement_id, pay_number, status, date, amount)
    select p_id, next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date, p.total_value
      from public.procurements p
     where p.id = p_id
       and not exists (select 1 from public.payments pay where pay.procurement_id = p_id);
  end if;

  -- [PD-7 / FR-PR-025] append this transition to the status-event log (append-only; actor = caller).
  -- v_from = current status captured BEFORE the status update above (same value SoD/map validation read).
  -- v_org = the RPC's existing org local.
  insert into public.procurement_status_events
    (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;
