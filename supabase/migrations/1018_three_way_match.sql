-- 1018_three_way_match.sql — #2525: three-way match. A vendor bill is checked line by line against the purchase order
-- (the purchase's ordered items) and the goods received before it can be paid. A mismatch holds the bill until an
-- Admin or Finance user who neither recorded the bill nor its match lines approves the exception with a reason.
-- Spec docs/specs/three-way-match.spec.md · Plan docs/plans/2026-11-20-three-way-match.md.
-- Proven by supabase/tests/three_way_match.test.sql (+ the 0178 allow-list).
--
-- Scope (spec FR-TWM-002): PMO-native bills on non-subcontract purchases of an organisation that switched the match on.
-- Bills recorded before the switch, ERP-mirrored bills (erp_docstatus set), record-only purchases, subcontract purchases
-- (their bills already carry a hard quantity cap, 0472) and organisations whose purchasing an ERP owns are untouched.
-- Nothing here writes to an ERP or changes any ERP posting.
--
-- ── REVERSE (also rollback/1018_three_way_match_down.sql; refused while an approved exception exists) ──
--   drop the three payment-gate triggers and their functions, the client RPCs, the evaluator, then the five tables.

-- §1 Settings: one row per organisation, written only by set_three_way_match_settings (Admin).
create table public.org_three_way_match_settings (
  org_id                 uuid primary key references public.organizations(id) on delete cascade,
  enabled                boolean not null default false,
  quantity_tolerance_pct numeric(5,2) not null default 0,
  amount_tolerance_pct   numeric(5,2) not null default 0,
  enabled_at             timestamptz,
  updated_by             uuid not null references public.profiles(id),
  updated_at             timestamptz not null default now(),
  constraint org_three_way_match_settings_qty_tol check (quantity_tolerance_pct >= 0 and quantity_tolerance_pct <= 100),
  constraint org_three_way_match_settings_amt_tol check (amount_tolerance_pct >= 0 and amount_tolerance_pct <= 100),
  constraint org_three_way_match_settings_enabled_at check (not enabled or enabled_at is not null)
);
comment on table public.org_three_way_match_settings is
  '#2525: whether vendor bills are matched against order and receipt before payment, and the per-org tolerances.';

-- §2 Receipt lines: what a goods receipt received, per ordered item. Replaced only by record_receipt_match_lines.
create table public.procurement_receipt_lines (
  receipt_id  uuid not null references public.procurement_receipts(id) on delete cascade,
  item_id     uuid not null references public.procurement_items(id),
  org_id      uuid not null references public.organizations(id),
  quantity    numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  recorded_by uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  primary key (receipt_id, item_id)
);
create index procurement_receipt_lines_item_idx on public.procurement_receipt_lines (item_id);

-- §3 Bill match header + lines. `seq` orders a purchase's bills, so a bill's cumulative billed quantity counts only the
-- bills matched before it (a later over-bill never holds an earlier bill). recorded_by is an authorship fact (SoD).
create table public.procurement_bill_matches (
  invoice_id  uuid primary key references public.procurement_invoices(id) on delete cascade,
  org_id      uuid not null references public.organizations(id),
  seq         bigint generated always as identity,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now()
);
create unique index procurement_bill_matches_seq_uq on public.procurement_bill_matches (seq);
create table public.procurement_bill_match_lines (
  invoice_id uuid not null references public.procurement_bill_matches(invoice_id) on delete cascade,
  item_id    uuid not null references public.procurement_items(id),
  org_id     uuid not null references public.organizations(id),
  quantity   numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate       numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  amount     numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  primary key (invoice_id, item_id)
);
create index procurement_bill_match_lines_item_idx on public.procurement_bill_match_lines (item_id);

-- §4 Approved exceptions: append-only. One per bill. The match as it stood at approval is kept in `match`.
create table public.bill_match_exceptions (
  invoice_id  uuid primary key references public.procurement_invoices(id),
  org_id      uuid not null references public.organizations(id),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  reason      text not null check (length(btrim(reason)) between 1 and 1000),
  match       jsonb not null
);

create or replace function public.guard_bill_match_exception_immutable() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  raise exception 'an approved bill match exception is permanent' using errcode = '42501';
end $$;
revoke all on function public.guard_bill_match_exception_immutable() from public, anon, authenticated;
create trigger bill_match_exceptions_immutable before update or delete on public.bill_match_exceptions
  for each row execute function public.guard_bill_match_exception_immutable();

-- §5 RLS: select only, org + active member; child rows also need their parent visible under the caller's own RLS
-- (so the invoice read exclusions are inherited, not restated). Every write goes through a definer below.
alter table public.org_three_way_match_settings enable row level security;
alter table public.org_three_way_match_settings force  row level security;
create policy org_three_way_match_settings_select on public.org_three_way_match_settings for select
  using (org_id = public.auth_org_id() and public.is_active_member());

alter table public.procurement_receipt_lines enable row level security;
alter table public.procurement_receipt_lines force  row level security;
create policy procurement_receipt_lines_select on public.procurement_receipt_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.procurement_receipts r where r.id = receipt_id));

alter table public.procurement_bill_matches enable row level security;
alter table public.procurement_bill_matches force  row level security;
create policy procurement_bill_matches_select on public.procurement_bill_matches for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.procurement_invoices i where i.id = invoice_id));

alter table public.procurement_bill_match_lines enable row level security;
alter table public.procurement_bill_match_lines force  row level security;
create policy procurement_bill_match_lines_select on public.procurement_bill_match_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.procurement_invoices i where i.id = invoice_id));

alter table public.bill_match_exceptions enable row level security;
alter table public.bill_match_exceptions force  row level security;
create policy bill_match_exceptions_select on public.bill_match_exceptions for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.procurement_invoices i where i.id = invoice_id));

revoke all on public.org_three_way_match_settings, public.procurement_receipt_lines, public.procurement_bill_matches,
              public.procurement_bill_match_lines, public.bill_match_exceptions from public, anon, authenticated;
grant select on public.org_three_way_match_settings, public.procurement_receipt_lines, public.procurement_bill_matches,
               public.procurement_bill_match_lines, public.bill_match_exceptions to authenticated;

-- §6 THE MATCH (FR-TWM-003..006). The only place the rule lives. Reads as the owner on purpose: it must see every
-- receipt and bill whatever the caller's RLS shows. Internal: clients read it through get_bill_match.
-- status: not_applicable | matched | held | exception_approved.
create or replace function public.bill_match_evaluate(p_invoice_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_inv public.procurement_invoices; v_proc public.procurements; v_set public.org_three_way_match_settings;
        v_match public.procurement_bill_matches; v_exc public.bill_match_exceptions;
        v_q numeric; v_a numeric; v_lines jsonb := '[]'::jsonb; v_reasons text[] := '{}'; v_line_held boolean := false;
        v_lines_total numeric; v_net numeric; v_status text;
begin
  select * into v_inv from public.procurement_invoices where id = p_invoice_id;
  if not found then return null; end if;
  select * into v_proc from public.procurements where id = v_inv.procurement_id;
  select * into v_set from public.org_three_way_match_settings where org_id = v_inv.org_id;
  if v_set.org_id is null or not v_set.enabled or v_inv.created_at < v_set.enabled_at
     or v_proc.is_subcontract or v_proc.record_only
     or coalesce(public.domain_externally_owned(v_inv.org_id, 'procurement'), false)
     or v_inv.erp_docstatus is not null or v_inv.erp_cancelled_at is not null or v_inv.voided_at is not null then
    return jsonb_build_object('status', 'not_applicable', 'reasons', '[]'::jsonb, 'lines', '[]'::jsonb);
  end if;
  v_q := v_set.quantity_tolerance_pct / 100.0;
  v_a := v_set.amount_tolerance_pct / 100.0;
  select * into v_match from public.procurement_bill_matches where invoice_id = v_inv.id;
  if v_match.invoice_id is null then
    v_reasons := array['no_lines'];
  else
    with earlier as (                       -- live bills on this purchase matched no later than this one
      select m.invoice_id
        from public.procurement_bill_matches m
        join public.procurement_invoices i on i.id = m.invoice_id
       where i.procurement_id = v_inv.procurement_id and m.seq <= v_match.seq
         and i.erp_docstatus is null and i.erp_cancelled_at is null and i.voided_at is null),
    billed as (
      select l.item_id, sum(l.quantity) as q
        from public.procurement_bill_match_lines l join earlier e on e.invoice_id = l.invoice_id
       group by l.item_id),
    received as (
      select rl.item_id, sum(rl.quantity) as q
        from public.procurement_receipt_lines rl
        join public.procurement_receipts r on r.id = rl.receipt_id
       where r.procurement_id = v_inv.procurement_id
         and coalesce(r.erp_docstatus, 1) <> 2 and r.erp_cancelled_at is null
       group by rl.item_id),
    lines as (
      select l.item_id, pi.name as item_name, pi.quantity as ordered, pi.rate as order_rate,
             coalesce(rc.q, 0) as received, coalesce(b.q, 0) as billed_to_date,
             l.quantity as bill_quantity, l.rate as bill_rate, l.amount as bill_amount,
             array_remove(array[
               case when pi.id is null then 'not_on_order' end,
               case when pi.id is not null and coalesce(b.q, 0) > coalesce(rc.q, 0) * (1 + v_q) then 'over_received' end,
               case when pi.id is not null and coalesce(b.q, 0) > pi.quantity * (1 + v_q) then 'over_ordered' end,
               case when pi.id is not null and l.rate > pi.rate * (1 + v_a) then 'price_variance' end
             ], null) as reasons
        from public.procurement_bill_match_lines l
        left join public.procurement_items pi on pi.id = l.item_id and pi.procurement_id = v_inv.procurement_id
        left join received rc on rc.item_id = l.item_id
        left join billed b on b.item_id = l.item_id
       where l.invoice_id = v_inv.id)
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_id', item_id, 'item_name', item_name, 'ordered', ordered, 'order_rate', order_rate,
             'received', received, 'billed_to_date', billed_to_date, 'bill_quantity', bill_quantity,
             'bill_rate', bill_rate, 'bill_amount', bill_amount, 'reasons', to_jsonb(reasons))
             order by item_name nulls first, item_id), '[]'::jsonb),
           coalesce(bool_or(cardinality(reasons) > 0), false),
           coalesce(sum(bill_amount), 0)
      into v_lines, v_line_held, v_lines_total
      from lines;
    -- The bill's own pre-tax amount must agree with its lines within the amount tolerance (FR-TWM-005).
    v_net := v_inv.amount - case when v_inv.tax_treatment = 'inclusive' then coalesce(v_inv.tax_amount, 0) else 0 end;
    if v_net is null or abs(v_net - v_lines_total) > round(v_lines_total * v_a, 2) then
      v_reasons := array_append(v_reasons, 'amount_mismatch');
    end if;
  end if;
  select * into v_exc from public.bill_match_exceptions where invoice_id = v_inv.id;
  v_status := case
    when v_exc.invoice_id is not null then 'exception_approved'
    when cardinality(v_reasons) = 0 and not v_line_held then 'matched'
    else 'held'
  end;
  return jsonb_build_object(
    'status', v_status, 'reasons', to_jsonb(v_reasons), 'lines', v_lines,
    'quantity_tolerance_pct', v_set.quantity_tolerance_pct, 'amount_tolerance_pct', v_set.amount_tolerance_pct,
    'exception', case when v_exc.invoice_id is null then null else jsonb_build_object(
      'approved_by', v_exc.approved_by, 'approved_at', v_exc.approved_at, 'reason', v_exc.reason) end);
end $$;
revoke all on function public.bill_match_evaluate(uuid) from public, anon, authenticated;

-- Whether the organisation that owns a purchase has the match switched on (the gate's cheap first question, so a
-- purchase in an organisation without the match never takes the gate's lock).
create or replace function public.purchase_match_on(p_procurement_id uuid) returns boolean
  language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.procurements p
                   join public.org_three_way_match_settings s on s.org_id = p.org_id and s.enabled
                  where p.id = p_procurement_id)
$$;
revoke all on function public.purchase_match_on(uuid) from public, anon, authenticated;

-- Whether any bill on a purchase is held (the payment gate's one question).
create or replace function public.purchase_has_held_bill(p_procurement_id uuid) returns boolean
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if not public.purchase_match_on(p_procurement_id) then return false; end if;
  return exists (select 1 from public.procurement_invoices i
                  where i.procurement_id = p_procurement_id
                    and public.bill_match_evaluate(i.id)->>'status' = 'held');
end $$;
revoke all on function public.purchase_has_held_bill(uuid) from public, anon, authenticated;

-- §7 THE GATE (FR-TWM-007). A held bill cannot move to payment: no payment is added to or paid on its purchase, the
-- bill is not marked Paid, the purchase is not moved to Paid. Triggers, so every writer (RPC, import, direct table
-- write) is bound. Definer so the check runs whatever the writer's own grants. The purchase row lock serializes the
-- gate with the line and exception writers, which take the same lock first.
create or replace function public.guard_payment_three_way_hold() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and not (new.status = 'Paid' and old.status is distinct from 'Paid') then return new; end if;
  if not public.purchase_match_on(new.procurement_id) then return new; end if;
  perform 1 from public.procurements where id = new.procurement_id for update;
  if public.purchase_has_held_bill(new.procurement_id) then
    raise exception 'a vendor bill on this purchase is held by the three-way match; correct it or approve the exception before paying'
      using errcode = 'MH001', detail = 'three-way-match-held';
  end if;
  return new;
end $$;
revoke all on function public.guard_payment_three_way_hold() from public, anon, authenticated;
create trigger payments_zz_three_way_hold before insert or update of status on public.payments
  for each row execute function public.guard_payment_three_way_hold();

create or replace function public.guard_invoice_paid_three_way_hold() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.status::text = 'Paid' and old.status::text is distinct from 'Paid' and public.purchase_match_on(new.procurement_id) then
    perform 1 from public.procurements where id = new.procurement_id for update;
    if public.bill_match_evaluate(new.id)->>'status' = 'held' then
      raise exception 'this vendor bill is held by the three-way match; correct it or approve the exception before paying'
        using errcode = 'MH001', detail = 'three-way-match-held';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_invoice_paid_three_way_hold() from public, anon, authenticated;
create trigger procurement_invoices_zz_three_way_hold before update of status on public.procurement_invoices
  for each row execute function public.guard_invoice_paid_three_way_hold();

create or replace function public.guard_procurement_paid_three_way_hold() returns trigger
  language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if new.status::text = 'Paid' and old.status::text is distinct from 'Paid'
     and public.purchase_has_held_bill(new.id) then
    raise exception 'a vendor bill on this purchase is held by the three-way match; correct it or approve the exception before paying'
      using errcode = 'MH001', detail = 'three-way-match-held';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_paid_three_way_hold() from public, anon, authenticated;
create trigger procurements_zz_three_way_hold before update of status on public.procurements
  for each row execute function public.guard_procurement_paid_three_way_hold();

-- §8 Settings writer (Admin). Switching on stamps enabled_at: bills recorded before it are not matched (FR-TWM-002).
create or replace function public.set_three_way_match_settings(
  p_enabled boolean, p_quantity_tolerance_pct numeric, p_amount_tolerance_pct numeric)
  returns public.org_three_way_match_settings
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_old public.org_three_way_match_settings; v_row public.org_three_way_match_settings;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin sets the three-way match' using errcode = '42501';
  end if;
  if p_enabled is null
     or p_quantity_tolerance_pct is null or not (p_quantity_tolerance_pct >= 0 and p_quantity_tolerance_pct <= 100)
     or p_amount_tolerance_pct is null or not (p_amount_tolerance_pct >= 0 and p_amount_tolerance_pct <= 100) then
    raise exception 'the three-way match needs on or off and tolerances from 0 to 100 percent' using errcode = '22023';
  end if;
  select * into v_old from public.org_three_way_match_settings where org_id = v_org for update;
  insert into public.org_three_way_match_settings
    (org_id, enabled, quantity_tolerance_pct, amount_tolerance_pct, enabled_at, updated_by, updated_at)
  values (v_org, p_enabled, round(p_quantity_tolerance_pct, 2), round(p_amount_tolerance_pct, 2),
          case when p_enabled then now() end, v_uid, now())
  on conflict (org_id) do update set
    enabled = excluded.enabled,
    quantity_tolerance_pct = excluded.quantity_tolerance_pct,
    amount_tolerance_pct = excluded.amount_tolerance_pct,
    enabled_at = case when excluded.enabled and not org_three_way_match_settings.enabled then excluded.enabled_at
                      else org_three_way_match_settings.enabled_at end,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into v_row;
  perform public.log_audit('three_way_match.settings', v_org, v_uid, v_org, jsonb_build_object(
    'from', case when v_old.org_id is null then null else jsonb_build_object('enabled', v_old.enabled,
              'quantity_tolerance_pct', v_old.quantity_tolerance_pct, 'amount_tolerance_pct', v_old.amount_tolerance_pct) end,
    'to', jsonb_build_object('enabled', v_row.enabled,
              'quantity_tolerance_pct', v_row.quantity_tolerance_pct, 'amount_tolerance_pct', v_row.amount_tolerance_pct)));
  return v_row;
end $$;
revoke all on function public.set_three_way_match_settings(boolean, numeric, numeric) from public, anon, authenticated;
grant execute on function public.set_three_way_match_settings(boolean, numeric, numeric) to authenticated;

-- Shared input check for the two line writers: a non-empty array of objects naming each ordered item once.
create or replace function public.three_way_match_lines_unreadable(p_lines jsonb, p_with_rate boolean) returns boolean
  language sql immutable set search_path = public, pg_catalog as $$
  select p_lines is null or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0
      or exists (select 1 from jsonb_array_elements(p_lines) x
                  where jsonb_typeof(x) is distinct from 'object'
                     or exists (select 1 from jsonb_object_keys(x) k
                                 where k not in ('item_id', 'quantity') and not (p_with_rate and k = 'rate'))
                     -- CASE, not OR: SQL does not promise left-to-right evaluation, so a cast is reached only
                     -- after its type test passed.
                     or case when jsonb_typeof(x->'item_id') = 'string'
                             then (x->>'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             else true end
                     or case when jsonb_typeof(x->'quantity') = 'number'
                             then not ((x->>'quantity')::numeric > 0 and (x->>'quantity')::numeric < 1e11)
                             else true end
                     or (p_with_rate and case when jsonb_typeof(x->'rate') = 'number'
                                              then not ((x->>'rate')::numeric >= 0 and (x->>'rate')::numeric < 1e12)
                                              else true end))
      or (select count(*) <> count(distinct x->>'item_id') from jsonb_array_elements(p_lines) x)
$$;
revoke all on function public.three_way_match_lines_unreadable(jsonb, boolean) from public, anon, authenticated;

-- §9 Receipt lines writer (the receipt writers' roles). Replaces the receipt's lines.
create or replace function public.record_receipt_match_lines(p_receipt_id uuid, p_lines jsonb)
  returns setof public.procurement_receipt_lines
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_rcpt public.procurement_receipts; v_proc public.procurements;
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
  if public.three_way_match_lines_unreadable(p_lines, false) then
    raise exception 'receipt lines must name each ordered item once with a quantity above zero' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x
              where not exists (select 1 from public.procurement_items pi
                                 where pi.id = (x->>'item_id')::uuid and pi.procurement_id = v_proc.id)) then
    raise exception 'a receipt line names an item that is not on this purchase' using errcode = '22023';
  end if;
  delete from public.procurement_receipt_lines where receipt_id = v_rcpt.id;
  insert into public.procurement_receipt_lines (receipt_id, item_id, org_id, quantity, recorded_by)
  select v_rcpt.id, (x->>'item_id')::uuid, v_org, round((x->>'quantity')::numeric, 3), v_uid
    from jsonb_array_elements(p_lines) x;
  perform public.log_audit('procurement_receipt.match_lines', v_org, v_uid, v_rcpt.id,
    jsonb_build_object('procurement_id', v_proc.id, 'lines', p_lines));
  return query select * from public.procurement_receipt_lines where receipt_id = v_rcpt.id;
end $$;
revoke all on function public.record_receipt_match_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_receipt_match_lines(uuid, jsonb) to authenticated;

-- §10 Bill lines writer (the bill capture roles). Replaces the bill's lines and records who set them (an authorship
-- event for SoD). Refused once an exception is approved: the approval froze what it approved.
create or replace function public.record_bill_match_lines(p_invoice_id uuid, p_lines jsonb)
  returns jsonb
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
        v_inv public.procurement_invoices; v_proc public.procurements;
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
  insert into public.procurement_bill_matches (invoice_id, org_id, recorded_by)
  values (v_inv.id, v_org, v_uid)
  on conflict (invoice_id) do update set recorded_by = excluded.recorded_by, recorded_at = now();
  delete from public.procurement_bill_match_lines where invoice_id = v_inv.id;
  insert into public.procurement_bill_match_lines (invoice_id, item_id, org_id, quantity, rate)
  select v_inv.id, (x->>'item_id')::uuid, v_org, round((x->>'quantity')::numeric, 3), round((x->>'rate')::numeric, 2)
    from jsonb_array_elements(p_lines) x;
  perform public.log_audit('procurement_invoice.match_lines', v_org, v_uid, v_inv.id,
    jsonb_build_object('procurement_id', v_proc.id, 'lines', p_lines));
  return public.bill_match_evaluate(v_inv.id);
end $$;
revoke all on function public.record_bill_match_lines(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_bill_match_lines(uuid, jsonb) to authenticated;

-- §11 Read (the roles that may read bills). Returns the match for one bill of the caller's organisation.
create or replace function public.get_bill_match(p_invoice_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.procurement_invoices where id = p_invoice_id and org_id = public.auth_org_id()) then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  return public.bill_match_evaluate(p_invoice_id);
end $$;
revoke all on function public.get_bill_match(uuid) from public, anon, authenticated;
grant execute on function public.get_bill_match(uuid) to authenticated;

-- §12 THE EXCEPTION (FR-TWM-008/009, ADR-0019). Admin or Finance; a reason; never the bill's author (the actor of its
-- create audit) nor the person who recorded its match lines. Fails closed when the author is not recorded.
create or replace function public.approve_bill_match_exception(p_invoice_id uuid, p_reason text)
  returns jsonb
  language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_reason text := nullif(btrim(p_reason), '');
        v_inv public.procurement_invoices; v_proc public.procurements; v_match jsonb; v_capturer uuid; v_recorder uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) > 1000 then
    raise exception 'an exception needs a reason of 1 to 1000 characters' using errcode = '22023';
  end if;
  select * into v_inv from public.procurement_invoices where id = p_invoice_id and org_id = v_org;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_inv.procurement_id and org_id = v_org for update;
  perform public.assert_feature_on(v_org, 'procurement');
  v_match := public.bill_match_evaluate(v_inv.id);
  if v_match->>'status' = 'exception_approved' then
    raise exception 'an exception was already approved for this bill' using errcode = '23505';
  end if;
  if v_match->>'status' is distinct from 'held' then
    raise exception 'this bill is not held by the three-way match' using errcode = 'MH002';
  end if;
  select e.actor_id into v_capturer from public.audit_events e
   where e.org_id = v_org and e.entity_id = v_inv.id and e.action = 'procurement_invoice.create'
   order by e.created_at limit 1;
  if v_capturer is null then
    raise exception 'the author of this bill is not recorded; its exception cannot be approved'
      using errcode = '42501', detail = 'three-way-match-author-unknown';
  end if;
  select recorded_by into v_recorder from public.procurement_bill_matches where invoice_id = v_inv.id;
  if v_uid = v_capturer or v_uid = v_recorder then
    raise exception 'separation of duties: the person who recorded this bill or its lines cannot approve its exception'
      using errcode = '42501', detail = 'three-way-match-own-bill';
  end if;
  insert into public.bill_match_exceptions (invoice_id, org_id, approved_by, reason, match)
  values (v_inv.id, v_org, v_uid, v_reason, v_match);
  perform public.log_audit('procurement_invoice.match_exception', v_org, v_uid, v_inv.id, jsonb_build_object(
    'procurement_id', v_proc.id, 'vi_number', v_inv.vi_number, 'reason', v_reason,
    'captured_by', v_capturer, 'lines_recorded_by', v_recorder, 'reasons', v_match->'reasons'));
  return public.bill_match_evaluate(v_inv.id);
end $$;
revoke all on function public.approve_bill_match_exception(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_bill_match_exception(uuid, text) to authenticated;

-- §13 Closing self-assertion.
do $$
begin
  if has_function_privilege('anon', 'public.approve_bill_match_exception(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_bill_match_lines(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_receipt_match_lines(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_three_way_match_settings(boolean,numeric,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_bill_match(uuid)', 'EXECUTE') then
    raise exception '1018: a three-way match RPC is anon-executable'; end if;
  if has_function_privilege('authenticated', 'public.bill_match_evaluate(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purchase_has_held_bill(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purchase_match_on(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_payment_three_way_hold()', 'EXECUTE') then
    raise exception '1018: an internal three-way match function is client-executable'; end if;
end $$;
