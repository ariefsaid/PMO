-- Optional PMO display enhancement; the legal identity stays in companies.name.
-- Rollback: restore the three dashboard functions from 0044/0022/0223, then
-- alter table public.companies drop column short_name; the native guard is unchanged.
alter table public.companies add column short_name text;
comment on column public.companies.short_name is 'Optional PMO display name; separate from the legal name and project-number segments.';

-- Native fields stay pinned. Additive PMO fields (including numbering enhancements)
-- remain editable under the existing row-level write policy.
create or replace function public.companies_native_mirror_guard()
  returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' and public.domain_externally_owned(new.org_id, 'companies') then
    return new;
  end if;
  if old.type = 'Internal' and new.type = 'Internal' then
    return new;
  end if;
  if public.domain_externally_owned(new.org_id, 'companies') then
    if new.name is distinct from old.name
       or new.type is distinct from old.type
       or new.erp_party_type is distinct from old.erp_party_type
       or new.erp_supplier_name is distinct from old.erp_supplier_name
       or new.erp_customer_name is distinct from old.erp_customer_name
       or new.erp_tax_id is distinct from old.erp_tax_id
       or new.erp_payment_terms_days is distinct from old.erp_payment_terms_days
       or new.erp_cancelled_at is distinct from old.erp_cancelled_at
       or new.erp_docstatus is distinct from old.erp_docstatus
       or new.erp_modified is distinct from old.erp_modified
       or new.erp_amended_from is distinct from old.erp_amended_from
    then
      raise exception 'company native fields are read-only while companies are externally-owned'
        using errcode = '42501';
    end if;
  end if;
  return new;
end; $$;

create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.client_id,
      p.end_client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.tax_treatment,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',              pl.id,
          'name',            pl.name,
          'client_name',     coalesce(nullif(btrim(co.short_name), ''), co.name),
          'client_legal_name', co.name,
          'end_client_id',   pl.end_client_id,
          'end_client_name', coalesce(nullif(btrim(ec.short_name), ''), ec.name),
          'end_client_legal_name', ec.name,
          'status',          pl.status,
          'contract_value',  pl.contract_value,
          'currency',        pl.currency,
          'tax_treatment',   pl.tax_treatment,
          'win_probability', pl.win_prob,
          'last_update',     pl.last_update,
          'pm_name',         pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join companies ec on ec.id = pl.end_client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;


comment on function public.get_sales_pipeline() is 'Latest definition: 0226; projects carry display and legal client/end-customer names.';
revoke all on function public.get_sales_pipeline() from public;
grant execute on function public.get_sales_pipeline() to authenticated;
revoke execute on function public.get_sales_pipeline() from anon;

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

create or replace function get_finance_budget_review()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select coalesce((
    select json_agg(r order by r.variance desc)
    from (
      select
        p.id,
        p.name,
        coalesce(nullif(btrim(c.short_name), ''), c.name) as client_name,
        p.budget,
        coalesce((select sum(pr.total_value) from procurements pr
                   where pr.project_id = p.id
                     and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0) as spent,
        (coalesce((select sum(pr.total_value) from procurements pr
                    where pr.project_id = p.id
                      and pr.status in ('Ordered','Received','Vendor Invoiced','Paid')), 0)
          - p.budget) as variance
      from projects p
      left join companies c on c.id = p.client_id
      where p.budget > 0
    ) r
  ), '[]'::json);
$$;
revoke all on function get_finance_budget_review() from public;
grant execute on function get_finance_budget_review() to authenticated;
revoke execute on function get_finance_budget_review() from anon;
