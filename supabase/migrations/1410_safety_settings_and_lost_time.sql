-- 1410_safety_settings_and_lost_time.sql — #2596 daily safety records: the organisation switch, the client-maintained
-- lists, and the lost-time marker on incidents. Spec: docs/specs/daily-safety-records.spec.md (FR-DSF-018, OD-DSF-3,
-- OD-SCOPE-2). Proven by supabase/tests/safety_days.test.sql. Reversal: rollback/1410_safety_settings_and_lost_time_down.sql.
-- Off until an Admin switches it on: an existing organisation sees no change. Nothing here is a client process: the check
-- types, permit types and pre-work checklist items are rows the client keeps.

alter table public.organizations add column safety_records_enabled boolean not null default false;

create function public.safety_records_enabled() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select o.safety_records_enabled from public.organizations o
                    where o.id = public.auth_org_id() and public.is_active_member()), false)
$$;
revoke all on function public.safety_records_enabled() from public, anon;
grant execute on function public.safety_records_enabled() to authenticated;

create function public.set_safety_records_enabled(p_enabled boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_active_member() or public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin may switch safety records on or off' using errcode = '42501';
  end if;
  update public.organizations set safety_records_enabled = coalesce(p_enabled, false) where id = public.auth_org_id();
end $$;
revoke all on function public.set_safety_records_enabled(boolean) from public, anon;
grant execute on function public.set_safety_records_enabled(boolean) to authenticated;

-- ── the lists (FR-DSF-018): one table, three kinds; Admin edits, every active member reads; archive, never delete ──────
create table public.safety_list_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  kind        text not null check (kind in ('check_type', 'permit_type', 'checklist_item')),
  label       text not null check (char_length(btrim(label)) between 1 and 120),
  position    integer not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index safety_list_items_label on public.safety_list_items (org_id, kind, lower(btrim(label))) where archived_at is null;
create index safety_list_items_kind on public.safety_list_items (org_id, kind, position, created_at);
create trigger safety_list_items_stamp_org_id before insert on public.safety_list_items
  for each row execute function public.stamp_org_id();
alter table public.safety_list_items enable row level security;
alter table public.safety_list_items force row level security;
revoke all on public.safety_list_items from public, anon, authenticated;
grant select on public.safety_list_items to authenticated;
grant insert (kind, label, position) on public.safety_list_items to authenticated;
grant update (label, position, archived_at) on public.safety_list_items to authenticated;
grant all on public.safety_list_items to service_role;
create policy safety_list_items_select on public.safety_list_items for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy safety_list_items_insert on public.safety_list_items for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
create policy safety_list_items_update on public.safety_list_items for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');

-- ── lost-time marker (OD-DSF-3): additive, default false, set only by the incident managers ───────────────────────
-- A sibling guard (the shipped guard_incident_issue_fields is untouched): UPDATE by an assignee already fails there on
-- any changed column; this adds the INSERT case and names the rule. auth.uid() null = migrations, jobs, fixtures.
alter table public.incident_reports add column lost_time boolean not null default false;

create function public.guard_incident_lost_time() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or public.auth_role() in ('Admin', 'Executive', 'Project Manager', 'Finance') then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.lost_time) or (tg_op = 'UPDATE' and new.lost_time is distinct from old.lost_time) then
    raise exception 'only an incident manager may classify an incident as lost-time' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_incident_lost_time() from public, anon, authenticated;
create trigger incident_reports_zz_lost_time_guard before insert or update on public.incident_reports
  for each row execute function public.guard_incident_lost_time();
