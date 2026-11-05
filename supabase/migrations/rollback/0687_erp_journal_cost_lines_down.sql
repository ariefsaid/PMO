-- Rollback of 0687: restore the 0372 / 0651 ledger-held bodies, then drop the journal-line objects.
create or replace function public.procurement_ledger_held(p_procurement_id uuid)
 returns numeric
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
    from public.procurements p
   where p.id = p_procurement_id and (auth.uid() is null or p.org_id = public.auth_org_id())
     -- 0350 Engineer purchasing scope: invoice money is for the four money roles only (else no row → null).
     and (auth.uid() is null
          or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance'))
     and (auth.uid() is null or public.is_active_member())  -- 0372: an offboarded member's token reads nothing
$function$;

create or replace function public.procurement_ledger_held_many(p_ids uuid[])
 returns table(procurement_id uuid, held numeric)
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
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
$function$;

drop function public.detach_erp_journal_line(uuid);
drop function public.attach_erp_journal_lines(jsonb, boolean);
drop function public.project_erp_journal_lines(uuid);
drop trigger erp_journal_line_links_guard on public.erp_journal_line_links;
drop function public.guard_erp_journal_line_link();
drop table public.erp_journal_line_links;
drop function public.erp_journal_cost_lines(uuid, uuid, text);
drop index public.erp_gl_entry_mirror_org_project_voucher_type_idx;
