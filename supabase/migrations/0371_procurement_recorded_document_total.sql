-- 0371 a purchase recorded in PMO with no line items takes its total from its documents (spec procurement-flexible-entry;
-- ADR-0093). Rollback: supabase/migrations/rollback/0371_procurement_recorded_document_total_down.sql
--
-- A purchase can start at any step (0362). Started at a vendor invoice or a payment with no line items, it reached Paid
-- with total_value 0, so committed spend (procurement_open_commitment reads total_value) counted nothing. 0361 already
-- refreshes the total of a purchase created from ERP documents; this is the same write-time refresh for documents
-- recorded in PMO (by a user or by the ERP mirror).
--
-- The total is the pre-tax vendor-invoice total (the basis procurement_ledger_held subtracts, so a fully billed purchase
-- nets to zero on a ledger org), else the payment total, else the order amount — the 0361 precedence of a bill before a
-- payment. It applies only while the purchase has no line items (line items win), no approved amount (an approved
-- purchase keeps the amount its approval was decided on), and was not created from ERP documents (0361 owns those).
-- Documents with no amount leave the total as it is. Like 0362's derivation it runs for user writes (auth.uid() set)
-- and the ERP mirror (service_role JWT) only, never for direct SQL (seed, migrations, fixtures) — NFR-PFE-010.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

create function public.refresh_procurement_recorded_total(p_procurement_id uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_currency text; v_total numeric;
begin
  select p.currency into v_currency from public.procurements p
   where p.id = p_procurement_id and p.origin is distinct from 'erp_link' and p.approved_total_value is null
     and not exists (select 1 from public.procurement_items i where i.procurement_id = p.id);
  if not found then return; end if;
  v_total := coalesce(
    -- the billed net, as procurement_payment_within_ceiling counts it (not cancelled, not superseded by an amendment)
    (select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
       from public.procurement_invoices i
      where i.procurement_id = p_procurement_id and i.amount is not null and i.currency is not distinct from v_currency
        and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
        and not (i.vi_number is not null and exists (
          select 1 from public.procurement_invoices successor
           where successor.procurement_id = i.procurement_id and successor.erp_amended_from = i.vi_number
             and coalesce(successor.erp_docstatus, 1) <> 2 and successor.erp_cancelled_at is null))),
    (select sum(pay.amount) from public.payments pay
      where pay.procurement_id = p_procurement_id and pay.amount is not null and pay.currency is not distinct from v_currency
        and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null),
    (select sum(po.amount) from public.purchase_orders po
      where po.procurement_id = p_procurement_id and po.amount is not null and po.currency is not distinct from v_currency
        and coalesce(po.erp_docstatus, 1) <> 2 and po.erp_cancelled_at is null));
  if v_total is null then return; end if;
  update public.procurements set total_value = v_total, updated_at = now()
   where id = p_procurement_id and total_value is distinct from v_total;
end $$;
revoke all on function public.refresh_procurement_recorded_total(uuid) from public, anon, authenticated;

create function public.refresh_procurement_total_on_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') then perform public.refresh_procurement_recorded_total(old.procurement_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.procurement_id is distinct from old.procurement_id) then
    perform public.refresh_procurement_recorded_total(new.procurement_id);
  end if;
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
