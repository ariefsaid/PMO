-- 2661_usage_warning_two_levels_issue_path.sql — owner ruling OD-R1125-4 (#2884): material that is issued or installed raises BOTH warning levels
-- (as a request does), each once per work order and item, and each reaches the work order's responsible person AND the project's manager.
-- usage_check_work_order is restated from 2000 (the latest). Changes: the second level (usage_warn_pct_2) is checked; its alert is kind 'installed_usage_2'
-- (so the once-per-open-row index of 1870 holds it separately and the work-order banner, which reads kind 'installed_usage', is untouched);
-- both recipients are told (distinct, active, not a field account); when there is no responsible person the manager alone, as before.
-- A level with no plan is raised once (level 1): both levels would say the same thing. usage_warning_recipient (1862) is unchanged: the ahead-of-progress check still uses it.
-- drops: the single v_pct/v_to variables and one-slot insert become two slots and two recipients (v_p1, v_p2, v_resp, v_pm); the share test, plan-0 sentence and once-per-open-row conflict are unchanged.
-- Rollback: supabase/migrations/rollback/2661_usage_warning_two_levels_issue_path_down.sql
alter table public.material_installed_usage_alerts drop constraint material_installed_usage_alerts_kind_check;
alter table public.material_installed_usage_alerts add constraint material_installed_usage_alerts_kind_check
  check (kind in ('installed_usage', 'installed_usage_2', 'issued_ahead'));

create or replace function public.usage_check_work_order(p_work_order uuid) returns void
  language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_p1 numeric; v_p2 numeric; v_pct numeric; v_slot smallint; v_source text; v_label text; i record; v_plan numeric; v_inst numeric;
  v_to uuid; v_who uuid; v_item text; v_unit text; v_rows integer; v_pm uuid; v_resp uuid;
begin
  select w.org_id, coalesce(w.wo_number, w.title) into v_org, v_label from public.work_orders w where w.id = p_work_order;
  if v_org is null then return; end if;
  select s.usage_warn_pct_1, s.usage_warn_pct_2, s.usage_installed_source into v_p1, v_p2, v_source from public.material_request_settings s where s.org_id = v_org;
  if v_p1 is null and v_p2 is null then return; end if;                                                -- mut:usage_unset  (default off)
  v_source := coalesce(v_source, 'site_reports');
  v_to := public.usage_warning_recipient(p_work_order);
  -- the two people told: the work order's responsible person and the project's manager (active, and not a field account, which cannot open it)
  select w.responsible_person_id into v_resp from public.work_orders w join public.profiles p on p.id = w.responsible_person_id and p.org_id = w.org_id
   where w.id = p_work_order and public.is_active_member(w.responsible_person_id) and not public.is_light_role_key(p.built_in_role);
  select pr.project_manager_id into v_pm from public.work_orders w
    join public.projects pr on pr.id = w.project_id and pr.org_id = w.org_id
    join public.profiles p on p.id = pr.project_manager_id and p.org_id = w.org_id
   where w.id = p_work_order and public.is_active_member(pr.project_manager_id) and not public.is_light_role_key(p.built_in_role);
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
      for v_slot in 1..2 loop
        v_pct := case v_slot when 1 then v_p1 else v_p2 end;
        continue when v_pct is null or (v_slot = 2 and v_plan = 0);
        -- plan 0 and any installed quantity is past the share; otherwise installed >= pct percent of plan, in exact numeric.
        continue when not ((v_plan = 0 and v_inst > 0) or (v_plan > 0 and v_inst * 100 >= v_pct * v_plan));   -- mut:usage_share
        insert into public.material_installed_usage_alerts (org_id, work_order_id, item_id, pct, installed_qty, plan_qty, source, notified_user_id, kind)
        values (v_org, p_work_order, i.item_id, v_pct, v_inst, v_plan, v_source, v_to, case v_slot when 1 then 'installed_usage' else 'installed_usage_2' end)
        on conflict (work_order_id, item_id, kind) where resolved_at is null do nothing;
        get diagnostics v_rows = row_count;
        if v_rows = 1 then
          select it.name, u.code into v_item, v_unit from public.stock_items it join public.stock_units u on u.id = it.unit_id where it.id = i.item_id;
          for v_who in select x from (select v_resp as x union select v_pm) r where x is not null loop      -- mut:usage_recipients
            perform public.notify_workflow_user(v_org, v_who, 'Installed material usage reached',
              case when v_plan = 0
                   then format('%s on work order %s has been used with no plan: %s %s installed and none planned. Go and check the site.',
                               v_item, v_label, trim_scale(v_inst)::text, v_unit)
                   else format('%s on work order %s has reached the %s%% usage warning: %s of %s %s planned is installed. Go and check the site.',
                               v_item, v_label, trim_scale(v_pct)::text, trim_scale(v_inst)::text, trim_scale(v_plan)::text, v_unit) end,
              'warning', 'work_order', p_work_order, v_label);
          end loop;
        end if;
      end loop;
    exception when others then
      raise warning 'usage warning check failed for work order % item %: %', p_work_order, i.item_id, sqlerrm;
    end;
  end loop;
end $$;
revoke all on function public.usage_check_work_order(uuid) from public, anon, authenticated, service_role;

-- An issue is posted first and tied to its work order afterwards (set_cost_attribution), so the check also runs when a posted issue or return
-- is given its work order (the ahead-of-progress check of 1871 already does). 1862's trigger fired on the status change only.
drop trigger if exists stock_documents_zz_usage_check on public.stock_documents;
create trigger stock_documents_zz_usage_check after update of status, work_order_id on public.stock_documents
  for each row when (new.status = 'Posted' and new.kind in ('issue', 'return') and new.work_order_id is not null
                     and (old.status is distinct from new.status or old.work_order_id is distinct from new.work_order_id))
  execute function public.usage_check_stock_trigger();
