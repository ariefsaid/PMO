-- 2740_stage_list_labels.sql: #2906 slice 1. The sales and project stage list becomes an organisation
-- setting: one pipeline_stage_config row per stage key, with an optional name per language.
-- The stored stage key (project_status) never changes; a blank name means the shipped wording.
-- Reversal: supabase/migrations/rollback/2740_stage_list_labels_down.sql.

alter table public.pipeline_stage_config
  alter column win_probability drop not null,
  add column label_en text,
  add column label_id text,
  add constraint pipeline_stage_config_label_en_check
    check (label_en is null or (char_length(label_en) between 1 and 40 and label_en = btrim(label_en))),
  add constraint pipeline_stage_config_label_id_check
    check (label_id is null or (char_length(label_id) between 1 and 40 and label_id = btrim(label_id))),
  -- Readers use the probability on the pipeline stages only; those five must keep one.
  add constraint pipeline_stage_config_pipeline_probability_check
    check (win_probability is not null
           or status not in ('Leads','Quotation Submitted','PQ Submitted','Tender Submitted','Negotiation'));

comment on column public.pipeline_stage_config.label_en is
  '#2906: the organisation''s English name for this stage; null = the shipped wording.';
comment on column public.pipeline_stage_config.label_id is
  '#2906: the organisation''s Bahasa Indonesia name for this stage; null = the shipped wording.';

-- Every existing organisation gets a row for the seven stages outside the pipeline (no probability).
insert into public.pipeline_stage_config (org_id, status, win_probability)
select o.id, s.status, null
from public.organizations o
cross join unnest(enum_range(null::public.project_status)) as s(status)
where not (s.status::text = any (public.pipeline_project_statuses()))
on conflict (org_id, status) do nothing;

-- Restated from 0591_pipeline_order_go_get.sql:140 (latest); adds the seven non-pipeline rows and the
-- house search_path. create or replace keeps 0213's ACL (revoked from public, anon, authenticated).
create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  -- drops: the closing parenthesis of the old five-row list (0591's Negotiation line); the seven non-pipeline rows follow it.
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'Quotation Submitted', 0.200),
    (p_org_id, 'PQ Submitted',        0.400),
    (p_org_id, 'Tender Submitted',    0.800),
    (p_org_id, 'Negotiation',         0.900),
    (p_org_id, 'Won, Pending KoM',    null),
    (p_org_id, 'Ongoing Project',     null),
    (p_org_id, 'On Hold',             null),
    (p_org_id, 'Close Out',           null),
    (p_org_id, 'Loss Tender',         null),
    (p_org_id, 'Declined',            null),
    (p_org_id, 'Internal Project',    null)
  on conflict (org_id, status) do nothing;
$$;
revoke all on function public.seed_org_defaults(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
