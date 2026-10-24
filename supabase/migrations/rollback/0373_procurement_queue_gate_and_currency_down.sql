-- Reverses 0373: restores each function's previous body — claim_outbox_for_commit (0368 §4),
-- refresh_procurement_total_on_record (0371), create_purchase_order (0238), create_procurement_invoice (0273),
-- create_payment (0349), project_committed_spend (0361, one numeric sum) — and drops procurement_create_refusal.
-- Records already written keep the currency they were stamped with.

create or replace function public.claim_outbox_for_commit(
  p_id uuid, p_lease interval default interval '60 seconds'
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
  declare
    v public.external_command_outbox;
    v_domain text;
    v_record_id text;
    v_key text;
    v_status timesheet_status;
    v_approved_at timestamptz;
    v_witness timestamptz;
    v_row public.external_command_outbox;
    v_proc public.procurements;                                                                          -- 0368
    v_refusal text;                                                                                      -- 0368
  begin
    select domain, pmo_record_id, idempotency_key
      into v_domain, v_record_id, v_key
      from public.external_command_outbox where id = p_id;
    if v_domain = 'timesheets' then
      -- The canonical uuid text — the SAME identity §B stores and the Approved→Draft arm locks on
      -- (BLOCK 3). `domain` and `pmo_record_id` are immutable for the life of a row, so reading them
      -- before the lock is safe; everything that can CHANGE is read after it.
      v_record_id := (v_record_id::uuid)::text;
      perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || v_record_id, 0));
      select status, approved_at into v_status, v_approved_at
        from public.timesheets where id = v_record_id::uuid;
      if v_status is distinct from 'Approved' then
        raise exception 'timesheet-no-longer-approved' using errcode = 'P0001';
      end if;
      -- ⚑ THE GENERATION FENCE ON THE RE-DRIVE (Luna round-2 BLOCK 1). `Approved` is re-reachable: one
      -- correction cycle later the sheet is Approved AGAIN, as a DIFFERENT generation. A stale `failed`
      -- T1 row re-driven then (the foreground Retry, the sweep's mirror queue) would POST the
      -- SUPERSEDED hours and the corrected week would post as a SECOND ERP Timesheet. So this row's own
      -- persisted witness — its deterministic key (§A2), the SAME string §B refused to insert without —
      -- must equal the sheet's CURRENT `approved_at`. NULL ⇒ the row cannot prove its generation ⇒
      -- REFUSE (fail closed): an old or hand-written row is never given the benefit of the doubt over
      -- money. The refusal is a raise, never a NULL return — a NULL means "not claimable now" and would
      -- send the caller back into reconcileOutbox to try this same row forever.
      v_witness := public.timesheet_push_key_witness(v_key);
      if v_witness is null or v_witness is distinct from v_approved_at then
        raise exception 'timesheet-approval-superseded' using errcode = 'P0001';
      end if;
    end if;
    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4/5): a revenue command revived from `failed` is re-checked against its work order
    --   (and, for a claim's invoice, against the claim being withdrawn since) — the fence's own check, on the stored
    --   payload. The helper takes the work order's billing lock before it reads anything.
    if v_domain = 'revenue' then
      -- Rule: the row is locked before its state is read, so no other worker can move it to `failed` between this read
      -- and the claiming UPDATE. Lock order: outbox row, then the billing lock (no billing-lock holder waits on a row).
      select * into v_row from public.external_command_outbox where id = p_id for update;
      if v_row.state = 'failed' then
        perform public.assert_invoice_command_within_work_order(v_row.org_id, v_row.operation, v_row.pmo_record_id, v_row.payload);
      end if;
    end if;
    -- ⚑ 0368 (#1319): a queued purchase payment is re-checked against its purchase (see the §4 header).
    if v_domain = 'procurement' then                                                                     -- 0368
      select * into v_row from public.external_command_outbox where id = p_id for update;
      if v_row.state in ('pending','failed') and v_row.operation = 'create'
         and v_row.payload ->> 'erp_doc_kind' = 'payment' then
        if coalesce(v_row.payload ->> 'procurementId', '') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
          select * into v_proc from public.procurements
           where id = (v_row.payload ->> 'procurementId')::uuid and org_id = v_row.org_id for update;
        end if;
        if v_proc.id is null then
          v_refusal := 'purchase_not_found';
        else
          v_refusal := public.procurement_payment_allowed(v_proc.id);
        end if;
        if v_refusal is null and v_row.actor_user_id is null then
          v_refusal := 'actor_missing';
        elsif v_refusal is null
              and (v_row.actor_user_id = v_proc.approved_by_id or v_row.actor_user_id = v_proc.amount_approved_by_id) then
          v_refusal := 'separation_of_duties';
        elsif v_refusal is null and (v_proc.approved_by_id is not null or v_proc.approved_total_value is not null)
              and not coalesce((select c.ok from public.procurement_payment_within_ceiling(v_proc.id) c), false) then
          v_refusal := 'exceeds_approved_amount';
        end if;
        if v_refusal is not null then
          raise exception 'procurement-payment-refused: %', v_refusal using errcode = 'P0001', detail = v_refusal;
        end if;
      end if;
    end if;                                                                                              -- 0368
    update public.external_command_outbox
       set state='committing',
           attempt_count = attempt_count + 1,
           claim_generation = claim_generation + 1,   -- fencing token (F4): monotonic per claim
           claimed_at = now(),
           updated_at = now()
     where id = p_id
       and ( state in ('pending','failed')
             or (state='quarantined' and reconcile_after is not null and reconcile_after < now()) )
    returning * into v;
    return v;   -- v.claim_generation is the caller's fencing token; null ⇒ not claimable now
  end; $$;
revoke all on function public.claim_outbox_for_commit(uuid, interval) from public, anon, authenticated;
grant execute on function public.claim_outbox_for_commit(uuid, interval) to service_role;

drop function if exists public.procurement_create_refusal(uuid, uuid, text, uuid);

create or replace function public.refresh_procurement_total_on_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_old_had boolean;
begin
  if auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then return null; end if;
  begin
    if tg_op in ('UPDATE', 'DELETE') then
      v_old_had := old.amount is not null;
      perform public.refresh_procurement_recorded_total(old.procurement_id, v_old_had);
    end if;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.procurement_id is distinct from old.procurement_id) then
      perform public.refresh_procurement_recorded_total(new.procurement_id, false);
    end if;
  exception when others then
    if auth.uid() is not null then raise; end if;
    -- The ERP mirror's write is kept; the purchase total is left as it was and the failure audited.
    perform public.log_audit('procurement.total_refresh_skipped',
      case when tg_op = 'DELETE' then old.org_id else new.org_id end, null,
      case when tg_op = 'DELETE' then old.procurement_id else new.procurement_id end,
      jsonb_build_object('record', tg_table_name, 'reason', sqlerrm));
  end;
  return null;
end $$;
revoke all on function public.refresh_procurement_total_on_record() from public, anon, authenticated;

create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders;
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's PO writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref)
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''))
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null,
  p_withheld_amount numeric default 0,
  p_withheld_pph_type text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  if coalesce(p_withheld_amount, 0) <> 0
     and (p_withheld_pph_type is null or btrim(p_withheld_pph_type) not in ('pph23', 'pph4_2')) then
    raise exception 'a vendor invoice that withholds tax must state the withholding type: pph23 or pph4_2'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator, external_ref,
     withheld_amount, withheld_pph_type)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator, nullif(btrim(p_external_ref), ''),
            coalesce(p_withheld_amount, 0),
            case when coalesce(p_withheld_amount, 0) <> 0 then btrim(p_withheld_pph_type) end)
    returning * into v_row;
  return v_row;
end; $$;

create or replace function public.create_payment(
  p_procurement_id uuid, p_invoice_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null)
  returns payments language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.payments;
        v_bill_gross numeric;                                                                -- 0349
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Same-case invariant (0039, AC-PR-SEC-001 / FR-ENA-130d): invoice must belong to the same case.
  if p_invoice_id is not null and not exists (
    select 1 from public.procurement_invoices i
    where i.id = p_invoice_id and i.procurement_id = p_procurement_id
  ) then raise exception 'invoice not in this case' using errcode = '42501'; end if;
  -- Slice 6 addition (AC-ENA-072): a flipped org's payment writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — payments route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  -- ⚑ 0178: the origination-status gate. NULL is ACCEPTED on purpose (it is the permissive-capture
  -- default, sent by procurementRecords.ts and by four assertions in 0079) and the explicit
  -- `is not null` keeps the condition TOTAL — `p_status <> 'Scheduled'` alone is NULL for a NULL
  -- p_status and would fall through, which is 0176 §6's defect exactly.
  if p_status is not null and p_status <> 'Scheduled' then
    raise exception
      'payments.status "%" is not an origination status: a payment record is captured as Scheduled, and Paid is reached only by paying the case — the transition that is Finance-only and enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_amount is not null then                                                               -- 0349
    perform 1 from public.procurements where id = p_procurement_id for update;               -- 0349
    select sum(i.amount + case when i.tax_treatment = 'exclusive' then i.tax_amount else 0 end) -- 0349
      into v_bill_gross from public.procurement_invoices i                                   -- 0349
     where i.procurement_id = p_procurement_id and i.amount is not null                      -- 0349
       and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null;                 -- 0349
    if v_bill_gross is not null and p_amount + coalesce((                                    -- 0349
         select sum(pay.amount) from public.payments pay                                     -- 0349
          where pay.procurement_id = p_procurement_id                                        -- 0349
            and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null), 0)    -- 0349
         > v_bill_gross then                                                                 -- 0349
      raise exception 'scheduled payments cannot exceed the billed gross amount'             -- 0349
        using errcode = '23514';                                                             -- 0349
    end if;                                                                                  -- 0349
  end if;                                                                                    -- 0349
  insert into public.payments
    (procurement_id, invoice_id, pay_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at)
    values (p_procurement_id, p_invoice_id, next_procurement_doc_number(v_org, 'PAY'),
            p_reference_number, coalesce(p_status, 'Scheduled'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at)
    returning * into v_row;
  return v_row;
end; $$;

drop function if exists public.project_committed_spend(uuid);
create function public.project_committed_spend(p_project_id uuid) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  select coalesce(sum(public.procurement_open_commitment(p)), 0)
    from public.procurements p
   where p.project_id = p_project_id and p.status::text = any (public.committed_procurement_statuses())
$$;
revoke all on function public.project_committed_spend(uuid) from public, anon;
grant execute on function public.project_committed_spend(uuid) to authenticated;
