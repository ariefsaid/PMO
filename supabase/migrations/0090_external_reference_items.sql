-- 0088_external_reference_items.sql — the synthetic reference domain's read-model (OD-4, FR-EAS-037,
-- AC-EAS-035). org-scoped; the write-policy FLIP denies user-JWT writes WHILE 'reference' is externally-
-- owned for the org (domain_externally_owned, 0087) and permits only the dispatch/sync service role.
-- When 'reference' is PMO-owned the normal member-write path applies (the flip is per-org — ADR-0055 §3).
-- Reversibility (ADR-0006): supabase db reset. Manual:
--   drop policy if exists external_reference_items_select on public.external_reference_items;
--   drop policy if exists external_reference_items_write  on public.external_reference_items;
--   drop table if exists public.external_reference_items;

create table public.external_reference_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  pmo_record_id text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (org_id, pmo_record_id)
);
create index external_reference_items_org_idx on public.external_reference_items (org_id);

alter table public.external_reference_items enable row level security;
alter table public.external_reference_items force  row level security;

create policy external_reference_items_select on public.external_reference_items
  for select using (org_id = public.auth_org_id() and public.is_active_member());

create policy external_reference_items_write on public.external_reference_items
  for all using (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and not public.domain_externally_owned(public.auth_org_id(), 'reference'))
  with check (
    org_id = public.auth_org_id()
    and public.is_active_member()
    and not public.domain_externally_owned(public.auth_org_id(), 'reference'));

grant select, insert, update, delete on public.external_reference_items to authenticated;
grant select, insert, update, delete on public.external_reference_items to anon;
