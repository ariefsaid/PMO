-- 1260_expense_claim_cost_attribution.sql — #2732: an expense claim (and so every spend charged to a site float) can
-- name an optional work order and discipline. Spec docs/specs/site-cash-work-order.spec.md; plan
-- docs/plans/2026-11-21-site-cash-work-order.md; ADR-0104 addendum. Proven by supabase/tests/1260_site_cash_work_order.test.sql.
--   §1 two nullable columns + partial indexes on expense_claims (no client grant: the only writer is set_cost_attribution, 1261)
--   §2 check_cost_attribution (1029's body) + the claim branch: project = the claim's project; a cash advance refuses (COST_ADVANCE)
--   §3 the trigger on expense_claims (also guards a project change under a named work order: COST_WO_PROJECT)
--   (No change to assert_expense_claim_update: set_cost_attribution is a definer, so the DD-EXP-10 freeze, which waves
--   BYPASSRLS actors through, already lets it write; clients get no column grant, so they cannot reach the columns.)
-- No routing, approval, posting or total reads these columns. Default null: no existing record changes.
-- Reverse: rollback/1260_expense_claim_cost_attribution_down.sql.

alter table public.expense_claims
  add column work_order_id uuid references public.work_orders(id),
  add column discipline_id uuid references public.cost_disciplines(id);
create index expense_claims_work_order_idx on public.expense_claims (work_order_id) where work_order_id is not null;
create index expense_claims_discipline_idx on public.expense_claims (discipline_id) where discipline_id is not null;

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

create trigger zz_cost_attribution_check before insert or update of work_order_id, discipline_id, project_id, kind
  on public.expense_claims for each row execute function public.check_cost_attribution();
