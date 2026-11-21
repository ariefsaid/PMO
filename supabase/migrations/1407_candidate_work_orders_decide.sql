-- 1407_candidate_work_orders_decide.sql — #2595: the accept / reject decision (an approval rule, enforced here).
-- Spec FR-CWO-009..015. Rollback: supabase/migrations/rollback/1407_candidate_work_orders_decide_down.sql.
--
-- The ONLY writer of status and the decision columns (no client grant, 1405). Gate: the candidate's project's Project
-- Manager or an Admin. Rejecting is always allowed; accepting needs every required item passed or not applicable.
-- Accepting creates ONE Draft work order and stops: value 0, no number, no issue (FR-CWO-014): the Draft -> Issued gate
-- and set_work_order_value stay with the existing work-order flow. Calling accept again returns the same work order.
-- Returns {status, work_order_id}.
create function public.decide_work_order_candidate(p_candidate_id uuid, p_decision text, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_c public.work_order_candidates;
  v_pm uuid; v_tax text; v_reason text; v_blocking text; v_wo uuid;
begin
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'rejected') then
    raise exception 'CWO_DECISION: the decision is accepted or rejected' using errcode = '22023';
  end if;
  select * into v_c from public.work_order_candidates c where c.id = p_candidate_id and c.org_id = v_org for update;
  if not found then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  select p.project_manager_id, p.tax_treatment into v_pm, v_tax from public.projects p where p.id = v_c.project_id;
  -- ⚑ THE APPROVAL RULE: only the project's Project Manager or an Admin decides.
  if not (public.auth_role() = 'Admin' or v_pm = v_uid) then
    raise exception 'only the project''s project manager or an administrator can decide a candidate' using errcode = '42501';
  end if;
  -- repeat accept: the same work order, nothing created (FR-CWO-013)
  if v_c.status = 'accepted' and p_decision = 'accepted' then
    return jsonb_build_object('status', 'accepted', 'work_order_id', v_c.work_order_id);
  end if;
  if v_c.status <> 'assessing' then
    raise exception 'CWO_DECIDED: this candidate has already been %', v_c.status using errcode = '23514';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'CWO_REASON: a decision needs a reason of 1 to 500 characters' using errcode = '23514';
  end if;
  if p_decision = 'rejected' then
    update public.work_order_candidates set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
     where id = v_c.id;
    return jsonb_build_object('status', 'rejected', 'work_order_id', null);
  end if;
  -- ⚑ required items must be ready (FR-CWO-011)
  select string_agg(i.label, ', ' order by i.position) into v_blocking
    from public.work_order_candidate_items i
   where i.candidate_id = v_c.id and i.required and i.status not in ('passed', 'not_applicable');
  if v_blocking is not null then
    raise exception 'CWO_NOT_READY: required items are not ready: %', v_blocking using errcode = '23514';
  end if;
  insert into public.work_orders (org_id, project_id, title, description, client_po_number, order_value,
                                  tax_treatment, tax_amount, tax_rate, tax_template, status)
    values (v_org, v_c.project_id, v_c.title, v_c.description, v_c.client_reference, 0,
            coalesce(v_tax, 'exclusive'), 0, null, null, 'Draft')
    returning id into v_wo;
  update public.work_order_candidates set status = 'accepted', decided_by = v_uid, decided_at = now(),
         decision_reason = v_reason, work_order_id = v_wo where id = v_c.id;
  return jsonb_build_object('status', 'accepted', 'work_order_id', v_wo);
end $$;
revoke all on function public.decide_work_order_candidate(uuid, text, text) from public, anon;
grant execute on function public.decide_work_order_candidate(uuid, text, text) to authenticated;
