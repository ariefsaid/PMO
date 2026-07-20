-- 0107_external_project_bindings_audit_cols.sql
-- Add linked_by, linked_at, disconnected_at to external_project_bindings (mirrors 0104 pattern for external_org_bindings)
-- AC-EAC-014, AC-EAC-015
-- Reversibility: supabase db reset. Manual reverse:
--   alter table public.external_project_bindings drop column if exists linked_by;
--   alter table public.external_project_bindings drop column if exists linked_at;
--   alter table public.external_project_bindings drop column if exists disconnected_at;

alter table public.external_project_bindings
  add column if not exists linked_by uuid,
  add column if not exists linked_at timestamptz,
  add column if not exists disconnected_at timestamptz;

comment on column public.external_project_bindings.linked_by is 'User who linked the project (auth.uid() at link time)';
comment on column public.external_project_bindings.linked_at is 'When the project was linked';
comment on column public.external_project_bindings.disconnected_at is 'When the project was unlinked (soft-archive, tombstone retained)';