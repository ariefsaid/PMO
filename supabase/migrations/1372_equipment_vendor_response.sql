-- 1372_equipment_vendor_response.sql — #2702: the recorded time a rental vendor responded to an equipment breakdown.
-- Spec: docs/specs/equipment-vendor-response.spec.md; plan docs/plans/2026-11-21-equipment-vendor-response.md.
-- A breakdown is the derived downtime period (1033 equipment_downtime_days), keyed (asset_id, period_start).
-- Writes are RPC-only (1373): no INSERT/UPDATE/DELETE grant, so the recorder, the recording time and the date rules
-- cannot be forged from the client. Proven by supabase/tests/equipment_vendor_response.test.sql.
-- Reverse: rollback/1372_equipment_vendor_response_down.sql
create table public.equipment_vendor_responses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  asset_id     uuid not null references public.equipment_assets(id) on delete restrict,
  period_start date not null,
  vendor_id    uuid not null references public.companies(id) on delete restrict,
  reported_at  timestamptz not null,
  responded_at timestamptz not null,
  note         text check (note is null or char_length(note) <= 500),
  recorded_by  uuid references public.profiles(id) default auth.uid(),
  recorded_at  timestamptz not null default now(),
  constraint equipment_vendor_response_one_per_breakdown unique (asset_id, period_start),
  constraint equipment_vendor_response_order check (responded_at >= reported_at)
);
create index equipment_vendor_responses_org on public.equipment_vendor_responses (org_id, period_start);
create index equipment_vendor_responses_vendor on public.equipment_vendor_responses (vendor_id);

alter table public.equipment_vendor_responses enable row level security;
alter table public.equipment_vendor_responses force row level security;
create policy equipment_vendor_responses_select on public.equipment_vendor_responses for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Project Manager','Finance','Executive','Engineer'));

revoke all on public.equipment_vendor_responses from public, anon, authenticated;
grant select on public.equipment_vendor_responses to authenticated;
grant all on public.equipment_vendor_responses to service_role;
