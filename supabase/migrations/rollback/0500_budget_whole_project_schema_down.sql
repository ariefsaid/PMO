-- Reverse 0500 only when no whole-project version or stored distribution would be lost.
do $$
begin
  if exists (select 1 from public.budget_versions where budget_mode = 'whole_project')
     or exists (select 1 from public.budget_distribution_plans)
     or exists (select 1 from public.budget_year_distributions) then
    raise exception 'rollback refused: whole-project budget data must be removed or migrated first'
      using errcode = 'P0001';
  end if;
end;
$$;

drop trigger if exists budget_line_items_whole_project_fiscal_year_guard on public.budget_line_items;
drop trigger if exists budget_versions_budget_mode_immutable on public.budget_versions;
drop trigger if exists budget_distribution_plans_stamp_org_id on public.budget_distribution_plans;
drop trigger if exists budget_year_distributions_stamp_org_id on public.budget_year_distributions;

drop function if exists public.assert_budget_line_item_whole_project_year();
drop function if exists public.assert_budget_mode_immutable();

drop table public.budget_year_distributions;
drop table public.budget_distribution_plans;

update public.record_history_config
   set captured = captured - 'budget_mode'
 where entity_type = 'budget_version'
   and captured ? 'budget_mode';

alter table public.budget_versions drop column budget_mode;

-- Restore 0241's line-item draft guard after removing the version-row serialization added in 0500.
create or replace function public.enforce_draft_line_item()
returns trigger language plpgsql set search_path = public as $$
declare v_status public.budget_status;
begin
  if tg_op = 'UPDATE' and new.budget_version_id is distinct from old.budget_version_id then
    raise exception 'a budget line cannot move to another version' using errcode = 'P0001';
  end if;
  select status into v_status from public.budget_versions
    where id = case when tg_op = 'DELETE' then old.budget_version_id else new.budget_version_id end;
  if v_status <> 'Draft' then
    raise exception 'line-items can only change while the owning version is Draft' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end; $$;
grant execute on function public.enforce_draft_line_item() to public;
