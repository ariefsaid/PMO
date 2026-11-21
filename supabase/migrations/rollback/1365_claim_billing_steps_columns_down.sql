-- 1365 down.
create or replace function public.instantiate_claim_billing_stages() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'progress' then return new; end if;
  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.client_side, t.target_days, t.optional,
         case when t.position = (select min(t2.position) from public.billing_stage_templates t2 where t2.project_id = new.project_id)
              then public.native_org_today(new.org_id) end
    from public.billing_stage_templates t
   where t.project_id = new.project_id and t.org_id = new.org_id;
  insert into public.claim_billing_stage_documents (org_id, stage_id, claim_id, position, name, required)
  select new.org_id, s.id, new.id, d.position, d.name, d.required
    from public.claim_billing_stages s
    join public.billing_stage_templates t on t.project_id = new.project_id and t.position = s.position
    join public.billing_stage_template_documents d on d.template_id = t.id
   where s.claim_id = new.id;
  return new;
end; $$;
revoke all on function public.instantiate_claim_billing_stages() from public, anon, authenticated;
drop table if exists public.billing_step_template_documents;
drop table if exists public.billing_step_template_steps;
drop table if exists public.billing_step_templates;
drop index if exists public.claim_billing_stages_overdue_idx;
create index claim_billing_stages_overdue_idx on public.claim_billing_stages (project_id)
  where completed_on is null and skipped_on is null and target_days is not null and overdue_notified_at is null;
drop index if exists public.claim_billing_stages_waiting_idx;
alter table public.claim_billing_stages drop constraint claim_billing_stages_claim_id_position_key;
alter table public.claim_billing_stages add constraint claim_billing_stages_claim_id_position_key unique (claim_id, position);
alter table public.claim_billing_stages drop column target_on, drop column owner_role;
alter table public.billing_stage_templates drop column owner_role;
