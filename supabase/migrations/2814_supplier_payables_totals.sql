-- 2814: the home screen's supplier figures ("Owed to suppliers", the supplier-invoices wait row, the payables split)
-- come from one server read that returns a few rows per currency, instead of the browser reading every purchase with
-- its supplier invoices and payments plus every linked accounting document and summing them.
-- The rule is the browser's own (procurementMoney.ts supplierUnpaid + withLinkedDocuments, useCompanyFigures.ts
-- splitPayables, useNeedsYou.ts selectSupplierInvoices): a purchase waiting for payment is one in 'Vendor Invoiced';
-- its unpaid balance is its supplier invoices (voided left out, plus linked accounting invoices) less its Paid payments
-- (plus linked accounting payments), never below zero; when every invoice is an accounting one, the balance is their
-- outstanding sum; with no invoice amount at all, or any amount missing, the balance is unknown. Age is days since the
-- earliest non-voided supplier invoice date; over 90 days is overdue.
-- Security invoker, reading the same sources the browser reads: the price-masked views return each amount exactly as
-- the table does for a caller who may see prices, and nothing for one who may not, so every role sees what it saw.
-- New function only; no table, policy or grant on data changes.
-- Rollback: supabase/migrations/rollback/2814_supplier_payables_totals_down.sql

create or replace function public.get_supplier_payables_totals(p_today date)
  returns table (
    currency text,
    invoice_count int,          -- purchases waiting for payment
    unknown_count int,          -- of which the unpaid balance is unknown
    known_count int,
    known_total numeric,
    not_due_count int,          -- known balances 90 days old or younger, or with no invoice date
    not_due_total numeric,
    overdue_known_count int,    -- known balances older than 90 days
    overdue_total numeric,
    overdue_count int,          -- every purchase older than 90 days, known or not
    oldest_days int
  )
  language sql stable security invoker set search_path = public
as $$
  with ready as (
    select p.id, p.currency from public.procurements p where p.status = 'Vendor Invoiced'
  ), inv as (
    select i.procurement_id, count(*) as n, bool_or(i.amount is null) as any_null, sum(i.amount) as total,
           min(i.invoice_date) as first_date
      from public.procurement_invoices_masked i join ready r on r.id = i.procurement_id
     where i.voided_at is null
     group by i.procurement_id
  ), pay as (
    select y.procurement_id, bool_or(y.amount is null) as any_null, sum(y.amount) as total
      from public.payments_masked y join ready r on r.id = y.procurement_id
     where y.status = 'Paid'
     group by y.procurement_id
  ), erp as (
    select d.procurement_id,
           count(*) filter (where d.erp_doctype = 'Purchase Invoice') as inv_n,
           bool_or(d.grand_total is null) filter (where d.erp_doctype = 'Purchase Invoice') as inv_null,
           sum(d.grand_total) filter (where d.erp_doctype = 'Purchase Invoice') as inv_total,
           bool_or(d.outstanding_amount is null) filter (where d.erp_doctype = 'Purchase Invoice') as out_null,
           sum(d.outstanding_amount) filter (where d.erp_doctype = 'Purchase Invoice') as out_total,
           bool_or(d.grand_total is null) filter (where d.erp_doctype = 'Payment Entry') as pay_null,
           sum(d.grand_total) filter (where d.erp_doctype = 'Payment Entry') as pay_total
      from public.erp_purchase_documents_linked d join ready r on r.id = d.procurement_id
     where d.erp_docstatus = 1 and not d.pmo_owned
     group by d.procurement_id
  ), per as (
    select r.id, r.currency,
           case
             when coalesce(inv.n, 0) = 0 and coalesce(erp.inv_n, 0) > 0
               then case when erp.out_null then null else greatest(erp.out_total, 0) end
             when coalesce(inv.n, 0) + coalesce(erp.inv_n, 0) = 0 then null
             when coalesce(inv.any_null, false) or coalesce(erp.inv_null, false)
               or coalesce(pay.any_null, false) or coalesce(erp.pay_null, false) then null
             else greatest(coalesce(inv.total, 0) + coalesce(erp.inv_total, 0) - coalesce(pay.total, 0) - coalesce(erp.pay_total, 0), 0)
           end as unpaid,
           greatest(0, p_today - inv.first_date) as age
      from ready r
      left join inv on inv.procurement_id = r.id
      left join pay on pay.procurement_id = r.id
      left join erp on erp.procurement_id = r.id
  )
  select per.currency,
         count(*)::int,
         count(*) filter (where per.unpaid is null)::int,
         count(per.unpaid)::int,
         coalesce(sum(per.unpaid), 0),
         count(per.unpaid) filter (where per.age is null or per.age <= 90)::int,
         coalesce(sum(per.unpaid) filter (where per.age is null or per.age <= 90), 0),
         count(per.unpaid) filter (where per.age > 90)::int,
         coalesce(sum(per.unpaid) filter (where per.age > 90), 0),
         count(*) filter (where per.age > 90)::int,
         max(per.age)::int
    from per
   group by per.currency
   -- The browser lists currencies in the order it first meets them, reading purchases by id.
   order by min(per.id::text collate "C")
$$;
revoke all on function public.get_supplier_payables_totals(date) from public;
revoke execute on function public.get_supplier_payables_totals(date) from anon;
grant execute on function public.get_supplier_payables_totals(date) to authenticated, service_role;
