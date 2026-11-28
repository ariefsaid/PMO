-- Restore prior defaults and functions.
alter table public.organizations alter column quantity_change_approver_roles set default array[]::text[];
create or replace function public.guard_purchase_order_job_roles() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
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
  if public.org_hide_prices_enabled(new.org_id) and exists (select 1 from unnest(new.order_job_roles) k
              where not public.built_in_role_sees_prices(k)) then                                         -- 2701 mut:order_roles_prices
    raise exception 'PO_ORDER_ROLE_NO_PRICES: while prices are hidden, only built-in roles that see prices can order' using errcode = '23514';
  end if;
  return new;
end $$;

update public.purchase_order_settings set order_job_roles = array[]::text[] where order_job_roles is null;
alter table public.purchase_order_settings alter column order_job_roles set default array[]::text[];
alter table public.purchase_order_settings alter column order_job_roles set not null;
create or replace function public.po_set_order_job_roles(p_keys text[]) returns text[]
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
create or replace function public.actor_may_order_purchases() returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select bool_or(public.holds_job_role(auth.uid(), k)
                   and public.actor_built_in_role() is not distinct from k)                             -- mut:order_holds_key
      from public.purchase_order_settings s cross join lateral unnest(s.order_job_roles) k
     where s.org_id = public.auth_org_id()), false)
$$;

-- Default purchase approvers: restore the earlier routing.
drop function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, uuid);
drop function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb, uuid);
create or replace function public.spend_approval_route_from_figures(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid,
  p_decider_id   uuid,
  p_submitted_at timestamptz,
  p_figures      jsonb
) returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_reason       text;
  v_budget       numeric;
  v_used         numeric;
  v_currency     text;
  v_foreign      boolean;
  v_rows         int;
  v_eligible     uuid[];
  v_version      uuid;
  v_activated_at timestamptz;
  v_p_rows       int;
  v_p_ids        uuid[];
  v_rec          jsonb;
begin
  if p_figures is null then
    raise exception 'spend_approval_route_from_figures requires figures' using errcode = '22004';
  end if;

  -- 1. Classify (DD-APR-2). A missing or negative amount can never be "within" (DD-APR-5).
  if p_project_id is null then
    v_reason := 'no_project';
  elsif p_category is null then
    v_reason := 'no_category';
  elsif p_amount is null or p_amount < 0 then
    v_reason := 'amount_invalid';
  else
    select v.id, v.currency, v.activated_at into v_version, v_currency, v_activated_at
      from public.budget_versions v
     where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active';
    if not found then
      v_reason := 'no_active_budget';
    else
      select coalesce(sum(li.budgeted_amount), 0) into v_budget
        from public.budget_line_items li
        join public.budget_versions v on v.id = li.budget_version_id
       where v.org_id = p_org_id and v.project_id = p_project_id and v.status = 'Active'
         and li.category = p_category;
      if p_currency is distinct from v_currency then
        v_reason := 'currency_mismatch';
      elsif not (public.is_active_member() and public.holds_spend_approval_authority(public.auth_role())) then
        v_reason := 'spending_not_visible';
      else
        v_rec := p_figures->'recorded'->(p_category::text);
        -- Line used = recorded spending + reserved + open orders + claims not in recorded spending.
        v_used := (v_rec->>'amount')::numeric + (p_figures->>'other_used')::numeric;
        v_foreign := coalesce((p_figures->>'foreign')::boolean, false);
        -- Explicit `<=` for "within": anything not provably within (a NULL included) is not within.
        if not (p_figures ? 'basis') or not (p_figures ? 'other_used') then
          v_reason := 'spending_unknown';
        elsif (p_figures->>'ledger_currency') is distinct from v_currency or v_foreign
              or coalesce((p_figures->>'proj_foreign')::boolean, false) then
          v_reason := 'currency_mismatch';
        elsif (v_rec->>'mapped')::boolean is not true or v_used is null
              or (p_figures->>'proj_budget') is null or (p_figures->>'proj_spent') is null
              or (p_figures->>'proj_open') is null then
          v_reason := 'spending_unknown';
        elsif not (v_used + p_amount <= v_budget) then
          v_reason := 'exceeds_line';
        elsif (p_figures->>'proj_budget')::numeric - (p_figures->>'proj_spent')::numeric
              - (p_figures->>'proj_open')::numeric - (p_figures->>'proj_reserved')::numeric - p_amount < 0 then
          v_reason := 'exceeds_project';
        elsif (p_submitted_at is not null and v_activated_at > p_submitted_at)
           -- DD-APR-3: the budget the request fits must not have been set by the decider, or after submission.
           or (p_decider_id is not null and exists (
                 select 1 from public.audit_events a
                  where a.org_id = p_org_id and a.entity_id = v_version
                    and a.action = 'budget_version.update'
                    and a.detail->>'to_status' = 'Active'
                    and a.detail->>'from_status' is distinct from 'Active'
                    and a.actor_id = p_decider_id))
        then
          v_reason := 'budget_changed';
        else
          v_reason := 'within_budget';
        end if;
      end if;
    end if;
  end if;

  -- 1b. Below approval rank: no figures; everyone who could decide (the project's approvers and the senior set).
  if v_reason = 'spending_not_visible' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_p_rows, v_p_ids
      from public.spend_approvers_for_amount(p_org_id, p_project_id, p_amount, p_currency) sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers_for_amount(p_org_id, null::uuid, p_amount, p_currency) sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id is null;
    -- No project approver → flat. A project approver but no senior set → the project's approvers alone (the
    -- senior outcome falls to them, never wider); nobody eligible → an Admin. Both configured → both sets together.
    if v_p_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], null::numeric, null::numeric;
      return;
    elsif v_rows = 0 then
      if cardinality(v_p_ids) > 0 then
        return query select 'project'::text, v_reason, v_p_ids, null::numeric, null::numeric;
      else
        return query select 'admin'::text, v_reason, '{}'::uuid[], null::numeric, null::numeric;
      end if;
      return;
    end if;
    select coalesce(array_agg(distinct x order by x), '{}') into v_eligible from unnest(v_p_ids || v_eligible) x;
    if cardinality(v_eligible) > 0 then
      return query select 'org'::text, v_reason, v_eligible, null::numeric, null::numeric;
    else
      return query select 'admin'::text, v_reason, '{}'::uuid[], null::numeric, null::numeric;
    end if;
    return;
  end if;

  -- 2. Within budget → the project's approvers (FR-APR-012/013/014).
  if v_reason = 'within_budget' then
    select count(*),
           coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester_id
               and pf.status = 'active'
               and pf.org_id = p_org_id
               and public.holds_spend_approval_authority(pf.role)), '{}')
      into v_rows, v_eligible
      from public.spend_approvers_for_amount(p_org_id, p_project_id, p_amount, p_currency) sa
      join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org_id and sa.project_id = p_project_id;
    if v_rows = 0 then
      return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;  -- unconfigured
      return;
    elsif cardinality(v_eligible) > 0 then
      return query select 'project'::text, v_reason, v_eligible, v_budget, v_used;
      return;
    end if;
    -- configured, nobody eligible → escalate to the senior set (FR-APR-014)
  end if;

  -- 3. The senior set (FR-APR-012/015). DD-APR-4: the flat matrix applies only when no senior set is
  -- configured at all; a configured set with nobody eligible leaves the decision to an Admin.
  select count(*),
         coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_rows, v_eligible
    from public.spend_approvers_for_amount(p_org_id, null::uuid, p_amount, p_currency) sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id is null;
  if cardinality(v_eligible) > 0 then
    return query select 'org'::text, v_reason, v_eligible, v_budget, v_used;
    return;
  elsif v_rows > 0 then
    return query select 'admin'::text, v_reason, '{}'::uuid[], v_budget, v_used;
    return;
  end if;
  -- No senior set: the senior outcome falls to the project's named approvers, never to everyone; flat only when the
  -- project has none either. Nobody eligible among them → an Admin.
  select count(*),
         coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
           where sa.profile_id is distinct from p_requester_id
             and pf.status = 'active'
             and pf.org_id = p_org_id
             and public.holds_spend_approval_authority(pf.role)), '{}')
    into v_p_rows, v_p_ids
    from public.spend_approvers_for_amount(p_org_id, p_project_id, p_amount, p_currency) sa
    join public.profiles pf on pf.id = sa.profile_id
   where sa.org_id = p_org_id and sa.project_id = p_project_id;
  if v_p_rows > 0 then
    if cardinality(v_p_ids) > 0 then
      return query select 'project'::text, v_reason, v_p_ids, v_budget, v_used;
    else
      return query select 'admin'::text, v_reason, '{}'::uuid[], v_budget, v_used;
    end if;
    return;
  end if;
  return query select 'flat'::text, v_reason, null::uuid[], v_budget, v_used;
end; $$;
revoke all on function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb) to authenticated;
comment on function public.spend_approval_route_from_figures(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz, jsonb) is
  'DISPLAY ONLY. The route logic over figures read once for a list (get_procurement_approval_routes, get_expense_claim_approval_routes). It reads no spending figure itself and decides who may see figures from the caller''s real rank. Every decision, notification and eligibility check calls spend_approval_route, which reads its own figures.';
create or replace function public.spend_approval_route(
  p_org_id       uuid,
  p_project_id   uuid,
  p_category     public.budget_category,
  p_amount       numeric,
  p_currency     text,
  p_requester_id uuid,
  p_decider_id   uuid        default null,
  p_submitted_at timestamptz default null
) returns table (route text, reason text, approver_ids uuid[], line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select r.route, r.reason, r.approver_ids, r.line_budget, r.line_used
    from public.spend_approval_route_from_figures(p_org_id, p_project_id, p_category, p_amount, p_currency,
           p_requester_id, p_decider_id, p_submitted_at,
           case when p_project_id is not null and p_category is not null and p_amount >= 0
                     and public.is_active_member() and public.holds_spend_approval_authority(public.auth_role())
                then coalesce((select f.figures from public.spend_approval_project_figures(array[p_project_id]) f), '{}'::jsonb)
                     || coalesce((select l.figures from public.spend_approval_line_figures(array[p_project_id]) l where l.category = p_category),
                                 '{"other_used":0,"foreign":false}'::jsonb)
                else '{}'::jsonb end) r
$$;
revoke all on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.spend_approval_route(uuid, uuid, public.budget_category, numeric, text, uuid, uuid, timestamptz) to authenticated;
create or replace function public.get_procurement_approval_routes(p_ids uuid[])
returns table (procurement_id uuid, route text, reason text, approvers jsonb,
               request_amount numeric, line_budget numeric, line_used numeric)
  language sql stable security invoker set search_path = public, pg_temp as $$
  with req as materialized (
    select p.id, p.org_id, p.project_id, p.budget_category, p.currency, p.requested_by_id, p.total_value
      from public.procurements p
     where p.id = any (p_ids) and p.status = 'Requested'
  ), it as materialized (
    select i.procurement_id, sum(i.amount) as total, bool_or(i.amount < 0) as has_negative
      from public.procurement_items i
     where i.procurement_id in (select id from req)
     group by i.procurement_id
  ), ev as materialized (
    select e.procurement_id, max(e.created_at) as submitted_at
      from public.procurement_status_events e
     where e.to_status = 'Requested' and e.procurement_id in (select id from req)
     group by e.procurement_id
  ), amt as materialized (
    select req.*, a.amount, ev.submitted_at
      from req
      left join it on it.procurement_id = req.id
      left join ev on ev.procurement_id = req.id
      -- Same CASE as procurement_request_amount (0243): a negative header or line is untrustworthy -> NULL.
      cross join lateral (select case when req.total_value < 0 or coalesce(it.has_negative, false) then null
                                      else greatest(req.total_value, coalesce(it.total, 0)) end as amount) a
  ), pids as materialized (
    select array(select distinct x.project_id from amt x
                  where x.project_id is not null and x.budget_category is not null and x.amount >= 0) as ids
  ), pf as materialized (
    select f.project_id, f.figures from pids, public.spend_approval_project_figures(pids.ids) f
  ), lf as materialized (
    select l.project_id, l.category, l.figures from pids, public.spend_approval_line_figures(pids.ids) l
  )
  select amt.id, r.route, r.reason,
         coalesce((select jsonb_agg(jsonb_build_object('id', pf2.id, 'full_name', pf2.full_name) order by pf2.full_name)
                     from public.profiles pf2 where pf2.id = any (r.approver_ids)), '[]'::jsonb),
         amt.amount, r.line_budget, r.line_used
    from amt
    left join pf on pf.project_id = amt.project_id
    left join lf on lf.project_id = amt.project_id and lf.category = amt.budget_category
    -- Decider = the viewer, unless the viewer is the requester (who never decides: SoD-a).
    cross join lateral public.spend_approval_route_from_figures(
           amt.org_id, amt.project_id, amt.budget_category, amt.amount, amt.currency, amt.requested_by_id,
           nullif(auth.uid(), amt.requested_by_id), amt.submitted_at,
           case when pf.project_id is not null and amt.budget_category is not null and amt.amount >= 0
                then pf.figures || coalesce(lf.figures, '{"other_used":0,"foreign":false}'::jsonb)
                else '{}'::jsonb end) r
$$;
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public, pg_temp as $$
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

  if v_from='Requested' and p_to in ('Approved','Rejected')
    and (public.equipment_plan_purchase_submit_context(p_id)->>'is_submitter')::boolean then
    raise exception 'separation of duties: submitter cannot approve own procurement' using errcode='42501';
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

  if v_from = 'Ordered' and p_to = 'Received' then
    if not public.delivery_record_may_decide(p_id) then
      raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
    end if;
  elsif not v_is_admin then
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
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester or (public.equipment_plan_purchase_submit_context(p_id)->>'may_submit')::boolean then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        -- 1842 roles-that-decide FR-RTD-009/010: a person who fills one of the organisation's ordering job roles orders an
        -- approved purchase; never one that skipped approval. Everyone else meets today's refusal, worded for ordering.
        if v_from = 'Approved' and p_to = 'Vendor Quoted' and public.actor_may_order_purchases() then
          null; -- the ordering right also starts sourcing
        elsif p_to = 'Ordered' and public.actor_may_order_purchases() then                              -- mut:order_gate
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
    select p_id, p.pr_number, 'Submitted', public.native_org_today(v_org),
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date, work_order_id, discipline_id, amount)   -- the order carries the selected quote
    select p_id, p.po_number, 'Issued', public.native_org_today(v_org),
           case when exists (select 1 from public.work_orders w where w.id = v_wo and w.status <> 'Cancelled') then v_wo end, v_disc,
           (select q.total_amount from public.procurement_quotations q where q.procurement_id = p_id and q.is_selected)
      from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, public.native_org_today(v_org))
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', public.native_org_today(v_org),
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
drop function public.purchase_default_approver_ids(uuid, uuid, uuid, uuid);
create or replace function public.seed_purchase_types(p_org uuid) returns void
  language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  insert into public.purchase_types (org_id, name, name_id, is_rental, position)
  select p_org, v.name, v.name_id, v.is_rental, v.position
    from (values ('Goods', 'Barang', false, 1), ('Service', 'Jasa', false, 2), ('Rental', 'Sewa', true, 3)) v(name, name_id, is_rental, position)
   where not exists (select 1 from public.purchase_types where org_id = p_org)
  on conflict do nothing $$;
alter table public.purchase_types drop column is_service;
