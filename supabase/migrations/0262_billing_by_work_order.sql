-- 0262_billing_by_work_order.sql — OD-BILL-1 (#785 / #786): clients are billed against their work order (their PO/SO),
-- and the database refuses invoicing past it — before any ERP write.
-- Spec: docs/specs/progress-billing.spec.md §7 (FR-BWO-001..013, AC-BWO-001..006, AC-UNB-002/004).
-- ADR: docs/adr/0080-billing-by-work-order.md. Rulings: DD-BWO-1..12. Plan: docs/plans/2026-10-07-billing-by-work-order.md.
-- Reversal: supabase/migrations/rollback/0262_billing_by_work_order_down.sql (pre-production: supabase db reset).
--
-- ⚑ No table and no column. Two security_invoker views, one invoker reader RPC, two invoker helpers and two SECURITY
--   DEFINER trigger functions with NO client EXECUTE, and one paired edit of create_progress_claim (0250 §5 verbatim +
--   a lock + one call). 0178's allow-list is unchanged (59): nothing here is a client-callable definer. The isolation
--   denominator is unchanged: views are not tables and trigger functions are not in its definer list.
-- ⚑ Hosted Supabase grants EXECUTE on new public functions — and SELECT on new views — to anon/authenticated
--   explicitly (0185/0210): every object below revokes what it must not expose, and each section asserts the result
--   on the database itself.
-- ⚑ Refusals raise SQLSTATE BW001 ("billing, work order"); adapter-dispatch maps it to HTTP 422 (dispatchErrorStatus.ts).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the one billed-work view (0250 §8, DD-PBL-9) gains the invoice's work order. Appended LAST: 0250's
-- get_project_billing and 0251's get_management_pack read it by column name, so neither changes.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace view public.sales_invoice_work_billed with (security_invoker = true) as
  select si.id, si.org_id, si.project_id, si.currency, si.invoice_date, si.status,
         coalesce(pc.kind = 'down_payment', false) as is_down_payment,
         case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net,
         coalesce(pc.dp_recovery_amount, 0) as recovery,
         si.work_order_id
    from public.sales_invoices si
    left join public.progress_claims pc on pc.id = si.id and pc.org_id = si.org_id;
revoke all on public.sales_invoice_work_billed from public, anon, authenticated;
grant select on public.sales_invoice_work_billed to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — work_order_billing_lines (DD-BWO-1): one row per record that bills a work order.
--   • a linked invoice that is not Cancelled, at its billed work (net + recovery; a down payment bills 0);
--   • a live progress claim on the work order with NO invoice yet, at its gross (it will become an invoice, and
--     0250 makes its invoice reuse the claim id — so a raised claim appears exactly once, as its invoice).
-- `billed` is NULL when the invoice has no amount; the aggregate below reports that as "not totalled".
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create view public.work_order_billing_lines with (security_invoker = true) as
  select w.id as record_id, w.org_id, w.work_order_id, w.currency,
         case when w.is_down_payment then 0::numeric else w.net + w.recovery end as billed,
         (w.status in ('Submitted', 'Unpaid', 'Paid')) as submitted,
         (w.status = 'Paid') as paid
    from public.sales_invoice_work_billed w
   where w.work_order_id is not null and w.status <> 'Cancelled'
  union all
  select pc.id, pc.org_id, pc.work_order_id, pc.currency,
         case when pc.kind = 'down_payment' then 0::numeric else pc.gross_amount end,
         false, false
    from public.progress_claims pc
   where pc.work_order_id is not null and pc.withdrawn_at is null
     and not exists (select 1 from public.sales_invoices si where si.id = pc.id);
comment on view public.work_order_billing_lines is
  'OD-BILL-1 DD-BWO-1: every record that bills a work order — linked non-cancelled invoices at their billed work '
  '(DD-PBL-9; a down payment bills 0) and live unraised claims at gross. security_invoker: RLS stays the boundary.';
revoke all on public.work_order_billing_lines from public, anon, authenticated;
grant select on public.work_order_billing_lines to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — work_order_billing (DD-BWO-1..3): one row per work order. All figures excl. tax in the work order's currency.
-- The value uses 0197's rule (inclusive → value − tax amount), byte-identical to get_project_drawdown.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create view public.work_order_billing with (security_invoker = true) as
  select wo.id as work_order_id, wo.org_id, wo.project_id, wo.status, wo.wo_number, wo.title, wo.closed_at, wo.currency,
         case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end as order_net,
         coalesce(sum(l.billed) filter (where l.submitted), 0) as invoiced,
         coalesce(sum(l.billed) filter (where not l.submitted), 0) as pending,
         coalesce(sum(l.billed) filter (where l.paid), 0) as paid,
         (case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end)
           - coalesce(sum(l.billed), 0) as remaining,
         coalesce(bool_and(l.billed is not null and l.currency = wo.currency)
                    filter (where l.record_id is not null), true) as figures_complete,
         count(l.record_id)::int as line_count,
         (count(l.record_id) filter (where l.submitted and not l.paid))::int as unpaid_count
    from public.work_orders wo
    left join public.work_order_billing_lines l on l.work_order_id = wo.id and l.org_id = wo.org_id
   group by wo.id;
comment on view public.work_order_billing is
  'OD-BILL-1 DD-BWO-1..3: per work order, excl. tax in its currency — value, invoiced (submitted), pending (drafts + '
  'unraised claims), paid, remaining (value − invoiced − pending), and whether every record could be totalled. '
  'Derived on every read; never stored (DD-WO-3).';
revoke all on public.work_order_billing from public, anon, authenticated;
grant select on public.work_order_billing to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.work_order_billing_lines', 'select')
     or has_table_privilege('anon', 'public.work_order_billing', 'select')
     or has_table_privilege('anon', 'public.sales_invoice_work_billed', 'select') then
    raise exception '0262 §1-§3: anon can read a work-order billing view';
  end if;
  if not has_table_privilege('authenticated', 'public.work_order_billing', 'select') then
    raise exception '0262 §3: authenticated cannot read work_order_billing';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — the helpers. INVOKER and with NO client EXECUTE: they are called only from §5/§6 (SECURITY DEFINER trigger
-- functions) and from create_progress_claim (SECURITY DEFINER), i.e. always as the owner.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- An ERP command's pre-tax line total: Σ round(qty × rate, 2) — ERPNext rounds each line amount the same way. NULL
-- (cannot be read) when there are no lines or any qty/rate is not a JSON number; the helper refuses a NULL.
create or replace function public.invoice_command_line_total(p_payload jsonb)
  returns numeric language sql immutable set search_path = public as $$
  select case when bool_and(jsonb_typeof(i -> 'qty') = 'number' and jsonb_typeof(i -> 'rate') = 'number')
              then sum(round((i ->> 'qty')::numeric * (i ->> 'rate')::numeric, 2)) end
    from jsonb_array_elements(case when jsonb_typeof(p_payload -> 'items') = 'array' then p_payload -> 'items'
                                   else '[]'::jsonb end) i
$$;
revoke all on function public.invoice_command_line_total(jsonb) from public, anon, authenticated;

-- DD-BWO-5: the ONE definition of the per-work-order serialisation point (transaction-scoped).
create or replace function public.lock_work_order_billing(p_work_order_id uuid)
  returns void language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('work_order_billing:' || p_work_order_id::text, 0))
$$;
revoke all on function public.lock_work_order_billing(uuid) from public, anon, authenticated;

-- DD-BWO-1..5: the refusal. p_record_id is the record being written (excluded from "already billed" so an edit is
-- measured against everything ELSE); p_billed its billed work excl. tax; p_currency NULL when the caller has none.
create or replace function public.assert_work_order_invoiceable(
  p_org_id uuid, p_work_order_id uuid, p_project_id uuid, p_record_id text, p_billed numeric, p_currency text)
  returns void language plpgsql volatile set search_path = public as $$
declare
  v_org      uuid;
  v_project  uuid;
  v_status   public.work_order_status;
  v_currency text;
  v_label    text;
  v_net      numeric;
  v_existing numeric;
  v_unknown  boolean;
begin
  -- Taken FIRST, so every read below sees each billing write that committed before this one (DD-BWO-5).
  perform public.lock_work_order_billing(p_work_order_id);

  select wo.org_id, wo.project_id, wo.status, wo.currency, coalesce(wo.wo_number, wo.title),
         case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end
    into v_org, v_project, v_status, v_currency, v_label, v_net
    from public.work_orders wo where wo.id = p_work_order_id;
  if not found or v_org is distinct from p_org_id then
    raise exception 'work order not found' using errcode = 'BW001';
  end if;
  if v_project is distinct from p_project_id then
    raise exception 'the work order must be on the same project as the invoice' using errcode = 'BW001';
  end if;
  if v_status not in ('Issued', 'Closed') then
    raise exception 'work order % is %: only an issued or closed work order can be invoiced', v_label, v_status
      using errcode = 'BW001';
  end if;
  if p_currency is not null and p_currency is distinct from v_currency then
    raise exception 'this invoice is in % but work order % is in %: a work order is invoiced in its own currency',
      p_currency, v_label, v_currency using errcode = 'BW001';
  end if;
  -- `< 'Infinity'` is what rejects NaN (NaN sorts above every value) — the 0169/0193 construction.
  if p_billed is null or not (p_billed > '-Infinity'::numeric and p_billed < 'Infinity'::numeric) then
    raise exception 'the invoice amount could not be read, so it cannot be checked against work order %', v_label
      using errcode = 'BW001';
  end if;

  with lines as (
    -- what the views count (mirrored invoices + unraised claims), minus the record being written
    select l.record_id::text as record_id, l.billed, l.currency
      from public.work_order_billing_lines l
     where l.work_order_id = p_work_order_id and l.record_id::text <> lower(p_record_id)
    union all
    -- ERP commands still in flight (not yet mirrored, or an edit/amend not yet read back). A claim's own command is
    -- excluded: the claim already counts at gross. A command with no line array rebuilds no body and moves no money.
    select lower(o.pmo_record_id), public.invoice_command_line_total(o.payload), v_currency
      from public.external_command_outbox o
     where o.org_id = p_org_id and o.domain = 'revenue'
       and o.state in ('pending', 'committing', 'committed', 'quarantined', 'held')
       and o.payload ->> 'erp_doc_kind' = 'sales-invoice'
       and jsonb_typeof(o.payload -> 'items') = 'array'
       and (o.operation in ('create', 'update') or (o.operation = 'transition' and o.payload ->> 'verb' = 'amend'))
       and lower(o.pmo_record_id) <> lower(p_record_id)
       and not exists (select 1 from public.progress_claims pc where pc.id::text = lower(o.pmo_record_id))
       and lower(coalesce(nullif(btrim(o.payload ->> 'workOrderId'), ''),
                          (select si.work_order_id::text from public.sales_invoices si
                            where si.id::text = lower(o.pmo_record_id)))) = p_work_order_id::text
  ), per_record as (
    -- an invoice with an edit in flight counts at the larger of its mirrored and its pending amount
    select record_id, max(billed) as billed,
           bool_or(billed is null or currency is distinct from v_currency) as unknown
      from lines group by record_id
  )
  select coalesce(sum(billed), 0), coalesce(bool_or(unknown), false)
    into v_existing, v_unknown
    from per_record;

  if v_unknown then
    raise exception 'an invoice on work order % has no amount or is in another currency, so what is still to invoice cannot be checked',
      v_label using errcode = 'BW001';
  end if;
  if v_existing + p_billed > v_net then
    raise exception 'this invoice would bill % against work order % (worth % excl. tax, with % already invoiced or in draft): only % is still to invoice',
      round(p_billed, 2), v_label, round(v_net, 2), round(v_existing, 2), round(greatest(v_net - v_existing, 0), 2)
      using errcode = 'BW001';
  end if;
end; $$;
revoke all on function public.assert_work_order_invoiceable(uuid, uuid, uuid, text, numeric, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — sales_invoices: every writer except the service-role mirror and a no-JWT server load (DD-BWO-4).
-- ⚑ NOT actor_bypasses_rls(): this function is SECURITY DEFINER, so current_user is the owner for EVERY caller and
--   that predicate would exempt everyone — the DD-WO-8 lesson. The exemptions key on the JWT instead.
-- ⚑ Named zzzz_ so it fires AFTER stamp_org_id, the currency stamp and 0227's tax-base trigger (BEFORE triggers fire
--   in name order): it reads the stamped org, currency and tax amount.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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
    -- A reduction, or a status move that bills the same, never needs refusing. NULL on either side falls through.
    if v_new <= v_old then return new; end if;
  end if;

  perform public.assert_work_order_invoiceable(new.org_id, new.work_order_id, new.project_id, new.id::text, v_new, new.currency);
  return new;
end; $$;
revoke all on function public.assert_sales_invoice_within_work_order() from public, anon, authenticated;
create trigger sales_invoices_zzzz_work_order_invoiceable
  before insert or update of work_order_id, amount, tax_amount, tax_treatment, status on public.sales_invoices
  for each row execute function public.assert_sales_invoice_within_work_order();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — the ERP path: BEFORE INSERT on the outbox, which precedes every ERP POST (0134), so a refusal never strands
-- an ERP document. PostgREST runs the insert as one statement: the advisory lock is held until it commits.
-- zz_: fires after external_command_outbox_stamp_org_id (it reads NEW.org_id).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_outbox_invoice_within_work_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_record  text := lower(new.pmo_record_id);
  v_wo_text text;
  v_wo      uuid;
  v_project uuid;
  v_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if new.payload is null or new.payload ->> 'erp_doc_kind' is distinct from 'sales-invoice' then return new; end if;
  -- submit / cancel act on an existing document and build no body (buildsSalesInvoiceBody, dispatchFactory.ts)
  if not (new.operation in ('create', 'update') or (new.operation = 'transition' and new.payload ->> 'verb' = 'amend')) then
    return new;
  end if;
  if jsonb_typeof(new.payload -> 'items') is distinct from 'array' then return new; end if;
  if v_record !~ v_uuid then return new; end if;
  -- A billing claim reserved its gross when it was created (§7) and is immutable (0250).
  if exists (select 1 from public.progress_claims pc where pc.id = v_record::uuid) then return new; end if;

  if new.operation = 'create' then
    v_wo_text := lower(nullif(btrim(new.payload ->> 'workOrderId'), ''));
    if v_wo_text is null then return new; end if;
    if v_wo_text !~ v_uuid then
      raise exception 'work order not found' using errcode = 'BW001';
    end if;
    v_wo := v_wo_text::uuid;
    v_project := case when lower(new.payload ->> 'projectId') ~ v_uuid then lower(new.payload ->> 'projectId')::uuid end;
  else
    -- An edit or amend never moves the work order (DD-BWO-8): it is the mirror row's.
    select si.work_order_id, si.project_id into v_wo, v_project
      from public.sales_invoices si where si.id = v_record::uuid and si.org_id = new.org_id;
    if v_wo is null then return new; end if;
  end if;

  perform public.assert_work_order_invoiceable(new.org_id, v_wo, v_project, v_record,
    public.invoice_command_line_total(new.payload), nullif(btrim(new.payload ->> 'currency'), ''));
  return new;
end; $$;
revoke all on function public.assert_outbox_invoice_within_work_order() from public, anon, authenticated;
create trigger external_command_outbox_zz_work_order_invoice_fence
  before insert on public.external_command_outbox
  for each row when (new.domain = 'revenue')
  execute function public.assert_outbox_invoice_within_work_order();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — paired edit: 0250 §5's create_progress_claim, VERBATIM, with two marked additions (the billing lock before the
-- project row lock; the reservation before the progress insert). Down payments bill nothing against a work order
-- (DD-BWO-1), so the down-payment branch gains no call.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  -- ⚑ 0262 (OD-BILL-1, DD-BWO-5): the work order's billing lock BEFORE the project row lock — the order every billing
  --   writer uses, so a claim and a native invoice on one work order cannot deadlock.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or b.work_order_id is distinct from p_work_order_id) then
      raise exception 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4): a claim reserves its gross against its work order when it is created.
    if p_work_order_id is not null then
      perform public.assert_work_order_invoiceable(v_org, p_work_order_id, p_project_id, v_id::text, v_gross, v_currency);
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;
revoke all on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — hosted-grant assertion for §4–§7 (fails the migration, on the database itself, if any internal function is
-- client-executable or the claim RPC lost its grant).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v_exposed text;
begin
  select string_agg(sig, ', ') into v_exposed
    from (values ('public.invoice_command_line_total(jsonb)'),
                 ('public.lock_work_order_billing(uuid)'),
                 ('public.assert_work_order_invoiceable(uuid,uuid,uuid,text,numeric,text)'),
                 ('public.assert_sales_invoice_within_work_order()'),
                 ('public.assert_outbox_invoice_within_work_order()')) f(sig)
   where has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute');
  if v_exposed is not null then
    raise exception '0262 §8: client roles can execute internal billing functions: %', v_exposed;
  end if;
  if has_function_privilege('anon', 'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)', 'execute') then
    raise exception '0262 §8: create_progress_claim grants drifted';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — get_unbilled_work_orders (DD-BWO-10, #786): one jsonb document so the totals are computed server-side and are
-- never bounded by PostgREST max_rows. SECURITY INVOKER — do NOT add security definer: RLS scopes every read.
-- Totals per currency, never converted (DD-MMP-5). Deliberately NOT in 0178's allow-list (invoker; listing it would
-- blind that sweep if someone later flips it to definer — the get_project_drawdown note).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.get_unbilled_work_orders(p_limit integer default 8)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with zone as (
    select coalesce((select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), 'UTC') as tz
  ),
  live as (
    select b.work_order_id, b.wo_number, b.title, b.project_id, p.name as project_name, b.status, b.currency,
           b.remaining, b.figures_complete,
           case when b.status = 'Closed' and b.closed_at is not null
                then (now() at time zone zone.tz)::date - (b.closed_at at time zone zone.tz)::date end as days_since_closed
      from public.work_order_billing b
      join public.projects p on p.id = b.project_id
      cross join zone
     where b.status in ('Issued', 'Closed') and p.archived_at is null
  ),
  billable as (
    select * from live where figures_complete and remaining > 0
  )
  select jsonb_build_object(
    'totals', coalesce((select jsonb_agg(jsonb_build_object('currency', t.currency, 'remaining', t.remaining, 'count', t.n)
                                         order by t.currency)
                          from (select currency, sum(remaining) as remaining, count(*)::int as n
                                  from billable group by currency) t), '[]'::jsonb),
    'incomplete_count', (select count(*)::int from live where not figures_complete),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.remaining desc, r.work_order_id)
                        from (select work_order_id, wo_number, title, project_id, project_name, status, currency,
                                     remaining, days_since_closed
                                from billable
                               order by remaining desc, work_order_id
                               limit greatest(1, least(coalesce(p_limit, 8), 50))) r), '[]'::jsonb))
$$;
comment on function public.get_unbilled_work_orders(integer) is
  'OD-BILL-1 / #786 DD-BWO-10: what is still to invoice on the org''s Issued and Closed work orders on live projects — '
  'totals per currency, the untotallable count, and the work orders with the most left. SECURITY INVOKER on purpose.';
revoke all on function public.get_unbilled_work_orders(integer) from public, anon;
grant execute on function public.get_unbilled_work_orders(integer) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_unbilled_work_orders(integer)', 'execute') then
    raise exception '0262 §9: anon can execute get_unbilled_work_orders';
  end if;
  if not has_function_privilege('authenticated', 'public.get_unbilled_work_orders(integer)', 'execute') then
    raise exception '0262 §9: authenticated cannot execute get_unbilled_work_orders';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.get_unbilled_work_orders(integer)'::regprocedure) then
    raise exception '0262 §9: get_unbilled_work_orders must stay SECURITY INVOKER';
  end if;
end $$;
