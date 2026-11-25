-- 2665_receipts_read_for_ordering_right.sql — a person who holds the ordering right reads the receipts of the purchases they may
-- order for (same branch 1843 added to the purchases and their order-side records). Receipts were left out of 1843, so a Buyer saw
-- "not recorded" on a purchase someone else raised. The base select policy keeps the read inside the person's own organisation;
-- requesters keep the own-request branch. Proven by supabase/tests/receipts_read_ordering_right.test.sql.
-- Rollback: supabase/migrations/rollback/2665_receipts_read_for_ordering_right_down.sql

alter policy procurement_receipts_engineer_read_scope on public.procurement_receipts
  using ((select public.auth_role()) in ('Admin', 'Executive', 'Project Manager', 'Finance')
         or (select public.actor_may_order_purchases())                                 -- mut:read_receipts
         or exists (select 1 from public.procurements p
                     where p.id = procurement_receipts.procurement_id
                       and p.requested_by_id = (select auth.uid())));
