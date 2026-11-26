-- Reverses 2740_stage_list_labels.sql: back to 0591's five-row stage table and seed function.
delete from public.pipeline_stage_config where win_probability is null;
alter table public.pipeline_stage_config
  drop constraint pipeline_stage_config_pipeline_probability_check,
  drop constraint pipeline_stage_config_label_en_check,
  drop constraint pipeline_stage_config_label_id_check,
  drop column label_en,
  drop column label_id,
  alter column win_probability set not null;
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
revoke all on function public.seed_org_defaults(uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
