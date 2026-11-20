-- 1138_certificate_acceptance_bridge.sql — #2584 Slice 4: prepare the signed acceptance from a certificate, and the work-order read.
-- Spec docs/specs/subcontractor-progress-certificate.spec.md (FR-SPC-010, FR-SPC-018; OD-SPC-4).
-- Plan docs/plans/2026-11-20-subcontractor-progress-certificate.md. Proven by supabase/tests/subcontract_certificate_bill.test.sql.
-- Rollback: rollback/1138_certificate_acceptance_bridge_down.sql.
--
-- The certificate prepares the acceptance, it never replaces it (OD-SPC-4): this calls the shipped prepare_subcontract_acceptance
-- for a DRAFT whose cumulative verified quantity per item is the latest confirmed verified quantity plus the certificate's
-- measured quantity. Confirming it (the organisation's signed document, preparer != confirmer) stays the shipped process.

create function public.prepare_certificate_acceptance(p_certificate uuid, p_note text default null) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_lines jsonb; v_acc uuid; v_status text;
begin
  perform public.assert_is_active_member();
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null or not public.spc_may_prepare(c.project_id) then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  if c.status in ('cancelled', 'billed') then raise exception 'this certificate is % already', c.status using errcode = '23514'; end if;
  if c.status in ('draft', 'returned') then
    select jsonb_agg(jsonb_build_object('boq_item_id', (l->>'boq_item_id')::uuid,
                     'quantity', coalesce(v.quantity, 0) + (l->>'measured_quantity')::numeric)) into v_lines
      from jsonb_array_elements(public.spc_derive(c.id)->'lines') l
      left join public.subcontract_verified(c.po_id) v on v.boq_item_id = (l->>'boq_item_id')::uuid;
  else
    select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'quantity', coalesce(v.quantity, 0) + l.measured_quantity)) into v_lines
      from public.subcontract_certificate_lines l left join public.subcontract_verified(c.po_id) v on v.boq_item_id = l.boq_item_id
     where l.certificate_id = c.id;
  end if;
  if v_lines is null then raise exception 'there is nothing measured to accept' using errcode = '23514'; end if;
  v_acc := c.acceptance_id;
  if v_acc is not null then
    select a.status into v_status from public.subcontract_acceptances a where a.id = v_acc;
    if v_status is distinct from 'Draft' then v_acc := null; end if;
  end if;
  v_acc := public.prepare_subcontract_acceptance(c.po_id, current_date, v_lines, null,
             coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Prepared from the progress certificate for ' || to_char(c.period_start, 'YYYY-MM')), v_acc);
  update public.subcontract_certificates set acceptance_id = v_acc where id = c.id;
  perform public.log_audit('subcontract_certificate.acceptance_prepared', v_org, auth.uid(), c.id, jsonb_build_object('acceptance_id', v_acc));
  return v_acc;
end $$;
revoke all on function public.prepare_certificate_acceptance(uuid, text) from public, anon;
grant execute on function public.prepare_certificate_acceptance(uuid, text) to authenticated;

-- A work order's certified cost by period (FR-SPC-018). Invoker: the caller's own RLS decides what is visible.
create function public.work_order_certified_cost(p_work_order uuid)
  returns table (certificate_id uuid, period_start date, status text, gross numeric, backcharge_total numeric, net numeric, invoice_id uuid)
  language sql stable security invoker set search_path = public as $$
  select c.id, c.period_start, c.status, c.gross, c.backcharge_total, c.net, c.invoice_id
    from public.subcontract_certificates c
   where c.work_order_id = p_work_order and c.status in ('approved', 'billed')
   order by c.period_start, c.id
$$;
revoke all on function public.work_order_certified_cost(uuid) from public, anon;
grant execute on function public.work_order_certified_cost(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.prepare_certificate_acceptance(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.work_order_certified_cost(uuid)', 'EXECUTE') then
    raise exception '1138: a certificate function is anon-executable'; end if;
end $$;
