-- 1355_payment_channel_schema.sql — #2698: payment channel on a purchase request (how it will be paid).
-- Spec docs/specs/purchase-payment-channel.spec.md · Plan docs/plans/2026-11-21-purchase-payment-channel.md.
-- Proven by supabase/tests/payment_channel.test.sql (+ the 0178 allow-list). RPCs are in 1356.
--
-- Off for every existing organisation: no settings row means off, and the new column is NULL and unread.
-- The channel list is organisation data an Admin manages; the code never branches on a name.
-- The column is RPC-only: the procurements update grant (0010) is an explicit column list and this migration adds nothing.
-- Rollback: rollback/1355_payment_channel_schema_down.sql

create table public.org_payment_channel_settings (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  enabled    boolean not null default false,
  enabled_at timestamptz,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint org_payment_channel_settings_enabled_at check (not enabled or enabled_at is not null)
);
comment on table public.org_payment_channel_settings is
  '#2698: whether the organisation records a payment channel on purchase requests. No row = off.';

create table public.org_payment_channels (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  archived_at timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  constraint org_payment_channels_name_len check (name = btrim(name) and char_length(name) between 1 and 60),
  unique (id, org_id)
);
create unique index org_payment_channels_live_name_uq
  on public.org_payment_channels (org_id, lower(name)) where archived_at is null;
comment on table public.org_payment_channels is
  '#2698: the organisation''s own list of ways a purchase can be paid. Archived, never deleted (ADR-0018).';

alter table public.procurements
  add column payment_channel_id uuid references public.org_payment_channels(id) on delete restrict;
create index procurements_payment_channel_idx on public.procurements (payment_channel_id) where payment_channel_id is not null;

alter table public.org_payment_channel_settings enable row level security;
alter table public.org_payment_channel_settings force  row level security;
create policy org_payment_channel_settings_select on public.org_payment_channel_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

alter table public.org_payment_channels enable row level security;
alter table public.org_payment_channels force  row level security;
create policy org_payment_channels_select on public.org_payment_channels for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

revoke all on public.org_payment_channel_settings, public.org_payment_channels from public, anon, authenticated;
grant select on public.org_payment_channel_settings, public.org_payment_channels to authenticated;
