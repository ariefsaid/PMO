-- 1357_three_way_match_edit_states.sql — #2634: the receipt-line and bill-line writers learn the edit states, and the
-- Admin's setting screen gets a held-bill count. Spec docs/specs/three-way-match.spec.md section 7 · Plan
-- docs/plans/2026-11-21-bill-match-settings.md. Proven by supabase/tests/three_way_match_settings.test.sql; the
-- mutation check is three_way_match_edit_mutation.test.sql.
--   * record_bill_match_lines refuses a Paid bill (23514, detail three-way-match-posted).
--   * record_receipt_match_lines refuses a receipt of a Paid or Cancelled purchase (same code).
--   * both audit the lines before as well as after (the control for receipt edits, which carry no separation of duties).
--   * three_way_match_held_count(): how many bills of the caller's organisation are held now (Admin only).
-- Nothing is switched on: an organisation without the match never reaches these refusals (no row, no lines to write).
-- ── REVERSE (rollback/1357_three_way_match_edit_states_down.sql): restores the 1018 bodies; drops the count. ──

-- §1 (was 1018 §9) Receipt lines writer (the receipt writers' roles). Replaces the receipt's lines.
create or replace function public.record_receipt_match_lines(p_receipt_id uuid, p_lines jsonb)
  returns setof public.procurement_receipt_lines
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_rcpt public.procurement_receipts; v_proc public.procurements; v_before jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_rcpt from public.procurement_receipts where id = p_receipt_id and org_id = v_org;
  if not found then raise exception 'receipt not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_rcpt.procurement_id and org_id = v_org for update;
  perform public.assert_feature_on(v_org, 'procurement');
  if coalesce(public.domain_externally_owned(v_org, 'procurement'), false) or v_proc.record_only
     or v_rcpt.erp_docstatus is not null then
    raise exception 'this receipt is recorded in the ERP' using errcode = '42501', detail = 'three-way-match-erp';
  end if;
  if v_proc.is_subcontract then
    raise exception 'subcontract work is received through acceptances' using errcode = 'MH002';
  end if;
  if v_proc.status::text in ('Paid', 'Cancelled') then
    raise exception 'this purchase is closed; its receipt lines cannot change'
      using errcode = '23514', detail = 'three-way-match-posted';
  end if;
  if public.three_way_match_lines_unreadable(p_lines, false) then
    raise exception 'receipt lines must name each ordered item once with a quantity above zero' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x
              where not exists (select 1 from public.procurement_items pi
                                 where pi.id = (x->>'item_id')::uuid and pi.procurement_id = v_proc.id)) then
    raise exception 'a receipt line names an item that is not on this purchase' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity) order by item_id), '[]'::jsonb)
    into v_before from public.procurement_receipt_lines where receipt_id = v_rcpt.id;
  delete from public.procurement_receipt_lines where receipt_id = v_rcpt.id;
  insert into public.procurement_receipt_lines (receipt_id, item_id, org_id, quantity, recorded_by)
  select v_rcpt.id, (x->>'item_id')::uuid, v_org, round((x->>'quantity')::numeric, 3), v_uid
    from jsonb_array_elements(p_lines) x;
  perform public.log_audit('procurement_receipt.match_lines', v_org, v_uid, v_rcpt.id,
    jsonb_build_object('procurement_id', v_proc.id, 'before', v_before, 'lines', p_lines));
  return query select * from public.procurement_receipt_lines where receipt_id = v_rcpt.id;
end $$;
revoke all on function public.record_receipt_match_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_receipt_match_lines(uuid, jsonb) to authenticated;

-- §2 (was 1018 §10) Bill lines writer (the bill capture roles). Replaces the bill's lines and records who set them (an authorship
-- event for SoD). Refused once an exception is approved: the approval froze what it approved.
create or replace function public.record_bill_match_lines(p_invoice_id uuid, p_lines jsonb)
  returns jsonb
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_inv public.procurement_invoices; v_proc public.procurements; v_before jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_inv from public.procurement_invoices where id = p_invoice_id and org_id = v_org;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_inv.procurement_id and org_id = v_org for update;
  perform public.assert_feature_on(v_org, 'procurement');
  select * into v_inv from public.procurement_invoices where id = p_invoice_id;      -- re-read under the purchase lock
  if coalesce(public.domain_externally_owned(v_org, 'procurement'), false) or v_proc.record_only
     or v_inv.erp_docstatus is not null then
    raise exception 'this bill is recorded in the ERP' using errcode = '42501', detail = 'three-way-match-erp';
  end if;
  if v_proc.is_subcontract then
    raise exception 'a subcontract bill states its lines when it is captured' using errcode = 'MH002';
  end if;
  if v_inv.voided_at is not null or v_inv.erp_cancelled_at is not null then
    raise exception 'this bill is cancelled' using errcode = '23514';
  end if;
  if v_inv.status::text = 'Paid' then
    raise exception 'this bill is paid; its lines cannot change'
      using errcode = '23514', detail = 'three-way-match-posted';
  end if;
  if exists (select 1 from public.bill_match_exceptions where invoice_id = v_inv.id) then
    raise exception 'an exception was approved for this bill; its lines cannot change'
      using errcode = '23514', detail = 'three-way-match-frozen';
  end if;
  if public.three_way_match_lines_unreadable(p_lines, true) then
    raise exception 'bill lines must name each ordered item once with a quantity above zero and a rate'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x
              where not exists (select 1 from public.procurement_items pi
                                 where pi.id = (x->>'item_id')::uuid and pi.procurement_id = v_proc.id)) then
    raise exception 'a bill line names an item that is not on this purchase' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity, 'rate', rate) order by item_id), '[]'::jsonb)
    into v_before from public.procurement_bill_match_lines where invoice_id = v_inv.id;
  insert into public.procurement_bill_matches (invoice_id, org_id, recorded_by)
  values (v_inv.id, v_org, v_uid)
  on conflict (invoice_id) do update set recorded_by = excluded.recorded_by, recorded_at = now();
  delete from public.procurement_bill_match_lines where invoice_id = v_inv.id;
  insert into public.procurement_bill_match_lines (invoice_id, item_id, org_id, quantity, rate)
  select v_inv.id, (x->>'item_id')::uuid, v_org, round((x->>'quantity')::numeric, 3), round((x->>'rate')::numeric, 2)
    from jsonb_array_elements(p_lines) x;
  perform public.log_audit('procurement_invoice.match_lines', v_org, v_uid, v_inv.id,
    jsonb_build_object('procurement_id', v_proc.id, 'before', v_before, 'lines', p_lines));
  return public.bill_match_evaluate(v_inv.id);
end $$;
revoke all on function public.record_bill_match_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_bill_match_lines(uuid, jsonb) to authenticated;


-- §3 Held-bill count for the setting screen (D-TWM-15): shown before an Admin switches the match off, so the Admin knows
-- how many holds the switch releases. Admin only, own organisation. Reads through the evaluator (the one rule).
create or replace function public.three_way_match_held_count() returns integer
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin sees the held bill count' using errcode = '42501';
  end if;
  return (select count(*)::int from public.procurement_invoices i
           where i.org_id = v_org and public.bill_match_evaluate(i.id)->>'status' = 'held');
end $$;
revoke all on function public.three_way_match_held_count() from public, anon, authenticated;
grant execute on function public.three_way_match_held_count() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.three_way_match_held_count()', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_bill_match_lines(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_receipt_match_lines(uuid,jsonb)', 'EXECUTE') then
    raise exception '1357: a three-way match RPC is anon-executable'; end if;
end $$;
