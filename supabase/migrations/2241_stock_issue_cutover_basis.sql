-- Stock cutover uses the purchase's dated cost history. Rollback: rollback/2241_stock_issue_cutover_basis_down.sql.
-- Latest setter and classifier: 2240. No definer privileges or cost audience changes.
-- drops: the undated bill/payment presence check and date-only receive check, replaced by the shared dated-cost predicate.
create function public.purchase_had_cost_before(p_purchase uuid,p_before date) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select exists(select 1 from public.payments p where p.org_id=(select public.auth_org_id()) and p.procurement_id=p_purchase
   and p.status='Paid' and coalesce(p.erp_docstatus,1)<>2 and p.erp_cancelled_at is null
   and coalesce(p.date,(p.created_at at time zone 'UTC')::date)<p_before)
 or exists(select 1 from public.procurement_invoices i where i.org_id=(select public.auth_org_id()) and i.procurement_id=p_purchase
   and i.voided_at is null and coalesce(i.erp_docstatus,1)<>2 and i.erp_cancelled_at is null and i.invoice_date<p_before)
$$;
revoke all on function public.purchase_had_cost_before(uuid,date) from public,anon;
grant execute on function public.purchase_had_cost_before(uuid,date) to authenticated,service_role;

create or replace function public.set_stock_issue_cost_date(p_effective_on date) returns date
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid := public.auth_org_id();
begin
 perform public.assert_not_light();
 perform public.assert_is_active_member();
 if public.auth_role() is distinct from 'Admin' then
   raise exception 'only an Admin changes stock issue costing' using errcode='42501';
 end if;
 -- Serialise settings changes for this organisation.
 perform 1 from public.organizations where id=v_org for update;
 if p_effective_on is not null then
   if public.org_reads_erp_ledger() then
     raise exception 'stock issue costing requires the PMO-paid basis' using errcode='23514';
   end if;
   if exists(select 1 from public.stock_documents d
      where d.org_id=v_org and d.kind='receive' and d.status='Posted' and d.occurred_on<p_effective_on
      and public.purchase_had_cost_before(d.procurement_id,p_effective_on)) then
     raise exception 'this organisation needs a stock-cost migration first' using errcode='23514';
   end if;
 end if;
 insert into public.stock_issue_cost_settings(org_id,effective_on,updated_by)
 values(v_org,p_effective_on,auth.uid()) on conflict(org_id) do update
 set effective_on=excluded.effective_on,updated_by=excluded.updated_by,updated_at=now();
 perform public.log_audit('stock_issue_cost.set',v_org,auth.uid(),v_org,jsonb_build_object('effective_on',p_effective_on));
 return p_effective_on;
end $$;
create or replace function public.purchase_costs_as_stock(p_purchase uuid) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select not public.org_reads_erp_ledger() and exists (
  select 1 from public.stock_documents d join public.stock_issue_cost_settings s on s.org_id=d.org_id
  where d.org_id=(select public.auth_org_id()) and d.procurement_id=p_purchase
    and d.kind='receive' and d.status='Posted' and s.effective_on is not null
    and (d.occurred_on>=s.effective_on or not public.purchase_had_cost_before(d.procurement_id,s.effective_on)))
$$;
