-- 0990_attendance_timesheet.sql — #2528: attendance becomes the timesheet with no retyping, approved by someone other
-- than whoever recorded it. Spec: docs/specs/crews-roster-attendance.spec.md (FR-CRW-014..018, OQ-CRW-3).
-- Plan: Slice 3 (money path: hours feed work-order cost; SoD). Proven by supabase/tests/attendance_timesheet.test.sql.
--
-- The existing approval RPC (`transition_timesheet`) is extended by TRIGGERS on `timesheets`, not by rewriting it:
--   a1_timesheets_attendance_sod   BEFORE the status reaches Approved: the approver recorded none of its attendance.
--   z9_timesheets_attendance_lock  AFTER: approval locks the attendance; re-opening (Approved → Draft, the correction
--                                  path) unlocks it.
-- A trigger holds for every path to Approved, so a later approval writer cannot skip the rule.
--
-- ── REVERSE (also supabase/migrations/rollback/0990_attendance_timesheet_down.sql) ─────────────────────────────
--   restore the 0951 work_order_cost_lines view; drop the two timesheets triggers and their functions; drop functions
--   attendance_decide_week, attendance_generate_timesheet.

-- ── §1 generation (FR-CRW-014, FR-CRW-016, FR-CRW-018; AC-CRW-009, AC-CRW-012) ──────────────────────────────
-- For a person with a login: their weekly timesheet gets one line per present day (project, work order, hours) and
-- moves to Submitted. For a person with no login: the week's present days are submitted for approval on the attendance
-- itself. Running it again with nothing changed changes nothing.
create function public.attendance_generate_timesheet(p_worker_id uuid, p_week_start date)
  returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_profile uuid;
  v_sheet uuid;
  v_status public.timesheet_status;
  v_week_end date := p_week_start + 6;
  v_present int;
  v_same boolean;
  v_entry uuid;
  v_n int;
  r record;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'ATT_WEEK: a week starts on a Monday' using errcode = '22023';
  end if;
  select w.profile_id into v_profile from public.people w where w.id = p_worker_id and w.org_id = v_org;
  if not found then
    raise exception 'person not found' using errcode = 'P0002';   -- SECURITY: another org's id reads as absent
  end if;
  -- Serialise generation per person-week.
  perform pg_advisory_xact_lock(hashtextextended('att-week:' || p_worker_id::text || ':' || p_week_start::text, 0));

  select count(*) into v_present from public.attendance_days a
   where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end and a.status = 'present';
  if v_present = 0 then
    raise exception 'ATT_WEEK_EMPTY: this person has no present days that week' using errcode = '22023';
  end if;
  -- Authority: whoever may record every one of the week's records (a crew manager, or their crews' field controller).
  if exists (select 1 from public.attendance_days a
              where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end
                and not public.attendance_can_record(a.crew_id)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- OQ-CRW-2: a conflict between methods is settled before anyone is paid for it.
  if exists (select 1 from public.attendance_days a
              where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end and a.needs_review) then
    raise exception 'ATT_NEEDS_REVIEW: settle the days where check-in and roster disagree first' using errcode = '23514';
  end if;

  if v_profile is null then
    -- FR-CRW-016 / OQ-CRW-3: no login, so no timesheet. Submit the week's open present days on the attendance itself.
    update public.attendance_days a set submitted_at = now()
     where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end
       and a.status = 'present' and a.submitted_at is null and a.locked_at is null;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      perform public.log_audit('attendance.submit_week', v_org, v_uid, p_worker_id,
                jsonb_build_object('week_start', p_week_start, 'days', v_n));
    end if;
    return jsonb_build_object('mode', 'attendance', 'timesheet_id', null, 'changed', v_n > 0);
  end if;

  perform public.assert_feature_on(v_org, 'timesheets');
  -- A day split between two work orders of one project cannot be one timesheet line (one line per project and day).
  if exists (select 1 from public.attendance_days a
              where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end and a.status = 'present'
              group by a.project_id, a.work_date having count(*) > 1) then
    raise exception 'ATT_TS_SPLIT_DAY: a day is split across two work orders of one project; correct the attendance first'
      using errcode = '23514';
  end if;

  select t.id, t.status into v_sheet, v_status from public.timesheets t
   where t.user_id = v_profile and t.week_start_date = p_week_start for update;

  -- FR-CRW-018: already generated from exactly this attendance and sent on → nothing to do.
  select v_sheet is not null
     and not exists (select 1 from public.attendance_days a
                      left join public.timesheet_entries e on e.id = a.timesheet_entry_id and e.timesheet_id = v_sheet
                      where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end
                        and ((a.status = 'present' and (e.id is null or e.project_id <> a.project_id
                                                        or e.entry_date <> a.work_date
                                                        or e.work_order_id is distinct from a.work_order_id
                                                        or e.hours <> a.hours + coalesce(a.overtime_hours, 0)))
                             or (a.status <> 'present' and a.timesheet_entry_id is not null)))
    into v_same;
  if v_same and v_status in ('Submitted', 'Approved') then
    return jsonb_build_object('mode', 'timesheet', 'timesheet_id', v_sheet, 'changed', false);
  end if;
  if v_sheet is not null and v_status <> 'Draft' then
    raise exception 'ATT_TS_NOT_DRAFT: this week''s timesheet is %; change it through the timesheet correction path', v_status
      using errcode = '55000';
  end if;
  if v_sheet is null then
    insert into public.timesheets (org_id, user_id, week_start_date, status)
    values (v_org, v_profile, p_week_start, 'Draft') returning id into v_sheet;
  end if;

  -- Lines for days that are no longer present go.
  for r in select a.id, a.timesheet_entry_id from public.attendance_days a
            where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end
              and a.status <> 'present' and a.timesheet_entry_id is not null loop
    update public.attendance_days set timesheet_entry_id = null where id = r.id;
    delete from public.timesheet_entries where id = r.timesheet_entry_id and timesheet_id = v_sheet;
  end loop;

  for r in select a.* from public.attendance_days a
            where a.worker_id = p_worker_id and a.work_date between p_week_start and v_week_end and a.status = 'present'
            order by a.work_date loop
    select e.id into v_entry from public.timesheet_entries e
     where e.timesheet_id = v_sheet and e.project_id = r.project_id and e.entry_date = r.work_date;
    if v_entry is not null and v_entry is distinct from r.timesheet_entry_id then
      -- Never overwrite a line the person typed themself.
      raise exception 'ATT_TS_MANUAL_ENTRY: the timesheet already has a typed line for % on that project', to_char(r.work_date, 'YYYY-MM-DD')
        using errcode = '23514';
    end if;
    if v_entry is null then
      insert into public.timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours, notes, work_order_id, discipline_id)
      values (v_org, v_sheet, r.project_id, r.work_date, r.hours + coalesce(r.overtime_hours, 0), 'From attendance',
              r.work_order_id, (select c.discipline_id from public.crews c where c.id = r.crew_id))
      returning id into v_entry;
      update public.attendance_days set timesheet_entry_id = v_entry where id = r.id;
    else
      update public.timesheet_entries
         set hours = r.hours + coalesce(r.overtime_hours, 0), work_order_id = r.work_order_id
       where id = v_entry;
    end if;
    v_entry := null;
  end loop;

  -- FR-CRW-014: the sheet goes for approval. The approver population and SoD are transition_timesheet's plus the
  -- recorder rule below.
  update public.timesheets set status = 'Submitted', submitted_at = now() where id = v_sheet;
  perform public.log_audit('attendance.generate_timesheet', v_org, v_uid, v_sheet,
            jsonb_build_object('worker_id', p_worker_id, 'week_start', p_week_start, 'days', v_present));
  return jsonb_build_object('mode', 'timesheet', 'timesheet_id', v_sheet, 'changed', true);
end $$;
revoke all on function public.attendance_generate_timesheet(uuid, date) from public, anon;
grant execute on function public.attendance_generate_timesheet(uuid, date) to authenticated;

-- ── §2 SoD on timesheet approval (FR-CRW-015, AC-CRW-010) ────────────────────────────────────────────────────
create function public.timesheet_attendance_sod() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- SECURITY (SoD): whoever recorded any of the attendance behind this sheet may not approve it — not even an Admin.
  if auth.uid() is not null and exists (
       select 1 from public.timesheet_entries e join public.attendance_days a on a.timesheet_entry_id = e.id
        where e.timesheet_id = new.id and auth.uid() = any(a.recorded_by_ids)) then
    raise exception 'separation of duties: the attendance recorder cannot approve these hours' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.timesheet_attendance_sod() from public, anon, authenticated;
create trigger a1_timesheets_attendance_sod before update of status on public.timesheets
  for each row when (new.status = 'Approved' and old.status is distinct from 'Approved')
  execute function public.timesheet_attendance_sod();

-- ── §3 approval locks the attendance; re-opening unlocks it (FR-CRW-015, FR-CRW-017; AC-CRW-010/011) ─────────
create function public.timesheet_attendance_lock() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'Approved' and old.status is distinct from 'Approved' then
    update public.attendance_days a
       set locked_at = now(), approved_by = new.approved_by, approved_at = coalesce(new.approved_at, now())
      from public.timesheet_entries e
     where e.timesheet_id = new.id and a.timesheet_entry_id = e.id and a.locked_at is null;
  elsif old.status = 'Approved' and new.status is distinct from 'Approved' then
    update public.attendance_days a
       set locked_at = null, approved_by = null, approved_at = null
      from public.timesheet_entries e
     where e.timesheet_id = new.id and a.timesheet_entry_id = e.id and a.locked_at is not null;
  end if;
  return new;
end $$;
revoke all on function public.timesheet_attendance_lock() from public, anon, authenticated;
create trigger z9_timesheets_attendance_lock after update of status on public.timesheets
  for each row execute function public.timesheet_attendance_lock();

-- ── §4 approving the week of a person with no login (FR-CRW-016, AC-CRW-012) ─────────────────────────────────
-- The same supervisor rule as a timesheet: an office role, never anyone who recorded the week.
create function public.attendance_decide_week(p_worker_id uuid, p_week_start date, p_decision text, p_reason text default null)
  returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_profile uuid;
  v_n int;
begin
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'ATT_WEEK: a week starts on a Monday' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'ATT_DECISION: approve or reject' using errcode = '22023';
  end if;
  select w.profile_id into v_profile from public.people w where w.id = p_worker_id and w.org_id = v_org;
  if not found then
    raise exception 'person not found' using errcode = 'P0002';
  end if;
  if v_profile is not null then
    raise exception 'ATT_HAS_TIMESHEET: this person''s hours are approved on their timesheet' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('att-week:' || p_worker_id::text || ':' || p_week_start::text, 0));
  if not exists (select 1 from public.attendance_days a
                  where a.worker_id = p_worker_id and a.work_date between p_week_start and p_week_start + 6
                    and a.submitted_at is not null and a.locked_at is null) then
    raise exception 'ATT_NOTHING_SUBMITTED: nothing is waiting for approval that week' using errcode = 'P0001';
  end if;
  -- SECURITY (SoD) FIRST, ALWAYS: a recorder of any day in the week never decides it, whatever their role.
  if exists (select 1 from public.attendance_days a
              where a.worker_id = p_worker_id and a.work_date between p_week_start and p_week_start + 6
                and a.submitted_at is not null and a.locked_at is null and v_uid = any(a.recorded_by_ids)) then
    raise exception 'separation of duties: the attendance recorder cannot approve these hours' using errcode = '42501';
  end if;
  if public.auth_role() is null or public.auth_role() not in ('Admin', 'Executive', 'Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision = 'approve' then
    update public.attendance_days a set approved_by = v_uid, approved_at = now(), locked_at = now()
     where a.worker_id = p_worker_id and a.work_date between p_week_start and p_week_start + 6
       and a.submitted_at is not null and a.locked_at is null;
  else
    if nullif(btrim(p_reason), '') is null then
      raise exception 'ATT_REASON: say why the week is returned' using errcode = '22023';
    end if;
    update public.attendance_days a set submitted_at = null
     where a.worker_id = p_worker_id and a.work_date between p_week_start and p_week_start + 6
       and a.submitted_at is not null and a.locked_at is null;
  end if;
  get diagnostics v_n = row_count;
  perform public.log_audit('attendance.' || p_decision || '_week', v_org, v_uid, p_worker_id,
            jsonb_build_object('week_start', p_week_start, 'days', v_n, 'reason', p_reason));
  return v_n;
end $$;
revoke all on function public.attendance_decide_week(uuid, date, text, text) from public, anon;
grant execute on function public.attendance_decide_week(uuid, date, text, text) to authenticated;

-- ── §5 cost attribution reads approved no-login hours (FR-CRW-016, AC-CRW-012) ───────────────────────────────
-- The 0951 read seam, with one more source appended (columns unchanged).
create or replace view public.work_order_cost_lines with (security_invoker = true) as
  select 'purchase_request'::text as source, r.id as record_id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date as occurred_on, coalesce(r.pr_number, r.reference_number) as reference,
         null::numeric as quantity, null::text as quantity_unit
    from public.purchase_requests r join public.procurements p on p.id = r.procurement_id
  union all
  select 'purchase_order', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.date, coalesce(r.po_number, r.reference_number), null, null
    from public.purchase_orders r join public.procurements p on p.id = r.procurement_id
  union all
  select 'goods_receipt', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.receipt_date, r.gr_number, null, null
    from public.procurement_receipts r join public.procurements p on p.id = r.procurement_id
  union all
  select 'vendor_bill', r.id, r.org_id, p.project_id, r.work_order_id, r.discipline_id,
         r.invoice_date, r.vi_number, null, null
    from public.procurement_invoices r join public.procurements p on p.id = r.procurement_id
  union all
  select 'timesheet_entry', e.id, e.org_id, e.project_id, e.work_order_id, e.discipline_id,
         e.entry_date, null, e.hours, 'hours'
    from public.timesheet_entries e
  union all
  select 'stock_document', d.id, d.org_id,
         case when d.kind = 'transfer' then w.project_id else d.project_id end, d.work_order_id, d.discipline_id,
         d.occurred_on, d.number, null, null
    from public.stock_documents d left join public.stock_warehouses w on w.id = d.to_warehouse_id
   where d.kind in ('issue', 'return', 'transfer')
  union all
  select 'equipment_usage', u.id, u.org_id, u.project_id, u.work_order_id, u.discipline_id,
         u.work_date, null, u.quantity, u.unit
    from public.equipment_usage_entries u
   where u.archived_at is null
  union all
  -- 0990 (#2528, FR-CRW-016): approved hours of people with no login live on the attendance record itself. A login's
  -- hours reach cost through its timesheet line above, so a row linked to a timesheet line is never counted here.
  select 'attendance_day', a.id, a.org_id, a.project_id, a.work_order_id, c.discipline_id,
         a.work_date, null, a.hours + coalesce(a.overtime_hours, 0), 'hours'
    from public.attendance_days a left join public.crews c on c.id = a.crew_id
   where a.status = 'present' and a.approved_at is not null and a.timesheet_entry_id is null;
revoke all on public.work_order_cost_lines from public, anon, authenticated;
grant select on public.work_order_cost_lines to authenticated;
