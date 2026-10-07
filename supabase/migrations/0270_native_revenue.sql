-- 0270_native_revenue.sql — #784 (OD-REEL-1): customer invoices and receipts for an org whose revenue no ERP owns.
-- Spec: docs/specs/no-erp-revenue.spec.md (FR-NAR-*, AC-NAR-001..007). ADR: ADR-0055 addendum 2026-10-07.
-- Plan: docs/plans/2026-10-07-no-erp-revenue.md. Rollback: supabase/migrations/rollback/0270_native_revenue_down.sql.
--
-- Shape (DD-NAR-1..15): no new table. A PMO invoice / receipt is a row of sales_invoices / incoming_payments with
-- pmo_native = true, written ONLY by four SECURITY DEFINER RPCs:
--   create_native_sales_invoice     Draft, lines, tax from the project (OD-TAX-4), author recorded (0132's SoD oracle)
--   transition_native_sales_invoice Draft → Unpaid (approve: approver not in the author set, current Admin/Finance)
--                                   | Draft or unsettled Unpaid → Cancelled
--   record_native_receipt           settles part, all or more (DD-NAR-17); recomputes the balance from live receipts;
--                                   Paid at zero; any excess is the invoice's overpaid_amount
--   cancel_native_receipt           reverses a receipt; recomputes the balance
-- The balance lives in erp_outstanding_amount — the one paid-detection oracle every reader already uses (DD-WO-3) —
-- recomputed (never incremented) under the invoice row lock. Every write is refused while an ERP owns revenue, and the
-- ERP cannot take revenue over while a PMO draft is open (§7); at that moment every PMO invoice still owed is stamped
-- with its outstanding, the tally for the ERP opening entry (DD-NAR-16). Revenue writes are Admin and Finance only (owner ruling):
-- the RPCs check it in their bodies and §8 states the same rule in the tables' write policies.
-- ⚑ Depends on 0262 (#785): create calls lock_work_order_billing (DD-BWO-5 lock order), and 0262's sales_invoices trigger
--   fences a work-order invoice against what is left on the work order.
-- ⚑ Hosted Supabase grants EXECUTE on new public functions to anon/authenticated (0185/0210): every function below
--   revokes what it must not expose and §9 asserts the result on the database itself.
-- ⚑ 0178's client-callable allow-list grows by the four RPCs: supabase/tests/0178_anon_executable_definers.test.sql.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the native marker, number, lines, stamps, the overpaid figure and the ERP opening stamp (DD-NAR-2, -8, -9, -16,
-- -17). Not client-insertable: the INSERT grants on both tables are column lists (0176/0178) and nothing here is added
-- to them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.sales_invoices
  add column pmo_native     boolean not null default false,
  add column pmo_number     text,
  add column native_lines   jsonb,
  add column approved_by_id uuid references auth.users(id),
  add column approved_at    timestamptz,
  add column overpaid_amount numeric(14,2),
  add column erp_opening_amount numeric(14,2),
  add column erp_opening_at timestamptz,
  add constraint sales_invoices_pmo_native_shape check (
    not pmo_native
    or (si_number is null and erp_docstatus is null and coalesce(jsonb_typeof(native_lines) = 'array', false))),
  add constraint sales_invoices_overpaid_amount_shape check (
    overpaid_amount is null or (pmo_native and overpaid_amount >= 0 and overpaid_amount < 'Infinity'::numeric)),
  add constraint sales_invoices_erp_opening_shape check (
    (erp_opening_amount is null) = (erp_opening_at is null)
    and (erp_opening_amount is null or (pmo_native and erp_opening_amount > 0 and erp_opening_amount < 'Infinity'::numeric)));

comment on column public.sales_invoices.pmo_native is
  '#784 DD-NAR-2: true for an invoice raised in PMO (create_native_sales_invoice) while no ERP owned revenue; never an ERP mirror row.';
comment on column public.sales_invoices.pmo_number is
  '#784 DD-NAR-9: PMO''s own invoice number (INV-YYMMDDnnnn), minted when the invoice is approved. ERP invoices keep their number in si_number.';
comment on column public.sales_invoices.native_lines is
  '#784 DD-NAR-8: the lines of a PMO invoice as raised — [{item_code, description, qty, rate, amount}]; amount = round(qty × rate, 2). Fixed at creation.';
comment on column public.sales_invoices.approved_by_id is
  '#784 FR-NAR-005: who approved a PMO invoice (never one of its authors).';
comment on column public.sales_invoices.overpaid_amount is
  '#784 DD-NAR-17: on a PMO invoice, what its live receipts settled beyond its gross — greatest(Σ live receipts − gross, 0). Restated with erp_outstanding_amount (never below zero) by the receipt RPCs under the invoice row lock.';

comment on column public.sales_invoices.erp_opening_amount is
  '#784 DD-NAR-16: what a PMO invoice still owed when an ERP took over revenue — its share of the one opening entry the accountant posts in the ERP. Written once, by the employ path (§7) only; kept as history if the ERP is released.';
comment on column public.sales_invoices.erp_opening_at is
  '#784 DD-NAR-16: when the ERP took over revenue for this PMO invoice''s org and stamped erp_opening_amount.';

create unique index sales_invoices_org_pmo_number_uidx
  on public.sales_invoices (org_id, pmo_number) where pmo_number is not null;
create index sales_invoices_native_draft_idx
  on public.sales_invoices (org_id) where pmo_native and status = 'Draft';

alter table public.incoming_payments
  add column pmo_native   boolean not null default false,
  add column pmo_number   text,
  add column cancelled_at timestamptz,
  add constraint incoming_payments_pmo_native_shape check (
    not pmo_native or (ip_number is null and erp_docstatus is null and sales_invoice_id is not null));

comment on column public.incoming_payments.pmo_native is
  '#784 DD-NAR-2: true for a receipt recorded in PMO against a PMO invoice; never an ERP mirror row.';
comment on column public.incoming_payments.pmo_number is
  '#784 DD-NAR-9: PMO''s own receipt number (RCV-YYMMDDnnnn).';
comment on column public.incoming_payments.cancelled_at is
  '#784 DD-NAR-10: set when a PMO receipt is cancelled; a cancelled receipt no longer settles its invoice.';

create unique index incoming_payments_org_pmo_number_uidx
  on public.incoming_payments (org_id, pmo_number) where pmo_number is not null;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — what the live PMO receipts have settled on one invoice. INVOKER, no client EXECUTE: called only from the §4/§5
-- SECURITY DEFINER bodies (which run as the owner).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.native_invoice_settled(p_si_id uuid) returns numeric
  language sql stable set search_path = public as $$
  select coalesce(sum(ip.amount), 0)
    from public.incoming_payments ip
   where ip.sales_invoice_id = p_si_id and ip.pmo_native and ip.cancelled_at is null
$$;
revoke all on function public.native_invoice_settled(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — create_native_sales_invoice (FR-NAR-001..004). Order: member → role → ownership → lines → billing lock →
-- project (FOR SHARE: a concurrent VAT-flag change waits, then sees this invoice and refuses, 0253) → customer →
-- work order → tax → insert → author set.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_native_sales_invoice(
  p_project_id    uuid,
  p_customer_id   uuid,
  p_lines         jsonb,
  p_work_order_id uuid default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid      := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_uid         uuid      := auth.uid();
  v_valid       boolean;
  v_lines       jsonb;
  v_amount      numeric;
  v_p_org       uuid;
  v_currency    text;
  v_vat         boolean;
  v_rate        numeric;
  v_num         integer;
  v_den         integer;
  v_contract    text;
  v_wo_org      uuid;
  v_wo_currency text;
  v_wo_po       text;
  v_id          uuid      := gen_random_uuid();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can raise a customer invoice' using errcode = '42501';
  end if;
  if public.domain_externally_owned(v_org, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 100 then
    raise exception 'an invoice needs between 1 and 100 lines' using errcode = '23514';
  end if;
  -- CASE, not a bare cast: a non-number qty/rate becomes NULL (refused below), never a cast error or a coercion.
  with lines as (
    select x.ord,
           nullif(btrim(x.l ->> 'item_code'), '')   as item_code,
           nullif(btrim(x.l ->> 'description'), '') as description,
           case when jsonb_typeof(x.l -> 'qty')  = 'number' then (x.l ->> 'qty')::numeric  end as qty,
           case when jsonb_typeof(x.l -> 'rate') = 'number' then (x.l ->> 'rate')::numeric end as rate
      from jsonb_array_elements(p_lines) with ordinality as x(l, ord)
  )
  select bool_and((item_code is not null or description is not null)
                  and coalesce(length(item_code), 0) <= 140 and coalesce(length(description), 0) <= 140
                  and coalesce(qty > 0 and qty < 'Infinity'::numeric and qty = round(qty, 3), false)
                  and coalesce(rate >= 0 and rate < 'Infinity'::numeric and rate = round(rate, 2), false)),
         jsonb_agg(jsonb_build_object('item_code', item_code, 'description', description, 'qty', qty, 'rate', rate,
                                      'amount', round(qty * rate, 2)) order by ord),
         sum(round(qty * rate, 2))
    into v_valid, v_lines, v_amount
    from lines;
  if not coalesce(v_valid, false) then
    raise exception 'each line needs an item code or a description (up to 140 characters each), a quantity above zero with at most 3 decimals, and a rate of zero or more with at most 2 decimals'
      using errcode = '23514';
  end if;
  if not coalesce(v_amount > 0 and v_amount < 1000000000000, false) then
    raise exception 'the invoice total must be above zero' using errcode = '23514';
  end if;

  -- DD-BWO-5: the work order's billing lock BEFORE the project row lock — the order every billing writer uses.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency, p.subject_to_vat, p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
         p.customer_contract_ref
    into v_p_org, v_currency, v_vat, v_rate, v_num, v_den, v_contract
    from public.projects p where p.id = p_project_id for share;
  if not found or v_p_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.companies c where c.id = p_customer_id and c.org_id = v_org) then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if p_work_order_id is not null then
    select wo.org_id, wo.currency, wo.client_po_number into v_wo_org, v_wo_currency, v_wo_po
      from public.work_orders wo where wo.id = p_work_order_id;
    if not found or v_wo_org is distinct from v_org then
      raise exception 'work order not found' using errcode = 'P0002';
    end if;
    v_currency := v_wo_currency;
  end if;

  -- OD-TAX-4 / DD-NAR-7: the project says whether it is subject to VAT; its own rate and base apply.
  if v_vat then
    if v_rate is null or v_rate <= 0 then
      raise exception 'this project is subject to VAT but has no VAT rate: record it with the contract value before invoicing'
        using errcode = 'P0001';
    end if;
  else
    v_rate := 0; v_num := 1; v_den := 1;
  end if;

  -- tax_amount 0 is a placeholder the 0227 trigger (sales_invoices_zz_apply_tax_base) replaces from tax_rate on insert.
  insert into public.sales_invoices
    (id, org_id, project_id, customer_id, work_order_id, reference_number, native_lines, amount, currency,
     tax_treatment, tax_rate, tax_amount, tax_base_numerator, tax_base_denominator, status, pmo_native, author_user_id)
  values
    (v_id, v_org, p_project_id, p_customer_id, p_work_order_id,
     coalesce(nullif(btrim(v_wo_po), ''), nullif(btrim(v_contract), '')),
     v_lines, v_amount, v_currency,
     'exclusive', v_rate, 0, v_num, v_den, 'Draft', true, v_uid);

  -- 0132's SoD oracle: nobody in this set may approve the invoice (§4).
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id) values (v_org, v_id, v_uid);
  return v_id;
end; $$;
revoke all on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid) from public, anon;
grant execute on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid) to authenticated;
comment on function public.create_native_sales_invoice(uuid, uuid, jsonb, uuid) is
  '#784 FR-NAR-001..004: raises a PMO customer invoice as a Draft while no ERP owns revenue. Admin/Finance only; tax from the project; the caller is recorded as author.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — transition_native_sales_invoice (FR-NAR-005, FR-NAR-009). Order is load-bearing: member → row lock → org →
-- role (read now: current standing) → native → ownership → legality (NULL-safe) → SoD (outside any Admin skip,
-- OD-PROC-8 shape) → one update → audit. Same SoD rule and messages as submit_sales_invoice (0133).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_native_sales_invoice(p_id uuid, p_to text)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_row    public.sales_invoices%rowtype;
  v_uid    uuid      := auth.uid();
  v_role   user_role := public.auth_role();
  v_gross  numeric;
  v_today  date;
  v_number text;
  v_legal  jsonb := jsonb_build_object('Draft',  jsonb_build_array('Unpaid','Cancelled'),
                                       'Unpaid', jsonb_build_array('Cancelled'));
begin
  perform public.assert_is_active_member();
  select * into v_row from public.sales_invoices where id = p_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can approve or cancel a customer invoice' using errcode = '42501';
  end if;
  if not v_row.pmo_native then
    raise exception 'this invoice belongs to the ERP: approve or cancel it there' using errcode = 'P0001', detail = 'not-pmo-native';
  end if;
  if public.domain_externally_owned(v_row.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;
  -- NULL-safe: `? NULL` is NULL and `not NULL` would fall through (0176 §6).
  if p_to is null or not coalesce((v_legal -> v_row.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_row.status, coalesce(p_to, '<NULL>') using errcode = 'P0001';
  end if;

  v_gross := case when v_row.tax_treatment = 'inclusive' then v_row.amount else v_row.amount + v_row.tax_amount end;

  if p_to = 'Unpaid' then
    -- (0127 §B / 0133) FAIL CLOSED on an unknown author.
    if v_row.author_user_id is null
       and not exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = p_id) then
      raise exception 'sales invoice has no recorded author — SoD cannot be verified'
        using errcode = '42501', detail = 'sod-author-missing';
    end if;
    -- (0132) NOBODY WHO EVER WROTE THE BODY MAY APPROVE — an Admin included.
    if v_row.author_user_id = v_uid
       or exists (select 1 from public.sales_invoice_authors a where a.sales_invoice_id = p_id and a.user_id = v_uid) then
      raise exception 'approver must differ from author (SoD)' using errcode = '42501', detail = 'sod-self-approval';
    end if;
    v_today := (now() at time zone coalesce(
                 (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date;
    v_number := public.next_procurement_doc_number(v_row.org_id, 'INV');
    update public.sales_invoices set
      status                 = 'Unpaid',
      pmo_number             = v_number,
      invoice_date           = v_today,
      approved_by_id         = v_uid,
      approved_at            = now(),
      erp_outstanding_amount = v_gross,
      overpaid_amount        = 0
    where id = p_id;
  else
    if v_row.status = 'Unpaid' and public.native_invoice_settled(p_id) > 0 then
      raise exception 'cancel the receipts recorded against this invoice first' using errcode = 'P0001';
    end if;
    update public.sales_invoices set
      status                 = 'Cancelled',
      erp_outstanding_amount = case when v_row.status = 'Unpaid' then 0 else erp_outstanding_amount end
    where id = p_id;
  end if;

  perform public.log_audit('sales_invoice.transition', v_row.org_id, v_uid, p_id,
    jsonb_build_object('from', v_row.status, 'to', p_to, 'pmo_number', coalesce(v_number, v_row.pmo_number),
                       'gross', v_gross));
end; $$;
revoke all on function public.transition_native_sales_invoice(uuid, text) from public, anon;
grant execute on function public.transition_native_sales_invoice(uuid, text) to authenticated;
comment on function public.transition_native_sales_invoice(uuid, text) is
  '#784 FR-NAR-005/009: approve (Draft → Unpaid; approver not in the author set; current Admin/Finance) or cancel (Draft, or Unpaid with no live receipt) a PMO invoice.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — record_native_receipt / cancel_native_receipt (FR-NAR-007, FR-NAR-009; DD-NAR-4, DD-NAR-17). The balance is
-- RECOMPUTED from live PMO receipts under the invoice row lock — never incremented: erp_outstanding_amount =
-- greatest(gross − settled, 0) (never below zero: every reader relies on it) and overpaid_amount =
-- greatest(settled − gross, 0). The invoice is Paid exactly when the balance reaches zero. A receipt states its payment
-- date (required, never in the future); its amount defaults to what is outstanding and may be less or more.
-- Lock order: invoice, then receipt.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
  v_gross    numeric;
  v_settled  numeric;
  v_out      numeric;
  v_amount   numeric;
  v_received numeric;
  v_today    date;
  v_id       uuid      := gen_random_uuid();
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
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
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;
  if v_si.status is distinct from 'Unpaid' then
    raise exception 'a receipt can be recorded only against an approved invoice that is not fully paid' using errcode = 'P0001';
  end if;

  -- DD-NAR-17: the payment date is stated by the caller and is never later than today in the org's time zone.
  v_today := (now() at time zone coalesce(
               (select o.default_timezone from public.organizations o where o.id = v_si.org_id), 'UTC'))::date;
  if p_date is null then
    raise exception 'a receipt needs its payment date' using errcode = '23502';
  end if;
  if p_date > v_today then
    raise exception 'the payment date cannot be in the future' using errcode = '23514';
  end if;

  v_gross   := case when v_si.tax_treatment = 'inclusive' then v_si.amount else v_si.amount + v_si.tax_amount end;
  v_settled := public.native_invoice_settled(p_sales_invoice_id);
  v_out     := greatest(v_gross - v_settled, 0);
  -- DD-NAR-17: no amount stated settles what is outstanding; a different amount (less or more) is recorded as given.
  v_amount  := coalesce(p_amount, v_out);
  if not coalesce(v_amount > 0 and v_amount < 'Infinity'::numeric and v_amount = round(v_amount, 2), false) then
    raise exception 'the receipt amount must be a positive number with at most 2 decimals' using errcode = '23514';
  end if;
  if not coalesce(v_withheld >= 0 and v_withheld < 'Infinity'::numeric and v_withheld = round(v_withheld, 2), false) then
    raise exception 'the tax withheld must be zero or more with at most 2 decimals' using errcode = '23514';
  end if;
  v_received := coalesce(p_received_amount, v_amount - v_withheld);
  if not coalesce(v_received >= 0 and v_received = round(v_received, 2) and v_received + v_withheld = v_amount, false) then
    raise exception 'cash received plus tax withheld must equal the amount settled' using errcode = '23514';
  end if;
  if v_withheld > 0 and nullif(btrim(p_withholding_slip_number), '') is null then
    raise exception 'tax withheld needs its withholding-slip number' using errcode = '23514';
  end if;

  insert into public.incoming_payments
    (id, org_id, customer_id, sales_invoice_id, date, amount, received_amount, withheld_amount,
     withholding_slip_number, currency, status, pmo_native, pmo_number)
  values
    (v_id, v_si.org_id, v_si.customer_id, p_sales_invoice_id, p_date, v_amount, v_received, v_withheld,
     nullif(btrim(p_withholding_slip_number), ''), v_si.currency, 'Paid', true,
     public.next_procurement_doc_number(v_si.org_id, 'RCV'));

  v_settled := v_settled + v_amount;
  v_out     := greatest(v_gross - v_settled, 0);
  update public.sales_invoices set
    erp_outstanding_amount = v_out,
    overpaid_amount        = greatest(v_settled - v_gross, 0),
    status                 = case when v_out = 0 then 'Paid' else 'Unpaid' end
  where id = p_sales_invoice_id;
  return v_id;
end; $$;
revoke all on function public.record_native_receipt(uuid, numeric, numeric, numeric, text, date) from public, anon;
grant execute on function public.record_native_receipt(uuid, numeric, numeric, numeric, text, date) to authenticated;
comment on function public.record_native_receipt(uuid, numeric, numeric, numeric, text, date) is
  '#784 FR-NAR-007 / DD-NAR-17: records a customer receipt (payment date required, never in the future; amount defaults to the balance) against an Unpaid PMO invoice; restates the balance (never below zero) and the overpaid figure; Paid at zero.';

create or replace function public.cancel_native_receipt(p_receipt_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_rc      public.incoming_payments%rowtype;
  v_si      public.sales_invoices%rowtype;
  v_uid     uuid      := auth.uid();
  v_role    user_role := public.auth_role();
  v_gross   numeric;
  v_settled numeric;
  v_out     numeric;
begin
  -- SECURITY: membership, role, ownership and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
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
  if public.domain_externally_owned(v_rc.org_id, 'revenue') then
    raise exception 'customer invoices for this organisation are raised in the connected ERP, not in PMO'
      using errcode = '42501', detail = 'revenue-externally-owned';
  end if;
  -- Lock order invoice → receipt (record_native_receipt locks only the invoice), then re-read the receipt.
  select * into v_si from public.sales_invoices where id = v_rc.sales_invoice_id for update;
  select * into v_rc from public.incoming_payments where id = p_receipt_id for update;
  if v_rc.cancelled_at is not null then
    raise exception 'this receipt is already cancelled' using errcode = 'P0001';
  end if;

  update public.incoming_payments set cancelled_at = now() where id = p_receipt_id;
  v_gross   := case when v_si.tax_treatment = 'inclusive' then v_si.amount else v_si.amount + v_si.tax_amount end;
  v_settled := public.native_invoice_settled(v_si.id);
  v_out     := greatest(v_gross - v_settled, 0);
  update public.sales_invoices set
    erp_outstanding_amount = v_out,
    overpaid_amount        = greatest(v_settled - v_gross, 0),
    status                 = case when v_out = 0 then 'Paid' else 'Unpaid' end
  where id = v_si.id;

  perform public.log_audit('incoming_payment.cancel', v_rc.org_id, v_uid, p_receipt_id,
    jsonb_build_object('sales_invoice_id', v_si.id, 'amount', v_rc.amount, 'pmo_number', v_rc.pmo_number,
                       'outstanding_after', v_out, 'overpaid_after', greatest(v_settled - v_gross, 0)));
end; $$;
revoke all on function public.cancel_native_receipt(uuid) from public, anon;
grant execute on function public.cancel_native_receipt(uuid) to authenticated;
comment on function public.cancel_native_receipt(uuid) is
  '#784 FR-NAR-009 / DD-NAR-17: cancels a PMO receipt and restates its invoice''s balance, overpaid figure and status.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the mirror guards pin the new columns (DD-WO-4: a column added later is user-writable while the ERP owns the
-- domain unless its guard enumerates it). Bodies are the live definitions VERBATIM — sales_invoices from 0193,
-- incoming_payments from 0232 — with the lines marked `0270` added. SECURITY INVOKER as before; no trigger re-created
-- (a trigger binds by OID and create-or-replace keeps it).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.pmo_native is distinct from old.pmo_native           -- 0270 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0270 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0270 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0270 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0270 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0270 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0270 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0270 (#784, DD-NAR-16)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.received_amount is distinct from old.received_amount
     or new.withheld_amount is distinct from old.withheld_amount
     or new.withholding_slip_number is distinct from old.withholding_slip_number
     or new.currency is distinct from old.currency               -- 0187 (#478)
     or new.pmo_native is distinct from old.pmo_native           -- 0270 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0270 (#784)
     or new.cancelled_at is distinct from old.cancelled_at       -- 0270 (#784)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — the ERP takes revenue over only with no PMO draft open (DD-NAR-11): a draft frozen by the flip could neither be
-- approved nor cancelled, and it would keep holding its work order's headroom (0262 counts drafts). Fires for every
-- writer (the ERP setup writes ownership with the service role), on insert or on a move of org/domain.
-- DD-NAR-16: the same moment stamps every PMO invoice still owed (Unpaid, balance above zero) with its outstanding
-- (erp_opening_amount) and the time (erp_opening_at) — the tally Finance reconciles against the one opening entry the
-- accountant posts in the ERP. Paid and Cancelled invoices are never stamped. A stamp is history: it is written once and
-- kept if the ERP is later released (a later take-over stamps only invoices not stamped before). This trigger is the
-- only writer of the two columns; it runs BEFORE the ownership row exists, so the §6 guard (which pins both columns
-- while an ERP owns revenue) does not yet apply to its own update.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_revenue_employable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_drafts int;
begin
  if new.domain is distinct from 'revenue' then return new; end if;
  select count(*) into v_drafts
    from public.sales_invoices si
   where si.org_id = new.org_id and si.pmo_native and si.status = 'Draft';
  if v_drafts > 0 then
    raise exception 'approve or cancel the % draft invoice(s) raised in PMO before the ERP takes over customer invoicing', v_drafts
      using errcode = 'P0001', detail = 'native-drafts-open';
  end if;
  update public.sales_invoices si set
    erp_opening_amount = si.erp_outstanding_amount,
    erp_opening_at     = now()
   where si.org_id = new.org_id and si.pmo_native and si.status = 'Unpaid'
     and si.erp_outstanding_amount > 0 and si.erp_opening_at is null;
  return new;
end; $$;
revoke all on function public.assert_revenue_employable() from public, anon, authenticated;
create trigger external_domain_ownership_revenue_employable
  before insert or update of domain, org_id on public.external_domain_ownership
  for each row execute function public.assert_revenue_employable();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — Revenue writes are Admin and Finance only (owner ruling; DD-NAR-15, FR-NAR-013). The six write policies on the
-- two revenue tables are re-created with that role set; every other predicate is 0128's, verbatim (org, active member,
-- and for INSERT/DELETE "no ERP owns revenue"). Service-role mirror writers and SECURITY DEFINER RPCs do not pass
-- through these policies; each RPC checks the same role set in its own body.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop policy if exists sales_invoices_insert on public.sales_invoices;
create policy sales_invoices_insert on public.sales_invoices for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists sales_invoices_update on public.sales_invoices;
create policy sales_invoices_update on public.sales_invoices for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'));
drop policy if exists sales_invoices_delete on public.sales_invoices;
create policy sales_invoices_delete on public.sales_invoices for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

drop policy if exists incoming_payments_insert on public.incoming_payments;
create policy incoming_payments_insert on public.incoming_payments for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists incoming_payments_update on public.incoming_payments;
create policy incoming_payments_update on public.incoming_payments for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance'));
drop policy if exists incoming_payments_delete on public.incoming_payments;
create policy incoming_payments_delete on public.incoming_payments for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

comment on policy sales_invoices_insert on public.sales_invoices is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Inserts are column-limited (0176) and only while no ERP owns revenue.';
comment on policy sales_invoices_update on public.sales_invoices is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Client updates go through role-checked RPCs; this policy states the same rule.';
comment on policy sales_invoices_delete on public.sales_invoices is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Deletes are made by the service-role mirror writer and audited (sales_invoices_audit_delete); this policy states the same rule.';
comment on policy incoming_payments_insert on public.incoming_payments is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Inserts are column-limited (0178) and only while no ERP owns revenue.';
comment on policy incoming_payments_update on public.incoming_payments is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Client updates go through role-checked RPCs; this policy states the same rule.';
comment on policy incoming_payments_delete on public.incoming_payments is
  'Revenue writes are Admin and Finance only (owner ruling, #784). Deletes are made by the service-role mirror writer and audited; this policy states the same rule.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — assert the result on the database itself (hosted Supabase grants EXECUTE on new functions by default).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_bad text;
begin
  select string_agg(sig, ', ') into v_bad
    from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                 ('public.transition_native_sales_invoice(uuid,text)'),
                 ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                 ('public.cancel_native_receipt(uuid)')) f(sig)
   where has_function_privilege('anon', sig, 'execute')
      or not has_function_privilege('authenticated', sig, 'execute')
      or not (select p.prosecdef from pg_proc p where p.oid = sig::regprocedure);
  if v_bad is not null then
    raise exception '0270 §9: PMO revenue writer grants or SECURITY DEFINER drifted: %', v_bad;
  end if;

  select string_agg(sig, ', ') into v_bad
    from (values ('public.native_invoice_settled(uuid)'), ('public.assert_revenue_employable()')) f(sig)
   where has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute');
  if v_bad is not null then
    raise exception '0270 §9: client roles can execute internal functions: %', v_bad;
  end if;

  -- Every column §1 adds: neither client-insertable nor client-updatable (DD-NAR-2, -16, -17).
  select string_agg(c.t || '.' || c.col, ', ') into v_bad
    from (values ('sales_invoices','pmo_native'), ('sales_invoices','pmo_number'), ('sales_invoices','native_lines'),
                 ('sales_invoices','approved_by_id'), ('sales_invoices','approved_at'), ('sales_invoices','overpaid_amount'),
                 ('sales_invoices','erp_opening_amount'), ('sales_invoices','erp_opening_at'),
                 ('incoming_payments','pmo_native'), ('incoming_payments','pmo_number'),
                 ('incoming_payments','cancelled_at')) c(t, col)
   where has_column_privilege('authenticated', 'public.' || c.t, c.col, 'INSERT')
      or has_column_privilege('authenticated', 'public.' || c.t, c.col, 'UPDATE')
      or has_column_privilege('anon', 'public.' || c.t, c.col, 'INSERT')
      or has_column_privilege('anon', 'public.' || c.t, c.col, 'UPDATE');
  if v_bad is not null then
    raise exception '0270 §9: a PMO revenue column is client-writable: %', v_bad;
  end if;

  -- §8: exactly six write policies on the two tables, each admitting Admin and Finance and no other role.
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename in ('sales_invoices','incoming_payments')
         and cmd in ('INSERT','UPDATE','DELETE')) <> 6
     or exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename in ('sales_invoices','incoming_payments')
                   and cmd in ('INSERT','UPDATE','DELETE')
                   and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(Executive|Project Manager|Engineer)') then
    raise exception '0270 §9: revenue write policies are not exactly the Admin/Finance set';
  end if;
end $$;
