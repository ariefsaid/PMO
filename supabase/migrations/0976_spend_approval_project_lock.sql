-- 0976_spend_approval_project_lock.sql — an approval takes a project-wide lock before its budget-line lock.
-- Rollback: supabase/migrations/rollback/0976_spend_approval_project_lock_down.sql.
-- Redefines public.transition_procurement (from 0868), public.transition_expense_claim (from 0855),
--          public.approve_procurement_amount (from 0349) and public.decide_po_variation (from 0474), each the
--          highest migration that defines it; the only change in each is the one project lock statement.
--
-- The whole-project test reads every line of the project, so approval decisions serialize on the project.
--
-- Lock order, in all four callers and nowhere else: project lock, then line lock (then the float and PO locks as
-- before). Every other writer takes the line lock alone and never asks for a project lock while holding one, so a
-- wait chain cannot close into a cycle.

create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_pr_id uuid; v_pr_no text;                                                                          -- 0766
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled','Ordered','Received','Vendor Invoiced','Paid'),   -- 0362 skips
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled','Received','Vendor Invoiced','Paid'), -- 0362 skips
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled','Received','Vendor Invoiced','Paid'),               -- 0362 skips
    'Ordered',         jsonb_build_array('Received','Cancelled','Vendor Invoiced','Paid'),                         -- 0362 skips
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled','Paid'),                                    -- 0362 skip
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array());
  v_allowed_roles text[];
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- FR-PLN-006 closure: cancelling or rejecting an EXISTING purchase is a CLOSING transition (paid closes
  -- an already-invoiced one); a switch-off must not strand it. Every forward/minting transition is gated.
  if p_to is null or p_to::text not in ('Cancelled','Rejected','Paid') then
    perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  end if;

  if exists(select 1 from public.procurements where id=p_id and record_only) then
    v_gate := public.record_only_step_refusal(p_id,case p_to::text when 'Ordered' then 'purchase-order' when 'Received' then 'goods-receipt' when 'Vendor Invoiced' then 'purchase-invoice' when 'Paid' then 'paid' when 'Cancelled' then 'cancel' else 'unknown' end,null);
    if v_gate is not null then raise exception '%' ,v_gate using errcode='42501'; end if;
  end if;

  -- 0362 FR-PFE-006: a document step the purchase already holds is a no-op — its current step, or a lower step it
  -- has evidence for (e.g. Received, then a request for Ordered once an order is recorded).
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid')
     and (v_from = p_to
          or (public.procurement_step_rank(p_to) < public.procurement_step_rank(v_from)
              and (exists (select 1 from public.purchase_orders x where p_to = 'Ordered' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_receipts x where p_to = 'Received' and x.procurement_id = p_id)
                   or exists (select 1 from public.procurement_invoices x where p_to = 'Vendor Invoiced' and x.procurement_id = p_id
                                and coalesce(x.erp_docstatus, 1) <> 2 and x.erp_cancelled_at is null)
                   or exists (select 1 from public.procurement_erp_links l
                                join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                               where l.procurement_id = p_id and d.erp_docstatus = 1
                                 and d.erp_doctype = case p_to::text when 'Ordered' then 'Purchase Order'
                                                     when 'Received' then 'Purchase Receipt' else 'Purchase Invoice' end)))) then
    return;
  end if;

  if public.record_only_step_refusal(p_id) is not null then
    raise exception 'record_only_forward_step_refused' using errcode = '42501';
  end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;
  -- 0749 (#1607): an ERP-owned purchase places its order through the connected system, never as a PMO-only row.
  if p_to = 'Ordered' and public.domain_externally_owned(v_org, 'procurement')
     and not coalesce(public.pre_cutover_procurement(p_id), false) then
    raise exception 'This purchase is managed in your connected system. Record the purchase order to place the order there.'
      using errcode = '42501';
  end if;

  -- SoD-a (requester ≠ approver), outside the Admin skip (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;
  -- SoD-b (approver ≠ payer) on every path to Paid; the update guard re-checks it (0362, FR-PFE-016).
  if p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0362 FR-PFE-010: org purchase rules.
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then
    v_gate := public.procurement_gate_violation(p_id, p_to);
    if v_gate is not null then
      raise exception '%', public.procurement_gate_message(v_gate) using errcode = '23514', detail = v_gate;
    end if;
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') then
    if v_project is not null then
      -- 0954: whole-project test lock, taken before the line lock (project -> line, everywhere).
      perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_project::text, 0));
      if v_category is not null then
        perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
      end if;
    end if;
    v_amount := public.procurement_request_amount(p_id);
    select * into v_route from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester,
             v_uid, public.procurement_submitted_at(p_id));
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
    end if;
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  end if;

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
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when v_from = 'Ordered'   and p_to = 'Received' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  -- 0766 (#1986): a purchase request captured while the purchase was still Draft is the request this transition submits.
  if p_to = 'Requested' then
    select r.id, r.pr_number into v_pr_id, v_pr_no from public.purchase_requests r
     where r.procurement_id = p_id and r.status = 'Draft' and r.import_key is null and r.pr_number is not null
       and (select pr_number from public.procurements where id = p_id) is null
     order by r.created_at limit 1 for update;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, v_pr_no, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' and v_pr_id is not null then
    update public.purchase_requests set status = 'Submitted' where id = v_pr_id;
  elsif p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, current_date)
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date,
           coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                        - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null), p.total_value),
           p.currency
      from public.procurements p left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;

create or replace function public.transition_expense_claim(
  p_id                uuid,
  p_to                public.expense_claim_status,
  p_notes             text default null,
  p_payment_reference text default null
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_row      public.expense_claims%rowtype;
  v_uid      uuid      := auth.uid();
  v_role     user_role := auth_role();
  v_is_admin boolean;
  v_route    record;
  v_lines    int;
  v_adv      public.expense_claims%rowtype;
  v_applied  numeric   := 0;
  v_today    date;
  v_float    public.imprest_floats%rowtype;                                               -- 0423
  v_limit    numeric;                                                                      -- 0423
  v_tz       text;                                                                         -- 0423
  v_remain   numeric;                                                                      -- 0423
  v_exc      boolean   := false;                                                           -- 0423
  v_plan_by  uuid;                                                                         -- 0423
  v_out      numeric;                                                                      -- 0423
  v_legal    jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted','Cancelled'),
    'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',  jsonb_build_array('Paid','Cancelled'),
    'Rejected',  jsonb_build_array('Draft'),
    'Paid',      jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');

  select * into v_row from public.expense_claims where id = p_id for update;
  if not found then
    raise exception 'expense claim not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not (v_legal -> v_row.status::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_row.status, p_to using errcode = 'P0001';
  end if;
  if p_payment_reference is not null and p_to is distinct from 'Paid' then
    raise exception 'a payment reference belongs only to the payment step' using errcode = 'P0001';
  end if;
  if v_row.imprest_float_id is not null then                                               -- 0423
    select * into v_float from public.imprest_floats where id = v_row.imprest_float_id;    -- 0423
    if v_float.archived_at is not null and p_to in ('Approved','Paid') then                -- 0423
      raise exception 'this site float is archived: its records can no longer be approved or paid'  -- 0423
        using errcode = 'P0001';                                                           -- 0423
    end if;                                                                                -- 0423
    v_tz := coalesce((select o.default_timezone from public.organizations o                -- 0423
                       where o.id = v_row.org_id), 'UTC');                                 -- 0423
  end if;                                                                                  -- 0423

  -- SoD (DD-EXP-3), for every actor including an Admin (the OD-PROC-8 shape).
  if v_row.status = 'Submitted' and p_to in ('Approved','Rejected') and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot approve or reject their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.claimant_id then
    raise exception 'separation of duties: a claimant cannot pay their own expense claim' using errcode = '42501';
  end if;
  if p_to = 'Paid' and v_uid = v_row.approved_by_id then
    raise exception 'separation of duties: the approver cannot also pay this expense claim' using errcode = '42501';
  end if;
  -- 0423 DD-IMP-7.1: only the custodian pays a float record, so the custodian never decides one.
  if v_row.imprest_float_id is not null and v_row.status = 'Submitted'                      -- 0423
     and p_to in ('Approved','Rejected') and v_uid = v_float.custodian_id then               -- 0423
    raise exception 'separation of duties: the float''s custodian pays this record and cannot also decide it'  -- 0423
      using errcode = '42501';                                                               -- 0423
  end if;                                                                                  -- 0423

  if p_to = 'Submitted' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can submit this expense claim' using errcode = '42501';
    end if;
    if v_row.kind = 'claim' then
      select count(*) into v_lines from public.expense_claim_lines l where l.claim_id = p_id;
      if v_lines = 0 then
        raise exception 'an expense claim needs at least one line before it can be submitted' using errcode = 'P0001';
      end if;
    end if;
    if not (v_row.amount > 0) then
      raise exception 'the amount must be greater than zero before submitting' using errcode = 'P0001';
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423
      select s.procurement_limit into v_limit from public.org_imprest_settings s           -- 0423
       where s.org_id = v_row.org_id;                                                      -- 0423
      if v_limit is null or v_row.amount > v_limit then                                    -- 0423 DD-IMP-5, fail closed
        raise exception 'this is above the procurement limit of % for site cash: raise it as a procurement request instead',  -- 0423
          coalesce(v_limit::text, '(unset)') using errcode = 'P0001';                      -- 0423
      end if;                                                                              -- 0423
      if v_row.kind = 'claim' and not exists (select 1 from public.expense_claim_files f   -- 0423 OQ-IMP-4
                    where f.claim_id = p_id and f.archived_at is null) then                -- 0423
        raise exception 'a claim paid from site cash needs at least one receipt attached' using errcode = 'P0001';  -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  elsif v_row.status = 'Rejected' and p_to = 'Draft' then
    if v_uid is distinct from v_row.claimant_id then
      raise exception 'only the claimant can send a rejected expense claim back to Draft' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not ((v_row.status in ('Draft','Submitted') and v_uid = v_row.claimant_id) or v_is_admin or v_role = 'Finance') then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- #803 routing, called — never copied (ADR-0075 §3). Same lock key as transition_procurement (0243 §7) so a
    -- claim and a purchase request on one line serialize (FR-EXP-022). Classification runs AFTER the lock is held.
    if v_row.project_id is not null then
      -- 0954: whole-project test lock, taken before the line lock (project -> line, everywhere).
      perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_row.project_id::text, 0));
      if v_row.budget_category is not null then
      perform pg_advisory_xact_lock(
          hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
      end if;
    end if;
    select * into v_route
      from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_row.amount,
                                       v_row.currency, v_row.claimant_id, v_uid, v_row.submitted_at);
    -- 0423 FR-IMP-024: under the float lock (after the line lock, plan delta 5), an item that does not fit the month's
    -- remaining is an exception routed to the senior set only; the plan's own approver is excluded.  -- 0423
    if v_row.imprest_float_id is not null then                                             -- 0423
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423
      v_remain := public.imprest_remaining(v_row.imprest_float_id, v_row.imprest_month,    -- 0423
                                           v_row.budget_category);                         -- 0423
      v_exc := v_row.amount > v_remain;                                                    -- 0423
      if v_exc then                                                                        -- 0423
        select p.approved_by into v_plan_by from public.imprest_plans p                    -- 0423
         where p.float_id = v_row.imprest_float_id and p.month = v_row.imprest_month       -- 0423
           and p.status = 'Approved';                                                      -- 0423
        if v_uid = v_plan_by then                                                          -- 0423
          raise exception 'separation of duties: the approver of this month''s plan cannot decide an out-of-plan item'  -- 0423
            using errcode = '42501';                                                       -- 0423
        end if;                                                                            -- 0423
        select r.route, r.approver_ids, v_route.reason, v_route.line_budget, v_route.line_used  -- 0423
          into v_route                                                                     -- 0423
          from public.imprest_senior_route(v_row.org_id, v_row.claimant_id) r;             -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
    -- coalesce: a NULL route must refuse, never pass (DD-APR-5).
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason
          using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown')
        using errcode = '42501';
    end if;
    -- The flat floor still applies to everyone but an Admin (named approvers hold this rank by construction).
    if not v_is_admin and not public.holds_spend_approval_authority(v_role) then
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    perform public.log_audit('expense_claim.approval_route', v_row.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_row.amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_row.budget_category::text,
        'plan_exception', v_exc,                                                           -- 0423
        'plan_shortfall', case when v_exc then v_row.amount - v_remain end,                -- 0423
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  elsif p_to = 'Paid' then
    if v_row.imprest_float_id is null                                                      -- 0423 off-float: FR-EXP-024 unchanged
       and not (v_is_admin or v_role = 'Finance') then                                   -- 0423 (edited: was `if not (...)`)
      raise exception 'not authorized for transition % -> %', v_row.status, p_to using errcode = '42501';
    end if;
    -- 0423 DD-IMP-7: a float record is paid by its custodian alone, still eligible, whatever their role.
    if v_row.imprest_float_id is not null and (v_uid is distinct from v_float.custodian_id   -- 0423
       or not public.imprest_custodian_eligible(v_row.org_id, v_float.project_id, v_uid)) then  -- 0423
      raise exception 'only this site float''s custodian pays a record charged to it' using errcode = '42501';  -- 0423
    end if;                                                                                -- 0423
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    if v_row.advance_id is not null then
      -- Lock order is always claim → advance; record_expense_advance_return locks only the advance.
      select * into v_adv from public.expense_claims where id = v_row.advance_id for update;
      if v_adv.status is distinct from 'Paid' or v_adv.claimant_id is distinct from v_row.claimant_id then
        raise exception 'the linked advance is not a paid advance of this claimant' using errcode = 'P0001';
      end if;
      v_applied := least(v_row.amount, greatest(public.expense_advance_outstanding(v_row.advance_id), 0));
    end if;
    if v_row.imprest_float_id is not null then                                             -- 0423 DD-IMP-3
      perform public.imprest_lock_float(v_row.imprest_float_id);                           -- 0423 (claim → advance → float)
      v_out := case v_row.kind when 'advance' then v_row.amount else v_row.amount - v_applied end;  -- 0423
      if public.imprest_cash_book(v_row.imprest_float_id) - v_out < 0 then                 -- 0423
        raise exception 'paying % would overdraw the site float (cash on hand %): request a replenishment first',  -- 0423
          v_out, public.imprest_cash_book(v_row.imprest_float_id) using errcode = 'P0001'; -- 0423
      end if;                                                                              -- 0423
    end if;                                                                                -- 0423
  end if;

  update public.expense_claims set
    status            = p_to,
    claim_number      = case when p_to = 'Submitted'
                             then coalesce(claim_number, public.next_procurement_doc_number(org_id,
                                    case kind when 'advance' then 'ADV' else 'EXP' end))
                             else claim_number end,
    submitted_at      = case when p_to = 'Submitted' then now() else submitted_at end,
    imprest_month     = case when p_to = 'Submitted' and imprest_float_id is not null         -- 0423 OQ-IMP-8
                             then date_trunc('month', now() at time zone v_tz)::date          -- 0423
                             when p_to = 'Draft' then null else imprest_month end,            -- 0423
    is_plan_exception = case when p_to = 'Approved' then v_exc                                -- 0423
                             when p_to = 'Draft' then false else is_plan_exception end,       -- 0423
    approved_by_id    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by_id end,
    approved_at       = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    approval_notes    = case when p_to = 'Approved' then p_notes else approval_notes end,
    rejection_notes   = case when p_to = 'Rejected' then nullif(btrim(p_notes), '') when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejection_notes end,
    rejected_by = case when p_to = 'Rejected' then v_uid when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejected_by end,
    rejected_at = case when p_to = 'Rejected' then now() when p_to = 'Submitted' and v_row.status = 'Draft' then null else rejected_at end,
    paid_by_id        = case when p_to = 'Paid' then v_uid else paid_by_id end,
    paid_at           = case when p_to = 'Paid' then now() else paid_at end,
    paid_on           = case when p_to = 'Paid' then v_today else paid_on end,
    payment_reference = case when p_to = 'Paid' then nullif(btrim(p_payment_reference), '') else payment_reference end,
    advance_applied   = case when p_to = 'Paid' then v_applied else advance_applied end,
    cancelled_at      = case when p_to = 'Cancelled' then now() else cancelled_at end
  where id = p_id;

  perform public.log_audit('expense_claim.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status::text, 'to', p_to::text, 'notes', p_notes, 'advance_applied', v_applied));
end; $$;

create or replace function public.approve_procurement_amount(p_procurement_id uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid      uuid := auth.uid();
  v_role     public.user_role := public.auth_role();
  v_is_admin boolean;
  v_row      public.procurements%rowtype;
  v_ceiling  record;
  v_routed   numeric;
  v_route    record;
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select * into v_row from public.procurements where id = p_procurement_id for update;
  if not found then
    raise exception 'procurement not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status is distinct from 'Vendor Invoiced' then
    raise exception 'a higher amount can be approved only while the procurement awaits payment' using errcode = 'P0001';
  end if;

  if v_uid = v_row.requested_by_id then
    raise exception 'separation of duties: requester cannot approve the procurement amount' using errcode = '42501';
  end if;
  if v_uid = (select e.actor_id from public.procurement_status_events e
               where e.procurement_id = p_procurement_id and e.from_status = 'Vendor Quoted'::procurement_status
                 and e.to_status = 'Requested'::procurement_status
               order by e.created_at desc, e.id desc limit 1) then
    raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
  end if;
  if exists (select 1 from public.record_changes rc
               join public.procurement_invoices i on i.id = rc.entity_id
              where rc.org_id = v_row.org_id and rc.entity_type = 'procurement_invoice' and rc.op = 'insert'
                and i.procurement_id = p_procurement_id and rc.actor_id = v_uid)
     or exists (select 1 from public.procurement_status_events e
                 where e.procurement_id = p_procurement_id
                   and e.to_status = 'Vendor Invoiced'::procurement_status and e.actor_id = v_uid) then
    raise exception 'separation of duties: the bill recorder cannot approve the billed amount' using errcode = '42501';
  end if;
  if not v_is_admin and not (v_role::text = any (array['Project Manager','Finance','Executive'])) then
    raise exception 'not authorized to approve a procurement amount' using errcode = '42501';
  end if;

  select * into v_ceiling from public.procurement_payment_within_ceiling(p_procurement_id);
  if v_ceiling.reason = 'bill currency differs from procurement currency' then
    raise exception 'bill currency differs from procurement currency' using errcode = '23514';
  end if;
  if p_amount is null or not (p_amount < 'Infinity'::numeric) or p_amount < coalesce(v_ceiling.billed_net, 0) then
    raise exception 'the approved amount cannot be below the billed amount' using errcode = '23514';
  end if;
  if v_row.approved_total_value is not null and p_amount <= v_row.approved_total_value then
    raise exception 'the amount is already approved' using errcode = 'P0001';
  end if;

  if v_row.project_id is not null then
    -- 0954: whole-project test lock, taken before the line lock (project -> line, everywhere).
    perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_row.project_id::text, 0));
    if v_row.budget_category is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('spend-line:' || v_row.project_id::text || ':' || v_row.budget_category::text, 0));
    end if;
  end if;
  v_routed := greatest(p_amount - coalesce(public.procurement_request_amount(p_procurement_id), 0), 0);
  select * into v_route
    from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category, v_routed,
           v_row.currency, v_row.requested_by_id, v_uid, public.procurement_submitted_at(p_procurement_id));
  if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
     and not coalesce(v_uid = any (v_route.approver_ids), false) then
    if v_route.route = 'admin' then
      raise exception 'approval routing: % requires an Admin (no senior approver is eligible)',
        v_route.reason using errcode = '42501';
    end if;
    raise exception 'approval routing: % requires a named approver',
      coalesce(v_route.reason, 'unknown') using errcode = '42501';
  end if;

  update public.procurements
     set approved_total_value = p_amount, amount_approved_by_id = v_uid, updated_at = now()
   where id = p_procurement_id;
  perform public.log_audit('procurement.amount_approved', v_row.org_id, v_uid, p_procurement_id,
    jsonb_build_object(
      'from', v_row.approved_total_value, 'to', p_amount, 'billed_net', v_ceiling.billed_net,
      'routed_amount', v_routed, 'route', v_route.route, 'reason', v_route.reason,
      'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                      and not coalesce(v_uid = any (v_route.approver_ids), false))));
end; $$;

create or replace function public.decide_po_variation(p_id uuid, p_approve boolean, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare v public.po_variations; v_proc public.procurements; v_route record; v_uid uuid := auth.uid();
        v_role user_role := public.auth_role(); v_is_admin boolean := (v_role = 'Admin');
begin
  perform public.assert_is_active_member();
  if not v_is_admin and v_role::text not in ('Project Manager','Finance','Executive') then
    raise exception 'not authorized to decide a variation' using errcode = '42501';
  end if;
  select * into v from public.po_variations where id = p_id and org_id = public.auth_org_id();
  if not found then raise exception 'variation not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v.procurement_id for update;                  -- D5 1
  if v_proc.project_id is not null then                           -- D5 2 (0362 :226)
    -- 0954: whole-project test lock, taken before the line lock (project -> line, everywhere).
    perform pg_advisory_xact_lock(hashtextextended('spend-project:' || v_proc.project_id::text, 0));
    if v_proc.budget_category is not null then
      perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_proc.project_id::text || ':' || v_proc.budget_category::text, 0));
    end if;
  end if;
  perform public.subcontract_po_lock(v.po_id);                                                           -- D5 3
  select * into v from public.po_variations where id = p_id for update;
  if v_proc.status::text in ('Cancelled','Rejected') then                                                -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if v.status <> 'Requested' then raise exception 'only a Requested variation can be decided' using errcode = '42501'; end if;
  if v_uid = v.requested_by then                                                                         -- outside the Admin skip (OD-PROC-8)
    raise exception 'separation of duties: the requester cannot approve or reject their own variation' using errcode = '42501';
  end if;
  select * into v_route from public.spend_approval_route(v.org_id, v_proc.project_id, v_proc.budget_category, v.amount,
           v_proc.currency, v.requested_by, v_uid, v.requested_at);
  if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin and not coalesce(v_uid = any (v_route.approver_ids), false) then
    if v_route.route = 'admin' then
      raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
    end if;
    raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
  end if;
  perform set_config('pmo.po_variation_write', 'on', true);
  if p_approve then
    update public.po_variations set status = 'Approved', approved_by = v_uid, approved_at = clock_timestamp(),
           decided_by = v_uid, decided_at = clock_timestamp(), decided_notes = nullif(btrim(p_notes), '') where id = p_id;
    -- PQ-5: counts against the budget line now. The approver is recorded on the variation (procurement_amount_approver reads it);
    -- amount_approved_by_id belongs to approve_procurement_amount.
    update public.procurements set total_value = coalesce(total_value, 0) + v.amount,
           approved_total_value = case when approved_total_value is null then null else approved_total_value + v.amount end,
           updated_at = now() where id = v.procurement_id;
  else
    update public.po_variations set status = case when v.origin = 'post_work' then 'Disputed' else 'Rejected' end,
           decided_by = v_uid, decided_at = clock_timestamp(), decided_notes = nullif(btrim(p_notes), '') where id = p_id;
  end if;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit(case when p_approve then 'po_variation.approve' else 'po_variation.reject' end, v.org_id, v_uid, p_id,
    jsonb_build_object('route', v_route.route, 'reason', v_route.reason, 'amount', v.amount, 'line_budget', v_route.line_budget,
      'line_used', v_route.line_used, 'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
        and not coalesce(v_uid = any (v_route.approver_ids), false))));
end $$;
