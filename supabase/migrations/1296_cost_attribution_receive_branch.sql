-- 1296 — check_cost_attribution carries BOTH the receive-warehouse rule and the expense-claim rule.
-- Integration fault (land/1215-r1, ledger-r1 entry 1): 1161 restated the function whole with a `receive`
-- branch (a receive naming a work order takes the project of its receiving location; a central or
-- project-less location refuses with COST_WO_NO_PROJECT), then 1260 restated it whole again for expense
-- claims from a copy without that branch, so after 1260 EVERY receive attributed to a work order raised
-- COST_WO_NO_PROJECT. This migration restates the body with both changes: 1260's expense-claim arms
-- (the COST_ADVANCE guard and expense_claims in the project case list) AND 1161's receive branch.
-- The triggers are unchanged: 1161's stock_documents trigger (fires on the warehouse columns too) and
-- 1260's expense_claims trigger both execute this one function.
-- Proven by supabase/tests/csr_cost_attribution.test.sql (AC-CSR-020/021/023) and
-- supabase/tests/0950_work_order_cost_attribution.test.sql, both re-run green on the integration head.
-- Reverse: rollback/1296_cost_attribution_receive_branch_down.sql (restores 1260's body exactly).

create or replace function public.check_cost_attribution() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_project uuid;
  v_wo_org uuid; v_wo_project uuid; v_wo_status public.work_order_status;
begin
  if tg_table_name = 'expense_claims' then
    -- Nested, never `and`: plpgsql does not short-circuit, and only this table has a `kind` field on every row type here.
    if new.kind = 'advance' and (new.work_order_id is not null or new.discipline_id is not null) then
      raise exception 'COST_ADVANCE: a cash advance is not a cost; name the work order on the claim that settles it' using errcode = '23514';
    end if;
  end if;
  if new.work_order_id is not null then
    case tg_table_name
      when 'timesheet_entries', 'equipment_usage_entries', 'expense_claims' then
        v_project := new.project_id;
      when 'stock_documents' then
        if new.kind in ('issue', 'return') then
          v_project := new.project_id;
        elsif new.kind = 'transfer' then
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.to_warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');
        elsif new.kind = 'receive' then                                                       -- mut:receive_branch
          select w.project_id into v_project from public.stock_warehouses w
           where w.id = new.warehouse_id and w.org_id = new.org_id and w.kind in ('site', 'yard', 'staging');   -- mut:receive_central
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
    if v_wo_org is distinct from new.org_id or v_wo_project is distinct from v_project then   -- mut:receive_project
      raise exception 'COST_WO_PROJECT: the work order belongs to another project' using errcode = '23514';
    end if;
    -- A cancelled work order takes no NEW costs; a row already on it keeps it (it was valid when written).
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
