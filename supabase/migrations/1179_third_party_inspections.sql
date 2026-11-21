-- 1179_third_party_inspections.sql — #2580: third-party inspection tracker (the table, its report files, the bucket).
-- Spec docs/specs/third-party-inspections.spec.md (Review 20 Nov binding); plan docs/plans/2026-11-20-third-party-inspections.md.
-- Proven by supabase/tests/1179_third_party_inspections.test.sql (+ 1182 / 1183 files for the purchase link and the reads).
--   §1 third_party_inspections: one row per external test of a work order. No client write grant at all: every change is an
--      RPC (1180) and every rule below is a table trigger, so a definer or fixture path cannot skip a gate.
--   §2 guard_tpi_transition: the state rules in ONE place (forward only; invite needs the purchase; execute not in the future;
--      report needs a result + a live attachment; cancel only when required for no gate; waiver rules).
--   §3 third_party_inspection_files: append-only once reported, at most 10 live files, org from the parent.
--   §4 private bucket inspection-reports (15 MB; pdf, images, Office) + storage RLS.
-- No cost table, no cost writer: cost is read from the linked procurement case (1183).
--
-- ── REVERSE (also rollback/1179_third_party_inspections_down.sql) ───────────────────────────────────
--   drop policies on storage.objects for inspection-reports; delete from storage.buckets where id = 'inspection-reports';
--   drop table public.third_party_inspection_files; drop table public.third_party_inspections;
--   drop functions guard_tpi_transition, guard_tpi_file, can_add_inspection_file.

-- ── §1 the tracker ────────────────────────────────────────────────────────────────────────────────────
create table public.third_party_inspections (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  work_order_id      uuid not null references public.work_orders(id),
  -- derived from the work order by the create RPC, never chosen by the client; kept for the project link and indexes
  project_id         uuid not null references public.projects(id),
  title              text not null check (btrim(title) <> '' and char_length(title) <= 200),
  test_kind          text check (test_kind is null or (btrim(test_kind) <> '' and char_length(test_kind) <= 100)),
  planned_date       date not null,
  vendor_id          uuid references public.companies(id),
  -- A planning figure only (spec "Context"): never posts cost, never in a total. Not readable by the money-less roles.
  estimate           numeric(14,2) check (estimate is null or estimate >= 0),
  estimate_currency  text check (estimate_currency is null or estimate_currency ~ '^[A-Z]{3}$'),
  note               text check (note is null or char_length(note) <= 2000),
  required_for       text[] not null default '{}' check (required_for <@ array['readiness','billing']::text[]),
  -- #2576 ships the sections table and replaces this check with a foreign key + same-work-order rule (FR-TPI-004).
  section_id         uuid,
  constraint tpi_section_unavailable check (section_id is null),
  status             text not null default 'requested'
                       check (status in ('requested','purchase_raised','invited','executed','reported','cancelled')),
  result             text not null default 'pending' check (result in ('pending','pass','fail','conditional')),
  procurement_id     uuid unique references public.procurements(id) on delete restrict,
  purchase_raised_at timestamptz, purchase_raised_by uuid references public.profiles(id),
  invited_on         date, invited_who text, invited_how text, invited_by uuid references public.profiles(id),
  executed_on        date, executed_by uuid references public.profiles(id),
  reported_at        timestamptz, reported_by uuid references public.profiles(id),
  waived_at          timestamptz, waived_by uuid references public.profiles(id), waiver_reason text,
  cancelled_at       timestamptz, cancelled_by uuid references public.profiles(id), cancel_reason text,
  overdue_notified_at timestamptz,
  created_by         uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index third_party_inspections_wo_idx on public.third_party_inspections (org_id, work_order_id);
create index third_party_inspections_overdue_idx on public.third_party_inspections (planned_date)
  where status not in ('reported','cancelled') and overdue_notified_at is null;
alter table public.third_party_inspections enable row level security;
alter table public.third_party_inspections force row level security;

create trigger third_party_inspections_stamp_org_id before insert on public.third_party_inspections
  for each row execute function public.stamp_org_id();

create policy third_party_inspections_select on public.third_party_inspections for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- No INSERT/UPDATE/DELETE for any client role: the RPCs (1180/1182) are the only writers, so `status`, the waiver
-- and the cancel columns cannot be written from the client. SELECT excludes the planning estimate (money roles read it via 1183).
revoke all on public.third_party_inspections from public, anon, authenticated;
grant select (id, org_id, work_order_id, project_id, title, test_kind, planned_date, vendor_id, note, required_for, section_id,
              status, result, procurement_id, purchase_raised_at, purchase_raised_by, invited_on, invited_who, invited_how,
              invited_by, executed_on, executed_by, reported_at, reported_by, waived_at, waived_by, waiver_reason,
              cancelled_at, cancelled_by, cancel_reason, overdue_notified_at, created_by, created_at, updated_at)
  on public.third_party_inspections to authenticated;

-- ── §3 files (created before the trigger that reads them) ─────────────────────────────────────────────
create table public.third_party_inspection_files (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  inspection_id  uuid not null references public.third_party_inspections(id) on delete restrict,
  title          text,
  file_path      text not null,
  storage_object_id uuid not null default gen_random_uuid(),
  constraint tpi_files_storage_object_fkey foreign key (storage_object_id) references storage.objects(id) on delete restrict,
  uploaded_by_id uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create index tpi_files_parent_idx on public.third_party_inspection_files (inspection_id, created_at desc) where archived_at is null;
create index tpi_files_storage_object_idx on public.third_party_inspection_files (storage_object_id);
alter table public.third_party_inspection_files enable row level security;
alter table public.third_party_inspection_files force row level security;

-- ── §2 the state rules ────────────────────────────────────────────────────────────────────────────────
-- Fires for EVERY path (RPC, definer job, fixture). Order of `status` is the spec's; a step is one forward move.
create function public.guard_tpi_transition() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rank_old int; v_rank_new int;
begin
  -- Immutable once set: the work order, project, org, required gates, creator, the purchase link once raised.
  if new.org_id is distinct from old.org_id or new.work_order_id is distinct from old.work_order_id
     or new.project_id is distinct from old.project_id or new.required_for is distinct from old.required_for
     or new.created_by is distinct from old.created_by or new.section_id is distinct from old.section_id then
    raise exception 'TPI_IMMUTABLE: the work order, gates and creator of an inspection cannot change' using errcode = '23514';
  end if;
  if old.procurement_id is not null and new.procurement_id is distinct from old.procurement_id then
    raise exception 'TPI_IMMUTABLE: the linked purchase cannot change' using errcode = '23514';
  end if;
  if old.status = 'cancelled' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'TPI_TERMINAL: a cancelled inspection cannot change' using errcode = '23514';
  end if;

  -- waiver: set once, with a reason, by someone other than the creator, only where a gate exists to release.
  if new.waived_at is distinct from old.waived_at or new.waived_by is distinct from old.waived_by
     or new.waiver_reason is distinct from old.waiver_reason then
    if old.waived_at is not null then
      raise exception 'TPI_WAIVED: this inspection is already waived' using errcode = '23514';
    end if;
    if cardinality(new.required_for) = 0 then
      raise exception 'TPI_WAIVE_NOT_REQUIRED: this inspection is required for no gate, so there is nothing to waive' using errcode = '23514';
    end if;
    if new.waiver_reason is null or btrim(new.waiver_reason) = '' or new.waived_at is null or new.waived_by is null then
      raise exception 'TPI_WAIVE_REASON: a waiver needs a reason' using errcode = '23514';
    end if;
    if new.waived_by is not distinct from new.created_by then
      raise exception 'TPI_WAIVE_SELF: you cannot waive an inspection you created' using errcode = '42501';
    end if;
    if old.status = 'reported' and old.result in ('pass','conditional') then
      raise exception 'TPI_WAIVE_COMPLETE: this inspection is already complete' using errcode = '23514';
    end if;
  end if;

  if new.status is not distinct from old.status then
    -- no status move: result and the step fields only change together with a step
    if new.result is distinct from old.result or new.executed_on is distinct from old.executed_on
       or new.invited_on is distinct from old.invited_on or new.procurement_id is distinct from old.procurement_id then
      raise exception 'TPI_STEP: complete the previous step' using errcode = '23514';
    end if;
    return new;
  end if;

  v_rank_old := array_position(array['requested','purchase_raised','invited','executed','reported'], old.status);
  v_rank_new := array_position(array['requested','purchase_raised','invited','executed','reported'], new.status);

  if new.status = 'cancelled' then
    if old.status = 'reported' then
      raise exception 'TPI_CANCEL_REPORTED: a reported inspection cannot be cancelled' using errcode = '23514';
    end if;
    if cardinality(new.required_for) > 0 then
      raise exception 'TPI_CANCEL_REQUIRED: this inspection is required for a gate; report it or waive it' using errcode = '23514';
    end if;
    if new.cancel_reason is null or btrim(new.cancel_reason) = '' or new.cancelled_at is null or new.cancelled_by is null then
      raise exception 'TPI_CANCEL_REASON: cancelling needs a reason' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'reported' or v_rank_new is distinct from v_rank_old + 1 then
    raise exception 'TPI_STEP: complete the previous step' using errcode = '23514';
  end if;

  if new.status = 'purchase_raised' then
    if new.procurement_id is null or new.purchase_raised_at is null or new.purchase_raised_by is null then
      raise exception 'TPI_STEP: raising the purchase needs its procurement case' using errcode = '23514';
    end if;
  elsif new.status = 'invited' then
    if new.procurement_id is null then
      raise exception 'TPI_STEP: complete the previous step (raise the purchase first)' using errcode = '23514';
    end if;
    if new.invited_on is null or new.invited_by is null then
      raise exception 'TPI_INVITE: record the invitation date' using errcode = '23514';
    end if;
  elsif new.status = 'executed' then
    if new.executed_on is null or new.executed_by is null then
      raise exception 'TPI_EXECUTE: record the execution date' using errcode = '23514';
    end if;
    -- "not in the future" in every time zone: the server's UTC date plus one day (UTC+14 is the furthest ahead).
    if new.executed_on > current_date + 1 then
      raise exception 'TPI_EXECUTE_FUTURE: the execution date cannot be in the future' using errcode = '23514';
    end if;
  elsif new.status = 'reported' then
    if new.result not in ('pass','fail','conditional') then
      raise exception 'TPI_RESULT: record a result of pass, fail or conditional' using errcode = '23514';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
    if not exists (select 1 from public.third_party_inspection_files f
                    where f.inspection_id = new.id and f.archived_at is null) then
      raise exception 'TPI_REPORT_FILE: attach the report before marking it reported' using errcode = '23514';
    end if;
    if new.reported_at is null or new.reported_by is null then
      raise exception 'TPI_STEP: reporting stamps the date and actor' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_tpi_transition() from public, anon, authenticated;
create trigger third_party_inspections_zz_guard before update on public.third_party_inspections
  for each row execute function public.guard_tpi_transition();

-- who may add a report file: the roles that advance an inspection, on a live inspection of the caller's org
create function public.can_add_inspection_file(p_inspection uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.third_party_inspections i
     where i.id = p_inspection and i.org_id = public.auth_org_id()
       and public.is_active_member()
       and i.status <> 'cancelled'
       and public.auth_role() in ('Admin','Project Manager','Finance','Engineer'))
$$;
revoke all on function public.can_add_inspection_file(uuid) from public, anon;
grant execute on function public.can_add_inspection_file(uuid) to authenticated;

grant select, insert on public.third_party_inspection_files to authenticated;
grant update (archived_at) on public.third_party_inspection_files to authenticated;

create policy tpi_files_select on public.third_party_inspection_files for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy tpi_files_insert on public.third_party_inspection_files for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and (select public.can_add_inspection_file(inspection_id))
              and exists (select 1 from public.third_party_inspections i
                           where i.id = inspection_id and i.org_id = third_party_inspection_files.org_id));
-- archive (soft delete) the uploader or a manager; the guard refuses it once the inspection is reported
create policy tpi_files_update on public.third_party_inspection_files for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (uploaded_by_id = (select auth.uid()) or (select public.auth_role()) in ('Admin','Project Manager','Finance'))
         and exists (select 1 from public.third_party_inspections i
                      where i.id = inspection_id and i.org_id = third_party_inspection_files.org_id))
  with check (org_id = (select public.auth_org_id()));

create function public.guard_tpi_file() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_status text; v_object_id uuid;
begin
  select i.org_id, i.status into v_org, v_status from public.third_party_inspections i where i.id = coalesce(new.inspection_id, old.inspection_id) for update;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
      raise exception 'only archiving a report file is allowed' using errcode = '42501';
    end if;
    -- FR-TPI-015: a reported inspection's report is append-only; a correction is a new attachment.
    if new.archived_at is distinct from old.archived_at and v_status in ('reported','cancelled') then
      raise exception 'TPI_FILE_APPEND_ONLY: the report of a reported inspection cannot be removed or replaced; attach a new file' using errcode = '23514';
    end if;
    if old.archived_at is not null and new.archived_at is null then
      raise exception 'TPI_FILE_APPEND_ONLY: a removed file cannot be restored' using errcode = '23514';
    end if;
    return new;
  end if;
  if v_org is null then raise exception 'inspection not found' using errcode = '23503'; end if;
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then new.org_id := v_org; end if;
  if new.org_id is distinct from v_org then raise exception 'inspection not in this org' using errcode = '42501'; end if;
  if auth.uid() is not null then
    if v_org is distinct from public.auth_org_id() then
      raise exception 'inspection not in this org' using errcode = '42501';
    end if;
    new.uploaded_by_id := auth.uid();
    if new.file_path not like (new.org_id::text || '/' || new.inspection_id::text || '/' || new.id::text || '/%') then
      raise exception 'report object is missing or invalid' using errcode = '23514';
    end if;
  end if;
  if v_status = 'cancelled' then
    raise exception 'TPI_FILE_CANCELLED: a cancelled inspection takes no files' using errcode = '23514';
  end if;
  select o.id into v_object_id from storage.objects o
   where o.bucket_id = 'inspection-reports' and o.name = new.file_path
   order by o.created_at desc, o.id limit 1;
  if v_object_id is null then
    raise exception 'report object is missing or invalid' using errcode = '23514';
  end if;
  new.storage_object_id := v_object_id;
  if new.archived_at is null and (select count(*) from public.third_party_inspection_files f
        where f.inspection_id = new.inspection_id and f.archived_at is null) >= 10 then
    raise exception 'TPI_FILE_CAP: an inspection holds at most 10 report files' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_tpi_file() from public, anon, authenticated;
create trigger tpi_files_stamp_org_id before insert on public.third_party_inspection_files
  for each row execute function public.stamp_org_id();
create trigger tpi_files_zz_guard before insert or update on public.third_party_inspection_files
  for each row execute function public.guard_tpi_file();

-- ── §4 bucket + storage RLS ───────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('inspection-reports', 'inspection-reports', false, 15728640,
          array['image/jpeg','image/png','image/webp','image/heic','application/pdf',
                'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
  on conflict (id) do nothing;

create policy storage_objects_tpi_file_read on storage.objects for select to authenticated
  using (
    bucket_id = 'inspection-reports' and (select auth.uid()) is not null
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and exists (select 1 from public.third_party_inspections i
                 where i.id::text = split_part(name, '/', 2) and i.org_id = (select public.auth_org_id())));
create policy storage_objects_tpi_file_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inspection-reports' and (select auth.uid()) is not null
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and public.can_add_inspection_file(nullif(split_part(name, '/', 2), '')::uuid));
create policy storage_objects_tpi_orphan_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'inspection-reports' and (select public.is_active_member())
    and owner_id = (select auth.uid())::text
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and not exists (select 1 from public.third_party_inspection_files f where f.storage_object_id = objects.id));
