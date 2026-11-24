-- Reverses 2000: the warning on an item with no plan reads as the 1870 sentence again.
create or replace function public.usage_check_work_order(p_work_order uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_pct numeric; v_source text; v_label text; i record; v_plan numeric; v_inst numeric; v_to uuid;
  v_item text; v_unit text; v_rows integer;
begin
  select w.org_id, coalesce(w.wo_number, w.title) into v_org, v_label from public.work_orders w where w.id = p_work_order;
  if v_org is null then return; end if;
  select s.usage_warn_pct_1, s.usage_installed_source into v_pct, v_source from public.material_request_settings s where s.org_id = v_org;
  if v_pct is null then return; end if;                                                                -- mut:usage_unset  (default off)
  v_source := coalesce(v_source, 'site_reports');
  for i in
    select c.stock_item_id as item_id
      from public.dsr_consumables c join public.daily_site_reports r on r.id = c.report_id
     where v_source = 'site_reports' and r.work_order_id = p_work_order
       and r.status = 'validated' and r.superseded_at is null and r.archived_at is null
    union
    select l.item_id
      from public.stock_ledger l join public.stock_documents d on d.id = l.document_id
     where v_source = 'stock_issues' and d.work_order_id = p_work_order and l.org_id = v_org and l.kind in ('issue', 'return')
  loop
    begin   -- one item's failure does not stop the others
      v_plan := public.mrq_plan_quantity(p_work_order, i.item_id);
      v_inst := public.usage_installed_qty(p_work_order, i.item_id);
      -- plan 0 and any installed quantity is past the share; otherwise installed >= pct percent of plan, in exact numeric.
      continue when not ((v_plan = 0 and v_inst > 0) or (v_plan > 0 and v_inst * 100 >= v_pct * v_plan));   -- mut:usage_share
      v_to := public.usage_warning_recipient(p_work_order);
      insert into public.material_installed_usage_alerts (org_id, work_order_id, item_id, pct, installed_qty, plan_qty, source, notified_user_id)
      values (v_org, p_work_order, i.item_id, v_pct, v_inst, v_plan, v_source, v_to)
      on conflict (work_order_id, item_id, kind) where resolved_at is null do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 and v_to is not null then
        select it.name, u.code into v_item, v_unit from public.stock_items it join public.stock_units u on u.id = it.unit_id where it.id = i.item_id;
        perform public.notify_workflow_user(v_org, v_to, 'Installed material usage reached',
          format('%s on work order %s has reached the %s%% usage warning: %s of %s %s planned is installed. Go and check the site.',
                 v_item, v_label, trim_scale(v_pct)::text, trim_scale(v_inst)::text, trim_scale(v_plan)::text, v_unit),
          'warning', 'work_order', p_work_order, v_label);
      end if;
    exception when others then
      raise warning 'usage warning check failed for work order % item %: %', p_work_order, i.item_id, sqlerrm;
    end;
  end loop;
end $$;
revoke all on function public.usage_check_work_order(uuid) from public, anon, authenticated, service_role;
