-- 0885_void_subcontract_bill.sql — #1671: an organisation with no ERP voids a mistyped subcontract bill.
-- Soft void: the row and its lines stay. The void writes the shared cancel tombstone (erp_cancelled_at, the
-- system-neutral "not live" stamp since 0506) so every shipped live-bill predicate honours it unchanged — the cap
-- (subcontract_billed), the position read, the cap-exceptions read, the attribute and e-Faktur RPCs, create_payment's
-- billed-gross sum and the recorded-total trigger — and records who/when/why in voided_*.
-- SoD (ADR-0019): the bill's author (the actor of its create audit) may not void it unless they are the organisation's
-- sole active member; a bill with no recorded author is refused. Only Admin/Finance (the post-capture bill writers).
-- Only PMO-native subcontract bills with BoQ lines, only in an organisation with no ERP. The purchase keeps its status.
-- Plan docs/plans/2026-11-15-void-subcontract-bill.md. Proven by supabase/tests/subcontract_bill_void.test.sql.
-- Rollback: rollback/0885_void_subcontract_bill_down.sql (refused while a voided bill exists).

-- §1 The native void facts.
alter table public.procurement_invoices
  add column voided_at   timestamptz,
  add column voided_by   uuid references public.profiles(id) on delete set null,
  add column void_reason text;
alter table public.procurement_invoices add constraint procurement_invoices_void_shape check (
  (voided_at is null and voided_by is null and void_reason is null)
  or (voided_at is not null and void_reason is not null
      and length(btrim(void_reason)) between 1 and 1000
      and erp_cancelled_at is not distinct from voided_at));
comment on column public.procurement_invoices.voided_at is
  '#1671: when a PMO-native subcontract bill was voided (erp_cancelled_at carries the same instant). Written only by void_subcontract_bill.';

-- Change history (record_changes_catalog_gate): classified as the withholding-slip void is (0281) — who and when are
-- captured, the free-text reason is a flag.
update public.record_history_config
   set captured = captured || '{"voided_at":"timestamp","voided_by":"ref"}'::jsonb,
       flag_cols = flag_cols || array['void_reason']
 where table_name = 'procurement_invoices';

-- §2 Only the void writes them, and a voided bill stays voided. Applies to every role (the ERP mirror never voids).
-- The one permitted change after a void is voided_by -> null from the profiles FK (on delete set null).
create function public.guard_procurement_invoice_void() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and old.voided_at is not null then
    if new.voided_at is distinct from old.voided_at
       or new.void_reason is distinct from old.void_reason
       or new.erp_cancelled_at is distinct from old.erp_cancelled_at
       or (new.voided_by is distinct from old.voided_by and new.voided_by is not null) then
      raise exception 'a voided bill stays voided' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.voided_at is not null or new.voided_by is not null or new.void_reason is not null)
     and (tg_op = 'INSERT' or coalesce(current_setting('pmo.bill_void', true), '') <> 'on') then
    raise exception 'a bill is voided only through void_subcontract_bill' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_invoice_void() from public, anon, authenticated;
create trigger procurement_invoices_void_guard before insert or update on public.procurement_invoices
  for each row execute function public.guard_procurement_invoice_void();

-- §3 A voided bill is never paid (FR-SCV-007). create_payment already leaves it out of the billed gross; this closes
-- the invoice_id reference without rewriting create_payment.
create function public.guard_payment_voided_bill() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.invoice_id is not null
     and exists (select 1 from public.procurement_invoices i where i.id = new.invoice_id and i.voided_at is not null) then
    raise exception 'this bill is voided; it cannot be paid' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_payment_voided_bill() from public, anon, authenticated;
create trigger payments_zz_voided_bill before insert or update of invoice_id on public.payments
  for each row execute function public.guard_payment_voided_bill();

-- §4 The void. Lock order D5 (procurement row, PO advisory lock, invoice row), the same as the capture and the attribute.
create function public.void_subcontract_bill(p_invoice_id uuid, p_reason text)
  returns public.procurement_invoices language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_reason text := nullif(btrim(p_reason), '');
        v_inv public.procurement_invoices; v_proc public.procurements; v_capturer uuid; v_sole boolean := false;
        v_paid numeric; v_left numeric; v_now timestamptz := clock_timestamp();
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then                        -- the post-capture bill writers (attribute, e-Faktur)
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 1000 then
    raise exception 'a void needs a reason of 1 to 1000 characters' using errcode = '22023';
  end if;
  select * into v_inv from public.procurement_invoices where id = p_invoice_id and org_id = v_org;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_inv.procurement_id and org_id = v_org for update;   -- D5 row first
  perform public.assert_feature_on(v_org, 'procurement');
  if exists (select 1 from public.external_org_bindings b where b.org_id = v_org and b.status = 'active')
     or public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'this organisation records bills in its ERP; cancel the bill there'
      using errcode = '42501', detail = 'void-erp-bound';
  end if;
  if v_inv.po_id is not null then perform public.subcontract_po_lock(v_inv.po_id); end if;                       -- D5 then the PO
  select * into v_inv from public.procurement_invoices where id = p_invoice_id for update;                        -- re-read under the locks
  if v_inv.voided_at is not null then
    raise exception 'this bill is already voided' using errcode = '23514', detail = 'void-already';
  end if;
  if not public.subcontract_bill_is_live(v_inv.erp_docstatus, v_inv.erp_cancelled_at) then
    raise exception 'this bill is cancelled' using errcode = '23514';
  end if;
  if v_inv.external_ref is not null or v_inv.erp_docstatus is not null or v_proc.record_only then
    raise exception 'this bill came from an ERP record; it cannot be voided in PMO'
      using errcode = '42501', detail = 'void-erp-record';
  end if;
  if not v_proc.is_subcontract or v_inv.po_id is null
     or not exists (select 1 from public.procurement_invoice_lines l where l.invoice_id = v_inv.id) then
    raise exception 'only a subcontract bill with BoQ lines can be voided here' using errcode = 'SC002';
  end if;
  -- SoD (ADR-0019, FR-SCV-003): the author is the actor of the bill's create audit (audit_procurement_invoice_insert).
  select e.actor_id into v_capturer from public.audit_events e
   where e.org_id = v_org and e.entity_id = v_inv.id and e.action = 'procurement_invoice.create'
   order by e.created_at limit 1;
  if v_capturer is null then
    raise exception 'the author of this bill is not recorded; it cannot be voided'
      using errcode = '42501', detail = 'void-author-unknown';
  end if;
  if v_capturer = v_uid then
    select count(*) = 1 and bool_or(p.id = v_uid) into v_sole
      from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole, false) then
      raise exception 'separation of duties: the person who captured this bill cannot void it'
        using errcode = '42501', detail = 'void-own-bill';
    end if;
  end if;
  -- Payments (FR-SCV-005): the same live predicate and currency rule create_payment uses.
  if exists (select 1 from public.payments pay where pay.invoice_id = v_inv.id
              and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null) then
    raise exception 'this bill has a payment; cancel the payment first' using errcode = '23514', detail = 'void-has-payment';
  end if;
  select coalesce(sum(pay.amount), 0) into v_paid from public.payments pay
   where pay.procurement_id = v_proc.id and coalesce(pay.currency, v_proc.currency) = v_proc.currency
     and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null;
  select coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then i.tax_amount else 0 end), 0) into v_left
    from public.procurement_invoices i
   where i.procurement_id = v_proc.id and i.id <> v_inv.id and i.amount is not null
     and coalesce(i.currency, v_proc.currency) = v_proc.currency
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null;
  if v_paid > v_left then
    raise exception 'payments on this purchase would exceed its remaining bills; cancel a payment first'
      using errcode = '23514', detail = 'void-payments-exceed';
  end if;
  perform set_config('pmo.bill_void', 'on', true);
  update public.procurement_invoices
     set voided_at = v_now, voided_by = v_uid, void_reason = v_reason, erp_cancelled_at = v_now
   where id = v_inv.id
  returning * into v_inv;
  perform set_config('pmo.bill_void', '', true);
  perform public.log_audit('procurement_invoice.void', v_org, v_uid, v_inv.id, jsonb_build_object(
    'procurement_id', v_proc.id, 'po_id', v_inv.po_id, 'vi_number', v_inv.vi_number, 'amount', v_inv.amount,
    'reason', v_reason, 'captured_by', v_capturer,
    'basis', case when v_capturer = v_uid then 'sole_operator' else 'standard' end));
  return v_inv;
end $$;
revoke all on function public.void_subcontract_bill(uuid, text) from public, anon, authenticated;
grant execute on function public.void_subcontract_bill(uuid, text) to authenticated;

-- §5 Closing self-assertion.
do $$
begin
  if has_function_privilege('anon', 'public.void_subcontract_bill(uuid,text)', 'EXECUTE') then
    raise exception '0885: void_subcontract_bill is anon-executable'; end if;
  if has_function_privilege('authenticated', 'public.guard_procurement_invoice_void()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_payment_voided_bill()', 'EXECUTE') then
    raise exception '0885: a void guard is client-executable'; end if;
end $$;
