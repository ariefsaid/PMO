-- Reverses 2665: the receipts read scope back to its 0350 text.

alter policy procurement_receipts_engineer_read_scope on public.procurement_receipts
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or exists (select 1 from public.procurements p
                     where p.id = procurement_receipts.procurement_id
                       and p.requested_by_id = (select auth.uid())));
