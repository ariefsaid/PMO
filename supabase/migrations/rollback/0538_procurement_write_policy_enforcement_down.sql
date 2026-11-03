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

-- Restore the policy annotations that were attached to the pre-0538 definitions.
comment on policy procurement_invoices_insert on public.procurement_invoices is
  'SUPERSEDED and UNREACHABLE since 0174: `authenticated`/`anon` hold SELECT only on this table, so no '
  'client INSERT can reach this policy. The sole client write path is the SECURITY DEFINER RPC '
  'create_procurement_invoice, which re-asserts org, role, the ERPNext-ownership fence, the '
  'origination-status gate AND — since 0180 — active membership (assert_is_active_member). ⚑ The '
  'is_active_member() conjunct below is DEAD CODE THAT READS LIKE A LIVE CONTROL: do not cite it as '
  'evidence that offboarding is enforced here; 0180 §2 is. Kept as the second layer if a future '
  'migration re-grants INSERT — dropping it would make such a re-grant fully open.';

comment on policy procurement_receipts_insert on public.procurement_receipts is
  'SUPERSEDED and UNREACHABLE since 0174: `authenticated`/`anon` hold SELECT only on this table. The '
  'sole client write path is the SECURITY DEFINER RPC create_procurement_receipt, which re-asserts '
  'org, the Admin/PM/requester gate, the ERPNext-ownership fence and — since 0180 — active membership '
  '(assert_is_active_member). ⚑ HISTORY, since it explains the asymmetry with its twin: this policy '
  'carried NO is_active_member() from 0063 until 0203, so the goods-receipt create path had no '
  'active-member control on any layer until 0180 closed the RPC. 0203 added the conjunct here as the '
  'second layer, per this comment''s own instruction, in case a future migration re-grants INSERT.';

comment on policy procurement_invoices_delete on public.procurement_invoices is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete.';

comment on policy procurement_receipts_delete on public.procurement_receipts is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete. 0203 re-created '
  'it to add the is_active_member() conjunct; still dead, still deliberate, now consistent with the '
  'composition rule proven by 0203''s test.';
