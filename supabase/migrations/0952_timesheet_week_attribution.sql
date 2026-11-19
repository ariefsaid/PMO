-- 0952_timesheet_week_attribution.sql — #2517: a timesheet line carries its work order and discipline through the
-- week save. ADR-0103; spec docs/specs/work-order-cost-attribution.spec.md (FR-WCA-032).
-- 0268's save_timesheet_week, byte-for-byte, plus ONE statement (§3c) after the upsert: a line that names
-- `work_order_id` / `discipline_id` takes them. Nothing else moves: the ownership, Draft, week-bound and tenancy gates,
-- the role set, the upsert key and the deletes are unchanged. No status, approval or push changes.
-- Proven by supabase/tests/0950_work_order_cost_attribution.test.sql (AC-WCA-015).
-- ── REVERSE: supabase/migrations/rollback/0952_timesheet_week_attribution_down.sql (re-applies 0268's body) ────

create or replace function public.save_timesheet_week(
  p_timesheet_id uuid, p_week_start_date date, p_upserts jsonb default '[]'::jsonb,
  p_delete_ids uuid[] default '{}'::uuid[])
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_org        uuid := auth_org_id();
  v_sheet_id   uuid := p_timesheet_id;
  v_owner      uuid;
  v_status     timesheet_status;
  v_sheet_org  uuid;
  v_sheet_week date;
  v_bad_proj   int;
  v_bad_date   int;
  v_attribution record;
begin
  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller — this RPC already refuses a NULL auth.uid() below, so
  -- it never had a machine caller to protect. Placed FIRST so an offboarded user gets the offboarding
  -- message rather than a bare 'not authenticated'/'no org context'.
  perform public.assert_is_active_member();
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'no org context' using errcode = '42501';
  end if;
  -- 0268: the same role set as timesheet_entries_write (and the FE's timesheet create/edit) —
  -- this definer bypasses that policy, so it must state the set itself.
  if auth_role() is null or auth_role() not in ('Admin','Executive','Project Manager','Engineer') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- 1. Resolve (or create) the Draft sheet. Creating self-stamps user_id = caller.
  if v_sheet_id is null then
    insert into public.timesheets (org_id, user_id, week_start_date, status)
    values (v_org, v_uid, p_week_start_date, 'Draft')
    returning id into v_sheet_id;
  end if;

  -- 2. Ownership + Draft + tenancy re-assertion (mirrors timesheets_insert / entries_write RLS).
  --    (i) week_start_date is read HERE: the sheet — not the caller's argument — defines the week.
  select user_id, status, org_id, week_start_date
    into v_owner, v_status, v_sheet_org, v_sheet_week
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

  -- 2b. (ii) The caller named a sheet AND a week; if they disagree, one of them is wrong and the
  --     server must not pick. Silently using v_sheet_week would honour a call whose entries were
  --     authored against a different week — the FE's own week is what it renders and diffs against.
  if p_timesheet_id is not null and p_week_start_date is distinct from v_sheet_week then
    raise exception 'p_week_start_date % does not match the timesheet week %',
      to_char(p_week_start_date, 'YYYY-MM-DD'), to_char(v_sheet_week, 'YYYY-MM-DD')
      using errcode = '22023';
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

    -- 3b. (iii) Week-bounds preflight against the SHEET's week. Rejecting before any write keeps
    --     0168's all-or-nothing guarantee (no partial draft). `u.entry_date is null` is explicit:
    --     a missing key compares as NULL, which is not TRUE, so a two-sided comparison alone would
    --     let it through to surface as a bare 23502 not-null violation instead of this reason.
    select count(*) into v_bad_date
      from jsonb_to_recordset(p_upserts) as u(entry_date date)
     where u.entry_date is null
        or u.entry_date < v_sheet_week
        or u.entry_date > (v_sheet_week + 6);
    if v_bad_date > 0 then
      raise exception 'entry_date is outside the timesheet week (%)',
        to_char(v_sheet_week, 'YYYY-MM-DD') using errcode = '23514';
    end if;

    insert into public.timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours, notes)
    select v_org, v_sheet_id, u.project_id, u.entry_date, u.hours, u.notes
      from jsonb_to_recordset(p_upserts)
             as u(project_id uuid, entry_date date, hours numeric, notes text)
    on conflict (timesheet_id, project_id, entry_date)
      do update set hours = excluded.hours, notes = excluded.notes;

    -- 3c. 0952 (#2517): a line that names `work_order_id` / `discipline_id` takes both (a missing one = none).
    --     A line that names neither keeps what it had, so a caller that predates this keeps its behaviour.
    --     check_cost_attribution (0951 §2) refuses a work order of another project or org (23514).
    for v_attribution in
      select te.id, nullif(e->>'work_order_id', '')::uuid as work_order_id,
             nullif(e->>'discipline_id', '')::uuid as discipline_id
        from jsonb_array_elements(p_upserts) e
        join public.timesheet_entries te on te.timesheet_id = v_sheet_id
         and te.project_id = (e->>'project_id')::uuid and te.entry_date = (e->>'entry_date')::date
       where (e ? 'work_order_id' or e ? 'discipline_id')
         and (te.work_order_id is distinct from nullif(e->>'work_order_id', '')::uuid
           or te.discipline_id is distinct from nullif(e->>'discipline_id', '')::uuid)
    loop
      perform public.set_cost_attribution('timesheet_entry', array[v_attribution.id],
        v_attribution.work_order_id, v_attribution.discipline_id);
    end loop;
  end if;

  -- 4. Deletes — pinned to entries on the RESOLVED (own) sheet, so a caller can never
  --    delete another sheet's rows by passing foreign ids (they simply match nothing).
  if array_length(p_delete_ids, 1) is not null then
    delete from public.timesheet_entries
     where id = any(p_delete_ids) and timesheet_id = v_sheet_id;
  end if;

  return v_sheet_id;
end; $$;
