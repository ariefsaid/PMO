-- 0086_external_refs.sql — PMO record id ↔ external record id mapping (FR-EAS-040..043, AC-EAS-040/041).
-- Machine-written only (dispatch/sync service role); org-isolated on read. Minimal mapping (OQ-2: no
-- last-synced richness in P0). Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop policy if exists external_refs_select on public.external_refs; drop table if exists public.external_refs;

create table public.external_refs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                       references public.organizations(id) on delete cascade,
  domain             text not null,
  pmo_record_id      text not null,
  external_tier      text not null,
  external_record_id text not null,
  created_at         timestamptz not null default now(),
  unique (org_id, domain, pmo_record_id)
);
create index external_refs_org_domain_ext_idx on public.external_refs (org_id, domain, external_record_id);
create index external_refs_org_idx             on public.external_refs (org_id);

alter table public.external_refs enable row level security;
alter table public.external_refs force  row level security;

-- READ: own-org members (FR-EAS-041, AC-EAS-040).
create policy external_refs_select on public.external_refs
  for select using (org_id = public.auth_org_id() and public.is_active_member());

-- WRITE: machine-only. NO insert/update/delete policy for authenticated/anon ⇒ default-deny for every
-- user JWT (FR-EAS-042, AC-EAS-041); only service_role (RLS bypass) writes during dispatch/sync.

-- Client-role grants (auto_expose=false): members SELECT only; NO write grant.
grant select on public.external_refs to authenticated;
grant select on public.external_refs to anon;
