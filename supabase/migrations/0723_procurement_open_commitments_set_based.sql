-- 0723 procurement_open_commitments(p_ids): the open commitment of many purchases in one set-based read.
-- Rollback: supabase/migrations/rollback/0723_procurement_open_commitments_set_based_down.sql
--
-- The Procurement list embedded procurement_open_commitment(p) per row: each row re-ran org_reads_erp_ledger() (a
-- definer), a definer ledger read, or the payments/invoices subqueries of procurement_paid_pre_tax (measured ~4.6 ms
-- per row: ~4.6 s for a 1,000-row list). This is 0651's set-based body without the project grouping: the
-- org's ledger basis is read once, paid-pre-tax is aggregated once for the requested purchases (inline, so the
-- caller's RLS still applies), ledger-held amounts come from the one definer call that carries 0372's guards.
-- Same CASE as procurement_open_commitment, row for row (proved in 0651_committed_spend_equivalence). SECURITY
-- INVOKER: procurements RLS decides which of p_ids exist; an id the caller cannot read returns no row.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

create function public.procurement_open_commitments(p_ids uuid[])
returns table (procurement_id uuid, amount numeric)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with flag as (
    select public.org_reads_erp_ledger() as erp
  ), procs as (
    select p.id, p.org_id, p.currency, p.status, p.origin, p.total_value
      from public.procurements p where p.id = any (p_ids)
  ), held as (
    select h.procurement_id, h.held
      from public.procurement_ledger_held_many((select array_agg(id) from procs where (select erp from flag))) h
  ), paid as (
    select pay.procurement_id,
           count(*) filter (where pay.amount is null or pay.amount::text in ('NaN','Infinity','-Infinity')
                               or pay.currency is distinct from p.currency) as bad,
           coalesce(sum(pay.amount), 0) as amount
      from procs p join public.payments pay on pay.procurement_id = p.id and pay.org_id = p.org_id
     where not (select erp from flag) and p.origin is distinct from 'erp_link'
       and pay.status = 'Paid' and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null
     group by pay.procurement_id
  ), invoiced as (
    select i.procurement_id,
           count(*) filter (where i.currency is distinct from p.currency
                               or i.amount::text in ('NaN','Infinity','-Infinity')) as bad,
           sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end) as pre_tax,
           sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
               - coalesce(i.withheld_amount, 0)) as payable
      from procs p join public.procurement_invoices i on i.procurement_id = p.id and i.org_id = p.org_id
     where not (select erp from flag) and p.origin is distinct from 'erp_link'
       and i.amount is not null and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null
     group by i.procurement_id
  )
  select p.id,
         case
           when p.status::text in ('Cancelled','Rejected') then 0::numeric
           when (select erp from flag) then greatest(0::numeric, coalesce(p.total_value, 0) - coalesce(h.held, 0))
           when p.origin = 'erp_link' then coalesce(p.total_value, 0)::numeric
           else (select case when x.paid is null then coalesce(p.total_value, 0)::numeric
                             else greatest(0::numeric, coalesce(p.total_value, 0) - x.paid) end
                   from (select case when pa.bad > 0 then null::numeric
                                     when coalesce(pa.amount, 0) = 0 then 0::numeric
                                     when iv.bad > 0 then null::numeric
                                     when iv.payable > 0 then round(pa.amount * iv.pre_tax / iv.payable, 2)
                                     else pa.amount end as paid) x)
         end
    from procs p
    left join held h on h.procurement_id = p.id
    left join paid pa on pa.procurement_id = p.id
    left join invoiced iv on iv.procurement_id = p.id
$$;
revoke all on function public.procurement_open_commitments(uuid[]) from public, anon;
grant execute on function public.procurement_open_commitments(uuid[]) to authenticated, service_role;
