-- 1320_dsr_stock_issue_settings.sql — #2676 (spec docs/specs/daily-report-stock-issue.spec.md FR-DRS-001..003).
-- Proven by supabase/tests/1320_dsr_stock_issue.test.sql.
--   §1 organisation setting dsr_stock_issue (default off) + dsr_stock_issue_items ('all' | 'consumables'), written only by an Admin RPC, audited.
--   §2 stock_items.consumable (item data, default false).
--   §3 work_orders.site_warehouse_id: the work order's site location (client data), validated by a guard trigger.
--   §4 dsr_consumables.work_order_line_id: the contract item a material line went into (optional).
-- Nothing here writes the ledger. ── REVERSE: rollback/1320_dsr_stock_issue_settings_down.sql.

alter table public.organizations
  add column dsr_stock_issue boolean not null default false,
  add column dsr_stock_issue_items text not null default 'all' check (dsr_stock_issue_items in ('all', 'consumables'));

create or replace function public.dsr_stock_issue_on(p_org uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select o.dsr_stock_issue from public.organizations o where o.id = p_org), false) $$;
revoke all on function public.dsr_stock_issue_on(uuid) from public, anon;
grant execute on function public.dsr_stock_issue_on(uuid) to authenticated;

create or replace function public.set_dsr_stock_issue(p_on boolean, p_items text default null) returns boolean
  language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_old boolean; v_old_items text; v_items text;
begin
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  if not coalesce(public.role_rank(public.auth_role()) >= 50, false) then                          -- mut:drs_setting_admin
    raise exception 'STK_FORBIDDEN: only an Admin changes whether site reports post stock' using errcode = '42501'; end if;
  if p_on is null or (p_items is not null and p_items not in ('all', 'consumables')) then
    raise exception 'STK_INVALID: on or off, and items all or consumables' using errcode = 'P0001'; end if;
  if p_on then perform public.stock_assert_standalone(v_org); end if;                               -- STK_OWNED_BY_ERP
  select o.dsr_stock_issue, o.dsr_stock_issue_items into v_old, v_old_items from public.organizations o where o.id = v_org for update;
  v_items := coalesce(p_items, v_old_items);
  if v_old = p_on and v_old_items = v_items then return v_old; end if;
  update public.organizations set dsr_stock_issue = p_on, dsr_stock_issue_items = v_items where id = v_org;
  perform public.log_audit('dsr.stock_issue', v_org, auth.uid(), v_org,
    jsonb_build_object('from', v_old, 'to', p_on, 'items_from', v_old_items, 'items_to', v_items));
  return p_on;
end $$;
revoke all on function public.set_dsr_stock_issue(boolean, text) from public, anon;
grant execute on function public.set_dsr_stock_issue(boolean, text) to authenticated;

alter table public.stock_items add column consumable boolean not null default false;

alter table public.work_orders add column site_warehouse_id uuid references public.stock_warehouses(id);
create index work_orders_site_warehouse_idx on public.work_orders (site_warehouse_id) where site_warehouse_id is not null;

create or replace function public.guard_work_order_site_location() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.site_warehouse_id is not null and (tg_op = 'INSERT' or new.site_warehouse_id is distinct from old.site_warehouse_id) then
    if not exists (select 1 from public.stock_warehouses w                                            -- mut:drs_location_check
                    where w.id = new.site_warehouse_id and w.org_id = new.org_id and w.project_id = new.project_id
                      and w.kind in ('site', 'yard', 'staging') and w.archived_at is null) then
      raise exception 'DRS_LOCATION: the site location must be an open site, yard or staging location of this work order''s project' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_work_order_site_location() from public, anon, authenticated;
create trigger work_orders_zzzzz_site_location before insert or update of site_warehouse_id on public.work_orders
  for each row execute function public.guard_work_order_site_location();

alter table public.dsr_consumables add column work_order_line_id uuid references public.work_order_lines(id);
