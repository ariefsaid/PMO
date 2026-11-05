-- 0651 project_committed_spend is computed set-based: same signature, same rows, same RLS (security invoker).
-- Rollback: supabase/migrations/rollback/0651_committed_spend_set_based_down.sql
--
-- 0373 summed procurement_open_commitment(p) row by row; each row re-ran org_reads_erp_ledger() (a definer), a definer
-- ledger read, or the payments/invoices subqueries of procurement_paid_pre_tax. Now: the org's ledger basis is read once,
-- paid-pre-tax is aggregated once for the project's purchases (inline, so the caller's RLS still applies), and the
-- ledger-held amounts come from one definer call carrying procurement_ledger_held's guards (0372) verbatim.
-- No begin/commit: the rollback round trip wraps this file in its own transaction.

create function public.procurement_ledger_held_many(p_ids uuid[]) returns table (procurement_id uuid, held numeric)
language sql stable security definer set search_path = public, pg_catalog as $$
  select p.id,
         coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
    from public.procurements p
   where p.id = any (p_ids) and (auth.uid() is null or p.org_id = public.auth_org_id())
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
     and (auth.uid() is null or public.is_active_member())
$$;
revoke all on function public.procurement_ledger_held_many(uuid[]) from public, anon;
grant execute on function public.procurement_ledger_held_many(uuid[]) to authenticated, service_role;

create or replace function public.project_committed_spend(p_project_id uuid)
returns table (currency text, amount numeric, is_project_currency boolean)
language sql stable security invoker set search_path = public, pg_catalog as $$
  with proj as (
    select pr.id, pr.currency from public.projects pr where pr.id = p_project_id
  ), flag as (
    select public.org_reads_erp_ledger() as erp
  ), procs as (
    select p.id, p.org_id, p.currency, p.status, p.origin, p.total_value
      from public.procurements p join proj on p.project_id = proj.id
     where p.status::text = any (public.committed_procurement_statuses())
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
  ), positions as (
    select p.currency,
           sum(case
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
               end) as amount
      from procs p
      left join held h on h.procurement_id = p.id
      left join paid pa on pa.procurement_id = p.id
      left join invoiced iv on iv.procurement_id = p.id
     group by p.currency
  )
  select proj.currency, coalesce(pos.amount, 0)::numeric, true
    from proj left join positions pos on pos.currency = proj.currency
  union all
  select pos.currency, pos.amount, false
    from positions pos cross join proj
   where pos.currency is distinct from proj.currency and pos.amount <> 0
  order by 3 desc, 1
$$;
