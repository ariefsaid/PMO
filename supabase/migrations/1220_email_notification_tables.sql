-- 1220_email_notification_tables.sql — #2711: email as a second delivery channel for notifications.
-- Tables only. Settings are read by an Admin and written through RPCs (1223); a user reads/writes only their own opt-out;
-- the outbox has no client policy (service role and definer functions only). Every event is OFF until an org turns it on.
-- Reverse: rollback/1220_email_notification_tables_down.sql

create table public.email_event_settings (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  event_key   text not null check (event_key in ('approval_request','billing_step','overdue_item','document_expiry')),
  enabled     boolean not null default false,
  extra_roles text[] not null default '{}' check (cardinality(extra_roles) <= 30),
  updated_at  timestamptz not null default now(),
  primary key (org_id, event_key)
);

create table public.email_org_settings (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  locale     text not null default 'en' check (locale in ('en','id')),
  updated_at timestamptz not null default now()
);

create table public.email_user_prefs (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  opted_out  boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.email_outbox (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  event_key       text not null,
  status          text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts        integer not null default 0,
  lease_until     timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (notification_id, recipient_id)
);
create index email_outbox_claim_idx on public.email_outbox (created_at) where status in ('pending','sending');

alter table public.email_event_settings enable row level security;
alter table public.email_event_settings force row level security;
alter table public.email_org_settings   enable row level security;
alter table public.email_org_settings   force row level security;
alter table public.email_user_prefs     enable row level security;
alter table public.email_user_prefs     force row level security;
alter table public.email_outbox         enable row level security;
alter table public.email_outbox         force row level security;

revoke all on public.email_event_settings, public.email_org_settings, public.email_user_prefs, public.email_outbox from public, anon, authenticated;
grant select on public.email_event_settings, public.email_org_settings, public.email_user_prefs to authenticated;
grant all on public.email_event_settings, public.email_org_settings, public.email_user_prefs, public.email_outbox to service_role;

create policy email_event_settings_admin_read on public.email_event_settings for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) = 'Admin' and (select public.is_active_member()));
create policy email_org_settings_admin_read on public.email_org_settings for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) = 'Admin' and (select public.is_active_member()));
create policy email_user_prefs_own_read on public.email_user_prefs for select to authenticated
  using (user_id = (select auth.uid()) and org_id = (select public.auth_org_id()) and (select public.is_active_member()));
