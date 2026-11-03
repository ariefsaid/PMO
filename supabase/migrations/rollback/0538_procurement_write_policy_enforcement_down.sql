-- 0538_procurement_write_policy_switch_down.sql — restore the 0203 and 0129 write predicates exactly.

-- ── purchase_orders (0203) ───────────────────────────────────────────────────────────────────────
drop policy if exists purchase_orders_insert on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;
drop policy if exists purchase_orders_delete on public.purchase_orders;

create policy purchase_orders_insert on public.purchase_orders for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

create policy purchase_orders_update on public.purchase_orders for update
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id()));

create policy purchase_orders_delete on public.purchase_orders for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

-- ── procurement_receipts (0203) ─────────────────────────────────────────────────────────────────
drop policy if exists procurement_receipts_insert on public.procurement_receipts;
drop policy if exists procurement_receipts_update on public.procurement_receipts;
drop policy if exists procurement_receipts_delete on public.procurement_receipts;

create policy procurement_receipts_insert on public.procurement_receipts for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

create policy procurement_receipts_update on public.procurement_receipts for update
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id()));

create policy procurement_receipts_delete on public.procurement_receipts for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

-- ── procurement_invoices (0129) ─────────────────────────────────────────────────────────────────
drop policy if exists procurement_invoices_insert on public.procurement_invoices;
drop policy if exists procurement_invoices_update on public.procurement_invoices;
drop policy if exists procurement_invoices_delete on public.procurement_invoices;

create policy procurement_invoices_insert on procurement_invoices for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

create policy procurement_invoices_update on procurement_invoices for update
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id()));

create policy procurement_invoices_delete on procurement_invoices for delete
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

-- ── payments (0129) ─────────────────────────────────────────────────────────────────────────────
drop policy if exists payments_insert on public.payments;
drop policy if exists payments_update on public.payments;
drop policy if exists payments_delete on public.payments;

create policy payments_insert on payments for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));

create policy payments_update on payments for update
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id()));

create policy payments_delete on payments for delete
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement'));
