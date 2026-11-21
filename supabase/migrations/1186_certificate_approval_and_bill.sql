-- 1186_certificate_approval_and_bill.sql — #2584 Slice 3 (money, SoD, payable path): submit, return, approve, cancel, bill.
-- Spec docs/specs/subcontractor-progress-certificate.spec.md (FR-SPC-011..017, FR-SPC-021; NFR-SPC-002/003; OD-SPC-5/8/9).
-- Plan docs/plans/2026-11-20-subcontractor-progress-certificate.md. Proven by supabase/tests/subcontract_certificate_sod.test.sql,
-- subcontract_certificate_bill.test.sql and subcontract_certificate_mutation.test.sql (SoD and cap pre-check mutation checks).
-- Rollback: rollback/1186_certificate_approval_and_bill_down.sql (refused while a bill carries a deduction or a certificate is live).
--
-- Lock order (NFR-SPC-002, D5 of the shipped capture): the procurement row, then subcontract_po_lock, then the certificate row.
-- The claim on measured work is also arbitrated by the unique index on subcontract_certificate_claims, so two certificates on
-- two POs of one vendor cannot both hold the same work.
-- The payable: a backcharge cannot sit inside a bill's amount (the shipped capture requires the pre-tax amount to equal the
-- lines, FR-SCA-023), so it is its own field (procurement_invoices.deduction_amount) and the payment ceiling subtracts it.

-- ── §1 the bill carries the deduction and the certificate it came from ───────────────────────────────────
alter table public.procurement_invoices
  add column deduction_amount numeric(14,2) not null default 0 check (deduction_amount >= 0 and deduction_amount < 'Infinity'::numeric),
  add column certificate_id   uuid references public.subcontract_certificates(id);
create index procurement_invoices_certificate_idx on public.procurement_invoices (certificate_id) where certificate_id is not null;
comment on column public.procurement_invoices.deduction_amount is
  '#2584 OD-SPC-5: a non-tax deduction (backcharges) that lowers what is payable on the bill, never its pre-tax amount. Written only by bill_subcontract_certificate.';
-- Change history (record_changes_catalog_gate): the deduction is a captured money field, the certificate link a captured ref.
update public.record_history_config
   set captured = captured || '{"deduction_amount":"money","certificate_id":"ref"}'::jsonb
 where table_name = 'procurement_invoices';

create function public.guard_invoice_deduction() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
declare v_on boolean := coalesce(current_setting('pmo.spc_bill', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if (new.deduction_amount <> 0 or new.certificate_id is not null) and not v_on then
      raise exception 'a bill''s deduction is set only by bill_subcontract_certificate' using errcode = '42501'; end if;
    return new;
  end if;
  if (new.deduction_amount is distinct from old.deduction_amount or new.certificate_id is distinct from old.certificate_id) then
    if not v_on or old.deduction_amount <> 0 or old.certificate_id is not null then
      raise exception 'a bill''s deduction is fixed once set' using errcode = '42501'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_invoice_deduction() from public, anon, authenticated;
create trigger procurement_invoices_zz_deduction before insert or update on public.procurement_invoices
  for each row execute function public.guard_invoice_deduction();

-- ── §2 the payment ceiling honours the deduction (FR-SPC-015, AC-SPC-011) ──────────────────────────────────
-- One seam for every payment-writing path (create_payment, the Paid transition, imports): while a purchase has a live bill
-- carrying a deduction, live payments in the purchase's currency may not exceed the live bills' payable, the sum of
-- (amount + exclusive tax - deduction). The shipped gross ceiling stays in place; this only ever tightens it.
create function public.guard_payment_net_of_deduction() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur text; v_payable numeric; v_paid numeric;
begin
  if new.amount is null
     or coalesce(new.erp_docstatus, 1) = 2
     or new.erp_cancelled_at is not null
     or coalesce(new.status, '') in ('Cancelled', 'Void')
     or (new.invoice_id is not null and exists (
           select 1 from public.procurement_invoices vi
            where vi.id = new.invoice_id
              and (vi.voided_at is not null or coalesce(vi.erp_docstatus, 1) = 2 or vi.erp_cancelled_at is not null)))
  then
    return new;
  end if;
  if not exists (select 1 from public.procurement_invoices i where i.procurement_id = new.procurement_id and i.deduction_amount > 0
                  and i.voided_at is null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null) then
    return new;
  end if;
  perform 1 from public.procurements where id = new.procurement_id for update;
  select currency into v_cur from public.procurements where id = new.procurement_id;
  select coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then i.tax_amount else 0 end - i.deduction_amount), 0) into v_payable
    from public.procurement_invoices i
   where i.procurement_id = new.procurement_id and i.amount is not null and coalesce(i.currency, v_cur) = v_cur
     and i.voided_at is null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null;
  select coalesce(sum(p.amount), 0) into v_paid from public.payments p
   where p.procurement_id = new.procurement_id and p.id is distinct from new.id and coalesce(p.currency, v_cur) = v_cur
     and coalesce(p.erp_docstatus, 1) <> 2 and p.erp_cancelled_at is null
     and coalesce(p.status, '') not in ('Cancelled', 'Void')
     and not exists (select 1 from public.procurement_invoices vi where vi.id = p.invoice_id and (vi.voided_at is not null or coalesce(vi.erp_docstatus, 1) = 2 or vi.erp_cancelled_at is not null));
  if coalesce(new.currency, v_cur) = v_cur and v_paid + new.amount > v_payable then
    raise exception 'payments cannot exceed the payable net of backcharges (%)', v_payable using errcode = '23514', detail = 'payable-net-of-deduction';
  end if;
  return new;
end $$;
revoke all on function public.guard_payment_net_of_deduction() from public, anon, authenticated;
create trigger payments_zz_net_of_deduction before insert or update of amount, status, procurement_id on public.payments
  for each row execute function public.guard_payment_net_of_deduction();

-- ── §3 submit (FR-SPC-011, AC-SPC-002/008/012) ──────────────────────────────────────────────────────
-- Freezes lines, rates, backcharges and totals, and takes the claims. Refused for a second submit (status), for work another
-- live certificate holds, and for a backcharge another live certificate holds.
create function public.submit_subcontract_certificate(p_certificate uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; d jsonb; t jsonb; l jsonb; v_n integer; v_held integer;
begin
  perform public.assert_is_active_member();
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null or not public.spc_may_prepare(c.project_id) then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  perform 1 from public.procurements where id = c.procurement_id and org_id = v_org for update;     -- row, PO lock, certificate
  perform public.subcontract_po_lock(c.po_id);
  select * into c from public.subcontract_certificates where id = p_certificate for update;
  if c.status not in ('draft', 'returned') then
    raise exception 'this certificate is already % — a second submit takes no second claim', c.status using errcode = '23514', detail = 'cert-not-submittable'; end if;
  d := public.spc_derive(c.id);
  if d is null or jsonb_array_length(d->'lines') = 0 then
    raise exception 'nothing measured and rated to certify in this period' using errcode = '23514', detail = 'cert-empty'; end if;
  perform set_config('pmo.spc_transition', 'on', true);
  update public.subcontract_certificates set status = 'submitted', submitted_by = auth.uid(), submitted_at = now(), returned_reason = null,
         gross = (d->>'gross')::numeric, backcharge_total = (d->>'backcharge_total')::numeric, net = (d->>'net')::numeric,
         unrated = d->'unrated', excluded = d->'excluded'
   where id = c.id;
  perform set_config('pmo.spc_transition', '', true);
  perform set_config('pmo.spc_freeze', 'on', true);
  for l in select * from jsonb_array_elements(d->'lines') loop
    insert into public.subcontract_certificate_lines (certificate_id, boq_item_id, item_code, unit, measured_quantity, rate, po_rate)
    values (c.id, (l->>'boq_item_id')::uuid, l->>'item_code', l->>'unit', (l->>'measured_quantity')::numeric, (l->>'rate')::numeric, (l->>'po_rate')::numeric);
  end loop;
  begin
    for t in select * from jsonb_array_elements(d->'tuples') loop
      insert into public.subcontract_certificate_claims (certificate_id, work_order_id, work_date, work_order_line_id, crew_id, boq_item_id, quantity)
      values (c.id, c.work_order_id, (t->>'work_date')::date, (t->>'work_order_line_id')::uuid, (t->>'crew_id')::uuid,
              (t->>'boq_item_id')::uuid, (t->>'quantity')::numeric);
    end loop;
  exception when unique_violation then
    raise exception 'some of this measured work is already in another live certificate' using errcode = '23505', detail = 'already-certified';
  end;
  -- the backcharges: claim each under its row lock; one another live certificate holds refuses the whole submit
  perform 1 from public.subcontract_backcharges b join public.subcontract_certificate_backcharges s on s.backcharge_id = b.id
    where s.certificate_id = c.id for update of b;
  select count(*) into v_n from public.subcontract_certificate_backcharges where certificate_id = c.id;
  update public.subcontract_backcharges b set claimed_by_certificate_id = c.id
    from public.subcontract_certificate_backcharges s
   where s.certificate_id = c.id and s.backcharge_id = b.id and b.claimed_by_certificate_id is null and b.archived_at is null;
  get diagnostics v_held = row_count;
  if v_held <> v_n then
    raise exception 'a backcharge in this certificate is already in another live certificate' using errcode = '23505', detail = 'already-certified'; end if;
  update public.subcontract_certificate_backcharges s set amount = b.amount
    from public.subcontract_backcharges b where s.certificate_id = c.id and b.id = s.backcharge_id;
  perform set_config('pmo.spc_freeze', '', true);
  perform public.log_audit('subcontract_certificate.submit', v_org, auth.uid(), c.id, jsonb_build_object(
    'gross', d->'gross', 'backcharge_total', d->'backcharge_total', 'net', d->'net', 'lines', jsonb_array_length(d->'lines')));
end $$;
revoke all on function public.submit_subcontract_certificate(uuid) from public, anon;
grant execute on function public.submit_subcontract_certificate(uuid) to authenticated;

-- Release claims, backcharge claims and (on return) the frozen lines. Caller holds the locks and set the new status first.
create function public.spc_release(p_certificate uuid, p_drop_lines boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('pmo.spc_release', 'on', true);
  delete from public.subcontract_certificate_claims where certificate_id = p_certificate;
  if p_drop_lines then delete from public.subcontract_certificate_lines where certificate_id = p_certificate; end if;
  update public.subcontract_backcharges set claimed_by_certificate_id = null where claimed_by_certificate_id = p_certificate;
  update public.subcontract_certificate_backcharges set amount = null where certificate_id = p_certificate and p_drop_lines;
  perform set_config('pmo.spc_release', '', true);
end $$;
revoke all on function public.spc_release(uuid, boolean) from public, anon, authenticated;

-- ── §4 return (submitted -> returned), Finance or Admin, reason required ─────────────────────────────────
create function public.return_subcontract_certificate(p_certificate uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin', 'Finance') then raise exception 'only Finance and Admin return a certificate' using errcode = '42501'; end if;
  if v_reason is null or char_length(v_reason) > 500 then raise exception 'a return needs a reason' using errcode = '22023'; end if;
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  perform 1 from public.procurements where id = c.procurement_id and org_id = v_org for update;
  perform public.subcontract_po_lock(c.po_id);
  select * into c from public.subcontract_certificates where id = p_certificate for update;
  if c.status <> 'submitted' then raise exception 'only a submitted certificate can be returned' using errcode = '23514'; end if;
  perform set_config('pmo.spc_transition', 'on', true);
  update public.subcontract_certificates set status = 'returned', returned_reason = v_reason, gross = null, backcharge_total = null, net = null,
         unrated = null, excluded = null, submitted_by = null, submitted_at = null where id = c.id;
  perform set_config('pmo.spc_transition', '', true);
  perform public.spc_release(c.id, true);
  perform public.log_audit('subcontract_certificate.return', v_org, auth.uid(), c.id, jsonb_build_object('reason', v_reason));
end $$;
revoke all on function public.return_subcontract_certificate(uuid, text) from public, anon;
grant execute on function public.return_subcontract_certificate(uuid, text) to authenticated;

-- ── §5 cancel (draft | returned | submitted | approved, never billed) ───────────────────────────────────
create function public.cancel_subcontract_certificate(p_certificate uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.assert_is_active_member();
  if v_reason is null or char_length(v_reason) > 500 then raise exception 'a cancellation needs a reason' using errcode = '22023'; end if;
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null or not public.spc_may_prepare(c.project_id) then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  perform 1 from public.procurements where id = c.procurement_id and org_id = v_org for update;
  perform public.subcontract_po_lock(c.po_id);
  select * into c from public.subcontract_certificates where id = p_certificate for update;
  if c.status = 'billed' then raise exception 'a billed certificate cannot be cancelled; void its bill first' using errcode = '23514', detail = 'cert-billed'; end if;
  if c.status = 'cancelled' then raise exception 'this certificate is already cancelled' using errcode = '23514'; end if;
  perform set_config('pmo.spc_transition', 'on', true);
  update public.subcontract_certificates set status = 'cancelled', cancel_reason = v_reason, cancelled_by = auth.uid() where id = c.id;
  perform set_config('pmo.spc_transition', '', true);
  perform public.spc_release(c.id, false);
  perform public.log_audit('subcontract_certificate.cancel', v_org, auth.uid(), c.id, jsonb_build_object('reason', v_reason, 'from', c.status));
end $$;
revoke all on function public.cancel_subcontract_certificate(uuid, text) from public, anon;
grant execute on function public.cancel_subcontract_certificate(uuid, text) to authenticated;

-- ── §6 approve (FR-SPC-012, AC-SPC-006/009/015/018) ─────────────────────────────────────────────────
-- SoD (ADR-0019, OD-SPC-9): the approver is Finance or Admin and is neither the preparer nor the submitter. There is no
-- sole-operator escape: a one-person organisation cannot approve its own certificate.
create function public.approve_subcontract_certificate(p_certificate uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_v jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin', 'Finance') then
    raise exception 'only Finance and Admin approve a certificate' using errcode = '42501'; end if;
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  perform 1 from public.procurements where id = c.procurement_id and org_id = v_org for update;
  perform public.subcontract_po_lock(c.po_id);
  select * into c from public.subcontract_certificates where id = p_certificate for update;
  if c.status <> 'submitted' then raise exception 'only a submitted certificate can be approved' using errcode = '23514'; end if;
  -- SOD-CHECK
  if auth.uid() = c.prepared_by or auth.uid() = c.submitted_by then
    raise exception 'separation of duties: a certificate needs a different approver' using errcode = '42501', detail = 'needs-different-approver'; end if;
  -- /SOD-CHECK
  if jsonb_array_length(coalesce(c.unrated, '[]'::jsonb)) > 0 then
    raise exception 'some measured work has no usable rate; rate it or set it aside' using errcode = '23514', detail = 'cert-unrated'; end if;
  if c.net < 0 then
    raise exception 'the backcharges (%) are more than the gross (%); the net would be negative', c.backcharge_total, c.gross
      using errcode = '23514', detail = 'cert-net-negative'; end if;
  -- CAP-CHECK
  v_v := public.subcontract_bill_cap_violation(c.po_id, (select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'quantity', l.measured_quantity))
                                                          from public.subcontract_certificate_lines l where l.certificate_id = c.id), null);
  if v_v is not null then
    if v_v->>'reason' = 'over_cap' then
      raise exception 'line % cannot be approved: verified %, PO %, billed %, this certificate %',
        v_v->>'item_code', v_v->>'verified', v_v->>'po_qty', v_v->>'billed', v_v->>'requested' using errcode = 'SC001';
    end if;
    raise exception 'the bill cap could not be evaluated (%); approval is refused', v_v->>'reason' using errcode = 'SC001';
  end if;
  -- /CAP-CHECK
  perform set_config('pmo.spc_transition', 'on', true);
  update public.subcontract_certificates set status = 'approved', approved_by = auth.uid(), approved_at = now(), bill_refusal = null, bill_refusal_at = null
   where id = c.id;
  perform set_config('pmo.spc_transition', '', true);
  perform public.log_audit('subcontract_certificate.approve', v_org, auth.uid(), c.id, jsonb_build_object(
    'prepared_by', c.prepared_by, 'submitted_by', c.submitted_by, 'net', c.net));
end $$;
revoke all on function public.approve_subcontract_certificate(uuid) from public, anon;
grant execute on function public.approve_subcontract_certificate(uuid) to authenticated;

-- ── §7 bill (FR-SPC-014/015/016, AC-SPC-010/013) ────────────────────────────────────────────────────
-- One call to the shipped capture with the frozen lines at the frozen rates, then the work order through the shipped
-- attribution seam, then the deduction and the link. If the capture refuses (cap, lock, closed purchase, a PO revision that
-- moved) nothing is half-written: the sub-transaction rolls back, the certificate stays approved and shows the refusal.
create function public.bill_subcontract_certificate(
  p_certificate uuid, p_invoice_date date, p_reference_number text default null, p_notes text default null,
  p_tax_treatment text default 'exclusive', p_tax_amount numeric default 0, p_tax_rate numeric default null, p_tax_template text default null)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); c public.subcontract_certificates; v_lines jsonb; v_amount numeric; v_inv public.procurement_invoices;
        v_state text; v_msg text; v_detail text;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin', 'Finance') then raise exception 'only Finance and Admin bill a certificate' using errcode = '42501'; end if;
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = v_org;
  if c.id is null then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  perform 1 from public.procurements where id = c.procurement_id and org_id = v_org for update;
  perform public.subcontract_po_lock(c.po_id);
  select * into c from public.subcontract_certificates where id = p_certificate for update;
  if c.status = 'billed' then raise exception 'this certificate is already billed' using errcode = '23505', detail = 'cert-billed'; end if;
  if c.status <> 'approved' then raise exception 'only an approved certificate can be billed' using errcode = '23514'; end if;
  if c.backcharge_total > 0 and (exists (select 1 from public.external_org_bindings b where b.org_id = v_org and b.status = 'active')
                                 or public.domain_externally_owned(v_org, 'procurement')) then
    raise exception 'this organisation records bills in its ERP; a certificate with backcharges waits for the ERP route to carry the deduction'
      using errcode = '42501', detail = 'erp-deduction-unsupported'; end if;
  select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'quantity', l.measured_quantity, 'rate', l.rate) order by l.item_code),
         sum(l.amount) into v_lines, v_amount
    from public.subcontract_certificate_lines l where l.certificate_id = c.id;
  if v_lines is null or v_amount is distinct from c.gross then
    raise exception 'the frozen lines do not add up to the certificate; billing is refused' using errcode = 'SC001'; end if;
  begin
    perform set_config('pmo.spc_transition', 'on', true);
    v_inv := public.capture_subcontract_vendor_invoice(
      p_procurement_id => c.procurement_id, p_status => 'Received', p_invoice_date => p_invoice_date, p_lines => v_lines,
      p_reference_number => p_reference_number,
      p_amount => case when btrim(coalesce(p_tax_treatment, '')) = 'inclusive' then v_amount + coalesce(p_tax_amount, 0) else v_amount end,
      p_notes => p_notes, p_tax_treatment => coalesce(p_tax_treatment, 'exclusive'), p_tax_amount => coalesce(p_tax_amount, 0),
      p_tax_rate => p_tax_rate, p_tax_template => p_tax_template);
    perform public.set_cost_attribution('vendor_bill', array[v_inv.id], c.work_order_id, v_inv.discipline_id);   -- 0951 §5
    perform set_config('pmo.spc_bill', 'on', true);
    update public.procurement_invoices set deduction_amount = c.backcharge_total, certificate_id = c.id where id = v_inv.id;
    perform set_config('pmo.spc_bill', '', true);
    update public.subcontract_certificates set status = 'billed', invoice_id = v_inv.id, billed_at = now(), bill_refusal = null, bill_refusal_at = null
     where id = c.id;
    perform set_config('pmo.spc_transition', '', true);
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    v_state := sqlstate;
    if v_state in ('SC001', 'SC002', '42501', '23514', '23505', 'P0002', '22023') then
      update public.subcontract_certificates set bill_refusal = left(v_msg, 500), bill_refusal_at = now() where id = c.id;
      return jsonb_build_object('status', 'refused', 'code', v_state, 'message', v_msg);
    end if;
    raise;
  end;
  perform public.log_audit('subcontract_certificate.bill', v_org, auth.uid(), c.id, jsonb_build_object(
    'invoice_id', v_inv.id, 'gross', c.gross, 'deduction', c.backcharge_total, 'payable', c.net));
  return jsonb_build_object('status', 'billed', 'invoice_id', v_inv.id, 'payable', c.net);
end $$;
revoke all on function public.bill_subcontract_certificate(uuid, date, text, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.bill_subcontract_certificate(uuid, date, text, text, text, numeric, numeric, text) to authenticated;

-- ── §8 the void hook (FR-SPC-017, AC-SPC-014) ───────────────────────────────────────────────────────
-- The shipped void (0885) knows nothing of certificates. When it voids a bill that came from a certificate, this returns
-- the certificate to approved (it may be billed again, or cancelled to release its work). Every failure is swallowed into a
-- warning: a certificate problem can never block a void.
create function public.spc_on_bill_void() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.voided_at is not null and old.voided_at is null and new.certificate_id is not null then
    begin
      perform set_config('pmo.spc_transition', 'on', true);
      update public.subcontract_certificates set status = 'approved', invoice_id = null, billed_at = null
       where id = new.certificate_id and status = 'billed' and invoice_id = new.id;
      perform set_config('pmo.spc_transition', '', true);
      perform public.log_audit('subcontract_certificate.bill_voided', new.org_id, auth.uid(), new.certificate_id,
        jsonb_build_object('invoice_id', new.id));
    exception when others then
      raise warning 'certificate % was not returned to approved after its bill % was voided: %', new.certificate_id, new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;
revoke all on function public.spc_on_bill_void() from public, anon, authenticated;
create trigger procurement_invoices_zz_certificate_void after update of voided_at on public.procurement_invoices
  for each row execute function public.spc_on_bill_void();

do $$
begin
  if has_function_privilege('authenticated', 'public.spc_release(uuid,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.spc_on_bill_void()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_payment_net_of_deduction()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_invoice_deduction()', 'EXECUTE') then
    raise exception '1137: an internal certificate function is client-executable'; end if;
  if has_function_privilege('anon', 'public.approve_subcontract_certificate(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.bill_subcontract_certificate(uuid,date,text,text,text,numeric,numeric,text)', 'EXECUTE') then
    raise exception '1137: a certificate function is anon-executable'; end if;
end $$;
