-- 0168_save_timesheet_week_entry_date_bounds.sql
-- Defect fix — save_timesheet_week() never clamped entry_date to the sheet's week.
--
-- 0055 inserts each upsert row's `entry_date` straight from the caller's jsonb with NO
-- bound against p_week_start_date. A caller could save entries dated the prior week, next
-- month, or any date onto a sheet labelled for a specific week — corrupting weekly rollups
-- (a "week of 2026-06-08" sheet silently carrying a 2026-05-01 row). Money-adjacent:
-- timesheet hours roll into project cost.
--
-- Fix: re-state save_timesheet_week with a v_bad_date preflight mirroring the existing
-- v_bad_proj tenancy guard — count upsert rows whose entry_date falls OUTSIDE
-- [p_week_start_date, p_week_start_date + 6] (the 7 inclusive days of the ISO week) and
-- raise 23514 BEFORE any write, so the all-or-nothing guarantee holds (a bad date aborts
-- the whole call, leaving no partial draft — proven in pgTAP 0161, proof 4).
--
-- Errcode choice: 23514 (CHECK-violation) — the SAME errcode the existing hours>24 path
-- uses (that CHECK lives on the table, 0001:199; Postgres surfaces it as 23514). The FE's
-- classifyMutationError has NO explicit 23514 branch: it falls through to the generic
-- "Update failed" headline with the verbatim reason in the sub-text — identical to how
-- hours>24 already surfaces. So no new wire shape, no new UX branch. A weekly-timesheet
-- tool's entries belong to that week.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. The change is purely
-- additive inside the function body (a new preflight block); the table shape is untouched,
-- so rollback is dropping the block — no data migration, no backfill.
--
-- SECURITY: this is a SECURITY DEFINER function (bypasses RLS), so the re-statement was
-- audited guard-by-guard against 0055 (security-auditor SHIP). SECURITY DEFINER +
-- search_path = public retained verbatim; every 0055 guard (auth, ownership `for update`,
-- org tenancy, Draft-only, project-tenancy, delete-pinning) is preserved byte-for-byte.
-- The new preflight reads only the caller-supplied p_upserts + p_week_start_date — no new
-- table access, no privilege surface added. ⚑ ONE other delta from 0055, deliberately kept
-- and documented here (not "unchanged"): a `v_org is null` guard at the auth step. 0055
-- checked only `v_uid is null`; 0168 ALSO rejects a null `auth_org_id()` (errcode 42501)
-- before any read — a strict tightening (a null org context can't reach the ownership
-- compare). Confirmed a real improvement by the security review, not a silent edit.

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
  v_bad_date  int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'no org context' using errcode = '42501';
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

    -- 3b. Week-bounds guard (NEW, 0168): every upsert's entry_date must fall in the
    --     sheet's ISO week [p_week_start_date, p_week_start_date + 6]. A date outside
    --     that range would land hours on the wrong weekly sheet. Same reject-before-write
    --     shape as the project-tenancy guard above, so atomicity holds. errcode 23514
    --     (CHECK-violation) — the FE classifies it identically to the hours>24 case.
    select count(*) into v_bad_date
      from jsonb_to_recordset(p_upserts) as u(entry_date date)
     where u.entry_date < p_week_start_date
        or u.entry_date > (p_week_start_date + 6);
    if v_bad_date > 0 then
      raise exception 'entry_date is outside the timesheet week (%)', p_week_start_date
        using errcode = '23514';
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
