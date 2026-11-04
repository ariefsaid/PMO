-- 0591_pipeline_order_go_get_down.sql — restore the prior transition map, RPC and stage defaults.

do $$
declare
  v_definition text := pg_get_functiondef(
    'public.transition_project(uuid, public.project_status, text, date, text, text)'::regprocedure
  );
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[
    array['Leads', $new$jsonb_build_array('Quotation Submitted','Loss Tender','Internal Project','Declined')$new$,
                  $old$jsonb_build_array('PQ Submitted','Loss Tender','Internal Project','Declined')$old$],
    array['PQ Submitted', $new$jsonb_build_array('Tender Submitted','Quotation Submitted','Leads','Loss Tender','Declined')$new$,
                         $old$jsonb_build_array('Quotation Submitted','Leads','Loss Tender','Declined')$old$],
    array['Quotation Submitted', $new$jsonb_build_array('PQ Submitted','Won, Pending KoM','Loss Tender','Declined')$new$,
                                 $old$jsonb_build_array('Tender Submitted','PQ Submitted','Won, Pending KoM','Loss Tender','Declined')$old$],
    array['Tender Submitted', $new$jsonb_build_array('Negotiation','PQ Submitted','Won, Pending KoM','Loss Tender','Declined')$new$,
                              $old$jsonb_build_array('Negotiation','Quotation Submitted','Won, Pending KoM','Loss Tender','Declined')$old$]
  ] loop
    if position(v_pair[2] in v_definition) = 0 then
      raise exception '0591 rollback transition-map source not found for %', v_pair[1];
    end if;
    v_definition := replace(v_definition, v_pair[2], v_pair[3]);
  end loop;
  execute v_definition;
end;
$$;

create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select p.id, p.name, p.short_name, p.code, p.pmo_project_number,
      p.service_line,p.sector,p.location,p.award_type,p.bidding_entity,
      p.client_id,p.end_client_id,p.status,p.contract_value,p.currency,
      p.tax_treatment,p.tax_rate,p.tax_base_numerator,p.tax_base_denominator,
      p.last_update,p.project_manager_id,
      coalesce(stage_change.changed_at, p.created_at) as stage_started_at,
      coalesce(c.win_probability, 0) as win_prob
    from public.projects p
    left join public.pipeline_stage_config c on c.org_id=p.org_id and c.status=p.status
    left join lateral (
      select (e.entered_on::timestamp at time zone 'UTC') as changed_at
      from public.project_stage_entries e where e.project_id=p.id
      order by e.position desc limit 1
    ) stage_change on true
    where p.status::text=any(public.pipeline_project_statuses()) and p.archived_at is null
  )
  select json_build_object(
    'stages', coalesce((select json_agg(json_build_object(
      'status',s.status,'count',s.cnt,'total_value',s.total_value,
      'win_probability',s.win_prob,'weighted_value',s.total_value*s.win_prob
    ) order by s.status) from (
      select status,count(*)::int as cnt,sum(contract_value) as total_value,max(win_prob) as win_prob
      from pl group by status
    ) s),'[]'::json),
    'projects', coalesce((select json_agg(json_build_object(
      'id',pl.id,'name',pl.name,'short_name',pl.short_name,'code',pl.code,
      'pmo_project_number',pl.pmo_project_number,'service_line',pl.service_line,
      'sector',pl.sector,'location',pl.location,'award_type',pl.award_type,
      'bidding_entity',pl.bidding_entity,
      'client_name',coalesce(nullif(btrim(co.short_name),''),co.name),
      'client_legal_name',co.name,'end_client_id',pl.end_client_id,
      'end_client_name',coalesce(nullif(btrim(ec.short_name),''),ec.name),
      'end_client_legal_name',ec.name,'status',pl.status,'contract_value',pl.contract_value,
      'currency',pl.currency,'tax_treatment',pl.tax_treatment,'tax_rate',pl.tax_rate,
      'tax_base_numerator',pl.tax_base_numerator,'tax_base_denominator',pl.tax_base_denominator,
      'win_probability',pl.win_prob,'last_update',pl.last_update,
      'stage_started_at',pl.stage_started_at,'pm_name',pm.full_name
    ) order by pl.contract_value desc) from pl
      left join public.companies co on co.id=pl.client_id
      left join public.companies ec on ec.id=pl.end_client_id
      left join public.profiles pm on pm.id=pl.project_manager_id),'[]'::json)
  );
$$;
revoke all on function public.get_sales_pipeline() from public, anon;
grant execute on function public.get_sales_pipeline() to authenticated;

do $$
declare
  v_definition text := pg_get_functiondef('public.get_executive_dashboard()'::regprocedure);
  v_old text := 'sum(contract_value*go_probability*get_probability) as weighted_value';
  v_new text := 'sum(contract_value*win_prob) as weighted_value';
begin
  if position(v_old in v_definition) = 0 then
    raise exception '0591 rollback dashboard weighted-value source not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

update public.pipeline_stage_config c
set win_probability = b.win_probability
from public.pipeline_stage_config_0591_backup b
where c.org_id=b.org_id and c.status=b.status;
delete from public.pipeline_stage_config c
where not exists (
  select 1 from public.pipeline_stage_config_0591_backup b
  where b.org_id=c.org_id and b.status=c.status
);
drop table public.pipeline_stage_config_0591_backup;

create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'PQ Submitted',        0.250),
    (p_org_id, 'Quotation Submitted', 0.400),
    (p_org_id, 'Tender Submitted',    0.500),
    (p_org_id, 'Negotiation',         0.750)
  on conflict (org_id, status) do nothing;
$$;

create or replace function public.pipeline_project_statuses()
  returns text[] language sql immutable parallel safe set search_path = ''
as $$
  select array['Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation']::text[];
$$;

drop trigger projects_set_probabilities_for_status on public.projects;
drop function public.set_project_probabilities_for_status();
alter table public.projects drop constraint projects_terminal_get_probability_check;
update public.record_history_config
set captured = captured - 'go_probability' - 'get_probability'
where entity_type = 'project';
revoke update (go_probability, get_probability) on public.projects from authenticated;
alter table public.projects drop column go_probability;
alter table public.projects drop column get_probability;

notify pgrst, 'reload schema';
