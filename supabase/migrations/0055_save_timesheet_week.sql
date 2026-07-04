-- 0055_save_timesheet_week.sql — atomic timesheet-week save (reliability harden #1).
--
-- The FE previously performed the week Save as THREE separate PostgREST writes:
--   create-draft-if-absent → upsert-changed-cells → delete-zeroed-cells.
-- A failure mid-delete (or mid-upsert) left a PARTIAL commit: the draft/upserts
-- persisted while the deletes did not. This RPC collapses all three into ONE
-- transaction (a plpgsql function body is atomic) so the Save is all-or-nothing.
--
-- SECURITY: SECURITY DEFINER with search_path pinned. Because DEFINER bypasses RLS,
-- the ownership/tenancy guards the timesheet_entries_write policy enforces (0011) are
-- RE-ASSERTED here EXACTLY:
--   • the resolved sheet must be the caller's OWN and in status 'Draft';
--   • the sheet's org must equal auth_org_id();
--   • every upserted/deleted entry's parent project must be in the caller's org;
--   • deletes are pinned to entries whose parent sheet is the resolved (own) sheet.
-- Removing any of these re-assertions would let a caller write onto another user's
-- (or another org's) sheet — they MUST stay.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`.

create or replace function save_timesheet_week(
  p_timesheet_id    uuid,               -- null ⇒ create the caller's Draft for the week
  p_week_start_date date,
  p_upserts         jsonb default '[]'::jsonb,  -- [{project_id, entry_date, hours, notes}]
  p_delete_ids      uuid[] default '{}')
  returns uuid                          -- the resolved timesheet id
  language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_org       uuid := auth_org_id();
  v_sheet_id  uuid := p_timesheet_id;
  v_owner     uuid;
  v_status    timesheet_status;
  v_sheet_org uuid;
  v_bad_proj  int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- 1. Resolve (or create) the Draft sheet. Creating self-stamps user_id = caller.
  if v_sheet_id is null then
    insert into public.timesheets (org_id, user_id, week_start_date, status)
    values (v_org, v_uid, p_week_start_date, 'Draft')
    returning id into v_sheet_id;
  end if;

  -- 2. Ownership + Draft + tenancy re-assertion (mirrors timesheets_insert / entries_write RLS).
  select user_id, status, org_id into v_owner, v_status, v_sheet_org
    from public.timesheets where id = v_sheet_id for update;
  if v_owner is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;
  if v_sheet_org is distinct from v_org or v_owner is distinct from v_uid then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_status <> 'Draft' then
    raise exception 'timesheet is not editable (status %)', v_status using errcode = 'P0001';
  end if;

  -- 3. Upserts. Every referenced project must be in the caller's org (parent-project
  --    tenancy guard from 0011). Reject BEFORE any write if a foreign project appears.
  if jsonb_array_length(p_upserts) > 0 then
    select count(*) into v_bad_proj
      from jsonb_to_recordset(p_upserts) as u(project_id uuid)
     where not exists (
       select 1 from public.projects p where p.id = u.project_id and p.org_id = v_org);
    if v_bad_proj > 0 then
      raise exception 'not authorized' using errcode = '42501';
    end if;

    insert into public.timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours, notes)
    select v_org, v_sheet_id, u.project_id, u.entry_date, u.hours, u.notes
      from jsonb_to_recordset(p_upserts)
             as u(project_id uuid, entry_date date, hours numeric, notes text)
    on conflict (timesheet_id, project_id, entry_date)
      do update set hours = excluded.hours, notes = excluded.notes;
  end if;

  -- 4. Deletes — pinned to entries on the RESOLVED (own) sheet, so a caller can never
  --    delete another sheet's rows by passing foreign ids (they simply match nothing).
  if array_length(p_delete_ids, 1) is not null then
    delete from public.timesheet_entries
     where id = any(p_delete_ids) and timesheet_id = v_sheet_id;
  end if;

  return v_sheet_id;
end; $$;

revoke all     on function save_timesheet_week(uuid, date, jsonb, uuid[]) from public;
grant  execute on function save_timesheet_week(uuid, date, jsonb, uuid[]) to   authenticated;
revoke execute on function save_timesheet_week(uuid, date, jsonb, uuid[]) from anon;
