-- 0538_procurement_write_policy_enforcement.sql — retain procurement entitlement checks when composing
-- the current INSERT/UPDATE/DELETE policies for purchase_orders, procurement_receipts,
-- procurement_invoices, and payments.
--
-- Every existing org, active-member, role, parent-org and external-ownership predicate is preserved.
-- The switch uses the same non-raising RLS-safe wrapper as 0534 §B. SELECT policies are unchanged.

-- ── purchase_orders ─────────────────────────────────────────────────────────────────────────────
drop policy if exists purchase_orders_insert on public.purchase_orders;
drop policy if exists purchase_orders_update on public.purchase_orders;
drop policy if exists purchase_orders_delete on public.purchase_orders;

create policy purchase_orders_insert on public.purchase_orders for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy purchase_orders_update on public.purchase_orders for update
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy purchase_orders_delete on public.purchase_orders for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = purchase_orders.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

-- ── procurement_receipts ────────────────────────────────────────────────────────────────────────
drop policy if exists procurement_receipts_insert on public.procurement_receipts;
drop policy if exists procurement_receipts_update on public.procurement_receipts;
drop policy if exists procurement_receipts_delete on public.procurement_receipts;

create policy procurement_receipts_insert on public.procurement_receipts for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy procurement_receipts_update on public.procurement_receipts for update
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'))
  with check (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy procurement_receipts_delete on public.procurement_receipts for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
                 where p.id = procurement_receipts.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

-- ── procurement_invoices ────────────────────────────────────────────────────────────────────────
drop policy if exists procurement_invoices_insert on public.procurement_invoices;
drop policy if exists procurement_invoices_update on public.procurement_invoices;
drop policy if exists procurement_invoices_delete on public.procurement_invoices;

create policy procurement_invoices_insert on public.procurement_invoices for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy procurement_invoices_update on public.procurement_invoices for update
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'))
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy procurement_invoices_delete on public.procurement_invoices for delete
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = procurement_invoices.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

-- ── payments ────────────────────────────────────────────────────────────────────────────────────
drop policy if exists payments_insert on public.payments;
drop policy if exists payments_update on public.payments;
drop policy if exists payments_delete on public.payments;

create policy payments_insert on public.payments for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy payments_update on public.payments for update
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'))
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));

create policy payments_delete on public.payments for delete
  using (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p where p.id = payments.procurement_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'procurement')
    and public.org_feature_enabled(public.auth_org_id(), 'procurement'));
