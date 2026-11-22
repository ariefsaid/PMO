-- 1820_incident_types.sql — issue-closing-measure: the organisation's own kept list of issue types.
-- Spec: docs/specs/issue-closing-measure.spec.md (FR-ICM-001, 005). Plan: docs/plans/2026-11-22-issue-closing-measure.md.
-- Pattern: cost_disciplines (0950). Every active member reads; an Admin adds, renames and archives (soft-archive, ADR-0018).
-- A new organisation gets exactly one generic entry, "Other"; existing organisations get their list in 1821 from their own issues.
-- Proven by supabase/tests/1820_incident_types.test.sql. Reverse: rollback/1820_incident_types_down.sql.

create table public.incident_types (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 80),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
-- One live label per organisation, case-insensitive; an archived label can be reused.
create unique index incident_types_label_live on public.incident_types (org_id, lower(btrim(label))) where archived_at is null;
create index incident_types_org_idx on public.incident_types (org_id, label);
create trigger incident_types_stamp_org_id before insert on public.incident_types
  for each row execute function public.stamp_org_id();

alter table public.incident_types enable row level security;
alter table public.incident_types force row level security;

create policy incident_types_select on public.incident_types for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy incident_types_insert on public.incident_types for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy incident_types_update on public.incident_types for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()));

revoke all on public.incident_types from public, anon, authenticated;
grant select on public.incident_types to authenticated;
grant insert (label) on public.incident_types to authenticated;
grant update (label, archived_at) on public.incident_types to authenticated;
grant all on public.incident_types to service_role;

-- A new organisation: exactly one generic entry so issues can be raised; the Admin adds the rest.
create function public.incident_types_seed_new_org() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.incident_types (org_id, label) values (new.id, 'Other') on conflict do nothing;
  return new;
end $$;
revoke all on function public.incident_types_seed_new_org() from public, anon, authenticated;
create trigger organizations_incident_types_seed after insert on public.organizations
  for each row execute function public.incident_types_seed_new_org();
