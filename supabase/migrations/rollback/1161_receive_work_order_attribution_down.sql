-- 1161_receive_work_order_attribution_down.sql — reverse 1161: restore 1029's check_cost_attribution (no receive
-- branch), the original trigger column list and 1029's warehouse-move guard.
create or replace function public.check_cost_attribution() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
  if new.work_order_id is not null then
    case tg_table_name
      when 'timesheet_entries', 'equipment_usage_entries' then
        v_project := new.project_id;
      when 'stock_documents' then
        if new.kind in ('issue', 'return') then
          v_project := new.project_id;
        elsif new.kind = 'transfer' then
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.to_warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');
        end if;
      else
        select p.project_id into v_project from public.procurements p
         where p.id = new.procurement_id and p.org_id = new.org_id;
    end case;
    if v_project is null then
      raise exception 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order' using errcode = '23514';
    end if;
    select w.org_id, w.project_id, w.status into v_wo_org, v_wo_project, v_wo_status
      from public.work_orders w where w.id = new.work_order_id;
    if v_wo_org is distinct from new.org_id or v_wo_project is distinct from v_project then
      raise exception 'COST_WO_PROJECT: the work order belongs to another project' using errcode = '23514';
    end if;
    if v_wo_status = 'Cancelled' and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
      raise exception 'COST_WO_CANCELLED: the work order is cancelled' using errcode = '23514';
    end if;
  end if;
  if new.discipline_id is not null and (tg_op = 'INSERT' or new.discipline_id is distinct from old.discipline_id) then
    if not exists (select 1 from public.cost_disciplines d
                    where d.id = new.discipline_id and d.org_id = new.org_id and d.archived_at is null) then
      raise exception 'COST_DISCIPLINE: the discipline is not on this organisation''s list' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_cost_attribution() from public, anon, authenticated;

drop trigger zz_cost_attribution_check on public.stock_documents;
create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, project_id, kind, to_warehouse_id
  on public.stock_documents for each row execute function public.check_cost_attribution();

create or replace function public.guard_warehouse_move_with_work_orders() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.project_id is distinct from old.project_id or new.kind is distinct from old.kind)
     and exists (select 1 from public.stock_documents d
       join public.work_orders w on w.id = d.work_order_id
       where d.to_warehouse_id = new.id and d.kind = 'transfer'
         and (new.kind not in ('site', 'yard', 'staging') or w.project_id is distinct from new.project_id)) then
    raise exception 'COST_WO_PROJECT_MOVE: transfers to this warehouse name a work order of its project' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_warehouse_move_with_work_orders() from public, anon, authenticated;
