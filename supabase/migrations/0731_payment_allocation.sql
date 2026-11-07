-- 0731_payment_allocation.sql — #1415: apply a payment to one or more invoices, for an org whose revenue no ERP owns.
-- Plan: docs/plans/2026-11-07-payment-allocation.md. Follows 0275 (#784 native revenue). Rollback: supabase/migrations/rollback/0731_payment_allocation_down.sql.
--
-- Shape: a native receipt (incoming_payments.pmo_native) may now be ON ACCOUNT (no invoice) and is applied to invoices through a new
-- table, incoming_payment_allocations, which becomes the ONLY authority for "what settles an invoice" (native_invoice_settled sums it).
-- incoming_payments.sales_invoice_id on a native receipt is now only the origin pointer ("recorded from this invoice").
--   record_native_receipt             unchanged signature and meaning (receipt + settle one invoice, overpay allowed, DD-NAR-17); now also
--                                     writes the receipt's one allocation
--   record_native_on_account_receipt  NEW  a receipt for a customer with no invoice; the client-minted receipt id makes a replay safe
--   apply_native_receipt              NEW  applies a receipt across 1..50 invoices; over-allocation is refused (no overpay on this path)
--   unapply_native_allocation         NEW  reverses one allocation (soft: reversed_at), restating its invoice
--   cancel_native_receipt             now reverses every live allocation of the receipt in the same transaction
-- LOCK ORDER (every writer): org row (FOR SHARE) -> invoices in ascending id -> receipt. pgTAP proves it on the shipped bodies.
-- Writes exist only inside these definer RPCs; the table additionally defends itself (ipa_consistency, the amount trigger), so a
-- service_role writer cannot over-allocate either. The readers that treated a native receipt's invoice link as THE link
-- (get_project_finances' cash, invoice_pair_candidates, list_unpaired_native_invoices) are re-created in §6 and read allocations.
-- ⚑ Hosted Supabase grants EXECUTE on new public functions to anon/authenticated (0185/0210): §7 asserts the result on the database itself.
-- Refusals the UI words carry a stable `detail` code (listed on each raise).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — a native receipt needs a customer, not an invoice (on account). Every existing native row has its customer
-- (record_native_receipt stamped it from the invoice); the DO block makes the migration refuse if one does not.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.incoming_payments where pmo_native and customer_id is null;
  if v_bad > 0 then
    raise exception '0731: % native receipt(s) have no customer; the relaxed shape check would refuse them', v_bad;
  end if;
end $$;
alter table public.incoming_payments drop constraint incoming_payments_pmo_native_shape;
alter table public.incoming_payments add constraint incoming_payments_pmo_native_shape check (
  not pmo_native or (ip_number is null and erp_docstatus is null and customer_id is not null));

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — the allocation table. RLS forced; authenticated reads its own org (Engineer excluded, as for receipts, 0350);
-- nobody but the definer RPCs writes. service_role keeps full DML (the 0137 catalog backstop).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.incoming_payment_allocations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  incoming_payment_id uuid not null references public.incoming_payments(id) on delete restrict,
  sales_invoice_id    uuid not null references public.sales_invoices(id) on delete restrict,
  amount              numeric(14,2) not null check (amount > 0),
  cash_amount         numeric(14,2) not null check (cash_amount >= 0),
  withheld_amount     numeric(14,2) not null check (withheld_amount >= 0),
  currency            text not null,
  request_id          uuid not null,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  reversed_at         timestamptz,
  reversed_by         uuid references public.profiles(id),
  constraint ipa_split check (cash_amount + withheld_amount = amount),
  constraint ipa_reversal_pair check (reversed_at is not null or reversed_by is null),   -- a backfilled reversal has no actor
  constraint ipa_request_uniq unique (incoming_payment_id, request_id, sales_invoice_id)
);
comment on table public.incoming_payment_allocations is
  '#1415: what a PMO-native receipt settles on each invoice. The only authority for an invoice''s settled figure (native_invoice_settled). cash/withheld split the allocation so project cash is attributed by what was actually received. Written only by the definer RPCs; reversed (reversed_at), never deleted.';
create index ipa_invoice_live_idx on public.incoming_payment_allocations (org_id, sales_invoice_id) where reversed_at is null;
create index ipa_receipt_live_idx on public.incoming_payment_allocations (incoming_payment_id) where reversed_at is null;
create trigger incoming_payment_allocations_stamp_org_id
  before insert on public.incoming_payment_allocations for each row execute function public.stamp_org_id();   -- 0074 pattern
alter table public.incoming_payment_allocations enable row level security;
alter table public.incoming_payment_allocations force row level security;
revoke all on public.incoming_payment_allocations from public, anon, authenticated;
grant select on public.incoming_payment_allocations to authenticated;
grant select, insert, update, delete on public.incoming_payment_allocations to service_role;
create policy ipa_select on public.incoming_payment_allocations for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));          -- the incoming_payments_select predicate, 0646 init-plan form
create policy ipa_engineer_read_scope on public.incoming_payment_allocations
  as restrictive for select to authenticated
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance'));   -- the receipts read set (0350)
-- NO insert/update/delete policy for authenticated: writes exist only inside the definer RPCs below.

-- ipa_consistency: defence for any writer that is not the RPCs (service_role, the table owner). Same org, PMO receipt and invoice,
-- same customer, same currency, and the live allocations of a receipt never exceed it. A reversal can only free room, so it is let through.
-- The receipt row is locked FOR UPDATE so two raw writers cannot both pass the sum check.
create or replace function public.ipa_consistency() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_rc   public.incoming_payments%rowtype;
  v_si   public.sales_invoices%rowtype;
  v_live numeric;
begin
  if new.reversed_at is not null then
    return new;
  end if;
  select * into v_rc from public.incoming_payments where id = new.incoming_payment_id for update;
  select * into v_si from public.sales_invoices where id = new.sales_invoice_id;
  if v_rc.org_id is distinct from new.org_id or v_si.org_id is distinct from new.org_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not v_rc.pmo_native or not v_si.pmo_native then
    raise exception 'only PMO receipts and PMO invoices take allocations' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  if v_rc.customer_id is distinct from v_si.customer_id then
    raise exception 'the receipt and the invoice belong to different customers' using errcode = '23514', detail = 'allocation-client-mismatch';
  end if;
  if v_rc.currency is distinct from v_si.currency or new.currency is distinct from v_rc.currency then
    raise exception 'the receipt, the invoice and the allocation must be in one currency' using errcode = '23514', detail = 'allocation-currency-mismatch';
  end if;
  select coalesce(sum(a.amount), 0) into v_live from public.incoming_payment_allocations a
   where a.incoming_payment_id = new.incoming_payment_id and a.reversed_at is null and a.id is distinct from new.id;
  if v_live + new.amount > v_rc.amount then
    raise exception 'the allocations of a receipt cannot exceed the receipt' using errcode = '23514', detail = 'allocation-exceeds-receipt';
  end if;
  return new;
end; $$;
revoke all on function public.ipa_consistency() from public, anon, authenticated;
create trigger incoming_payment_allocations_consistency
  before insert or update of incoming_payment_id, sales_invoice_id, amount, reversed_at, org_id, currency
  on public.incoming_payment_allocations for each row execute function public.ipa_consistency();

-- A receipt is never lowered below what is allocated from it. (authenticated cannot UPDATE amount on incoming_payments today, so this
-- is the same belt-and-braces as ipa_consistency: it binds service_role and the owner.)
create or replace function public.incoming_payments_amount_covers_allocations() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.amount < (select coalesce(sum(a.amount), 0) from public.incoming_payment_allocations a
                    where a.incoming_payment_id = new.id and a.reversed_at is null) then
    raise exception 'a receipt cannot be lowered below what is allocated from it' using errcode = '23514', detail = 'amount-below-allocations';
  end if;
  return new;
end; $$;
revoke all on function public.incoming_payments_amount_covers_allocations() from public, anon, authenticated;
create trigger incoming_payments_amount_covers_allocations
  before update of amount on public.incoming_payments
  for each row when (new.amount is distinct from old.amount)
  execute function public.incoming_payments_amount_covers_allocations();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — native_invoice_settled now sums the invoice's LIVE allocations (same signature, so its no-client-EXECUTE grants survive).
-- native_invoice_restate and transition_native_sales_invoice call it and need no text change.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.native_invoice_settled(p_org uuid, p_si_id uuid) returns numeric
  language sql stable set search_path = public as $$
  select coalesce(sum(a.amount), 0)
    from public.incoming_payment_allocations a
   where a.org_id = p_org and a.sales_invoice_id = p_si_id and a.reversed_at is null
$$;
revoke all on function public.native_invoice_settled(uuid, uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — backfill: every existing native receipt becomes one allocation for its whole amount (reversed when the receipt is
-- cancelled). Idempotent; kept so the pgTAP before/after test can re-run it. Then the migration proves nothing moved.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.native_receipt_allocations_backfill() returns int
  language sql security definer set search_path = public as $$
  with ins as (
    insert into public.incoming_payment_allocations
      (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id,
       created_at, reversed_at, reversed_by)
    select ip.org_id, ip.id, ip.sales_invoice_id, ip.amount, coalesce(ip.received_amount, ip.amount - coalesce(ip.withheld_amount, 0)), coalesce(ip.withheld_amount, 0), ip.currency,
           ip.id,                                   -- request_id: the receipt's own id (deterministic, replay-safe)
           ip.created_at, ip.cancelled_at, null::uuid
      from public.incoming_payments ip
     where ip.pmo_native and ip.sales_invoice_id is not null
       -- ipa_consistency fires BEFORE the conflict check, so an already-backfilled receipt is skipped here, not by ON CONFLICT alone.
       and not exists (select 1 from public.incoming_payment_allocations a
                        where a.incoming_payment_id = ip.id and a.request_id = ip.id and a.sales_invoice_id = ip.sales_invoice_id)
    on conflict on constraint ipa_request_uniq do nothing
    returning 1)
  select count(*)::int from ins
$$;
revoke all on function public.native_receipt_allocations_backfill() from public, anon, authenticated;

select public.native_receipt_allocations_backfill();

do $$
declare v_bad int;
begin
  select count(*) into v_bad from (
    select si.id,
           coalesce((select sum(ip.amount) from public.incoming_payments ip
                      where ip.org_id = si.org_id and ip.sales_invoice_id = si.id and ip.pmo_native and ip.cancelled_at is null), 0) as legacy,
           public.native_invoice_settled(si.org_id, si.id) as migrated
      from public.sales_invoices si where si.pmo_native) x
   where x.legacy is distinct from x.migrated;
  if v_bad > 0 then
    raise exception '0731: % PMO invoice(s) settle differently after the backfill', v_bad;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — the RPCs. Every definer body: active member -> (feature) -> role -> org row FOR SHARE -> ERP-ownership refusal -> row locks.
-- The org-row share lock serialises with an ERP take-over of revenue (the lock create_native_sales_invoice and cancel take).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- record_native_receipt: 0534's body, plus the receipt's one allocation (for the whole amount, keyed on the receipt's own id).
create or replace function public.record_native_receipt(
  p_sales_invoice_id        uuid,
  p_amount                  numeric default null,
  p_received_amount         numeric default null,
  p_withheld_amount         numeric default null,
  p_withholding_slip_number text    default null,
  p_date                    date    default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_si       public.sales_invoices%rowtype;
  v_role     user_role := public.auth_role();
  v_withheld numeric   := coalesce(p_withheld_amount, 0);
  v_amount   numeric;
  v_received numeric;
  v_today    date;
  v_id       uuid      := gen_random_uuid();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  perform public.assert_feature_on(public.auth_org_id(), 'revenue');
  select * into v_si from public.sales_invoices where id = p_sales_invoice_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_si.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can record a customer receipt' using errcode = '42501';
  end if;
  if not v_si.pmo_native then
    raise exception 'receipts for an ERP invoice are recorded in the ERP' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  if public.domain_externally_owned(v_si.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  if v_si.status is distinct from 'Unpaid' then
    raise exception 'a receipt can be recorded only against an approved invoice that is not fully paid'
      using errcode = 'P0001', detail = 'invoice-not-receivable';
  end if;

  -- DD-NAR-17: the payment date is stated by the caller, never later than today in the org's time zone and never
  -- before the invoice's own date.
  v_today := public.native_org_today(v_si.org_id);
  if p_date is null then
    raise exception 'a receipt needs its payment date' using errcode = '23502', detail = 'payment-date-missing';
  end if;
  if p_date > v_today then
    raise exception 'the payment date cannot be in the future' using errcode = '23514', detail = 'payment-date-future';
  end if;
  if p_date < v_si.invoice_date then
    raise exception 'the payment date cannot be before the invoice date' using errcode = '23514', detail = 'payment-date-before-invoice';
  end if;

  -- DD-NAR-17: no amount stated settles what is outstanding (the restated balance); a different amount (less or
  -- more) is recorded as given. Every figure is bounded below the numeric(14,2) ceiling, as create bounds its total.
  v_amount := coalesce(p_amount, (public.native_invoice_restate(p_sales_invoice_id)).erp_outstanding_amount);
  if not coalesce(v_amount > 0 and v_amount < 1000000000000 and v_amount = round(v_amount, 2), false) then
    raise exception 'the receipt amount must be a positive number with at most 2 decimals' using errcode = '23514', detail = 'receipt-amount-invalid';
  end if;
  if not coalesce(v_withheld >= 0 and v_withheld < 1000000000000 and v_withheld = round(v_withheld, 2), false) then
    raise exception 'the tax withheld must be zero or more with at most 2 decimals' using errcode = '23514', detail = 'withheld-amount-invalid';
  end if;
  v_received := coalesce(p_received_amount, v_amount - v_withheld);
  if not coalesce(v_received >= 0 and v_received = round(v_received, 2) and v_received + v_withheld = v_amount, false) then
    raise exception 'cash received plus tax withheld must equal the amount settled' using errcode = '23514', detail = 'receipt-split-mismatch';
  end if;
  if v_withheld > 0 and nullif(btrim(p_withholding_slip_number), '') is null then
    raise exception 'tax withheld needs its withholding-slip number' using errcode = '23514', detail = 'withholding-slip-missing';
  end if;

  insert into public.incoming_payments
    (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount, withheld_amount,
     withholding_slip_number, currency, status, pmo_native, pmo_number)
  values
    (v_id, v_si.org_id, v_si.customer_id, p_sales_invoice_id, p_date, v_amount, v_received, v_withheld,
     nullif(btrim(p_withholding_slip_number), ''), v_si.currency, 'Paid', true,
     public.native_revenue_doc_number(v_si.org_id, 'RCV', v_today));
  -- 0731: the invoice's settled figure is its live allocations, so the direct receipt allocates its whole amount to its own invoice.
  insert into public.incoming_payment_allocations
    (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id, created_by)
  values
    (v_si.org_id, v_id, p_sales_invoice_id, v_amount, v_received, v_withheld, v_si.currency, v_id, auth.uid());

  perform public.native_invoice_restate(p_sales_invoice_id);
  return v_id;
end; $$;

-- record_native_on_account_receipt: a receipt for a customer with no invoice. p_receipt_id is the client-minted idempotency key.
create or replace function public.record_native_on_account_receipt(
  p_customer_id             uuid,
  p_amount                  numeric,
  p_received_amount         numeric default null,
  p_withheld_amount         numeric default null,
  p_withholding_slip_number text    default null,
  p_date                    date    default null,
  p_receipt_id              uuid    default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid      := public.auth_org_id();
  v_uid      uuid      := auth.uid();
  v_role     user_role := public.auth_role();
  v_withheld numeric   := coalesce(p_withheld_amount, 0);
  v_received numeric;
  v_today    date;
  v_id       uuid      := coalesce(p_receipt_id, gen_random_uuid());
  v_slip     text      := nullif(btrim(p_withholding_slip_number), '');
  v_ex       public.incoming_payments%rowtype;
  v_cnt      int;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  perform public.assert_feature_on(v_org, 'revenue');
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can record a customer receipt' using errcode = '42501';
  end if;
  -- Serialise with an ERP take-over of revenue BEFORE reading who owns it (the create_native_sales_invoice lock).
  perform 1 from public.organizations o where o.id = v_org for share;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_customer_id and c.org_id = v_org and c.type = 'Client') then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  v_today := public.native_org_today(v_org);
  if p_date is null then
    raise exception 'a receipt needs its payment date' using errcode = '23502', detail = 'payment-date-missing';
  end if;
  if p_date > v_today then
    raise exception 'the payment date cannot be in the future' using errcode = '23514', detail = 'payment-date-future';
  end if;
  if not coalesce(p_amount > 0 and p_amount < 1000000000000 and p_amount = round(p_amount, 2), false) then
    raise exception 'the receipt amount must be a positive number with at most 2 decimals' using errcode = '23514', detail = 'receipt-amount-invalid';
  end if;
  if not coalesce(v_withheld >= 0 and v_withheld < 1000000000000 and v_withheld = round(v_withheld, 2), false) then
    raise exception 'the tax withheld must be zero or more with at most 2 decimals' using errcode = '23514', detail = 'withheld-amount-invalid';
  end if;
  v_received := coalesce(p_received_amount, p_amount - v_withheld);
  if not coalesce(v_received >= 0 and v_received = round(v_received, 2) and v_received + v_withheld = p_amount, false) then
    raise exception 'cash received plus tax withheld must equal the amount settled' using errcode = '23514', detail = 'receipt-split-mismatch';
  end if;
  if v_withheld > 0 and v_slip is null then
    raise exception 'tax withheld needs its withholding-slip number' using errcode = '23514', detail = 'withholding-slip-missing';
  end if;

  -- Idempotency: the same id and payload returns the receipt; the same id with another payload is refused; an id that is
  -- another org's is refused without saying whose it is.
  -- Unlocked read first (a replay burns no document number); the insert is on conflict do nothing, so two simultaneous
  -- identical calls both end in the compare below, never a unique violation.
  select * into v_ex from public.incoming_payments where id = v_id;
  if not found then
    insert into public.incoming_payments
      (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount, withheld_amount,
       withholding_slip_number, status, pmo_native, pmo_number)
    values
      (v_id, v_org, p_customer_id, null, p_date, p_amount, v_received, v_withheld, v_slip, 'Paid', true,
       public.native_revenue_doc_number(v_org, 'RCV', v_today))   -- currency: the org's, stamped by the 0187 trigger
    on conflict (id) do nothing;
    get diagnostics v_cnt = row_count;
    if v_cnt = 0 then
      select * into v_ex from public.incoming_payments where id = v_id;
    end if;
  end if;
  if v_ex.id is not null then
    if v_ex.org_id is distinct from v_org then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    if v_ex.pmo_native and v_ex.sales_invoice_id is null and v_ex.cancelled_at is null
       and v_ex.customer_id = p_customer_id and v_ex.amount = p_amount and v_ex.received_amount = v_received
       and v_ex.withheld_amount = v_withheld and v_ex.withholding_slip_number is not distinct from v_slip and v_ex.date = p_date then
      return v_id;
    end if;
    raise exception 'this receipt id was already used for a different receipt' using errcode = 'P0001', detail = 'request-id-reused';
  end if;

  perform public.log_audit('incoming_payment.on_account', v_org, v_uid, v_id,
    jsonb_build_object('customer_id', p_customer_id, 'amount', p_amount, 'received_amount', v_received, 'withheld_amount', v_withheld));
  return v_id;
end; $$;

-- apply_native_receipt: the owner's "apply across one or more invoices". Stricter than the direct path: no over-allocation.
create or replace function public.apply_native_receipt(p_receipt_id uuid, p_allocations jsonb, p_request_id uuid)
  returns uuid[]
  language plpgsql security definer set search_path = public as $$
declare
  v_org      uuid      := public.auth_org_id();
  v_uid      uuid      := auth.uid();
  v_role     user_role := public.auth_role();
  v_n        int;
  v_i        int;
  v_el       jsonb;
  v_a        numeric;
  v_inv      uuid[]    := '{}';
  v_amt      numeric[] := '{}';
  v_cnt      int;
  v_rc       public.incoming_payments%rowtype;
  v_si       public.sales_invoices%rowtype;
  v_prior    int;
  v_total    numeric;
  v_unapplied numeric;
  v_cash_used numeric;
  v_wh_used  numeric;
  v_cash     numeric;
  v_id       uuid;
  v_ids      uuid[]    := '{}';
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  perform public.assert_feature_on(v_org, 'revenue');
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can apply a customer receipt' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = v_org for share;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;

  if p_request_id is null then
    raise exception 'an apply needs its request id' using errcode = '23502', detail = 'request-id-missing';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
     or jsonb_array_length(p_allocations) < 1 or jsonb_array_length(p_allocations) > 50 then
    raise exception 'apply the receipt to between 1 and 50 invoices' using errcode = '23514', detail = 'allocation-amount-invalid';
  end if;
  v_n := jsonb_array_length(p_allocations);
  for v_i in 0 .. v_n - 1 loop
    v_el := p_allocations -> v_i;
    -- CASE-free shape check: anything that is not {invoice_id: uuid string, amount: number} is refused, never cast.
    if jsonb_typeof(v_el) is distinct from 'object'
       or jsonb_typeof(v_el -> 'invoice_id') is distinct from 'string'
       or jsonb_typeof(v_el -> 'amount') is distinct from 'number'
       or (v_el ->> 'invoice_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'each line needs an invoice and an amount' using errcode = '23514', detail = 'allocation-amount-invalid';
    end if;
    v_a := (v_el ->> 'amount')::numeric;
    if not (v_a > 0 and v_a < 1000000000000 and v_a = round(v_a, 2)) then
      raise exception 'each amount must be above zero with at most 2 decimals' using errcode = '23514', detail = 'allocation-amount-invalid';
    end if;
    v_inv := v_inv || (v_el ->> 'invoice_id')::uuid;
    v_amt := v_amt || v_a;
  end loop;
  if (select count(distinct x) from unnest(v_inv) x) <> v_n then
    raise exception 'an invoice can appear once in an apply' using errcode = '23514', detail = 'allocation-duplicate-invoice';
  end if;
  select coalesce(sum(x), 0) into v_total from unnest(v_amt) x;

  -- Locks: invoices in ascending id (of the caller's org only), then the receipt. A foreign or missing id is one generic "not found".
  perform 1 from public.sales_invoices si where si.id = any(v_inv) and si.org_id = v_org order by si.id for update;
  get diagnostics v_cnt = row_count;
  if v_cnt <> v_n then
    raise exception 'receipt or invoice not found' using errcode = 'P0002';
  end if;
  select * into v_rc from public.incoming_payments where id = p_receipt_id and org_id = v_org for update;
  if not found then
    raise exception 'receipt or invoice not found' using errcode = 'P0002';
  end if;
  if not v_rc.pmo_native or v_rc.cancelled_at is not null or v_rc.status is distinct from 'Paid' then
    raise exception 'this receipt cannot take an allocation' using errcode = 'P0001', detail = 'receipt-not-applicable';
  end if;

  -- Idempotency: the same request on this receipt returns its ids; the same request id with another payload is refused.
  select count(*) into v_prior from public.incoming_payment_allocations a
   where a.incoming_payment_id = p_receipt_id and a.request_id = p_request_id;
  if v_prior > 0 then
    if v_prior = v_n and not exists (
         select 1 from unnest(v_inv, v_amt) r(inv, amt)
          where not exists (select 1 from public.incoming_payment_allocations a
                             where a.incoming_payment_id = p_receipt_id and a.request_id = p_request_id
                               and a.sales_invoice_id = r.inv and a.amount = r.amt)) then
      return (select array_agg(a.id order by a.sales_invoice_id) from public.incoming_payment_allocations a
               where a.incoming_payment_id = p_receipt_id and a.request_id = p_request_id);
    end if;
    raise exception 'this request id was already used for a different apply' using errcode = 'P0001', detail = 'request-id-reused';
  end if;

  -- Each invoice: a PMO invoice, approved and not fully paid, the receipt's customer and currency.
  for v_i in 1 .. v_n loop
    select * into v_si from public.sales_invoices where id = v_inv[v_i];
    if not v_si.pmo_native then
      raise exception 'receipts for an ERP invoice are recorded in the ERP' using errcode = 'P0001', detail = 'not-pmo-native';
    end if;
    if v_si.status is distinct from 'Unpaid' then
      raise exception 'a receipt can be applied only to an approved invoice that is not fully paid'
        using errcode = 'P0001', detail = 'invoice-not-receivable';
    end if;
    if v_si.customer_id is distinct from v_rc.customer_id then
      raise exception 'the invoice belongs to another customer' using errcode = '23514', detail = 'allocation-client-mismatch';
    end if;
    if v_si.currency is distinct from v_rc.currency then
      raise exception 'the invoice is in another currency' using errcode = '23514', detail = 'allocation-currency-mismatch';
    end if;
  end loop;

  -- Over-allocation, both inequalities inclusive, from figures recomputed under the locks (never the stored balance).
  select coalesce(sum(a.amount), 0), coalesce(sum(a.cash_amount), 0), coalesce(sum(a.withheld_amount), 0) into v_unapplied, v_cash_used, v_wh_used
    from public.incoming_payment_allocations a where a.incoming_payment_id = p_receipt_id and a.reversed_at is null;
  v_unapplied := v_rc.amount - v_unapplied;
  if v_total > v_unapplied then
    raise exception 'more than the receipt has left to apply' using errcode = '23514', detail = 'allocation-exceeds-unapplied';
  end if;
  for v_i in 1 .. v_n loop
    select * into v_si from public.sales_invoices where id = v_inv[v_i];
    if v_amt[v_i] > public.native_invoice_gross(v_si.amount, v_si.tax_amount, v_si.tax_treatment)
                    - public.native_invoice_settled(v_org, v_inv[v_i]) then
      raise exception 'more than the invoice still owes' using errcode = '23514', detail = 'allocation-exceeds-balance';
    end if;
  end loop;

  -- Cash / withheld split (D5): the proportional share, bounded by what is left of each pool (cash not yet taken, withheld not
  -- yet taken), and an allocation that takes the receipt's whole remainder takes the remaining cash. So a fully applied
  -- receipt's cash sums to received_amount and its withheld to withheld_amount exactly, however it is sliced.
  for v_i in 1 .. v_n loop
    if v_amt[v_i] = v_unapplied then
      v_cash := v_rc.received_amount - v_cash_used;
    else
      v_cash := least(v_amt[v_i], v_rc.received_amount - v_cash_used,
                      greatest(round(v_amt[v_i] * v_rc.received_amount / v_rc.amount, 2),
                               v_amt[v_i] - (v_rc.withheld_amount - v_wh_used), 0));
    end if;
    insert into public.incoming_payment_allocations
      (org_id, incoming_payment_id, sales_invoice_id, amount, cash_amount, withheld_amount, currency, request_id, created_by)
    values
      (v_org, p_receipt_id, v_inv[v_i], v_amt[v_i], v_cash, v_amt[v_i] - v_cash, v_rc.currency, p_request_id, v_uid)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_cash_used := v_cash_used + v_cash;
    v_wh_used := v_wh_used + v_amt[v_i] - v_cash;
    v_unapplied := v_unapplied - v_amt[v_i];
  end loop;

  for v_id in select x from unnest(v_inv) x order by x loop
    perform public.native_invoice_restate(v_id);
  end loop;

  perform public.log_audit('incoming_payment.apply', v_org, v_uid, p_receipt_id,
    jsonb_build_object('request_id', p_request_id, 'total', v_total,
                       'allocations', (select jsonb_agg(jsonb_build_object('invoice_id', r.inv, 'amount', r.amt)) from unnest(v_inv, v_amt) r(inv, amt))));
  return v_ids;
end; $$;

-- unapply_native_allocation: reverse one allocation (soft), restating its invoice. Not feature-gated: like cancelling a receipt it is a
-- CLOSING transition (FR-PLN-006), so a switch-off never strands money that is already applied.
create or replace function public.unapply_native_allocation(p_allocation_id uuid)
  returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_uid  uuid      := auth.uid();
  v_role user_role := public.auth_role();
  v_al   public.incoming_payment_allocations%rowtype;
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can unapply a customer receipt' using errcode = '42501';
  end if;
  perform 1 from public.organizations o where o.id = v_org for share;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;

  select * into v_al from public.incoming_payment_allocations where id = p_allocation_id and org_id = v_org;
  if not found then
    raise exception 'allocation not found' using errcode = 'P0002';
  end if;
  -- Lock order: invoice, then receipt, then re-read the allocation under both.
  perform 1 from public.sales_invoices si where si.id = v_al.sales_invoice_id and si.org_id = v_org order by si.id for update;
  perform 1 from public.incoming_payments ip where ip.id = v_al.incoming_payment_id for update;
  select * into v_al from public.incoming_payment_allocations where id = p_allocation_id for update;
  if v_al.reversed_at is not null then
    raise exception 'this allocation is already reversed' using errcode = 'P0001', detail = 'allocation-already-reversed';
  end if;

  update public.incoming_payment_allocations set reversed_at = now(), reversed_by = v_uid where id = p_allocation_id;
  perform public.native_invoice_restate(v_al.sales_invoice_id);

  perform public.log_audit('incoming_payment.unapply', v_org, v_uid, v_al.incoming_payment_id,
    jsonb_build_object('allocation_id', p_allocation_id, 'sales_invoice_id', v_al.sales_invoice_id, 'amount', v_al.amount));
end; $$;

-- cancel_native_receipt: 0534's body, but the receipt may now touch several invoices (or none): lock the live-allocation invoices
-- ascending, then the receipt; reverse every live allocation; restate each invoice.
create or replace function public.cancel_native_receipt(p_receipt_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_rc     public.incoming_payments%rowtype;
  v_uid    uuid      := auth.uid();
  v_role   user_role := public.auth_role();
  v_inv    uuid[];
  v_id     uuid;
  v_revd   int;
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  -- FR-PLN-006 closure: reversing a receipt recorded while the module was on is a CLOSING transition and is
  -- deliberately NOT gated, so a switch-off never strands a transaction that already exists.
  perform public.assert_is_active_member();
  select * into v_rc from public.incoming_payments where id = p_receipt_id;
  if not found then
    raise exception 'receipt not found' using errcode = 'P0002';
  end if;
  if v_rc.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can cancel a customer receipt' using errcode = '42501';
  end if;
  if not v_rc.pmo_native then
    raise exception 'receipts recorded in the ERP are cancelled there' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  -- Serialise with an ERP take-over of revenue BEFORE reading who owns it — the same org-row lock
  -- create_native_sales_invoice takes. After the org row, the locks go invoices (ascending id) -> receipt.
  perform 1 from public.organizations o where o.id = v_rc.org_id for share;
  if public.domain_externally_owned(v_rc.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'erp-owns-revenue';
  end if;
  select coalesce(array_agg(distinct a.sales_invoice_id), '{}') into v_inv from public.incoming_payment_allocations a
   where a.incoming_payment_id = p_receipt_id and a.reversed_at is null;
  perform 1 from public.sales_invoices si where si.id = any(v_inv) and si.org_id = v_rc.org_id order by si.id for update;
  select * into v_rc from public.incoming_payments where id = p_receipt_id for update;
  if v_rc.cancelled_at is not null then
    raise exception 'this receipt is already cancelled' using errcode = 'P0001', detail = 'receipt-already-cancelled';
  end if;
  -- The set was read before the locks: if an apply grew it in between, retry rather than restate a stale set.
  if exists (select 1 from public.incoming_payment_allocations a
              where a.incoming_payment_id = p_receipt_id and a.reversed_at is null and a.sales_invoice_id <> all (v_inv)) then
    raise exception 'the receipt changed while it was being cancelled: try again' using errcode = '40001';
  end if;

  update public.incoming_payment_allocations set reversed_at = now(), reversed_by = v_uid
   where incoming_payment_id = p_receipt_id and reversed_at is null;
  get diagnostics v_revd = row_count;
  update public.incoming_payments set cancelled_at = now() where id = p_receipt_id;
  for v_id in select x from unnest(v_inv) x order by x loop
    perform public.native_invoice_restate(v_id);
  end loop;

  -- outstanding_after / overpaid_after: the origin invoice's restated figures (the 0275 audit shape); 'invoices' lists every restated invoice.
  perform public.log_audit('incoming_payment.cancel', v_rc.org_id, v_uid, p_receipt_id,
    jsonb_build_object('sales_invoice_id', v_rc.sales_invoice_id, 'amount', v_rc.amount, 'pmo_number', v_rc.pmo_number,
                       'allocations_reversed', v_revd,
                       'outstanding_after', (select si.erp_outstanding_amount from public.sales_invoices si where si.id = v_rc.sales_invoice_id and si.id = any(v_inv)),
                       'overpaid_after', (select si.overpaid_amount from public.sales_invoices si where si.id = v_rc.sales_invoice_id and si.id = any(v_inv)),
                       'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', si.id, 'outstanding_after', si.erp_outstanding_amount) order by si.id), '[]'::jsonb)
                                      from public.sales_invoices si where si.id = any(v_inv))));
end; $$;

revoke all on function public.record_native_on_account_receipt(uuid, numeric, numeric, numeric, text, date, uuid) from public, anon;
revoke all on function public.apply_native_receipt(uuid, jsonb, uuid) from public, anon;
revoke all on function public.unapply_native_allocation(uuid) from public, anon;
grant execute on function public.record_native_on_account_receipt(uuid, numeric, numeric, numeric, text, date, uuid) to authenticated;
grant execute on function public.apply_native_receipt(uuid, jsonb, uuid) to authenticated;
grant execute on function public.unapply_native_allocation(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the readers that treated a native receipt's invoice link as THE link. Each is its LIVE text (pg_get_functiondef on the local
-- database at 0720 -- the migrations are history, pg_proc decides) with ONLY the receipt-link predicates changed (marked 0731);
-- create-or-replace keeps the grants (§7 asserts them). transition_native_sales_invoice, native_invoice_restate and the 0534 gates are
-- unchanged: they call native_invoice_settled. project_mapped_actuals(_all) read ERP snapshots, not receipts, and are untouched.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_project_finances(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_result jsonb; v_role public.user_role := public.auth_role();
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists(select 1 from public.projects p where p.id = p_project_id and p.org_id = public.auth_org_id()) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  with invoice_rows as (
    select si.* from public.sales_invoices si
    where si.org_id = public.auth_org_id() and si.project_id = p_project_id
      and si.status in ('Submitted','Unpaid','Paid')
      and coalesce(si.erp_docstatus,1) <> 2 and si.erp_cancelled_at is null
      and si.paired_erp_invoice_id is null   -- 0498 (#1602, PD-ECA-11): count the ERP copy once
  ), invoice_gross as (
    select i.*, case
      when i.amount is null or i.amount::text in ('NaN','Infinity','-Infinity') then null
      when i.tax_treatment = 'inclusive' then i.amount
      when i.tax_treatment = 'exclusive' and i.tax_amount is not null
        and i.tax_amount::text not in ('NaN','Infinity','-Infinity') then i.amount + i.tax_amount
      else null end as gross
    from invoice_rows i
  ), inv as (
    select currency,count(*)::int as invoice_count,
      count(*) filter(where gross is null)::int as missing_gross,
      count(*) filter(where amount is null or amount::text in ('NaN','Infinity','-Infinity'))::int as missing_amount,
      count(*) filter(where erp_outstanding_amount is null or erp_outstanding_amount::text in ('NaN','Infinity','-Infinity'))::int as missing_outstanding,
      sum(amount) as invoiced,sum(erp_outstanding_amount) as outstanding,
      sum(gross-erp_outstanding_amount) as settled,
      case when count(distinct tax_treatment) = 1 then min(tax_treatment) else 'mixed' end as tax_basis
    from invoice_gross group by currency
  ), work as (
    select w.currency,
      count(*) filter(where w.net is null or w.net::text in ('NaN','Infinity','-Infinity')
                     or w.recovery is null or w.recovery::text in ('NaN','Infinity','-Infinity'))::int as missing_work,
      sum(w.net+w.recovery) as revenue
    from public.sales_invoice_work_billed w join invoice_rows i on i.id = w.id and i.org_id = w.org_id
    where not w.is_down_payment group by w.currency
  ), chosen_budget as (
    select v.* from public.budget_versions v
    where v.org_id = public.auth_org_id() and v.project_id = p_project_id and v.status in ('Active','Draft')
    order by (v.status = 'Active') desc,v.version desc,v.created_at desc,v.id desc limit 1
  ), budget_sum as (
    select case when count(*) filter(where li.budgeted_amount is null
                    or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')) > 0 then null
                else coalesce(sum(li.budgeted_amount),0) end as amount
    from public.budget_line_items li join chosen_budget b on b.id = li.budget_version_id and b.org_id = li.org_id
  ), gl as (
    select * from public.project_finance_actuals(p_project_id)
  ), contract_rows as (
    select i.id, i.si_number, i.pmo_number, i.invoice_date,
           case when i.currency <> p.currency or p.tax_treatment not in ('inclusive','exclusive')
                     or i.tax_treatment not in ('inclusive','exclusive') or i.amount is null or i.tax_amount is null
                     or i.amount::text in ('NaN','Infinity','-Infinity') or i.tax_amount::text in ('NaN','Infinity','-Infinity')
                then null
                when i.tax_treatment = p.tax_treatment then i.amount
                when p.tax_treatment = 'inclusive' then i.amount+i.tax_amount
                else i.amount-i.tax_amount end as amount
    from invoice_rows i cross join public.projects p
    -- #1471 FR-006: only Contract billing draws down the contract. `inv`, `work`, settlement, outstanding, cash and
    -- margin inputs keep reading invoice_rows (both kinds), which is what makes FR-007 hold by construction.
    where p.id = p_project_id and i.billing_kind = 'contract'
  ), contract_sum as (
    select case when count(*) filter(where amount is null) > 0 then null
                else coalesce(sum(amount),0) end as amount from contract_rows
  ), target_invoices as (
    select si.*
      from public.sales_invoices si
     where si.org_id = public.auth_org_id() and si.project_id = p_project_id
       and si.paired_erp_invoice_id is null   -- 0498 (#1602): a paired copy never carries receipts, and none is read through it
  ), candidate_receipt_ids as (
    -- UNION deduplicates the receipt before any allocation fan-out, regardless of which identity path matched.
    -- 0731 (#1415): a PMO receipt reaches a project through its LIVE ALLOCATIONS on that project's invoices (an on-account receipt reaches none).
    select a.incoming_payment_id as id
      from public.incoming_payment_allocations a
      join target_invoices ti on ti.org_id = a.org_id and ti.id = a.sales_invoice_id
     where a.org_id = public.auth_org_id() and a.reversed_at is null
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id and ti.id = ip.sales_invoice_id
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and (ip.allocation_details is null or jsonb_array_length(ip.allocation_details) > 0)
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id
       and ip.allocation_details @> jsonb_build_array(jsonb_build_object('invoice_id', ti.id::text))
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and ip.allocation_details is not null and jsonb_array_length(ip.allocation_details) > 0
    union
    select ip.id
      from public.incoming_payments ip
      join target_invoices ti on ti.org_id = ip.org_id
      join public.external_refs er on er.org_id = ti.org_id and er.domain = 'revenue'
       and er.pmo_record_id = ti.id::text
       and ip.allocation_details @> jsonb_build_array(jsonb_build_object('invoice_number', er.external_record_id))
     where ip.org_id = public.auth_org_id() and not ip.pmo_native
       and ip.allocation_details is not null and jsonb_array_length(ip.allocation_details) > 0
  ), receipt_scope as (
    select ip.*
      from public.incoming_payments ip
      join candidate_receipt_ids cr on cr.id = ip.id
     where ip.org_id = public.auth_org_id()
  ), receipt_allocations as (
    select r.id as receipt_id, r.org_id as receipt_org_id, r.sales_invoice_id as receipt_invoice_id,
           r.currency as receipt_currency, a.ordinality::int as allocation_ordinal,
           ap.invoice_id_text, ap.invoice_number_text, ap.currency_text, ap.allocation_amount,
           coalesce(ap.shape_valid, false) as shape_valid,
           by_id.id as resolved_invoice_id, by_id.project_id as resolved_invoice_project_id,
           by_id.currency as resolved_invoice_currency, by_id.pmo_native as resolved_invoice_native,
           by_id.status as resolved_invoice_status, by_id.erp_docstatus as resolved_invoice_docstatus,
           by_id.erp_cancelled_at as resolved_invoice_cancelled_at,
           by_number.id as number_invoice_id, by_number.project_id as number_invoice_project_id,
           coalesce(by_id.id, by_number.id) as source_invoice_id,
           (by_id.id is not null and by_number.id is not null and by_id.id is distinct from by_number.id) as identity_conflict,
           (by_id.id is not null and
             case when r.pmo_native then
               by_id.pmo_native and by_id.status in ('Unpaid','Paid') and by_id.erp_docstatus is null
                 and by_id.erp_cancelled_at is null and by_id.project_id = p_project_id
             else
               not by_id.pmo_native and by_id.status in ('Submitted','Unpaid','Paid') and by_id.erp_docstatus = 1
                 and by_id.erp_cancelled_at is null
             end) as invoice_lifecycle_valid,
           (ap.currency_text is not null and ap.currency_text ~ '^[A-Z]{3}$'
             and ap.currency_text = r.currency and ap.currency_text = by_id.currency) as currency_valid
      from receipt_scope r
      left join lateral jsonb_array_elements(
        case when not r.pmo_native and jsonb_typeof(r.allocation_details) = 'array'
             then r.allocation_details else '[]'::jsonb end
      ) with ordinality as a(value, ordinality) on true
      cross join lateral (
        select a.value->>'invoice_id' as invoice_id_text,
               a.value->>'invoice_number' as invoice_number_text,
               a.value->>'currency' as currency_text,
               case when length(a.value->>'amount') <= 15
                          and a.value->>'amount' ~ '^[0-9]+[.][0-9]{2}$'
                    then (a.value->>'amount')::numeric end as allocation_amount,
               (jsonb_typeof(a.value) = 'object'
                 and a.value ? 'invoice_id' and jsonb_typeof(a.value->'invoice_id') in ('string','null')
                 and a.value ? 'invoice_number' and jsonb_typeof(a.value->'invoice_number') in ('string','null')
                 and a.value ? 'amount' and jsonb_typeof(a.value->'amount') in ('string','null')
                 and a.value ? 'currency' and jsonb_typeof(a.value->'currency') in ('string','null')) as shape_valid
      ) ap
      left join public.sales_invoices by_id
        on by_id.org_id = r.org_id
       and by_id.id = case when ap.invoice_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then ap.invoice_id_text::uuid end
      left join public.external_refs er
        on er.org_id = r.org_id and er.domain = 'revenue' and er.external_record_id = ap.invoice_number_text
      left join public.sales_invoices by_number
        on by_number.org_id = r.org_id and by_number.id::text = er.pmo_record_id
  ), receipt_allocation_totals as (
    select ra.receipt_id,
           count(ra.allocation_ordinal)::int as allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (not ra.shape_valid or ra.allocation_amount is null))::int as invalid_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (ra.resolved_invoice_id is null
               or (ra.number_invoice_project_id = p_project_id and ra.resolved_invoice_id is distinct from ra.number_invoice_id)))::int as unresolved_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and (not coalesce(ra.currency_valid, false)))::int as currency_mismatch_count,
           count(*) filter (where ra.allocation_ordinal is not null and ra.resolved_invoice_id is not null
             and not coalesce(ra.invoice_lifecycle_valid, false))::int as invalid_invoice_lifecycle_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and ra.resolved_invoice_project_id = p_project_id)::int as target_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null
             and ra.resolved_invoice_project_id is distinct from p_project_id)::int as non_target_allocation_count,
           count(*) filter (where ra.allocation_ordinal is not null and ra.identity_conflict)::int as identity_conflict_count,
           coalesce(sum(ra.allocation_amount) filter (where ra.allocation_ordinal is not null
             and ra.allocation_amount is not null), 0::numeric) as allocated_total,
           coalesce(sum(ra.allocation_amount) filter (where ra.allocation_ordinal is not null
             and ra.allocation_amount is not null and ra.resolved_invoice_project_id = p_project_id), 0::numeric) as target_allocated_total,
           coalesce(bool_or(ra.source_invoice_id = ra.receipt_invoice_id) filter (where ra.allocation_ordinal is not null), false) as fk_allocation_matches
      from receipt_allocations ra
     group by ra.receipt_id
  ), native_alloc as (
    -- 0731: per PMO receipt, what its live allocations on THIS project's invoices carry in cash, and whether any of them fails the
    -- invoice lifecycle or currency check (the checks the receipt's one invoice link used to carry).
    select a.incoming_payment_id as receipt_id,
           coalesce(sum(a.cash_amount), 0::numeric) as native_cash,
           count(*) filter (where not (ni.pmo_native and ni.status in ('Unpaid','Paid') and ni.erp_docstatus is null
                                       and ni.erp_cancelled_at is null))::int as native_lifecycle_bad,
           count(*) filter (where a.currency is distinct from ni.currency or a.currency is distinct from r.currency)::int as native_currency_bad
      from public.incoming_payment_allocations a
      join target_invoices ni on ni.org_id = a.org_id and ni.id = a.sales_invoice_id
      join receipt_scope r on r.id = a.incoming_payment_id
     where a.org_id = public.auth_org_id() and a.reversed_at is null
     group by a.incoming_payment_id
  ), receipt_facts as (
    select r.*,
           coalesce(at.allocation_count, 0) as allocation_count,
           coalesce(at.invalid_allocation_count, 0) as invalid_allocation_count,
           coalesce(at.unresolved_allocation_count, 0) as unresolved_allocation_count,
           coalesce(at.currency_mismatch_count, 0) as currency_mismatch_count,
           coalesce(at.invalid_invoice_lifecycle_count, 0) as invalid_invoice_lifecycle_count,
           coalesce(at.target_allocation_count, 0) as target_allocation_count,
           coalesce(at.non_target_allocation_count, 0) as non_target_allocation_count,
           coalesce(at.identity_conflict_count, 0) as identity_conflict_count,
           coalesce(at.allocated_total, 0::numeric) as allocated_total,
           coalesce(at.target_allocated_total, 0::numeric) as target_allocated_total,
           coalesce(at.fk_allocation_matches, false) as fk_allocation_matches,
           coalesce(na.native_cash, 0::numeric) as native_cash,
           coalesce(na.native_lifecycle_bad, 0) as native_lifecycle_bad,
           coalesce(na.native_currency_bad, 0) as native_currency_bad,
           coalesce((r.cancelled_at is not null or
             (not r.pmo_native and (r.erp_cancelled_at is not null or r.erp_docstatus = 2
               or r.erp_docstatus = 0 or (r.status = 'Scheduled' and r.erp_docstatus is null)))), false) as is_excluded,
           (r.pmo_native and r.status = 'Paid' and r.erp_docstatus is null and r.erp_cancelled_at is null)
             or (not r.pmo_native and r.status = 'Paid' and r.erp_docstatus = 1
               and r.erp_cancelled_at is null and r.cancelled_at is null) as posting_confirmed,
           (r.amount is not null and r.amount::text ~ '^[0-9]+[.][0-9]{2}$' and r.amount < 1000000000000
             and r.received_amount is not null and r.received_amount::text ~ '^[0-9]+[.][0-9]{2}$'
             and r.received_amount < 1000000000000
             and r.withheld_amount is not null and r.withheld_amount::text ~ '^[0-9]+[.][0-9]{2}$'
             and r.withheld_amount < 1000000000000) as header_money_valid,
           (r.currency is not null and r.currency ~ '^[A-Z]{3}$') as receipt_currency_valid
      from receipt_scope r
      left join receipt_allocation_totals at on at.receipt_id = r.id
      left join native_alloc na on na.receipt_id = r.id
  ), receipt_reason_rows as (
    select rf.id as receipt_id, 'posting-unconfirmed'::text as reason
      from receipt_facts rf where not rf.is_excluded and not coalesce(rf.posting_confirmed, false)
    union all
    select rf.id, 'allocation-unreported'
      from receipt_facts rf where not rf.is_excluded and not rf.pmo_native and rf.allocation_details is null
    union all
    select ra.receipt_id, 'allocation-invalid'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null
       and (not ra.shape_valid or ra.allocation_amount is null)
    union all
    select ra.receipt_id, 'allocation-unresolved'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null
       and (ra.resolved_invoice_id is null
         or (ra.number_invoice_project_id = p_project_id and ra.resolved_invoice_id is distinct from ra.number_invoice_id))
    union all
    select ra.receipt_id, 'currency-mismatch'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and not coalesce(ra.currency_valid, false)
    union all
    select ra.receipt_id, 'source-inconsistent'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and ra.identity_conflict
    union all
    select ra.receipt_id, 'invoice-lifecycle'
      from receipt_allocations ra join receipt_facts rf on rf.id = ra.receipt_id
     where not rf.is_excluded and ra.allocation_ordinal is not null and ra.resolved_invoice_id is not null
       and not coalesce(ra.invoice_lifecycle_valid, false)
    union all
    select rf.id, 'invoice-lifecycle'
      from receipt_facts rf where not rf.is_excluded and rf.pmo_native and rf.native_lifecycle_bad > 0
    union all
    select rf.id, 'currency-mismatch'
      from receipt_facts rf where not rf.is_excluded and
       (not coalesce(rf.receipt_currency_valid, false)
         or (rf.pmo_native and rf.native_currency_bad > 0))
    union all
    select rf.id, 'source-inconsistent'
      from receipt_facts rf where not rf.is_excluded and
       (not coalesce(rf.header_money_valid, false)
         or rf.amount is distinct from (rf.received_amount + rf.withheld_amount)
         or (not rf.pmo_native and rf.allocation_count > 0 and rf.sales_invoice_id is not null
             and not rf.fk_allocation_matches)
         or (not rf.pmo_native and rf.allocated_total > rf.amount)
         or (not rf.pmo_native and rf.withheld_amount = 0 and rf.allocated_total > rf.received_amount)
         or (not rf.pmo_native and rf.withheld_amount > 0 and rf.allocation_count > 0
             and rf.allocated_total <> rf.amount))
    union all
    select rf.id, 'ambiguous-withholding'
      from receipt_facts rf where not rf.is_excluded and not rf.pmo_native and rf.withheld_amount > 0
       and (rf.allocation_count = 0 or rf.target_allocation_count <> rf.allocation_count
         or rf.allocated_total <> rf.amount or rf.invalid_allocation_count > 0
         or rf.unresolved_allocation_count > 0 or rf.currency_mismatch_count > 0
         or rf.invalid_invoice_lifecycle_count > 0)
  ), receipt_classified as (
    select rf.*,
           coalesce((select array_agg(distinct rr.reason order by rr.reason)
                       from receipt_reason_rows rr where rr.receipt_id = rf.id), array[]::text[]) as reasons,
           case when rf.pmo_native then rf.native_cash
                when rf.withheld_amount > 0 then rf.received_amount
                else rf.target_allocated_total end as cash_amount
      from receipt_facts rf
     where not rf.is_excluded
  ), receipt_cash_buckets as (
    select rc.currency, sum(rc.cash_amount)::text as amount
      from receipt_classified rc
     where cardinality(rc.reasons) = 0
     group by rc.currency
  ), receipt_bucket_json as (
    select coalesce(jsonb_agg(jsonb_build_object('currency', b.currency, 'amount', b.amount) order by b.currency), '[]'::jsonb) as buckets
      from receipt_cash_buckets b
  ), receipt_cash_payload as (
    select case when count(*) filter (where cardinality(rc.reasons) > 0) > 0 then
      jsonb_build_object('state','incomplete','buckets','[]'::jsonb,'receipt_count',count(*)::int,
        'reasons',coalesce((select jsonb_agg(reason order by reason) from
          (select distinct reason from receipt_reason_rows) distinct_reasons),'[]'::jsonb))
      else jsonb_build_object('state','known','buckets',(select buckets from receipt_bucket_json),'receipt_count',count(*)::int)
      end as payload
      from receipt_classified rc
  )
  select jsonb_build_object(
    'project_id',p.id,
    'contract_invoiced',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                           then null else cs.amount::text end,
    'remaining_to_invoice',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                                    or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                               then null else (p.contract_value-cs.amount)::text end,
    -- #1471 FR-009: present only when comparable Contract billing exceeds a known contract value. Built from the same
    -- contract_rows as contract_invoiced, so the list reconciles to contract_billing by construction.
    'contract_excess',case when p.contract_value is null or p.tax_treatment not in ('inclusive','exclusive')
                              or p.contract_value < 0 or p.contract_value::text in ('NaN','Infinity','-Infinity')
                              or cs.amount is null or cs.amount <= p.contract_value then null
                      else jsonb_build_object(
                        'amount',(cs.amount-p.contract_value)::text,
                        'contract_billing',cs.amount::text,
                        'contributors',coalesce((select jsonb_agg(jsonb_build_object(
                            'invoice_id',r.id,'invoice_number',coalesce(r.si_number,r.pmo_number),
                            'invoice_date',r.invoice_date,'contribution',r.amount::text)
                          order by r.invoice_date desc nulls last,r.id) from contract_rows r where r.amount <> 0),'[]'::jsonb)) end,
    'cash_received',(select payload from receipt_cash_payload),
    'invoices',coalesce((select jsonb_agg(jsonb_build_object(
      'currency',i.currency,'invoice_count',i.invoice_count,'missing_amount',i.missing_amount,
      'missing_outstanding',i.missing_outstanding,'tax_basis',i.tax_basis,
      'invoiced',case when i.missing_amount = 0 then i.invoiced::text end,
      'outstanding',case when i.missing_outstanding = 0 then i.outstanding::text end,
      'settled',case when i.missing_gross = 0 and i.missing_outstanding = 0 then i.settled::text end,
      'work_revenue',case when coalesce(w.missing_work,0) = 0 then coalesce(w.revenue,0)::text end,
      'missing_work',coalesce(w.missing_work,0)
    ) order by i.currency) from inv i left join work w on w.currency = i.currency),'[]'::jsonb),
    'budget',(select jsonb_build_object('id',b.id,'name',b.name,'version',b.version,'status',b.status,
                                      'currency',b.currency,'amount',bs.amount::text)
              from chosen_budget b cross join budget_sum bs),
    'actuals',jsonb_build_object(
      'currency',case when public.org_reads_erp_ledger() then o.default_currency else p.currency end,'as_of',(select max(actuals_as_of) from gl),
      'excludes_restricted_rows',not coalesce(public.holds_spend_approval_authority(v_role),false),
      'total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and actuals_to_date is null) > 0 then null
                          else sum(actuals_to_date) filter(where mapped) end::text from gl),
      -- 0376 (#1271): the split of `total` into ERP-project-tagged and rule-attributed cost.
      'tagged_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and tagged_to_date is null) > 0 then null
                          else sum(tagged_to_date) filter(where mapped) end::text from gl),
      'attributed_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and attributed_to_date is null) > 0 then null
                          else sum(attributed_to_date) filter(where mapped) end::text from gl),
      -- 0497 (#1519, FR-EQU-051): the hire-rate internal charge, inside `total`, stated on its own.
      'equipment_charge_total',(select case when count(*) filter(where mapped) = 0
                                  or count(*) filter(where mapped and equipment_charge_to_date is null) > 0 then null
                          else sum(equipment_charge_to_date) filter(where mapped) end::text from gl),
      'categories',(select jsonb_agg(jsonb_build_object('category',category,'mapped',mapped,
                                                       'amount',actuals_to_date::text,
                                                       'tagged_amount',tagged_to_date::text,
                                                       'attributed_amount',attributed_to_date::text,
                                                       'equipment_charge_amount',equipment_charge_to_date::text) order by category) from gl)  -- 0497
    )
  ) into v_result from public.projects p join public.organizations o on o.id = p.org_id
    cross join contract_sum cs where p.id = p_project_id;
  return v_result;
end $function$
;

create or replace function public.invoice_pair_candidates(p_pmo_id uuid default null, p_erp_id uuid default null, p_ignore_scope boolean default false)
  returns table (pmo_invoice_id uuid, erp_invoice_id uuid)
  language sql stable security invoker set search_path = public as $$
  select n.id, e.id
    from public.sales_invoices n
    join public.sales_invoices e on e.org_id = n.org_id and e.customer_id = n.customer_id
   where n.org_id = public.auth_org_id()
     and public.auth_role() in ('Admin', 'Finance')   -- the roles that may pair; INVOKER, so RLS applies on top
     and (p_pmo_id is null or n.id = p_pmo_id) and (p_erp_id is null or e.id = p_erp_id)
     and n.pmo_native and n.status = 'Unpaid' and n.paired_erp_invoice_id is null
     and not exists (select 1 from public.incoming_payment_allocations a    -- 0731: anything applied to the invoice keeps it out of pairing
                      where a.org_id = n.org_id and a.sales_invoice_id = n.id and a.reversed_at is null)
     and not e.pmo_native and e.erp_docstatus = 1 and e.erp_cancelled_at is null
     and e.status in ('Submitted', 'Unpaid', 'Paid')
     and not exists (select 1 from public.sales_invoices t where t.paired_erp_invoice_id = e.id)
     -- A pair never moves revenue: the ERP copy has no project (or work order) of its own yet, or the PMO copy's own.
     -- p_ignore_scope drops only this test, so the review list can say "same invoice, different project".
     and (p_ignore_scope or ((e.project_id is null or e.project_id = n.project_id)
                             and (e.work_order_id is null or e.work_order_id = n.work_order_id)))
     and ((n.reference_number is not null and n.reference_number = e.reference_number)
          or (n.si_number is not null and n.si_number = e.si_number))
     -- Compared on the tax-inclusive total: PMO invoices are raised exclusive of tax, the ERP mirror stores its grand total (inclusive),
     -- so equal `amount` and equal `tax_treatment` could never both hold for a real pair.
     and n.currency = e.currency
     and case when n.tax_treatment = 'inclusive' then n.amount else n.amount + n.tax_amount end
       = case when e.tax_treatment = 'inclusive' then e.amount else e.amount + e.tax_amount end
     -- Equal totals alone do not make equal tax (net 100 + tax 10 vs net 110 + tax 0): the tax must match too, so net does.
     and n.tax_amount = e.tax_amount
     and date_trunc('month', n.invoice_date) = date_trunc('month', e.invoice_date)
$$;

create or replace function public.list_unpaired_native_invoices()
  returns table (invoice_id uuid, pmo_number text, customer_name text, invoice_date date, amount numeric, currency text, reason text)
  language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if public.auth_role() is null or public.auth_role() not in ('Admin', 'Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(public.auth_org_id(), 'revenue') then return; end if;
  return query
    with c as (select * from public.invoice_pair_candidates()),
    amb as (select x.pmo_invoice_id from c x
             where (select count(*) from c y where y.pmo_invoice_id = x.pmo_invoice_id) > 1
                or (select count(*) from c y where y.erp_invoice_id = x.erp_invoice_id) > 1)
    select n.id, n.pmo_number, co.name, n.invoice_date, n.amount, n.currency,
           case when exists (select 1 from public.incoming_payment_allocations a    -- 0731
                              where a.org_id = n.org_id and a.sales_invoice_id = n.id and a.reversed_at is null) then 'has-receipt'
                when n.id in (select pmo_invoice_id from amb) then 'ambiguous'
                when n.id in (select pmo_invoice_id from public.invoice_pair_candidates(null, null, true)) then 'project-differs'
                else 'no-match' end
      from public.sales_invoices n
      left join public.companies co on co.id = n.customer_id
     where n.org_id = public.auth_org_id() and n.pmo_native and n.paired_erp_invoice_id is null
       and n.status in ('Unpaid', 'Paid')   -- a PMO invoice is Draft, Unpaid, Paid or Cancelled; a Draft is not yet a sale
       and (n.id in (select pmo_invoice_id from amb) or n.id not in (select pmo_invoice_id from c))
     order by n.invoice_date, n.pmo_number;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — assert the result on the database itself (hosted Supabase grants EXECUTE on new functions by default).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad text;
begin
  select string_agg(sig, ', ') into v_bad
    from (values ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                 ('public.cancel_native_receipt(uuid)'),
                 ('public.record_native_on_account_receipt(uuid,numeric,numeric,numeric,text,date,uuid)'),
                 ('public.apply_native_receipt(uuid,jsonb,uuid)'),
                 ('public.unapply_native_allocation(uuid)')) f(sig)
   where has_function_privilege('anon', sig, 'execute')
      or not has_function_privilege('authenticated', sig, 'execute')
      or not (select p.prosecdef from pg_proc p where p.oid = sig::regprocedure);
  if v_bad is not null then
    raise exception '0731 §7: a PMO receipt writer''s grants or SECURITY DEFINER drifted: %', v_bad;
  end if;

  select string_agg(sig, ', ') into v_bad
    from (values ('public.native_receipt_allocations_backfill()'), ('public.ipa_consistency()'),
                 ('public.incoming_payments_amount_covers_allocations()'), ('public.native_invoice_settled(uuid,uuid)')) f(sig)
   where has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute');
  if v_bad is not null then
    raise exception '0731 §7: client roles can execute internal functions: %', v_bad;
  end if;

  -- the re-created readers keep their 0498 grants
  if has_function_privilege('anon', 'public.get_project_finances(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_project_finances(uuid)', 'execute')
     or has_function_privilege('anon', 'public.invoice_pair_candidates(uuid,uuid,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.invoice_pair_candidates(uuid,uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.list_unpaired_native_invoices()', 'execute')
     or not has_function_privilege('authenticated', 'public.list_unpaired_native_invoices()', 'execute') then
    raise exception '0731 §7: a re-created reader''s grants drifted';
  end if;

  if has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'INSERT')
     or has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'DELETE')
     or has_table_privilege('anon', 'public.incoming_payment_allocations', 'SELECT')
     or not has_table_privilege('authenticated', 'public.incoming_payment_allocations', 'SELECT')
     or not (has_table_privilege('service_role', 'public.incoming_payment_allocations', 'SELECT')
             and has_table_privilege('service_role', 'public.incoming_payment_allocations', 'INSERT')
             and has_table_privilege('service_role', 'public.incoming_payment_allocations', 'UPDATE')
             and has_table_privilege('service_role', 'public.incoming_payment_allocations', 'DELETE')) then
    raise exception '0731 §7: incoming_payment_allocations privileges drifted';
  end if;
end $$;
