-- Rollback 0286_executive_at_risk_active_delivery.sql.
create or replace function get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with active as (
    select * from projects where status = 'Ongoing Project'
  ),
  active_committed as (
    select
      p.id,
      p.contract_value,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = p.id and v.status = 'Active'), 0) as budget,
      coalesce((
        select sum(pr.total_value) from procurements pr
        where pr.project_id = p.id
          and pr.status::text = any(committed_procurement_statuses())
      ), 0) as committed_spend
    from projects p
    where p.status = 'Ongoing Project'
  ),
  on_hand as (
    select p.id, p.contract_value,
           coalesce((select sum(pr.total_value) from procurements pr
                     where pr.project_id = p.id
                       and pr.status::text = any(committed_procurement_statuses())), 0) as spent
    from projects p
    where p.status::text = any(on_hand_project_statuses())
  ),
  pipeline as (
    select p.id, p.contract_value, p.status,
           coalesce((select sum(li.budgeted_amount)
                     from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                     where v.project_id = p.id and v.status = 'Active'), 0) as active_budget,
           coalesce((select c.win_probability from pipeline_stage_config c where c.status = p.status), 0) as win_prob
    from projects p
    where p.status::text = any(pipeline_project_statuses())
  )
  select json_build_object(
    'active_projects', (select count(*) from active),
    'total_contract_value', coalesce((select sum(contract_value) from active), 0),
    'on_hand_value', coalesce((select sum(contract_value) from on_hand), 0),
    'on_hand_margin', coalesce((select case when sum(contract_value) > 0
                         then sum(contract_value - spent) / sum(contract_value) else 0 end from on_hand), 0),
    'pipeline_total_value', coalesce((select sum(contract_value) from pipeline), 0),
    'pipeline_weighted_value', coalesce((select sum(contract_value * win_prob) from pipeline), 0),
    'pipeline_projected_margin', coalesce((select case when sum(contract_value) > 0
                         then sum(contract_value - active_budget) / sum(contract_value) else 0 end from pipeline), 0),
    'projects_at_risk', (
      select count(*) from active_committed
      where budget > 0 and committed_spend / budget >= 0.9
    ),
    'projects_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from projects group by status) s), '[]'::json),
    'procurements_by_status', coalesce((
      select json_agg(json_build_object('status', status, 'count', c) order by status)
      from (select status, count(*) c from procurements group by status) s), '[]'::json),
    'top_projects', coalesce((
      select json_agg(t order by t.contract_value desc) from (
        select
          p.id,
          p.name,
          coalesce(nullif(btrim(c.short_name), ''), c.name) as client_name,
          p.contract_value,
          coalesce((select sum(li.budgeted_amount)
                    from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                    where v.project_id = p.id and v.status = 'Active'), 0) as budget,
          coalesce((
            select sum(pr.total_value) from procurements pr
            where pr.project_id = p.id
              and pr.status::text = any(committed_procurement_statuses())
          ), 0) as spent,
          p.status
        from projects p left join companies c on c.id = p.client_id
        order by p.contract_value desc limit 5
      ) t), '[]'::json)
  );
$$;
revoke all on function get_executive_dashboard() from public;
grant execute on function get_executive_dashboard() to authenticated;
revoke execute on function get_executive_dashboard() from anon;

drop function if exists public.active_delivery_project_statuses();
