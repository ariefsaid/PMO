-- Read-only action eligibility projections; write authorities remain unchanged.
create or replace function public.budget_activation_mode(version_id uuid)
  returns text language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_drafter uuid; v_count integer;
begin
  select org_id, created_by into v_org, v_drafter from public.budget_versions where id = version_id;
  if not found or v_org is distinct from public.auth_org_id() or not public.is_active_member() then
    return 'blocked';
  end if;
  if auth_role() not in ('Admin','Executive','Project Manager','Finance') then return 'blocked'; end if;
  if (select org_id from public.projects where id = (select project_id from public.budget_versions where id=version_id))
      is distinct from public.auth_org_id() then return 'blocked'; end if;
  if v_drafter is null and auth_role() not in ('Admin','Finance') then return 'blocked_no_drafter'; end if;
  if exists (select 1 from public.budget_version_editors e where e.budget_version_id=version_id and e.user_id=auth.uid())
     or v_drafter=auth.uid() then
    select count(*) into v_count from public.profiles p
      where p.org_id = v_org and public.is_active_member(p.id);
    if v_count=1 and exists (select 1 from public.profiles p
                              where p.id = auth.uid() and p.org_id = v_org
                                and public.is_active_member(p.id)) then
      return 'sole_operator';
    end if;
    return 'blocked_editor';
  end if;
  return 'allowed';
end; $$;
revoke all on function public.budget_activation_mode(uuid) from public, anon;
grant execute on function public.budget_activation_mode(uuid) to authenticated;

-- Advisory only: the transition retains its own locked checks.
create function public.project_win_eligibility(p_id uuid)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_project public.projects%rowtype;
  v_role public.user_role := public.auth_role();
begin
  if not public.is_active_member() or v_role is null
     or v_role not in ('Admin','Executive','Project Manager','Finance') then return null; end if;
  select * into v_project from public.projects where id = p_id and org_id = public.auth_org_id();
  if not found then return null; end if;
  if v_project.status not in ('Quotation Submitted','Tender Submitted','Negotiation') then return 'unavailable'; end if;
  if coalesce(v_project.contract_value,0) > 0 and not public.holds_won_value_authority(v_role) then
    if v_project.contract_value_set_at is null then return 'missing_witness'; end if;
    if v_project.contract_value_set_by is not null and not public.is_active_member(v_project.contract_value_set_by)
      then return 'inactive_reviewer'; end if;
    if v_project.contract_value_set_by is not distinct from auth.uid()
       or (v_project.contract_value_set_by is not null and not public.may_approve_work_of(v_project.contract_value_set_by, auth.uid()))
      then return 'reviewer_required'; end if;
  end if;
  return 'allowed';
end; $$;
revoke all on function public.project_win_eligibility(uuid) from public, anon;
grant execute on function public.project_win_eligibility(uuid) to authenticated;

-- Returns only a fixed reason for the caller and visible purchase, never event identities or route details.
create function public.procurement_amount_eligibility(p_procurement_id uuid, p_amount numeric)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role := public.auth_role();
  v_row public.procurements%rowtype;
  v_ceiling record;
  v_route record;
  v_routed numeric;
begin
  if not public.is_active_member() or v_role is null
     or v_role not in ('Admin','Executive','Project Manager','Finance') then return null; end if;
  select * into v_row from public.procurements where id = p_procurement_id and org_id = public.auth_org_id();
  if not found then return null; end if;
  if v_row.status is distinct from 'Vendor Invoiced' then return 'unavailable'; end if;
  if v_uid = v_row.requested_by_id then return 'requester'; end if;
  if v_uid = (select e.actor_id from public.procurement_status_events e
               where e.procurement_id = p_procurement_id and e.from_status = 'Vendor Quoted'::public.procurement_status
                 and e.to_status = 'Requested'::public.procurement_status
               order by e.created_at desc, e.id desc limit 1) then return 'quote_selector'; end if;
  if exists (select 1 from public.record_changes rc join public.procurement_invoices i on i.id = rc.entity_id
              where rc.org_id = v_row.org_id and rc.entity_type = 'procurement_invoice' and rc.op = 'insert'
                and i.procurement_id = p_procurement_id and rc.actor_id = v_uid)
     or exists (select 1 from public.procurement_status_events e where e.procurement_id = p_procurement_id
                and e.to_status = 'Vendor Invoiced'::public.procurement_status and e.actor_id = v_uid)
    then return 'bill_recorder'; end if;
  select * into v_ceiling from public.procurement_payment_within_ceiling(p_procurement_id);
  if v_ceiling.reason = 'bill currency differs from procurement currency'
     or p_amount is null or not (p_amount < 'Infinity'::numeric)
     or p_amount < coalesce(v_ceiling.billed_net,0)
     or (v_row.approved_total_value is not null and p_amount <= v_row.approved_total_value)
    then return 'unavailable'; end if;
  v_routed := greatest(p_amount - coalesce(public.procurement_request_amount(p_procurement_id),0),0);
  select * into v_route from public.spend_approval_route(v_row.org_id, v_row.project_id, v_row.budget_category,
    v_routed, v_row.currency, v_row.requested_by_id, v_uid, public.procurement_submitted_at(p_procurement_id));
  if coalesce(v_route.route,'senior') <> 'flat' and v_role <> 'Admin'
     and not coalesce(v_uid = any(v_route.approver_ids),false) then return 'routing'; end if;
  return 'allowed';
end; $$;
revoke all on function public.procurement_amount_eligibility(uuid,numeric) from public, anon;
grant execute on function public.procurement_amount_eligibility(uuid,numeric) to authenticated;

-- Fixed actor-specific issue decisions; the authoritative transition rechecks under lock.
create function public.work_order_issue_eligibility(p_ids uuid[])
returns table (work_order_id uuid, reason text)
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_role public.user_role := public.auth_role();
begin
  if not public.is_active_member() or v_role is null
     or v_role not in ('Admin','Executive','Project Manager','Finance') then return; end if;
  return query
    select w.id, case
      when w.status <> 'Draft' then 'unavailable'
      when coalesce(w.order_value,0) <= 0 or public.holds_won_value_authority(v_role) then 'allowed'
      when w.order_value_set_at is null or w.order_value_set_by is null then 'missing_witness'
      when w.order_value_set_by is not distinct from auth.uid() then 'self'
      when not public.is_active_member(w.order_value_set_by) then 'inactive_reviewer'
      when not public.may_approve_work_of(w.order_value_set_by, auth.uid()) then 'reviewer_required'
      else 'allowed'
    end::text
    from public.work_orders w
    where w.org_id = public.auth_org_id() and w.id = any(p_ids);
end; $$;
revoke all on function public.work_order_issue_eligibility(uuid[]) from public, anon;
grant execute on function public.work_order_issue_eligibility(uuid[]) to authenticated;
