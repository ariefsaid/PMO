-- 0371 a purchase recorded in PMO with no line items takes its total from its documents (spec procurement-flexible-entry;
-- ADR-0093). Rollback: supabase/migrations/rollback/0371_procurement_recorded_document_total_down.sql
--
-- A purchase can start at any step (0362). Started at a vendor invoice or a payment with no line items, it reached Paid
-- with total_value 0, so committed spend (procurement_open_commitment reads total_value) counted nothing. 0361 already
-- refreshes the total of a purchase created from ERP documents; this is the same write-time refresh for documents
-- recorded in PMO (by a user or by the ERP mirror).
--
-- The rule. A document counts when it has an amount, is in the purchase's currency, and is not cancelled (an invoice
-- also not superseded by an amendment). Total = the larger of the order total and the pre-tax vendor-invoice total (the
-- basis procurement_ledger_held subtracts, so a fully billed purchase nets to zero on a ledger org; an order of 10,000
-- with a partial bill of 2,000 stays 10,000). Only with no counting order and no counting invoice does the payment total
-- apply (payments carry tax, so they never compete with a bill). A purchase whose documents all stopped counting
-- (cancelled, amended away, deleted) goes to 0 rather than keeping a stale amount; a purchase that never had a document
-- with an amount keeps its total.
--
-- Currency: only documents in the purchase's currency count; one in another currency is ignored (no conversion). A row
-- written with no currency is stamped with the ORG's default currency (stamp_currency), so on a purchase in another
-- currency such a row is ignored too.
--
-- Applies only while the purchase has no line items (line items win), never entered approval (the same test
-- procurement_payment_allowed uses: no approved amount, no approver, no request number, no Requested/Approved event —
-- an approved purchase keeps the amount its approval was decided on), is not awaiting approval, and was not created from
-- ERP documents (0361 owns those). Like 0362's derivation it runs for user writes (auth.uid() set) and the ERP mirror
-- (service_role JWT) only, never for direct SQL (seed, migrations, fixtures) — NFR-PFE-010. A user write that cannot
-- refresh fails; a mirror write is kept and the failure audited (procurement.total_refresh_skipped), as 0362 does.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

create function public.refresh_procurement_recorded_total(p_procurement_id uuid, p_had_document boolean default false)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype; v_order numeric; v_invoice numeric; v_payment numeric; v_total numeric;
begin
  select * into v_row from public.procurements where id = p_procurement_id for update;
  if not found or v_row.origin is not distinct from 'erp_link' or v_row.status = 'Requested'
     or v_row.approved_total_value is not null or v_row.approved_by_id is not null or v_row.pr_number is not null
     or exists (select 1 from public.procurement_items i where i.procurement_id = v_row.id)
     or exists (select 1 from public.procurement_status_events e
                 where e.procurement_id = v_row.id
                   and e.to_status in ('Requested'::procurement_status, 'Approved'::procurement_status)) then
    return;
  end if;
  select sum(po.amount) into v_order from public.purchase_orders po
   where po.procurement_id = v_row.id and po.org_id = v_row.org_id and po.amount is not null
     and po.currency is not distinct from v_row.currency
     and coalesce(po.erp_docstatus, 1) <> 2 and po.erp_cancelled_at is null;
  -- the billed net, as procurement_payment_within_ceiling counts it
  select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
    into v_invoice from public.procurement_invoices i
   where i.procurement_id = v_row.id and i.org_id = v_row.org_id and i.amount is not null
     and i.currency is not distinct from v_row.currency
     and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     and not (i.vi_number is not null and exists (
       select 1 from public.procurement_invoices successor
        where successor.procurement_id = i.procurement_id and successor.org_id = v_row.org_id
          and successor.erp_amended_from = i.vi_number
          and coalesce(successor.erp_docstatus, 1) <> 2 and successor.erp_cancelled_at is null));
  select sum(pay.amount) into v_payment from public.payments pay
   where pay.procurement_id = v_row.id and pay.org_id = v_row.org_id and pay.amount is not null
     and pay.currency is not distinct from v_row.currency
     and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null;
  v_total := coalesce(greatest(v_order, v_invoice), v_payment);
  if v_total is null then
    -- Nothing counts. Zero the total only if a document with an amount ever stood here (a cancelled or superseded one
    -- is still on file; a deleted or moved-away one is reported by the trigger).
    if not (p_had_document
            or exists (select 1 from public.purchase_orders x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)
            or exists (select 1 from public.procurement_invoices x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)
            or exists (select 1 from public.payments x where x.procurement_id = v_row.id and x.org_id = v_row.org_id
                         and x.amount is not null and x.currency is not distinct from v_row.currency)) then
      return;
    end if;
    v_total := 0;
  end if;
  update public.procurements set total_value = v_total, updated_at = now()
   where id = v_row.id and total_value is distinct from v_total;
end $$;
revoke all on function public.refresh_procurement_recorded_total(uuid, boolean) from public, anon, authenticated;

create function public.refresh_procurement_total_on_record() returns trigger
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

-- Named zy_ so they fire before 0362's zz_*_advance triggers: the total is in place before status derives.
create trigger zy_procurement_invoices_recorded_total
  after insert or delete or update of procurement_id, amount, tax_amount, tax_treatment, currency, vi_number,
    erp_docstatus, erp_cancelled_at, erp_amended_from on public.procurement_invoices
  for each row execute function public.refresh_procurement_total_on_record();
create trigger zy_payments_recorded_total
  after insert or delete or update of procurement_id, amount, currency, erp_docstatus, erp_cancelled_at on public.payments
  for each row execute function public.refresh_procurement_total_on_record();
create trigger zy_purchase_orders_recorded_total
  after insert or delete or update of procurement_id, amount, currency, erp_docstatus, erp_cancelled_at on public.purchase_orders
  for each row execute function public.refresh_procurement_total_on_record();
