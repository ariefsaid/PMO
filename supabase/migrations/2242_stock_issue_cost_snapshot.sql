-- Persistent stock-cost cutover purchase set. First release: apply 2240-2242 before enabling.
-- Latest setter/classifier: 2241. Rollback: rollback/2242_stock_issue_cost_snapshot_down.sql.
-- Field accounts: snapshot rows denied; existing assert_not_light and cost-role boundaries are retained.
-- drops: live dated-cost classification is replaced by the saved purchase set; the setter captures the prior-receipt set and refusal together.
create table public.stock_issue_cost_purchases (
 org_id uuid not null references public.stock_issue_cost_settings(org_id) on delete cascade,
 purchase_id uuid not null,
 effective_on date not null,
 captured_at timestamptz not null default now(),
 primary key(org_id,purchase_id),
 foreign key(org_id,purchase_id) references public.procurements(org_id,id)
);
alter table public.stock_issue_cost_purchases enable row level security;
alter table public.stock_issue_cost_purchases force row level security;
create policy stock_issue_cost_purchases_read on public.stock_issue_cost_purchases for select to authenticated
 using (org_id=(select public.auth_org_id()) and (select public.is_active_member())
   and (select public.actor_is_light()) is not true
   and (select public.auth_role()) in ('Admin','Executive','Finance','Project Manager'));
revoke all on public.stock_issue_cost_purchases from public,anon,authenticated;
grant select on public.stock_issue_cost_purchases to authenticated;
grant all on public.stock_issue_cost_purchases to service_role;

create or replace function public.set_stock_issue_cost_date(p_effective_on date) returns date
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_purchases uuid[]; v_has_cost boolean;
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
   -- Capture the purchase set and refusal at one statement snapshot. Later bill writes cannot change this set.
   select coalesce(array_agg(distinct d.procurement_id),'{}'::uuid[]),
          coalesce(bool_or(public.purchase_had_cost_before(d.procurement_id,p_effective_on)),false)
     into v_purchases,v_has_cost
     from public.stock_documents d
    where d.org_id=v_org and d.kind='receive' and d.status='Posted' and d.occurred_on<p_effective_on
      and d.procurement_id is not null;
   if v_has_cost then
     raise exception 'this organisation needs a stock-cost migration first' using errcode='23514';
   end if;
 end if;
 insert into public.stock_issue_cost_settings(org_id,effective_on,updated_by)
 values(v_org,p_effective_on,auth.uid()) on conflict(org_id) do update
 set effective_on=excluded.effective_on,updated_by=excluded.updated_by,updated_at=now();
 delete from public.stock_issue_cost_purchases where org_id=v_org;
 if p_effective_on is not null then
   insert into public.stock_issue_cost_purchases(org_id,purchase_id,effective_on)
   select v_org,p,p_effective_on from unnest(v_purchases) p;
 end if;
 perform public.log_audit('stock_issue_cost.set',v_org,auth.uid(),v_org,jsonb_build_object('effective_on',p_effective_on));
 return p_effective_on;
end $$;
create or replace function public.purchase_costs_as_stock(p_purchase uuid) returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
 select not public.org_reads_erp_ledger() and exists (
  select 1 from public.stock_documents d join public.stock_issue_cost_settings s on s.org_id=d.org_id
  where d.org_id=(select public.auth_org_id()) and d.procurement_id=p_purchase
    and d.kind='receive' and d.status='Posted' and s.effective_on is not null
    and (d.occurred_on>=s.effective_on or exists(select 1 from public.stock_issue_cost_purchases x where x.org_id=d.org_id and x.purchase_id=d.procurement_id and x.effective_on=s.effective_on)))
$$;
