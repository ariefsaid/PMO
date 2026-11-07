-- 0704_native_tm_invoice.sql — #1817: an organisation with no ERP invoices a signed-off time-and-materials claim in PMO.
-- FR-TM-030..037 (docs/specs/time-and-materials-claims.spec.md), AC-TM-020..026; floor ruling OD-VISION-ERP.
--
-- ONE new RPC, no table, no status, no new fence. create_native_tm_invoice(p_claim) is create_native_sales_invoice (0534) with the
-- customer, project, work order, currency and LINES read from the confirmed claim, and with the invoice id = the claim id. That id
-- is the double-billing guard (the primary key backs the explicit check) and is how the existing triggers find the claim:
-- append_progress_claim_author (0517) adds the preparer, the sign-off preparer and the confirmer to the author set, so the approver
-- must differ from all of them through the unchanged assert_sales_invoice_approver. The outbox fence (assert_progress_claim_raisable)
-- only fires for an ERP raise, so the claim gate is repeated here with the same messages.
create or replace function public.create_native_tm_invoice(p_claim uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid      := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_uid         uuid      := auth.uid();
  v_c           public.tm_claims;
  v_withdrawn   timestamptz;
  v_p_currency  text;
  v_client      uuid;
  v_vat         boolean;
  v_rate        numeric;
  v_num         integer;
  v_den         integer;
  v_contract    text;
  v_wo_currency text;
  v_wo_po       text;
  v_lines       jsonb;
  v_amount      numeric;
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can raise a customer invoice' using errcode = '42501';
  end if;
  perform public.assert_feature_on(v_org, 'sales_invoices');
  -- Serialise with an ERP take-over of revenue BEFORE reading who owns it; the ERP path stays the one for connected orgs.
  perform 1 from public.organizations o where o.id = v_org for share;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;

  -- SECURITY: the claim must be the caller's organisation's.
  select * into v_c from public.tm_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  -- Lock order as confirm_tm_signoff: the work order's billing lock, the project row, then the claim.
  if v_c.work_order_id is not null then perform public.lock_work_order_billing(v_c.work_order_id); end if;
  select p.currency, p.client_id, p.subject_to_vat, p.tax_rate, p.tax_base_numerator, p.tax_base_denominator, p.customer_contract_ref
    into v_p_currency, v_client, v_vat, v_rate, v_num, v_den, v_contract
    from public.projects p where p.id = v_c.project_id and p.org_id = v_org for share;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  select * into v_c from public.tm_claims c where c.id = p_claim for update;

  -- The claim gate (assert_progress_claim_raisable's rules, same messages): confirmed, live, with billing evidence.
  if v_c.status = 'Withdrawn' then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if v_c.status is distinct from 'SignedOff' or v_c.confirmed_by is null then
    raise exception 'confirm the client''s sign-off before raising this time-and-materials claim''s invoice' using errcode = '55000';
  end if;
  select pc.withdrawn_at into v_withdrawn from public.progress_claims pc where pc.id = p_claim and pc.org_id = v_org for share;
  if not found then
    raise exception 'this claim has no confirmed sign-off record, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if not exists (select 1 from public.progress_claim_evidence ev where ev.claim_id = p_claim) then
    raise exception 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice'
      using errcode = '55000';
  end if;

  -- One invoice per claim, whatever its status: a cancelled one also blocks (withdraw the claim and assemble it again).
  if exists (select 1 from public.sales_invoices si where si.id = p_claim) then
    raise exception 'this claim already has an invoice' using errcode = 'P0001', detail = 'claim-already-invoiced';
  end if;

  if v_client is null then
    raise exception 'the project has no client to invoice: set the client on the project first' using errcode = 'P0002', detail = 'no-client';
  end if;
  if v_c.currency is distinct from v_p_currency then
    raise exception 'the claim is in % but the project is in %', v_c.currency, v_p_currency using errcode = '23514';
  end if;
  if v_c.work_order_id is not null then
    select wo.currency, wo.client_po_number into v_wo_currency, v_wo_po from public.work_orders wo
     where wo.id = v_c.work_order_id and wo.org_id = v_org;
    if not found then raise exception 'work order not found' using errcode = 'P0002'; end if;
    if v_wo_currency is distinct from v_c.currency then
      raise exception 'the claim is in % but the work order is in %', v_c.currency, v_wo_currency using errcode = '23514';
    end if;
  end if;

  -- OD-TAX-4 / DD-NAR-7: the project says whether it is subject to VAT; its own rate and base apply.
  if v_vat then
    if v_rate is null or v_rate <= 0 then
      raise exception 'this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing'
        using errcode = 'P0001', detail = 'vat-rate-missing';
    end if;
  else
    v_rate := 0; v_num := 1; v_den := 1;
  end if;

  -- The signed lines, as they were signed; the header is their sum and must equal the claim's gross.
  select jsonb_agg(jsonb_build_object(
           'item_code', null,
           'description', left(l.label || ' (' || l.unit || ')' || case when l.basis = 'standby' then ' standby' else '' end, 140),
           'qty', l.units, 'rate', l.rate, 'amount', l.amount) order by l.kind, l.label, l.basis),
         sum(l.amount)
    into v_lines, v_amount
    from public.tm_claim_lines l where l.claim_id = p_claim;
  if v_lines is null or v_amount is distinct from v_c.gross_amount then
    raise exception 'the claim''s lines do not add up to its total' using errcode = '23514', detail = 'claim-total-mismatch';
  end if;

  -- tax_amount 0 is a placeholder the 0227 trigger (sales_invoices_zz_apply_tax_base) replaces from tax_rate on insert.
  perform set_config('pmo.native_tm_invoice', p_claim::text, true);
  insert into public.sales_invoices
    (id, org_id, project_id, customer_id, work_order_id, reference_number, native_lines, amount, currency,
     tax_treatment, tax_rate, tax_amount, tax_base_numerator, tax_base_denominator, status, pmo_native, author_user_id, billing_kind)
  values
    (p_claim, v_org, v_c.project_id, v_client, v_c.work_order_id,
     coalesce(nullif(btrim(v_wo_po), ''), nullif(btrim(v_contract), '')),
     v_lines, v_amount, v_c.currency,
     'exclusive', v_rate, 0, v_num, v_den, 'Draft', true, v_uid, 'contract');
  perform set_config('pmo.native_tm_invoice', '', true);
  -- 0132's SoD oracle: the creator joins the author set (append_progress_claim_author adds the claim's three people).
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id) values (v_org, p_claim, v_uid) on conflict do nothing;
  perform public.log_audit('tm_native_invoice.create', v_org, v_uid, p_claim,
    jsonb_build_object('project_id', v_c.project_id, 'work_order_id', v_c.work_order_id, 'gross_amount', v_amount));
  return p_claim;
end $$;

revoke all on function public.create_native_tm_invoice(uuid) from public, anon;
grant execute on function public.create_native_tm_invoice(uuid) to authenticated;
alter function public.create_native_tm_invoice(uuid) owner to postgres;

-- The work-order fence (0262 §5, body verbatim) with the one marker exception above.
create or replace function public.assert_sales_invoice_within_work_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_dp       boolean;
  v_recovery numeric;
  v_new      numeric;
  v_old      numeric;
begin
  -- The ERP mirror (dispatch finalize, sweep, inbound feed): the ERP document already exists; refusing its mirror
  -- would wedge every sweep replay (DD-VI-3a). An overage shows as over-invoiced instead (FR-BWO-006).
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  -- A server-side load with no JWT (seed, migration, owner-run loader).
  if auth.uid() is null and session_user in ('postgres', 'supabase_admin') then return new; end if;
  -- A claim's invoice is raised from the claim and mirrored under its id; any other writer taking that id would be
  -- read as the claim's invoice (its recovery, a down payment's zero) and stop the claim counting as unraised. That
  -- moves a work order's figures only when the claim or the invoice names one — the case refused here.
  -- ⚑ 0704 (#1817): create_native_tm_invoice is that claim invoice. It names the claim id in a transaction-local marker just
  -- before its insert; any other writer still takes the refusal. The claim already counts against its work order, and the
  -- helper below excludes the invoice's own id, so the work order's billed total does not change.
  if tg_op = 'INSERT' and coalesce(current_setting('pmo.native_tm_invoice', true), '') is distinct from new.id::text
     and exists (select 1 from public.progress_claims pc
                                   where pc.id = new.id and (pc.work_order_id is not null or new.work_order_id is not null)) then
    raise exception 'this id belongs to a progress claim: its invoice is raised from the claim' using errcode = 'BW001';
  end if;
  if new.work_order_id is null or new.status = 'Cancelled' then return new; end if;

  -- The row's billed work, by the same rule as sales_invoice_work_billed (a claim invoice adds its recovery back; a
  -- down-payment invoice bills nothing).
  select pc.kind = 'down_payment', pc.dp_recovery_amount into v_dp, v_recovery
    from public.progress_claims pc where pc.id = new.id and pc.org_id = new.org_id;
  v_new := case when coalesce(v_dp, false) then 0
                else (case when new.tax_treatment = 'inclusive' then new.amount - new.tax_amount else new.amount end)
                     + coalesce(v_recovery, 0) end;

  if tg_op = 'UPDATE' and old.work_order_id is not distinct from new.work_order_id and old.status <> 'Cancelled' then
    v_old := case when coalesce(v_dp, false) then 0
                  else (case when old.tax_treatment = 'inclusive' then old.amount - old.tax_amount else old.amount end)
                       + coalesce(v_recovery, 0) end;
    -- A reduction, or a status move that bills the same, never needs refusing — down to zero, not below it. NULL on
    -- either side falls through to the helper, which refuses it.
    if v_new <= v_old and v_new >= 0 then return new; end if;
  end if;

  perform public.assert_work_order_invoiceable(new.org_id, new.work_order_id, new.project_id, new.id::text, v_new, new.currency);
  return new;
end; $$;
revoke all on function public.assert_sales_invoice_within_work_order() from public, anon, authenticated;
