-- 0129_ap_invoices_payments_active_member.sql
-- Luna re-audit money round, BLOCK #10 — the AP half.
--
-- 0128 §1 conjoined `is_active_member()` into the AR tables (`sales_invoices`, `incoming_payments`).
-- The identical gap exists on the AP side: `procurement_invoices_select` (0006:75) and
-- `payments_select` (0035:136) predate 0062's active-member requirement, and 0100's flip rewrite of
-- the write policies carried the omission forward. A disabled/offboarded user (`admin_set_user_status`
-- sets status='disabled', 0065) holding a still-valid JWT can therefore keep reading — and writing —
-- supplier invoice amounts, payment amounts and their procurement linkage.
--
-- Same INLINE idiom as 0128/0097: predicates preserved VERBATIM, only `and is_active_member()` added.
-- All commands are covered, not just SELECT — the C1 gap 0063 documents is that a select-only pass
-- silently leaves the write policies open.
--
-- Reversibility (ADR-0006): `supabase db reset`. Manual reverse: re-create these eight policies
-- without the `and is_active_member()` conjunct (originals: 0006:75, 0035:136, 0100 §2).

-- ============================================================================
-- §1 — procurement_invoices (AP invoices)
-- ============================================================================

drop policy if exists procurement_invoices_select on public.procurement_invoices;
drop policy if exists procurement_invoices_insert on public.procurement_invoices;
drop policy if exists procurement_invoices_update on public.procurement_invoices;
drop policy if exists procurement_invoices_delete on public.procurement_invoices;

create policy procurement_invoices_select on procurement_invoices for select
  using (org_id = auth_org_id() and is_active_member());
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

-- ============================================================================
-- §2 — payments (AP payments)
-- ============================================================================

drop policy if exists payments_select on public.payments;
drop policy if exists payments_insert on public.payments;
drop policy if exists payments_update on public.payments;
drop policy if exists payments_delete on public.payments;

create policy payments_select on payments for select
  using (org_id = auth_org_id() and is_active_member());
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
