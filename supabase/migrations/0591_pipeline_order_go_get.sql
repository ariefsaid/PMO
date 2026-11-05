-- 0591_pipeline_order_go_get.sql (#1793 + #1796).
-- Keep the existing org-scoped stage lookup as % Go and add an independently editable % Get
-- value to each opportunity. This is reversible by 0591_pipeline_order_go_get_down.sql.

alter table public.projects
  add column go_probability numeric(4,3) not null default 0.100
    check (go_probability between 0 and 1),
  add column get_probability numeric(4,3) not null default 0.250
    check (get_probability between 0 and 1);

-- projects has column-scoped UPDATE grants; expose only these two user-editable estimates. The
-- existing projects_write RLS policy still limits writes to the caller's org and write roles.
grant update (go_probability, get_probability) on public.projects to authenticated;

-- Capture the independently editable estimates in the project audit history (AC-CHG-011).
update public.record_history_config
set captured = captured || '{"go_probability":"number","get_probability":"number"}'::jsonb
where entity_type = 'project';

update public.projects p
set go_probability = case
      when p.status in ('Won, Pending KoM', 'Loss Tender', 'Declined') then 1.000
      else coalesce(c.win_probability, 0.100)
    end,
    get_probability = case
      when p.status = 'Won, Pending KoM' then 1.000
      when p.status in ('Loss Tender', 'Declined') then 0.000
      else 0.250
    end
from public.pipeline_stage_config c
where c.org_id = p.org_id and c.status = p.status;

update public.projects p
set go_probability = case
      when p.status in ('Won, Pending KoM', 'Loss Tender', 'Declined') then 1.000
      else 0.100
    end,
    get_probability = case
      when p.status = 'Won, Pending KoM' then 1.000
      when p.status in ('Loss Tender', 'Declined') then 0.000
      else 0.250
    end
where not exists (select 1 from public.pipeline_stage_config c where c.org_id=p.org_id and c.status=p.status);

-- Preserve every pre-existing per-org stage value so rollback restores operator-tuned values too.
create table public.pipeline_stage_config_0591_backup (
  org_id uuid not null,
  status public.project_status not null,
  win_probability numeric(4,3) not null,
  primary key (org_id, status)
);
alter table public.pipeline_stage_config_0591_backup enable row level security;
alter table public.pipeline_stage_config_0591_backup force row level security;
insert into public.pipeline_stage_config_0591_backup (org_id, status, win_probability)
select org_id, status, win_probability from public.pipeline_stage_config;
revoke all on public.pipeline_stage_config_0591_backup from public, anon, authenticated;

alter table public.projects
  add constraint projects_terminal_get_probability_check
  check (
    (status not in ('Won, Pending KoM', 'Loss Tender', 'Declined') or go_probability = 1.000)
    and (status <> 'Won, Pending KoM' or get_probability = 1.000)
    and (status not in ('Loss Tender', 'Declined') or get_probability = 0.000)
  );

-- The database remains the authority for terminal probabilities, including transitions from any
-- caller. Reopening a lost opportunity starts from the owner-ruled 25% Get default.
create or replace function public.set_project_probabilities_for_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'Won, Pending KoM' then
    new.go_probability := 1.000;
    new.get_probability := 1.000;
  elsif new.status in ('Loss Tender', 'Declined') then
    new.go_probability := 1.000;
    new.get_probability := 0.000;
  elsif new.status::text = any (public.pipeline_project_statuses()) then
    select c.win_probability into new.go_probability
    from public.pipeline_stage_config c
    where c.org_id = new.org_id and c.status = new.status;
    if not found then
      new.go_probability := case new.status
        when 'Leads' then 0.100
        when 'Quotation Submitted' then 0.200
        when 'PQ Submitted' then 0.400
        when 'Tender Submitted' then 0.800
        when 'Negotiation' then 0.900
      end;
    end if;
    if tg_op = 'UPDATE' and old.status in ('Loss Tender', 'Declined') then
      new.get_probability := 0.250;
    end if;
  end if;
  return new;
end;
$$;

create trigger projects_set_probabilities_for_status
before insert or update of status on public.projects
for each row execute function public.set_project_probabilities_for_status();

-- The org-scoped values are stage defaults. Reset existing rows to the approved defaults and fill
-- missing rows for organizations created before the original seed-org defaults were generalized.
update public.pipeline_stage_config
set win_probability = case status
  when 'Leads' then 0.100
  when 'Quotation Submitted' then 0.200
  when 'PQ Submitted' then 0.400
  when 'Tender Submitted' then 0.800
  when 'Negotiation' then 0.900
  else win_probability
end
where status in ('Leads', 'Quotation Submitted', 'PQ Submitted', 'Tender Submitted', 'Negotiation');

insert into public.pipeline_stage_config (org_id, status, win_probability)
select o.id, s.status, s.win_probability
from public.organizations o
cross join (values
  ('Leads'::public.project_status, 0.100::numeric),
  ('Quotation Submitted'::public.project_status, 0.200::numeric),
  ('PQ Submitted'::public.project_status, 0.400::numeric),
  ('Tender Submitted'::public.project_status, 0.800::numeric),
  ('Negotiation'::public.project_status, 0.900::numeric)
) as s(status, win_probability)
on conflict (org_id, status) do nothing;

update public.projects p
set go_probability = case
      when p.status in ('Won, Pending KoM', 'Loss Tender', 'Declined') then 1.000
      else c.win_probability
    end
from public.pipeline_stage_config c
where c.org_id=p.org_id and c.status=p.status;

-- Newly created organizations receive the same stage defaults. Existing rows stay untouched here;
-- the preceding update records the approved new baseline before the function is replaced.
create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'Quotation Submitted', 0.200),
    (p_org_id, 'PQ Submitted',        0.400),
    (p_org_id, 'Tender Submitted',    0.800),
    (p_org_id, 'Negotiation',         0.900)
  on conflict (org_id, status) do nothing;
$$;

create or replace function public.pipeline_project_statuses()
  returns text[] language sql immutable parallel safe set search_path = ''
as $$
  select array['Leads','Quotation Submitted','PQ Submitted','Tender Submitted','Negotiation']::text[];
$$;

-- Keep transition_project's full security-definer contract and replace only its transition map.
do $$
declare
  v_definition text := pg_get_functiondef(
    'public.transition_project(uuid, public.project_status, text, date, text, text)'::regprocedure
  );
  v_pair text[];
begin
  foreach v_pair slice 1 in array array[
    array['Leads', $old$jsonb_build_array('PQ Submitted','Loss Tender','Internal Project','Declined')$old$,
                  $new$jsonb_build_array('Quotation Submitted','Loss Tender','Internal Project','Declined')$new$],
    array['PQ Submitted', $old$jsonb_build_array('Quotation Submitted','Leads','Loss Tender','Declined')$old$,
                         $new$jsonb_build_array('Tender Submitted','Quotation Submitted','Leads','Loss Tender','Declined')$new$],
    array['Quotation Submitted', $old$jsonb_build_array('Tender Submitted','PQ Submitted','Won, Pending KoM','Loss Tender','Declined')$old$,
                                 $new$jsonb_build_array('PQ Submitted','Won, Pending KoM','Loss Tender','Declined')$new$],
    array['Tender Submitted', $old$jsonb_build_array('Negotiation','Quotation Submitted','Won, Pending KoM','Loss Tender','Declined')$old$,
                              $new$jsonb_build_array('Negotiation','PQ Submitted','Won, Pending KoM','Loss Tender','Declined')$new$]
  ] loop
    if position(v_pair[2] in v_definition) = 0 then
      raise exception '0591 transition map source not found for %', v_pair[1];
    end if;
    v_definition := replace(v_definition, v_pair[2], v_pair[3]);
  end loop;
  execute v_definition;
end;
$$;

-- The aggregate and row projection are both returned from the canonical pipeline RPC. Stage output
-- stays useful to older clients through win_probability (= % Go), while the new fields express both
-- independent inputs and weighted_value uses their product for each project.
create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id, p.name, p.short_name, p.code, p.pmo_project_number,
      p.service_line, p.sector, p.location, p.award_type, p.bidding_entity,
      p.client_id, p.end_client_id, p.status, p.contract_value, p.currency,
      p.tax_treatment, p.tax_rate, p.tax_base_numerator, p.tax_base_denominator,
      p.go_probability, p.get_probability, p.last_update, p.project_manager_id,
      coalesce(stage_change.changed_at, p.created_at) as stage_started_at,
      coalesce(c.win_probability, 0) as stage_go_default
    from public.projects p
    left join public.pipeline_stage_config c on c.org_id = p.org_id and c.status = p.status
    left join lateral (
      select (e.entered_on::timestamp at time zone 'UTC') as changed_at
      from public.project_stage_entries e
      where e.project_id = p.id
      order by e.position desc
      limit 1
    ) stage_change on true
    where p.status::text = any(public.pipeline_project_statuses())
      and p.archived_at is null
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(json_build_object(
        'status', s.status,
        'count', s.cnt,
        'total_value', s.total_value,
        'go_probability', s.stage_go_default,
        'win_probability', s.stage_go_default,
        'weighted_value', s.weighted_value
      ) order by case s.status
        when 'Leads' then 1 when 'Quotation Submitted' then 2 when 'PQ Submitted' then 3
        when 'Tender Submitted' then 4 when 'Negotiation' then 5 else 6 end)
      from (
        select status, count(*)::int as cnt, sum(contract_value) as total_value,
          max(stage_go_default) as stage_go_default,
          sum(contract_value * go_probability * get_probability) as weighted_value
        from pl group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(json_build_object(
        'id', pl.id, 'name', pl.name, 'short_name', pl.short_name, 'code', pl.code,
        'pmo_project_number', pl.pmo_project_number, 'service_line', pl.service_line,
        'sector', pl.sector, 'location', pl.location, 'award_type', pl.award_type,
        'bidding_entity', pl.bidding_entity,
        'client_name', coalesce(nullif(btrim(co.short_name), ''), co.name),
        'client_legal_name', co.name, 'end_client_id', pl.end_client_id,
        'end_client_name', coalesce(nullif(btrim(ec.short_name), ''), ec.name),
        'end_client_legal_name', ec.name, 'status', pl.status,
        'contract_value', pl.contract_value, 'currency', pl.currency,
        'tax_treatment', pl.tax_treatment, 'tax_rate', pl.tax_rate,
        'tax_base_numerator', pl.tax_base_numerator, 'tax_base_denominator', pl.tax_base_denominator,
        'go_probability', pl.go_probability, 'get_probability', pl.get_probability,
        'win_probability', pl.go_probability * pl.get_probability,
        'last_update', pl.last_update, 'stage_started_at', pl.stage_started_at,
        'pm_name', pm.full_name
      ) order by pl.contract_value desc)
      from pl
      left join public.companies co on co.id = pl.client_id
      left join public.companies ec on ec.id = pl.end_client_id
      left join public.profiles pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

revoke all on function public.get_sales_pipeline() from public, anon;
grant execute on function public.get_sales_pipeline() to authenticated;

-- Dashboard forecast uses the same two probabilities as the Sales Pipeline.
do $$
declare
  v_definition text := pg_get_functiondef('public.get_executive_dashboard()'::regprocedure);
  v_old text := 'sum(contract_value*win_prob) as weighted_value';
  v_new text := 'sum(contract_value*go_probability*get_probability) as weighted_value';
begin
  if position(v_old in v_definition) = 0 then
    raise exception '0591 dashboard weighted-value source not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

notify pgrst, 'reload schema';
