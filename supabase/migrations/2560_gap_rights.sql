-- Scoped job-role rights; existing policies, column grants and field-account restrictions remain in force.
create policy equipment_officer_insert on public.equipment_assets for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_holds_job_role('equipment_officer')));
create policy equipment_officer_update on public.equipment_assets for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_holds_job_role('equipment_officer')))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.actor_holds_job_role('equipment_officer')));
create policy rate_catalogue_items_pcm_read on public.rate_catalogue_items for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and (select public.actor_holds_job_role('project_control_manager')));
create policy rate_catalogue_variants_pcm_read on public.rate_catalogue_variants for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and (select public.actor_holds_job_role('project_control_manager')));
