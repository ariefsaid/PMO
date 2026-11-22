-- 1842_purchase_order_job_roles.sql — roles that decide (b): a person who fills an ordering job role raises and sends a purchase order.
-- Spec docs/specs/roles-that-decide.spec.md §2.3 (FR-RTD-008..010). Proven by supabase/tests/roles_that_decide_purchasing.test.sql.
-- Money path: ships in its own commit. Rollback: supabase/migrations/rollback/1842_purchase_order_job_roles_down.sql
--
-- purchase_order_settings.order_job_roles: the built-in roles that may order IN ADDITION to today's levels. Empty (the default, every
-- existing organisation) = today. A BEFORE trigger holds the rules on every write path (the RPC and the existing Admin table policy):
-- each key is a catalogue key and not a field (light) role, and a non-empty list needs built-in roles on.
-- actor_may_order_purchases(): the ONE gate for the right — the real signed-in person fills one of their organisation's ordering job
-- roles (holds_job_role, 1840). Every channel calls it, ORed with the existing level rule, never replacing it:
--   create_purchase_order (0712 + 1530 guard) · transition_procurement to Ordered (1580, which carries the 1461 guard) · purchase_orders_insert /
--   purchase_orders_update (0646 text at head) · the read scopes in 1843.
-- A job-role orderer orders only an approved purchase (Approved or Quote Selected for the transition; also Vendor Quoted and Ordered
-- for recording the order document). Approvals, receipts, bills and payments are untouched.
-- drops: create_purchase_order's combined org-or-level refusal and transition_procurement's single role refusal — each split so the
--        ordering job role and its two worded refusals sit beside today's rule.

alter table public.purchase_order_settings add column order_job_roles text[] not null default array[]::text[];
comment on column public.purchase_order_settings.order_job_roles is
  'roles-that-decide FR-RTD-009: built-in role keys whose holders (holds_job_role) may raise and send purchase orders in addition '
  'to today''s levels. Empty = today.';

create function public.guard_purchase_order_job_roles() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and new.order_job_roles is not distinct from old.order_job_roles then return new; end if;
  new.order_job_roles := coalesce(array(select distinct k from unnest(new.order_job_roles) k order by k), array[]::text[]);
  if cardinality(new.order_job_roles) = 0 then return new; end if;
  if exists (select 1 from unnest(new.order_job_roles) k
              left join public.built_in_roles r on r.key = k
             where r.key is null or r.tier = 'field') then                                             -- mut:order_roles_valid
    raise exception 'PO_ORDER_ROLE_INVALID: choose built-in roles from the list; a field role cannot order' using errcode = '23514';
  end if;
  if not public.org_built_in_roles_enabled(new.org_id) then                                            -- mut:order_roles_setting
    raise exception 'PO_JOB_ROLE_OFF: turn on built-in roles before naming roles that order' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.guard_purchase_order_job_roles() from public, anon, authenticated;
create trigger purchase_order_settings_job_roles_guard
  before insert or update of order_job_roles on public.purchase_order_settings
  for each row execute function public.guard_purchase_order_job_roles();

create function public.actor_may_order_purchases() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select bool_or(public.holds_job_role(auth.uid(), k))
      from public.purchase_order_settings s cross join lateral unnest(s.order_job_roles) k
     where s.org_id = public.auth_org_id()), false)
$$;
comment on function public.actor_may_order_purchases() is
  'roles-that-decide FR-RTD-009: the one gate for ordering by job role. Real signed-in person, never the view-as role.';
revoke all on function public.actor_may_order_purchases() from public, anon;
grant execute on function public.actor_may_order_purchases() to authenticated, service_role;

create function public.po_set_order_job_roles(p_keys text[]) returns text[]
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_uid uuid := auth.uid(); v_keys text[];
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if public.auth_role() is distinct from 'Admin' then                                                  -- mut:order_roles_admin
    raise exception 'PO_ADMIN_ONLY: only an Admin can change purchase order settings' using errcode = '42501';
  end if;
  insert into public.purchase_order_settings (org_id, order_job_roles, updated_by, updated_at)
  values (v_org, coalesce(p_keys, array[]::text[]), v_uid, now())
  on conflict (org_id) do update set order_job_roles = excluded.order_job_roles, updated_by = excluded.updated_by, updated_at = now()
  returning order_job_roles into v_keys;
  perform public.log_audit('purchase_order.order_job_roles_set', v_org, v_uid, null, jsonb_build_object('order_job_roles', to_jsonb(v_keys)));
  return v_keys;
end $$;
revoke all on function public.po_set_order_job_roles(text[]) from public, anon;
grant execute on function public.po_set_order_job_roles(text[]) to authenticated;

-- ── create_purchase_order: 0712 body (with the 1530 guard line); the role check gains the ordering job role ────────────
create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders; v_currency text; v_po_number text; v_status public.procurement_status;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, currency, po_number, status into v_org, v_currency, v_po_number, v_status
    from public.procurements where id = p_procurement_id for update;   -- 0712: serializes with transition_procurement
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  -- 1842 roles-that-decide FR-RTD-009/010: today's four levels, or a person who fills an ordering job role on an approved purchase.
  if auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    if not public.actor_may_order_purchases() then                                                     -- mut:raise_gate
      raise exception 'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders'
        using errcode = '42501';
    end if;
    if v_status not in ('Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered') then                 -- mut:raise_approved
      raise exception 'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered'
        using errcode = '42501';
    end if;
  end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  -- 0712: the order the transition minted (this purchase's PO number, nothing captured on it) is completed, not duplicated.
  if v_po_number is not null and p_import_key is null then
    update public.purchase_orders
       set reference_number = p_reference_number, status = coalesce(p_status, 'Draft'), date = p_date, amount = p_amount,
           external_ref = nullif(btrim(p_external_ref), ''), currency = v_currency
     where id = (select o.id from public.purchase_orders o
                  where o.procurement_id = p_procurement_id and o.po_number = v_po_number
                    and o.reference_number is null and o.amount is null and o.import_key is null
                    and o.external_ref is null and o.status = 'Issued'
                  order by o.created_at limit 1 for update)
    returning * into v_row;
    if found then return v_row; end if;
  end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref, currency)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''), v_currency)
    returning * into v_row;
  return v_row;
end; $$;

-- ── transition_procurement: 1580 body (the latest; it keeps the 1461 guard line); only the role refusal changes ──────────────────────
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_pr_id uuid; v_pr_no text;                                                                          -- 0766
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_wo uuid; v_disc uuid;                                                               -- 1580
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
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency, work_order_id, discipline_id   -- 1580
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency, v_wo, v_disc
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
      -- 1017: whole-project test lock, taken before the line lock (project -> line, everywhere).
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
        -- 1842 roles-that-decide FR-RTD-009/010: a person who fills one of the organisation's ordering job roles orders an
        -- approved purchase; never one that skipped approval. Everyone else meets today's refusal, worded for ordering.
        if p_to = 'Ordered' and public.actor_may_order_purchases() then                              -- mut:order_gate
          if v_from not in ('Approved', 'Quote Selected') then                                        -- mut:order_approved
            raise exception 'PO_ORDER_NOT_APPROVED: this purchase has not been approved yet, so it cannot be ordered'
              using errcode = '42501';
          end if;
        elsif p_to = 'Ordered' then
          raise exception 'PO_ORDER_FORBIDDEN: you cannot order purchases; ask an Admin to name your built-in role as one that orders'
            using errcode = '42501';
        else
          raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
        end if;
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
    insert into public.purchase_requests (procurement_id, pr_number, status, date, work_order_id, discipline_id)   -- 1580: the request carries its cost attribution
    select p_id, p.pr_number, 'Submitted', current_date,
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date, work_order_id, discipline_id)   -- 1580: the order carries it too
    select p_id, p.po_number, 'Issued', current_date,
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
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

-- ── purchase_orders write policies: the 0646 text at head, the level list ORed with the gate on an approved purchase ──
alter policy purchase_orders_insert on public.purchase_orders
  with check (
    ((org_id = (select public.auth_org_id())) AND (select public.is_active_member()) AND (((select public.auth_role()) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR ((select public.actor_may_order_purchases()) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.status = ANY (ARRAY['Approved'::procurement_status, 'Vendor Quoted'::procurement_status, 'Quote Selected'::procurement_status, 'Ordered'::procurement_status]))))))) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.org_id = (select public.auth_org_id()))))) AND (NOT domain_externally_owned((select public.auth_org_id()), 'procurement'::text)) AND org_feature_enabled((select public.auth_org_id()), 'procurement'::text))
  );
alter policy purchase_orders_update on public.purchase_orders
  using (
    ((org_id = (select public.auth_org_id())) AND (select public.is_active_member()) AND (((select public.auth_role()) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR ((select public.actor_may_order_purchases()) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.status = ANY (ARRAY['Approved'::procurement_status, 'Vendor Quoted'::procurement_status, 'Quote Selected'::procurement_status, 'Ordered'::procurement_status]))))))) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.org_id = (select public.auth_org_id()))))) AND org_feature_enabled((select public.auth_org_id()), 'procurement'::text))
  )
  with check (
    ((org_id = (select public.auth_org_id())) AND (select public.is_active_member()) AND (((select public.auth_role()) = ANY (ARRAY['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role])) OR ((select public.actor_may_order_purchases()) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.status = ANY (ARRAY['Approved'::procurement_status, 'Vendor Quoted'::procurement_status, 'Quote Selected'::procurement_status, 'Ordered'::procurement_status]))))))) AND (EXISTS ( SELECT 1
   FROM procurements p
  WHERE ((p.id = purchase_orders.procurement_id) AND (p.org_id = (select public.auth_org_id()))))) AND org_feature_enabled((select public.auth_org_id()), 'procurement'::text))
  );
