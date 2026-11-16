-- 0924_native_progress_claim_invoice.sql — an organisation where no ERP owns revenue raises a progress claim's invoice in PMO.
-- FR-NAR-040..046 (docs/specs/no-erp-revenue.spec.md), AC-NAR-040..049; AC-PBL-NAT-* (docs/specs/progress-billing.spec.md §6.1).
--
-- create_native_progress_claim_invoice(p_claim) is create_native_tm_invoice (0704) for a progress or down-payment claim: the
-- invoice is a PMO Draft whose id IS the claim id (the primary key is the one-invoice-per-claim guard, and how
-- append_progress_claim_author (0517) finds the claim's preparer), a second Finance/Admin user approves it through the unchanged
-- transition_native_sales_invoice, and the payment is received in PMO. Its lines are the claim's own lines as claimed, plus a
-- negative line for the down payment the claim recovers, so the invoice total is the claim's net (gross - recovery): the figures
-- the ERP raise builds (dispatchRevenue.ts canonicalProgressLines). Nothing else reads a claim's invoice differently: every money
-- reader goes through sales_invoice_work_billed (0498) and counts the row once, native or ERP.
-- No SQL refusal ever stopped creating, evidencing or withdrawing a claim without an ERP (only the Billing tab did).
--
-- native_down_payment_item(): the ERP item an organisation picks in Administration cannot be picked with no ERP, so a down payment
-- claim made while no ERP owns revenue names this one fixed item. create_progress_claim says so below; the outbox fence refuses to
-- send it to an ERP.
--
-- ⚑ redefines create_progress_claim (from 0534), check: OK — two additions, both marked 0924; the rest is the 0534 body verbatim.
-- ⚑ redefines assert_progress_claim_raisable (from 0517), check: OK — one addition, marked 0924; the rest is the 0517 body verbatim.
-- Neither is replaced by any later migration at dev head (grep "function public.create_progress_claim|assert_progress_claim_raisable").

create or replace function public.native_down_payment_item() returns text
  language sql immutable parallel safe as $$ select 'DOWN-PAYMENT'::text $$;
revoke all on function public.native_down_payment_item() from public, anon;
grant execute on function public.native_down_payment_item() to authenticated, service_role;

create or replace function public.create_native_progress_claim_invoice(p_claim uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid      := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_uid         uuid      := auth.uid();
  v_c           public.progress_claims;
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
  select * into v_c from public.progress_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  if v_c.kind = 'time_materials' then
    raise exception 'a time-and-materials claim is invoiced from its own sign-off, not here' using errcode = 'P0001', detail = 'claim-kind';
  end if;
  -- Lock order as create_progress_claim and 0704: the work order's billing lock, the project row, then the claim.
  if v_c.work_order_id is not null then perform public.lock_work_order_billing(v_c.work_order_id); end if;
  select p.currency, p.client_id, p.subject_to_vat, p.tax_rate, p.tax_base_numerator, p.tax_base_denominator, p.customer_contract_ref
    into v_p_currency, v_client, v_vat, v_rate, v_num, v_den, v_contract
    from public.projects p where p.id = v_c.project_id and p.org_id = v_org for share;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  select * into v_c from public.progress_claims c where c.id = p_claim for update;

  -- The claim gate (assert_progress_claim_raisable's rules, same messages): live, with billing evidence.
  if v_c.withdrawn_at is not null then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if not exists (select 1 from public.progress_claim_evidence ev where ev.claim_id = p_claim) then
    raise exception 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice'
      using errcode = '55000';
  end if;

  -- One invoice per claim, whatever its status: a cancelled one also blocks (as for an ERP invoice).
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

  -- The claim's lines as claimed, and the recovery as a negative line; their sum is the claim's net. The line's `role` lets
  -- the screens name the down-payment lines in the viewer's language; the PMO-native item is never shown as a name.
  select jsonb_agg(jsonb_build_object('item_code', x.item_code, 'description', x.description, 'qty', x.qty, 'rate', x.rate, 'amount', x.amount)
                   || case when x.line_role is null then '{}'::jsonb else jsonb_build_object('role', x.line_role) end
                   order by x.grp, x.ord),
         sum(x.amount)
    into v_lines, v_amount
    from (
      select 1 as grp, l.boq_item_id::text as ord, l.item_code, left(l.description, 140) as description, null::text as line_role,
             l.quantity as qty, l.rate, l.amount
        from public.progress_claim_lines l where l.claim_id = p_claim and v_c.kind = 'progress'
      union all
      select 1, 'dp', nullif(v_c.dp_item_code, public.native_down_payment_item()), 'Down payment', 'down_payment',
             1, v_c.down_payment_amount, v_c.down_payment_amount
       where v_c.kind = 'down_payment'
      union all
      select 2, 'recovery', nullif(v_c.dp_item_code, public.native_down_payment_item()), 'Down payment recovery', 'down_payment_recovery',
             1, -v_c.dp_recovery_amount, -v_c.dp_recovery_amount
       where v_c.kind = 'progress' and v_c.dp_recovery_amount > 0
    ) x;
  if v_lines is null or v_amount is distinct from v_c.gross_amount - v_c.dp_recovery_amount then
    raise exception 'the claim''s lines do not add up to its total' using errcode = '23514', detail = 'claim-total-mismatch';
  end if;
  if not (v_amount > 0 and v_amount < 1000000000000) then
    raise exception 'the invoice total must be above zero' using errcode = '23514', detail = 'invoice-total-invalid';
  end if;

  -- tax_amount 0 is a placeholder the 0227 trigger (sales_invoices_zz_apply_tax_base) replaces from tax_rate on insert.
  -- The 0704 marker names this claim id to the work-order fence for the one insert below.
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
  -- 0132's SoD oracle: the creator joins the author set (append_progress_claim_author adds whoever created the claim).
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id) values (v_org, p_claim, v_uid) on conflict do nothing;
  perform public.log_audit('progress_claim_native_invoice.create', v_org, v_uid, p_claim,
    jsonb_build_object('project_id', v_c.project_id, 'work_order_id', v_c.work_order_id, 'kind', v_c.kind,
                       'gross_amount', v_c.gross_amount, 'dp_recovery_amount', v_c.dp_recovery_amount, 'amount', v_amount));
  return p_claim;
end $$;

revoke all on function public.create_native_progress_claim_invoice(uuid) from public, anon;
grant execute on function public.create_native_progress_claim_invoice(uuid) to authenticated;
alter function public.create_native_progress_claim_invoice(uuid) owner to postgres;

-- create_progress_claim (0534 body, two 0924 additions)
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
  v_locked_count integer;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  -- ⚑ 0924: a down payment asks who owns revenue (below), so the organisation row lock comes BEFORE the work-order and
  --   project locks, the order create_native_sales_invoice and create_native_progress_claim_invoice take.
  if p_kind = 'down_payment' then
    perform 1 from public.organizations o where o.id = v_org for share;
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
    -- ⚑ 0924: with no ERP owning revenue there is no ERP item list to choose from, so the claim names the one fixed item PMO
    --   uses (native_down_payment_item). An ERP-owned organisation with no item still gets the refusal below, unchanged.
    if v_item is null and not public.domain_externally_owned(v_org, 'revenue') then
      v_item := public.native_down_payment_item();
    end if;
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
                where b.id is null or (p_work_order_id is not null and not exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id and wl.work_order_id=p_work_order_id)) or (p_work_order_id is null and exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id))) then
      raise exception 'every line must be allocated to the selected work order, or have no allocation for a project-level claim'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    -- Hold every referenced rate stable through cap validation and line insertion.
    perform b.id
      from public.boq_items b
      join jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric) on x.boq_item_id = b.id
     order by b.id
     for share of b;
    get diagnostics v_locked_count = row_count;
    if v_locked_count <> jsonb_array_length(p_lines) then
      raise exception 'every progress claim line must lock a BoQ row' using errcode = '23514';
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
    if v_gross is distinct from (select coalesce(sum(l.amount),0) from public.progress_claim_lines l where l.claim_id=v_id) then
      raise exception 'the progress claim header must equal the sum of its priced lines' using errcode = '23514';
    end if;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;

-- assert_progress_claim_raisable (0517 body, one 0924 addition)
create or replace function public.assert_progress_claim_raisable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_withdrawn timestamptz; v_claim_org uuid; v_dp_item text; v_tm_org uuid; v_tm_status text; v_tm_confirmed uuid;
begin
  if new.pmo_record_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return new;
  end if;
  -- ⚑ 0517 (#1514 D2): a time-and-materials claim exists before its sign-off, without a progress-claim row, so the
  -- "not a claim" exit below would wave it through. Only a confirmed sign-off can be raised.
  select c.org_id, c.status, c.confirmed_by into v_tm_org, v_tm_status, v_tm_confirmed
    from public.tm_claims c where c.id = new.pmo_record_id::uuid for share;
  if found then
    if v_tm_org is distinct from new.org_id then
      raise exception 'this progress claim belongs to another organisation' using errcode = '42501';
    end if;
    if v_tm_status = 'Withdrawn' then
      raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
    end if;
    if v_tm_status is distinct from 'SignedOff' or v_tm_confirmed is null then
      raise exception 'confirm the client''s sign-off before raising this time-and-materials claim''s invoice' using errcode = '55000';
    end if;
  end if;
  select pc.withdrawn_at, pc.org_id, pc.dp_item_code into v_withdrawn, v_claim_org, v_dp_item
    from public.progress_claims pc
   where pc.id = new.pmo_record_id::uuid
     for share;
  if not found then
    return new;   -- not a claim: an ordinary invoice or receipt
  end if;
  -- A money fence fails CLOSED: a claim id under another org is refused, never waved through as "not a claim".
  if v_claim_org is distinct from new.org_id then
    raise exception 'this progress claim belongs to another organisation' using errcode = '42501';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if not exists (select 1 from public.progress_claim_evidence ev where ev.claim_id = new.pmo_record_id::uuid) then
    raise exception 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice'
      using errcode = '55000';
  end if;
  -- ⚑ 0924: a claim made while no ERP owned revenue names PMO's own down payment item, which no ERP knows. Sending it would
  -- fail at the ERP, so say what to do instead.
  if v_dp_item = public.native_down_payment_item() then
    raise exception 'this claim uses the down payment item PMO applies when no ERP is connected: withdraw this claim and assemble it again after the ERP''s down payment item is set'
      using errcode = '55000';
  end if;
  return new;
end; $$;
