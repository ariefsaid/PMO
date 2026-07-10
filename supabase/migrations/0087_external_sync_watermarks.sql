-- 0087_external_sync_watermarks.sql — modified-since cursor storage (FR-EAS-050..052, AC-EAS-050).
-- Machine-written only; org-isolated read; EXACTLY ONE row per (org, tier, domain) via the unique key.
-- P0 = storage + RLS only (the sweep engine is P1). Reversibility (ADR-0006): supabase db reset. Manual:
--   drop policy if exists external_sync_watermarks_select on public.external_sync_watermarks;
--   drop table if exists public.external_sync_watermarks;

create table public.external_sync_watermarks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                     references public.organizations(id) on delete cascade,
  external_tier    text not null,
  domain           text not null,
  watermark_cursor text not null default '',
  updated_at       timestamptz not null default now(),
  unique (org_id, external_tier, domain)
);
create index external_sync_watermarks_org_idx on public.external_sync_watermarks (org_id);

alter table public.external_sync_watermarks enable row level security;
alter table public.external_sync_watermarks force  row level security;

create policy external_sync_watermarks_select on public.external_sync_watermarks
  for select using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: machine-only — NO write policy for authenticated/anon (default-deny); service_role only.

grant select on public.external_sync_watermarks to authenticated;
grant select on public.external_sync_watermarks to anon;
