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

-- DROP POLICY removes attached object comments as well as the policy itself; preserve the
-- annotations that explain the intentionally unreachable RPC-backed policies.
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

-- Recreate the latest procurement writer bodies with the entitlement assertion before their effects.
create or replace function public.create_purchase_order(
  p_procurement_id uuid, p_reference_number text, p_status text, p_date date, p_amount numeric,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_external_ref text default null)
  returns purchase_orders language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.purchase_orders; v_currency text;                                      -- 0373
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  select org_id, currency into v_org, v_currency from public.procurements where id = p_procurement_id;  -- 0373
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  -- Slice 5 addition (AC-ENA-052): a flipped org's PO writes must route through the ERPNext adapter.
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — purchase orders route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  insert into public.purchase_orders
    (procurement_id, po_number, reference_number, status, date, amount,
     import_key, import_batch_id, imported_at, external_ref, currency)                                   -- 0373
    values (p_procurement_id, next_procurement_doc_number(v_org, 'PO'),
            p_reference_number, coalesce(p_status, 'Draft'), p_date, p_amount,
            p_import_key, p_import_batch_id, p_imported_at, nullif(btrim(p_external_ref), ''), v_currency) -- 0373
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz, text) from public;
grant  execute on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz, text) to   authenticated;
revoke execute on function public.create_purchase_order(uuid, text, text, date, numeric, text, uuid, timestamptz, text) from anon;

create or replace function public.set_procurement_invoice_efaktur(
  p_invoice_id uuid,
  p_efaktur_number text,
  p_efaktur_date date
)
returns public.procurement_invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.procurement_invoices;
  v_number text := nullif(btrim(p_efaktur_number), '');
begin
  select * into v_row from public.procurement_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'vendor bill not found' using errcode = 'P0002';
  end if;
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin', 'Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  if v_row.erp_docstatus = 2 or v_row.erp_cancelled_at is not null then
    raise exception 'cannot record e-Faktur facts on a cancelled vendor bill'
      using errcode = '23514', detail = 'efaktur-cancelled';
  end if;
  if (v_number is null) <> (p_efaktur_date is null) then
    raise exception 'an e-Faktur number and its date must be recorded together'
      using errcode = '23514', detail = 'efaktur-incomplete';
  end if;
  if v_number is not null and (char_length(v_number) > 32 or v_number !~ '^[0-9.-]+$') then
    raise exception 'invalid e-Faktur number' using errcode = '23514';
  end if;
  -- "Future" on the ORG's calendar (the 0247 pattern), not the session's: current_date would refuse
  -- an Asia/Jakarta morning's own date until 07:00 local.
  if p_efaktur_date is not null and p_efaktur_date > (now() at time zone coalesce(
       (select o.default_timezone from public.organizations o where o.id = v_row.org_id), 'UTC'))::date then
    raise exception 'e-Faktur date cannot be in the future'
      using errcode = '23514', detail = 'efaktur-future-date';
  end if;
  update public.procurement_invoices
     set efaktur_number = v_number, efaktur_date = p_efaktur_date
   where id = p_invoice_id
   returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_procurement_invoice_efaktur(uuid, text, date) from public, anon;
grant execute on function public.set_procurement_invoice_efaktur(uuid, text, date) to authenticated;

create or replace function public.issue_subcontract_po_lines(p_po_id uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_proc public.procurements; v_po public.purchase_orders;
        v_total numeric; v_ceiling numeric;
begin
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id for update;          -- D5 row first
  perform public.subcontract_po_lock(p_po_id);                                                     -- D5 then the PO
  if not v_proc.is_subcontract then raise exception 'only a subcontract purchase has BoQ lines' using errcode = '42501'; end if;
  if v_proc.status::text in ('Cancelled','Rejected') then                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only a Project Manager, Finance or an Admin may issue PO lines' using errcode = '42501'; end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  if exists (select 1 from public.purchase_order_revisions r where r.po_id = p_po_id) then
    raise exception 'PO lines are already issued' using errcode = '42501'; end if;
  select sum(l.amount) into v_total from public.purchase_order_lines l where l.po_id = p_po_id and l.revision = 1;
  if v_total is null then raise exception 'at least one BoQ line is required' using errcode = '23502'; end if;
  if exists (select 1 from public.procurement_invoices i where i.procurement_id = v_proc.id                -- PQ-4
              and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null) then
    raise exception 'a vendor bill already exists on this purchase; BoQ lines cannot be issued after billing' using errcode = '23514'; end if;
  v_ceiling := coalesce(v_proc.approved_total_value, nullif(v_proc.total_value, 0));                       -- PQ-2
  if v_ceiling is null then
    raise exception 'record the purchase''s value or approval before issuing its BoQ lines' using errcode = '23514';
  end if;
  if v_total > v_ceiling then
    raise exception 'the BoQ lines total % exceeds the purchase''s approved value %', v_total, v_ceiling using errcode = '23514';
  end if;
  if public.domain_externally_owned(v_proc.org_id, 'procurement')                                 -- PQ-11
     and v_po.amount is not null and v_po.amount is distinct from v_total then
    raise exception 'the BoQ lines total % must equal the ERP purchase order amount %', v_total, v_po.amount using errcode = '23514';
  end if;
  insert into public.purchase_order_revisions (org_id, po_id, procurement_id, revision, total, issued_by, issue_basis)
  values (v_org, p_po_id, v_proc.id, 1, v_total, auth.uid(), 'standard');
  if not public.domain_externally_owned(v_proc.org_id, 'procurement') then                        -- PQ-11: a connected PO's amount is the ERP's
    update public.purchase_orders set amount = v_total, status = case when status = 'Draft' then 'Issued' else status end
     where id = p_po_id;                                        -- the revision row above makes the amount guard agree
  end if;
  perform public.log_audit('purchase_order_revision.issue', v_org, auth.uid(), p_po_id, jsonb_build_object('revision', 1, 'total', v_total));
  return 1;
end $$;
revoke all on function public.issue_subcontract_po_lines(uuid) from public, anon;
grant execute on function public.issue_subcontract_po_lines(uuid) to authenticated;

create or replace function public.issue_po_revision(p_variation_id uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare v public.po_variations; v_proc public.procurements; v_org uuid := public.auth_org_id(); v_new integer;
        v_basis text := 'standard'; v_sole boolean := false; v_prev numeric; v_total numeric; v_nlines integer; v_delta numeric;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only a Project Manager, Finance or an Admin may issue a PO revision' using errcode = '42501'; end if;
  select * into v from public.po_variations where id = p_variation_id and org_id = v_org;
  if not found then raise exception 'variation not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v.procurement_id for update;                  -- D5 row first
  if v_proc.project_id is not null and v_proc.budget_category is not null then                           -- D5 spend line: the rounding delta moves total_value
    perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_proc.project_id::text || ':' || v_proc.budget_category::text, 0));
  end if;
  perform public.subcontract_po_lock(v.po_id);                                                           -- D5 then the PO
  if v_proc.status::text in ('Cancelled','Rejected') then                                                -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if public.domain_externally_owned(v.org_id, 'procurement') then                                        -- PQ-11
    raise exception 'the ERP purchase order cannot be revised from here yet' using errcode = '42501', detail = 'erp_revise_pending'; end if;
  select * into v from public.po_variations where id = p_variation_id for update;
  if v.status <> 'Approved' then raise exception 'only an Approved variation can be revised into the PO' using errcode = '42501'; end if;
  if auth.uid() = v.approved_by then
    select count(*) = 1 and bool_or(p.id = auth.uid()) into v_sole from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole, false) then
      raise exception 'separation of duties: the variation''s approver cannot issue its PO revision' using errcode = '42501'; end if;
    v_basis := 'sole_operator';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  v_new := public.po_effective_revision(v.po_id) + 1;
  select count(*) into v_nlines from public.po_variation_lines where variation_id = p_variation_id;
  insert into public.purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit)
  select l.po_id, v_new, l.boq_item_id, l.quantity + coalesce(vl.additional_quantity, 0), l.rate, l.unit
    from public.purchase_order_lines l
    left join public.po_variation_lines vl on vl.variation_id = p_variation_id and vl.boq_item_id = l.boq_item_id
   where l.po_id = v.po_id and l.revision = v_new - 1;
  select (select sum(amount) from public.purchase_order_lines where po_id = v.po_id and revision = v_new),
         (select sum(amount) from public.purchase_order_lines where po_id = v.po_id and revision = v_new - 1) into v_total, v_prev;
  -- Never above the approved amount (FR-SCA-032). Each line rounds on its own, so allow one cent per variation line.
  if (select count(*) from public.po_variation_lines vl join public.purchase_order_lines l
        on l.po_id = v.po_id and l.revision = v_new - 1 and l.boq_item_id = vl.boq_item_id where vl.variation_id = p_variation_id) <> v_nlines
     or v_total - v_prev > v.amount + 0.01 * v_nlines then
    raise exception 'the revision would raise the PO beyond the approved variation' using errcode = '23514'; end if;
  insert into public.purchase_order_revisions (org_id, po_id, procurement_id, revision, total, variation_id, issued_by, issue_basis)
  values (v_org, v.po_id, v.procurement_id, v_new, v_total, p_variation_id, auth.uid(), v_basis);
  update public.purchase_orders set amount = v_total where id = v.po_id;      -- the revision row above makes the amount guard agree
  -- Each line rounds on its own, so the revised PO can differ from the approved amount by a few cents: move the purchase's
  -- totals by that realized delta so a bill for the full revised quantity fits the payment ceiling exactly.
  v_delta := v_total - v_prev - v.amount;
  if v_delta <> 0 then
    update public.procurements set total_value = coalesce(total_value, 0) + v_delta,
           approved_total_value = case when approved_total_value is null then null else approved_total_value + v_delta end,
           updated_at = now() where id = v.procurement_id;
  end if;
  perform set_config('pmo.po_variation_write', 'on', true);
  update public.po_variations set status = 'Revised', revision = v_new where id = p_variation_id;
  perform set_config('pmo.po_variation_write', '', true);
  perform public.log_audit('purchase_order_revision.issue', v_org, auth.uid(), v.po_id,
    jsonb_build_object('revision', v_new, 'total', v_total, 'variation_id', p_variation_id, 'basis', v_basis,
      'rounding_delta', v_delta));
  return v_new;
end $$;
revoke all on function public.issue_po_revision(uuid) from public, anon;
grant execute on function public.issue_po_revision(uuid) to authenticated;

create or replace function public.attribute_subcontract_bill_lines(p_invoice_id uuid, p_lines jsonb)
  returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_inv public.procurement_invoices; v_proc public.procurements; v_po uuid;
        v_rev integer; v_v jsonb; v_net numeric; v_lines_net numeric;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_inv from public.procurement_invoices where id = p_invoice_id and org_id = v_org;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_inv.procurement_id and org_id = v_org for update;   -- D5 row first
  select * into v_inv from public.procurement_invoices where id = p_invoice_id;                                   -- re-read under the lock
  perform public.assert_feature_on(public.auth_org_id(), 'procurement');
  if v_proc.status::text in ('Cancelled','Rejected') then                                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  select r.po_id into v_po from public.purchase_order_revisions r where r.procurement_id = v_proc.id and r.revision = 1;
  if not v_proc.is_subcontract or v_po is null then
    raise exception 'this purchase has no issued BoQ lines; there is nothing to attribute the bill to' using errcode = 'SC002';
  end if;
  perform public.subcontract_po_lock(v_po);                                                                        -- D5 then the PO
  if not public.subcontract_bill_is_live(v_inv.erp_docstatus, v_inv.erp_cancelled_at) then
    raise exception 'this bill is cancelled' using errcode = '23514'; end if;
  if exists (select 1 from public.procurement_invoice_lines where invoice_id = p_invoice_id)
     or (v_inv.po_id is not null and v_inv.po_id <> v_po) then
    raise exception 'this bill already states its BoQ lines' using errcode = '23514'; end if;
  v_rev := public.po_effective_revision(v_po);
  v_v := public.subcontract_bill_cap_violation(v_po, p_lines, p_invoice_id);                                       -- D3, NFR-SCA-004: fail closed
  if v_v is not null then
    if v_v->>'reason' = 'over_cap' then
      raise exception 'line % cannot be billed: verified %, PO %, billed %, this bill %',
        v_v->>'item_code', v_v->>'verified', v_v->>'po_qty', v_v->>'billed', v_v->>'requested' using errcode = 'SC001';
    end if;
    if v_v->>'reason' = 'line_not_on_po' then
      raise exception 'line % is not on this purchase order; the bill is refused', coalesce(v_v->>'item_code', v_v->>'boq_item_id')
        using errcode = 'SC001';
    end if;
    raise exception 'the bill cap could not be evaluated (%); the bill is refused', v_v->>'reason' using errcode = 'SC001';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric)
              left join public.purchase_order_lines pl on pl.po_id = v_po and pl.revision = v_rev and pl.boq_item_id = x.boq_item_id
              where pl.boq_item_id is null or x.rate is null or x.rate > pl.rate or x.rate <> round(x.rate, 2)
                 or x.quantity is null or x.quantity <= 0 or x.quantity <> round(x.quantity, 3))
     or exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid) group by x.boq_item_id having count(*) > 1) then
    raise exception 'each bill line must be a distinct BoQ line of this PO at no more than the PO rate' using errcode = '23514'; -- FR-SCA-023
  end if;
  select coalesce(sum(round(x.quantity * x.rate, 2)), 0) into v_lines_net
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  v_net := case when btrim(v_inv.tax_treatment) = 'inclusive' then v_inv.amount - v_inv.tax_amount else v_inv.amount end;
  if v_net is distinct from v_lines_net then
    raise exception 'the bill''s pre-tax amount % must equal its lines %', v_net, v_lines_net using errcode = '23514';
  end if;
  perform set_config('pmo.subcontract_capture', 'on', true);
  insert into public.procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate, attributed_by)
  select p_invoice_id, x.boq_item_id, x.quantity, x.rate, auth.uid()
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric);
  perform set_config('pmo.subcontract_capture', '', true);
  update public.procurement_invoices set po_id = v_po where id = p_invoice_id;
  perform public.log_audit('procurement_invoice.attribute_lines', v_proc.org_id, auth.uid(), p_invoice_id,
    jsonb_build_object('po_id', v_po, 'revision', v_rev, 'lines', (
      select coalesce(jsonb_agg(jsonb_build_object('boq_item_id', x.boq_item_id, 'quantity', x.quantity, 'rate', x.rate)
                                order by x.boq_item_id), '[]'::jsonb)
        from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric))));   -- normalised, never the raw client JSON
end $$;
revoke all on function public.attribute_subcontract_bill_lines(uuid, jsonb) from public, anon;
grant execute on function public.attribute_subcontract_bill_lines(uuid, jsonb) to authenticated;
