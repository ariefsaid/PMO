-- Reverses 1022 (#2480): both batch reads go back to one per-project call per id.
-- The 0700 body of get_projects_money_collection and the 0396 body of get_projects_delivery, verbatim.
-- Reversing restores the measured 9.9 s / 2.0 s list reads on a 500-project organisation.

create or replace function public.get_projects_money_collection(p_project_ids uuid[])
returns table(project_id uuid, actuals jsonb, ledger_basis text, active_budget_amount text, active_budget_currency text, has_active_budget boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.auth_role();
  v_erp boolean;
  v_project_id uuid;
  v_actuals jsonb;
  v_finance_actuals jsonb;
  v_categories_complete boolean;
  v_pmo_spent numeric;
  v_pmo_spent_complete boolean;
  v_pmo_committed numeric;
  v_pmo_committed_complete boolean;
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 or cardinality(p_project_ids) > 500 then
    raise exception 'project selection is invalid' using errcode = '22023';
  end if;
  v_erp := public.org_reads_erp_ledger();

  for v_project_id in
    select distinct requested.id
    from unnest(p_project_ids) requested(id)
    join public.projects p on p.id = requested.id and p.org_id = public.auth_org_id()
    order by requested.id
  loop
    if v_erp then
      v_finance_actuals := public.get_project_finances(v_project_id)->'actuals';
      with pma as materialized (select category, mapped, actuals_to_date from public.project_mapped_actuals(v_project_id,null))
      select coalesce((select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
                   (where exists (select 1 from pma x
                     where x.category=li.category and x.mapped and x.actuals_to_date is not null))
                   from public.budget_versions b join public.budget_line_items li on li.budget_version_id=b.id
                   where b.project_id=v_project_id and b.status='Active'),false)
        into v_categories_complete;
      v_actuals := jsonb_set(v_finance_actuals,'{complete}',to_jsonb(
        v_categories_complete
        and not coalesce((v_finance_actuals->>'excludes_restricted_rows')::boolean,true)));
    else
      select s.amount, s.complete, c.amount, c.complete
        into v_pmo_spent, v_pmo_spent_complete, v_pmo_committed, v_pmo_committed_complete
        from public.project_pmo_spent_position(v_project_id) s
        cross join public.project_pmo_commitment_position(v_project_id) c;
      v_actuals := jsonb_build_object(
        'currency', (select p.currency from public.projects p where p.id = v_project_id),
        'total', v_pmo_spent::text,
        'as_of', null,
        'excludes_restricted_rows', false,
        'complete', v_pmo_spent_complete,
        'committed_total', v_pmo_committed::text,
        'committed_complete', v_pmo_committed_complete,
        'categories', '[]'::jsonb);
    end if;

    return query
      select v_project_id,
             v_actuals,
             case when v_erp then 'erp' else 'pmo' end,
             case
               when not exists (
                 select 1 from public.budget_versions b
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ) then null
               when exists (
                 select 1 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
                   and (li.budgeted_amount is null or li.budgeted_amount::text in ('NaN','Infinity','-Infinity'))
               ) then null
               else coalesce((
                 select sum(li.budgeted_amount)
                 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ), 0::numeric)::text
             end,
             (select b.currency from public.budget_versions b
              where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
              order by b.version desc, b.created_at desc, b.id desc limit 1),
             exists (
               select 1 from public.budget_versions b
               where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
             );
  end loop;
end $$;
revoke all on function public.get_projects_money_collection(uuid[]) from public, anon, authenticated;
grant execute on function public.get_projects_money_collection(uuid[]) to authenticated;

create or replace function get_projects_delivery(p_ids uuid[])
  returns table (
    project_id    uuid,
    delivery_pct  numeric,
    committed_spend numeric,
    budget        numeric
  )
  language sql stable security invoker set search_path = public as $$
  with eff as (
    select
      m.project_id,
      m.weight,
      coalesce(
        m.input_pct,
        count(t.id) filter (where t.status = 'Done') * 100.0 / nullif(count(t.id), 0),
        0
      ) as effective_pct,
      (m.input_pct is not null or count(t.id) > 0) as has_signal
    from project_milestones m
    left join tasks t on t.milestone_id = m.id
                     and t.parent_task_id is null
                     and t.archived_at is null
    where m.project_id = any(p_ids)
    group by m.id
  ),
  committed as (
    select
      p.id as project_id,
      coalesce((select sum(li.budgeted_amount)
                from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                where v.project_id = p.id and v.status = 'Active'), 0) as budget,
      (select case when position.complete then position.amount else null end
       from public.project_pmo_commitment_position(p.id) position) as committed_spend
    from projects p
    where p.id = any(p_ids)

  )
  select
    c.project_id,
    case
      when bool_or(e.has_signal) then sum(e.weight * e.effective_pct) / nullif(sum(e.weight), 0)
      else null
    end as delivery_pct,
    c.committed_spend,
    c.budget
  from committed c
  left join eff e on e.project_id = c.project_id
  group by c.project_id, c.committed_spend, c.budget;
$$;
revoke all     on function get_projects_delivery(uuid[]) from public;
grant  execute on function get_projects_delivery(uuid[]) to   authenticated;
revoke execute on function get_projects_delivery(uuid[]) from anon;
