-- 0704_native_tm_invoice_down.sql - reverses 0704. Refuses while any native invoice shares an id with a T&M claim: the invoices this
-- RPC made cannot be told apart from history, and dropping the function would leave them with no way to be created again.
do $$ begin
  if exists (select 1 from public.sales_invoices si join public.tm_claims c on c.id = si.id where si.pmo_native) then
    raise exception 'native invoices made from T&M claims exist; cancel and export them before rolling back 0704; rollback refused'
      using errcode = 'P0001';
  end if;
end $$;
drop function if exists public.create_native_tm_invoice(uuid);

-- Restore the work-order fence as 0262 shipped it.
create or replace function public.assert_sales_invoice_within_work_order() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_dp       boolean;
  v_recovery numeric;
  v_new      numeric;
  v_old      numeric;
begin
  -- The ERP mirror (dispatch finalize, sweep, inbound feed): the ERP document already exists; refusing its mirror
  -- would wedge every sweep replay (DD-VI-3a). An overage shows as over-invoiced instead (FR-BWO-006).
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  -- A server-side load with no JWT (seed, migration, owner-run loader).
  if auth.uid() is null and session_user in ('postgres', 'supabase_admin') then return new; end if;
  -- A claim's invoice is raised from the claim and mirrored under its id; any other writer taking that id would be
  -- read as the claim's invoice (its recovery, a down payment's zero) and stop the claim counting as unraised. That
  -- moves a work order's figures only when the claim or the invoice names one — the case refused here.
  if tg_op = 'INSERT' and exists (select 1 from public.progress_claims pc
                                   where pc.id = new.id and (pc.work_order_id is not null or new.work_order_id is not null)) then
    raise exception 'this id belongs to a progress claim: its invoice is raised from the claim' using errcode = 'BW001';
  end if;
  if new.work_order_id is null or new.status = 'Cancelled' then return new; end if;

  -- The row's billed work, by the same rule as sales_invoice_work_billed (a claim invoice adds its recovery back; a
  -- down-payment invoice bills nothing).
  select pc.kind = 'down_payment', pc.dp_recovery_amount into v_dp, v_recovery
    from public.progress_claims pc where pc.id = new.id and pc.org_id = new.org_id;
  v_new := case when coalesce(v_dp, false) then 0
                else (case when new.tax_treatment = 'inclusive' then new.amount - new.tax_amount else new.amount end)
                     + coalesce(v_recovery, 0) end;

  if tg_op = 'UPDATE' and old.work_order_id is not distinct from new.work_order_id and old.status <> 'Cancelled' then
    v_old := case when coalesce(v_dp, false) then 0
                  else (case when old.tax_treatment = 'inclusive' then old.amount - old.tax_amount else old.amount end)
                       + coalesce(v_recovery, 0) end;
    -- A reduction, or a status move that bills the same, never needs refusing — down to zero, not below it. NULL on
    -- either side falls through to the helper, which refuses it.
    if v_new <= v_old and v_new >= 0 then return new; end if;
  end if;

  perform public.assert_work_order_invoiceable(new.org_id, new.work_order_id, new.project_id, new.id::text, v_new, new.currency);
  return new;
end; $$;
revoke all on function public.assert_sales_invoice_within_work_order() from public, anon, authenticated;
