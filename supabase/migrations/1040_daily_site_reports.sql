-- 1040_daily_site_reports.sql — #1522: daily site report per work order (tables, RLS, photo bucket).
-- Spec: docs/specs/daily-site-report.spec.md. Plan: docs/plans/2026-11-20-daily-site-report.md.
-- Every write goes through the security-definer RPCs in 1041: these tables grant authenticated SELECT only
-- (plus the photo rows, written under RLS while the report is still editable). org_id is stamped by
-- stamp_org_id / the RPCs, never sent by the client.
-- Proven by supabase/tests/dsr_report.test.sql.
-- Reversal: rollback/1040_daily_site_reports_down.sql.

-- ── organisation lists (FR-DSR-003/004): Admin-maintained, archivable ─────────────────────────────────
create table public.dsr_idle_reasons (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 80),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index dsr_idle_reasons_label on public.dsr_idle_reasons (org_id, lower(btrim(label)));

create table public.dsr_weather_conditions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 80),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index dsr_weather_conditions_label on public.dsr_weather_conditions (org_id, lower(btrim(label)));

-- ── the report (FR-DSR-001, 013..019) ──────────────────────────────────────────────────────────────
create table public.daily_site_reports (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  project_id        uuid not null references public.projects(id),
  work_order_id     uuid not null references public.work_orders(id),
  work_date         date not null,
  status            text not null default 'draft' check (status in ('draft','submitted','validated','returned')),
  version           integer not null default 1 check (version >= 1),
  supersedes_id     uuid unique references public.daily_site_reports(id),
  superseded_at     timestamptz,
  correction_reason text check (correction_reason is null or char_length(btrim(correction_reason)) between 1 and 500),
  author_id         uuid not null references public.profiles(id),
  submitted_at      timestamptz,
  validated_by      uuid references public.profiles(id),
  validated_at      timestamptz,
  returned_reason   text check (returned_reason is null or char_length(returned_reason) <= 500),
  client_request_id uuid,
  variant_id        uuid references public.rate_catalogue_variants(id),
  start_time        time,
  end_time          time,
  total_minutes     integer generated always as (
                      case when start_time is null or end_time is null then null
                           else ((extract(epoch from (end_time - start_time))::integer / 60) + 1440) % 1440 end) stored,
  weather_id        uuid references public.dsr_weather_conditions(id),
  weather_note      text check (weather_note is null or char_length(weather_note) <= 500),
  note              text check (note is null or char_length(note) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz,
  -- FR-DSR-015, defence in depth under dsr_validate's own refusal.
  constraint daily_site_reports_sod check (validated_by is null or validated_by <> author_id),
  constraint daily_site_reports_validated_stamped check ((status = 'validated') = (validated_by is not null and validated_at is not null)),
  constraint daily_site_reports_correction_pair check ((supersedes_id is null) = (correction_reason is null)),
  constraint daily_site_reports_supersede_validated check (superseded_at is null or status = 'validated')
);
-- FR-DSR-019: one original report per work order and date (a correction carries supersedes_id instead).
create unique index daily_site_reports_one_per_day on public.daily_site_reports (work_order_id, work_date)
  where supersedes_id is null and archived_at is null;
-- NFR-DSR-004: an idempotent create.
create unique index daily_site_reports_client_request on public.daily_site_reports (org_id, client_request_id)
  where client_request_id is not null;
create index daily_site_reports_wo_date on public.daily_site_reports (work_order_id, work_date);
create index daily_site_reports_org_status on public.daily_site_reports (org_id, status, submitted_at);
create index daily_site_reports_project_date on public.daily_site_reports (org_id, project_id, work_date desc, id desc);
create index daily_site_reports_author on public.daily_site_reports (author_id);

create table public.dsr_progress_lines (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  report_id          uuid not null references public.daily_site_reports(id) on delete cascade,
  position           integer not null check (position >= 1),
  work_order_line_id uuid not null references public.work_order_lines(id),
  sub_stage          text check (sub_stage is null or char_length(btrim(sub_stage)) between 1 and 80),
  quantity           numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  unit               text not null,
  -- FR-DSR-011: frozen at validation, null before.
  frozen_rate        numeric(24,8),
  frozen_rate_id     uuid references public.rate_catalogue_rates(id),
  frozen_rate_source text check (frozen_rate_source is null or frozen_rate_source in ('catalogue','contract')),
  frozen_amount      numeric(16,2),
  frozen_at          timestamptz,
  unique (report_id, position)
);
create index dsr_progress_lines_report on public.dsr_progress_lines (report_id);
create index dsr_progress_lines_wo_line on public.dsr_progress_lines (work_order_line_id);

create table public.dsr_idle_periods (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null references public.daily_site_reports(id) on delete cascade,
  position  integer not null check (position >= 1),
  minutes   integer not null check (minutes between 1 and 1440),
  reason_id uuid not null references public.dsr_idle_reasons(id),
  unique (report_id, position)
);
create index dsr_idle_periods_reason on public.dsr_idle_periods (reason_id);

-- FR-DSR-005 / OD-DSR-6: a record of use only; nothing here posts stock.
create table public.dsr_consumables (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  report_id     uuid not null references public.daily_site_reports(id) on delete cascade,
  position      integer not null check (position >= 1),
  stock_item_id uuid not null references public.stock_items(id),
  quantity      numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  unit          text not null,
  unique (report_id, position)
);
create index dsr_consumables_item on public.dsr_consumables (stock_item_id);

-- FR-DSR-008: photos of the paper form and other site photos, in the private bucket below.
create table public.dsr_photos (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  report_id      uuid not null references public.daily_site_reports(id) on delete cascade,
  kind           text not null default 'paper_form' check (kind in ('paper_form','other')),
  file_path      text not null check (char_length(file_path) between 1 and 400),
  uploaded_by_id uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now()
);
create index dsr_photos_report on public.dsr_photos (report_id, created_at);
create index dsr_photos_uploader on public.dsr_photos (uploaded_by_id);

-- FR-DSR-016: every transition and its reason.
create table public.dsr_events (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null references public.daily_site_reports(id) on delete cascade,
  action    text not null check (action in ('created','submitted','validated','returned','corrected','superseded')),
  actor_id  uuid references public.profiles(id),
  reason    text check (reason is null or char_length(reason) <= 500),
  at        timestamptz not null default clock_timestamp()
);
create index dsr_events_report on public.dsr_events (report_id, at, id);
create index dsr_events_actor on public.dsr_events (actor_id);

-- ── org stamp, RLS, grants ─────────────────────────────────────────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['dsr_idle_reasons','dsr_weather_conditions','daily_site_reports','dsr_progress_lines',
                           'dsr_idle_periods','dsr_consumables','dsr_photos','dsr_events'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_org_id()', t || '_stamp_org_id', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Lists: every active member reads (the form's pickers); the Admin keeps them.
create policy dsr_idle_reasons_select on public.dsr_idle_reasons for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy dsr_idle_reasons_admin_insert on public.dsr_idle_reasons for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy dsr_idle_reasons_admin_update on public.dsr_idle_reasons for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy dsr_weather_conditions_select on public.dsr_weather_conditions for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy dsr_weather_conditions_admin_insert on public.dsr_weather_conditions for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy dsr_weather_conditions_admin_update on public.dsr_weather_conditions for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
grant insert (label) on public.dsr_idle_reasons to authenticated;
grant update (label, archived_at) on public.dsr_idle_reasons to authenticated;
grant insert (label) on public.dsr_weather_conditions to authenticated;
grant update (label, archived_at) on public.dsr_weather_conditions to authenticated;

-- Reports: any active member of the organisation reads them (evidence, no money columns on the header).
create policy daily_site_reports_select on public.daily_site_reports for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy dsr_progress_lines_select on public.dsr_progress_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.daily_site_reports r where r.id = dsr_progress_lines.report_id));
create policy dsr_idle_periods_select on public.dsr_idle_periods for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.daily_site_reports r where r.id = dsr_idle_periods.report_id));
create policy dsr_consumables_select on public.dsr_consumables for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.daily_site_reports r where r.id = dsr_consumables.report_id));
create policy dsr_events_select on public.dsr_events for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.daily_site_reports r where r.id = dsr_events.report_id));
create policy dsr_photos_select on public.dsr_photos for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.daily_site_reports r where r.id = dsr_photos.report_id));

-- Money columns stay behind dsr_report_revenue (1041): a field role reads quantities, not rates.
revoke select on public.dsr_progress_lines from authenticated;
grant select (id, org_id, report_id, position, work_order_line_id, sub_stage, quantity, unit, frozen_at)
  on public.dsr_progress_lines to authenticated;

-- ── private photo bucket at {org}/{report}/{photo}/{filename} ────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('site-report-photos', 'site-report-photos', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/heic'])
  on conflict (id) do nothing;
