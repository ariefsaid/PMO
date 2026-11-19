-- 0980_site_issue_files.sql — #2521: photo / document evidence on an issue, and the close-proof rule.
-- Spec docs/specs/site-issue-log.spec.md (FR-SIL-010, FR-SIL-012); proven by supabase/tests/0979_site_issue_log.test.sql.
--   §1 incident_files: child table, soft-archive (ADR-0018), org stamped from the parent, at most 10 live files per issue,
--      kind `at_raise` / `at_close`. Read = anyone who reads the issue; add = reporter, assignee, manager roles.
--   §2 private bucket incident-files (15 MB, images + PDF), path {org}/{incident}/{file_id}/{filename}; storage RLS mirrors §1.
--   §3 close-proof guard: an issue of severity High or Critical cannot become Closed without a live `at_close` file.
--      Enforced here in the database; there is no bypass (job and fixture paths included).
--
-- ── REVERSE (also rollback/0980_site_issue_files_down.sql) ───────────────────────────────────────────
--   drop trigger if exists incident_reports_zz_close_proof on public.incident_reports; drop function if exists public.guard_incident_close_proof();
--   drop policy if exists storage_objects_incident_file_read / _write on storage.objects;
--   delete from storage.buckets where id = 'incident-files';  drop table if exists public.incident_files; drop its two functions.

create table public.incident_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  incident_id    uuid not null references public.incident_reports(id) on delete cascade,
  kind           text not null check (kind in ('at_raise','at_close')),
  title          text,
  file_path      text not null,
  uploaded_by_id uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create index incident_files_parent_idx on public.incident_files (incident_id, created_at desc) where archived_at is null;
alter table public.incident_files enable row level security;
alter table public.incident_files force row level security;

-- ⚑ one place for "who may add evidence": reporter, assignee, manager roles — of an issue in the caller's own org.
create function public.can_add_incident_evidence(p_incident uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.incident_reports i
     where i.id = p_incident and i.org_id = public.auth_org_id()
       and public.is_active_member()
       and (i.reported_by = auth.uid() or i.assignee_id = auth.uid()
            or public.auth_role() in ('Admin','Executive','Project Manager','Finance')))
$$;
revoke all on function public.can_add_incident_evidence(uuid) from public, anon;
grant execute on function public.can_add_incident_evidence(uuid) to authenticated;

create policy incident_files_select on public.incident_files for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy incident_files_insert on public.incident_files for insert
  with check (
    org_id = (select public.auth_org_id()) and (select public.can_add_incident_evidence(incident_id))
    and (select public.org_feature_enabled((select public.auth_org_id()), 'incidents')));
-- archive (soft delete): the uploader or a manager
create policy incident_files_update on public.incident_files for update
  using (
    org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and (uploaded_by_id = (select auth.uid()) or (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance')))
  with check (org_id = (select public.auth_org_id()));

-- org from the parent; at most 10 live files per issue
create function public.guard_incident_file() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  select i.org_id into v_org from public.incident_reports i where i.id = new.incident_id;
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then new.org_id := v_org; end if;
  if new.org_id is distinct from v_org then raise exception 'issue not in this org' using errcode = '42501'; end if;
  if new.archived_at is null and (select count(*) from public.incident_files f
        where f.incident_id = new.incident_id and f.archived_at is null) >= 10 then
    raise exception 'an issue holds at most 10 attachments' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.guard_incident_file() from public, anon, authenticated;
create trigger incident_files_guard before insert on public.incident_files
  for each row execute function public.guard_incident_file();

-- ── §2 bucket + storage RLS ───────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('incident-files', 'incident-files', false, 15728640,
          array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
  on conflict (id) do nothing;

create policy storage_objects_incident_file_read on storage.objects for select
  using (
    bucket_id = 'incident-files' and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and exists (select 1 from public.incident_reports i
                 where i.id::text = split_part(name, '/', 2) and i.org_id = auth_org_id()));
create policy storage_objects_incident_file_write on storage.objects for insert
  with check (
    bucket_id = 'incident-files' and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and public.can_add_incident_evidence(nullif(split_part(name, '/', 2), '')::uuid));

-- ── §3 close proof ────────────────────────────────────────────────────────────────────────────────
create function public.guard_incident_close_proof() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'Closed' and (tg_op = 'INSERT' or old.status <> 'Closed')
     and new.severity in ('High','Critical')
     and not exists (select 1 from public.incident_files f
                      where f.incident_id = new.id and f.kind = 'at_close' and f.archived_at is null) then
    raise exception 'a High or Critical issue needs a close photo before it can be closed' using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.guard_incident_close_proof() from public, anon, authenticated;
create trigger incident_reports_zz_close_proof before insert or update of status on public.incident_reports
  for each row execute function public.guard_incident_close_proof();
