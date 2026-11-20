-- 1128_quantity_change_approval.sql — #2578: internal approval (server-enforced separation of duties), the client record and the decision.
-- Spec: docs/specs/quantity-change-requests.spec.md (FR-QCR-011..016, 019); AC-QCR-011..018, 030.
-- Reversal: rollback/1128_quantity_change_approval_down.sql.
--   §1 qcr_assert_approver: ONE copy of the approval rule — approver role, and NOT the author, NOT anyone in the editor set,
--      NOT whoever submitted it, and no sole-user exception (OD-QCR-3). approve and return both call it.
--   §2 qcr_approve / qcr_return.
--   §3 qcr_record_sent / qcr_record_decision. Only `client_accepted` changes a quantity, and it does so in one transaction:
--      version appended, boq_items.quantity written (the amend flag, set here and honoured only for the table owner), the
--      work-order allocation raised by the delta, and — on a still-Draft work order — its value raised through
--      set_work_order_value. On an Issued work order the value is frozen (0193 / DD-WO-5); that is stated, not bypassed.

create function public.qcr_org_today(p_org uuid) returns date
  language sql stable security definer set search_path = public, pg_temp as $$
  select (now() at time zone coalesce((select o.default_timezone from public.organizations o where o.id = p_org), 'UTC'))::date
$$;
revoke all on function public.qcr_org_today(uuid) from public, anon, authenticated;

-- ── §1 the rule ─────────────────────────────────────────────────────────────────────────────────────
create function public.qcr_assert_approver(p_request public.quantity_change_requests) returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if public.auth_role() not in ('Admin','Executive','Finance') then
    raise exception 'not authorized to approve quantity change requests' using errcode = '42501';
  end if;
  if v_uid = p_request.author_id or v_uid = any (p_request.editor_ids) or v_uid is not distinct from p_request.submitted_by then
    raise exception 'separation of duties: the author cannot approve this request' using errcode = '42501';
  end if;
end; $$;
revoke all on function public.qcr_assert_approver(public.quantity_change_requests) from public, anon, authenticated;

-- ── §2 approve / return ─────────────────────────────────────────────────────────────────────────────
create function public.qcr_approve(p_request_id uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req public.quantity_change_requests;
begin
  perform public.assert_is_active_member();
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  perform public.qcr_assert_approver(v_req);
  if v_req.status <> 'pending_approval' then
    raise exception 'only a request pending approval can be approved; this one is %', v_req.status using errcode = 'P0001';
  end if;
  update public.quantity_change_requests
     set status = 'approved', approved_by = v_uid, approved_at = now(), updated_at = now() where id = p_request_id;
  perform public.qcr_log(p_request_id, 'approved', 'pending_approval', 'approved');
  perform public.notify_workflow_user(v_org, v_req.author_id, 'Quantity change request approved',
    'Your quantity change request was approved internally. Record when it is sent to the client.', 'info',
    'quantity_change_request', p_request_id, 'Quantity change request');
end; $$;

create function public.qcr_return(p_request_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req public.quantity_change_requests;
begin
  perform public.assert_is_active_member();
  if nullif(btrim(p_reason), '') is null or char_length(btrim(p_reason)) > 500 then
    raise exception 'a reason is required to return a request (up to 500 characters)' using errcode = '23502';
  end if;
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  perform public.qcr_assert_approver(v_req);
  if v_req.status <> 'pending_approval' then
    raise exception 'only a request pending approval can be returned; this one is %', v_req.status using errcode = 'P0001';
  end if;
  update public.quantity_change_requests
     set status = 'returned', returned_by = v_uid, returned_at = now(), return_reason = btrim(p_reason), updated_at = now()
   where id = p_request_id;
  perform public.qcr_log(p_request_id, 'returned', 'pending_approval', 'returned', btrim(p_reason));
  perform public.notify_workflow_user(v_org, v_req.author_id, 'Quantity change request returned',
    'Your quantity change request was returned: ' || btrim(p_reason), 'warning', 'quantity_change_request', p_request_id, 'Quantity change request');
end; $$;

-- ── §3 the client record and the decision ───────────────────────────────────────────────────────────
create function public.qcr_record_sent(p_request_id uuid, p_sent_date date, p_client_reference text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req public.quantity_change_requests;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to record a quantity change request' using errcode = '42501';
  end if;
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_req.status <> 'approved' then
    raise exception 'only an approved request can be marked as sent; this one is %', v_req.status using errcode = 'P0001';
  end if;
  if nullif(btrim(p_client_reference), '') is null or char_length(btrim(p_client_reference)) > 200 then
    raise exception 'the client reference is required (up to 200 characters)' using errcode = '23502';
  end if;
  if p_sent_date is null or p_sent_date > public.qcr_org_today(v_org) then
    raise exception 'the sent date is required and cannot be in the future' using errcode = '23514';
  end if;
  if not exists (select 1 from public.quantity_change_request_files f
                  where f.request_id = p_request_id and f.kind = 'sent_letter' and f.archived_at is null) then
    raise exception 'attach the letter or form that was sent to the client' using errcode = '23514';
  end if;
  update public.quantity_change_requests
     set status = 'sent_to_client', sent_date = p_sent_date, client_reference = btrim(p_client_reference),
         sent_by = v_uid, sent_at = now(), updated_at = now() where id = p_request_id;
  perform public.qcr_log(p_request_id, 'sent_to_client', 'approved', 'sent_to_client', btrim(p_client_reference));
end; $$;

create function public.qcr_record_decision(p_request_id uuid, p_decision text, p_decision_date date, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_req public.quantity_change_requests;
  v_wo record; l record; v_version integer; v_delta numeric; v_value_delta numeric := 0; v_net numeric; v_gross numeric; v_tax numeric;
  v_new_status text;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to record a quantity change request' using errcode = '42501';
  end if;
  if p_decision not in ('accepted','declined') then
    raise exception 'the decision must be accepted or declined' using errcode = '23514';
  end if;
  select q.* into v_req from public.quantity_change_requests q where q.id = p_request_id for update;
  if not found or v_req.org_id is distinct from v_org then raise exception 'request not found' using errcode = 'P0002'; end if;
  if v_req.status <> 'sent_to_client' then
    raise exception 'only a request sent to the client can take a decision; this one is %', v_req.status using errcode = 'P0001';
  end if;
  if p_decision_date is null or p_decision_date > public.qcr_org_today(v_org) or p_decision_date < v_req.sent_date then
    raise exception 'the decision date is required, cannot be in the future and cannot precede the sent date' using errcode = '23514';
  end if;
  if p_decision = 'accepted' and not exists (select 1 from public.quantity_change_request_files f
        where f.request_id = p_request_id and f.kind = 'client_response' and f.archived_at is null) then
    raise exception 'attach the client''s acceptance' using errcode = '23514';
  end if;

  if p_decision = 'accepted' then
    select w.id, w.status, w.order_value, w.tax_treatment, w.tax_amount, w.tax_rate, w.tax_base_numerator, w.tax_base_denominator
      into v_wo from public.work_orders w where w.id = v_req.work_order_id for update;
    if v_wo.status in ('Closed','Cancelled') then
      raise exception 'the work order is %: an accepted quantity cannot be added to it', v_wo.status using errcode = 'P0001';
    end if;
    for l in select ln.boq_item_id, ln.requested_quantity, ln.base_quantity, ln.base_version_no, b.rate
               from public.quantity_change_request_lines ln join public.boq_items b on b.id = ln.boq_item_id
              where ln.request_id = p_request_id order by ln.boq_item_id loop
      perform 1 from public.boq_items b where b.id = l.boq_item_id for update;
      select coalesce(max(v.version_no), 0) into v_version from public.boq_quantity_versions v where v.boq_item_id = l.boq_item_id;
      if v_version <> l.base_version_no
         or (select b.quantity from public.boq_items b where b.id = l.boq_item_id) <> l.base_quantity then
        raise exception 'stale base: the contract quantity of this line changed after the request was raised (now %, was %); record the request as declined and raise a new one',
          (select b.quantity from public.boq_items b where b.id = l.boq_item_id), l.base_quantity using errcode = 'P0001';
      end if;
      v_delta := l.requested_quantity - l.base_quantity;
      perform set_config('pmo.qcr_amend_quantity', 'on', true);
      update public.boq_items set quantity = l.requested_quantity where id = l.boq_item_id;
      perform set_config('pmo.qcr_amend_quantity', '', true);
      insert into public.boq_quantity_versions (org_id, boq_item_id, version_no, quantity, source, request_id, created_by)
      values (v_org, l.boq_item_id, v_version + 1, l.requested_quantity, 'change_request', p_request_id, v_uid);
      update public.work_order_lines set quantity = quantity + v_delta
       where work_order_id = v_req.work_order_id and boq_item_id = l.boq_item_id;
      if not found then
        raise exception 'the work order no longer allocates this contract line' using errcode = 'P0001';
      end if;
      -- each value is rounded once, so the changes add up to current minus baseline (the version history's rule)
      v_value_delta := v_value_delta + round(l.requested_quantity * l.rate, 2) - round(l.base_quantity * l.rate, 2);
    end loop;
    -- ⚑ OD-QCR-10: only a Draft work order's value can still rise. An Issued one is frozen; its screen says so.
    if v_wo.status = 'Draft' and v_value_delta <> 0 then
      -- order_value net of tax rises by the delta: the invoice fence reads the net figure.
      if v_wo.tax_treatment = 'inclusive' then
        v_net := v_wo.order_value - v_wo.tax_amount + v_value_delta;
        v_tax := case when v_wo.tax_rate is not null
                      then public.calculate_standalone_tax_amount(v_net, 'exclusive', v_wo.tax_rate, v_wo.tax_base_numerator, v_wo.tax_base_denominator)
                      else v_wo.tax_amount end;
        v_gross := v_net + v_tax;
      else
        v_gross := v_wo.order_value + v_value_delta;
        v_tax := case when v_wo.tax_rate is not null
                      then public.calculate_standalone_tax_amount(v_gross, 'exclusive', v_wo.tax_rate, v_wo.tax_base_numerator, v_wo.tax_base_denominator)
                      else v_wo.tax_amount end;
      end if;
      perform public.set_work_order_value(v_req.work_order_id, v_gross, v_wo.tax_treatment, v_tax, v_wo.tax_rate,
                                          v_wo.tax_base_numerator, v_wo.tax_base_denominator);
    end if;
    v_new_status := 'client_accepted';
  else
    v_new_status := 'client_declined';
  end if;

  update public.quantity_change_requests
     set status = v_new_status, decision_date = p_decision_date, decided_by = v_uid, decided_at = now(),
         decision_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_request_id;
  update public.quantity_change_request_lines set is_open = false where request_id = p_request_id;
  perform public.qcr_log(p_request_id, v_new_status, 'sent_to_client', v_new_status, nullif(btrim(p_note), ''));
  perform public.notify_workflow_user(v_org, v_req.author_id,
    case when p_decision = 'accepted' then 'Quantity change accepted by the client' else 'Quantity change declined by the client' end,
    case when p_decision = 'accepted' then 'The contract quantities were updated.' else 'No quantity was changed.' end,
    case when p_decision = 'accepted' then 'info' else 'warning' end, 'quantity_change_request', p_request_id, 'Quantity change request');
end; $$;

do $$ declare f text; begin
  foreach f in array array['qcr_approve(uuid)','qcr_return(uuid,text)','qcr_record_sent(uuid,date,text)','qcr_record_decision(uuid,text,date,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
