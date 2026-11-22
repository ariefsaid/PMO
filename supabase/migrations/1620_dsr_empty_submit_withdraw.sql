-- 1620_dsr_empty_submit_withdraw.sql -- a daily report cannot be sent empty, and its author can take a sent one back.
-- drops: dsr_submit replaces its declare line to carry the missing-part list for the empty-report refusal; no rule is removed.
-- Rollback: supabase/migrations/rollback/1620_dsr_empty_submit_withdraw_down.sql
-- Walk fix (site controller): an empty report (no progress, no hours, no photo, no consumables, no idle time) went to
-- validation in one tap. dsr_submit now refuses it and says what is missing; dsr_withdraw lets the author pull a sent
-- report back to a draft until someone validates or returns it. Nothing else about dsr_submit changes: this restates its
-- newest definition (1041, plus the assert_not_light guard 1461 added) with the new refusal.

alter table public.dsr_events drop constraint dsr_events_action_check;
alter table public.dsr_events add constraint dsr_events_action_check
  check (action in ('created','submitted','validated','returned','corrected','superseded','withdrawn'));

create or replace function public.dsr_submit(p_report uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.daily_site_reports; v_missing text[] := array[]::text[];
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status = 'submitted' then return; end if;
  if r.status not in ('draft','returned') then raise exception 'only a draft or returned report can be submitted' using errcode = '42501'; end if;
  if r.author_id <> auth.uid() and not public.dsr_may_enter(r.project_id) then
    raise exception 'you cannot submit this report' using errcode = '42501';
  end if;
  -- An empty report is refused, and the answer names what a report can carry. The screen words it in the reader's language
  -- from the missing-part tokens after the colon; the message itself is never shown.
  if not exists (select 1 from public.dsr_progress_lines where report_id = r.id)
     and (r.start_time is null or r.end_time is null)
     and not exists (select 1 from public.dsr_photos where report_id = r.id)
     and not exists (select 1 from public.dsr_consumables where report_id = r.id)
     and not exists (select 1 from public.dsr_idle_periods where report_id = r.id) then
    v_missing := array['progress', 'hours', 'photo'];
    raise exception 'dsr_empty: %', array_to_string(v_missing, ',') using errcode = 'DS001';
  end if;
  update public.daily_site_reports set status = 'submitted', submitted_at = now(), updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'submitted', null);
end $$;

-- The author takes a sent report back to a draft, until it is validated or returned. Nobody else can: the validator
-- returns it with a reason (dsr_return), and a validated report only ever changes through a correction.
create or replace function public.dsr_withdraw(p_report uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.daily_site_reports;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.dsr_require_member();
  select * into r from public.daily_site_reports where id = p_report and org_id = v_org for update;
  if r.id is null then raise exception 'report not found' using errcode = 'P0002'; end if;
  if r.status = 'draft' then return; end if;
  if r.status <> 'submitted' then raise exception 'only a sent report can be withdrawn' using errcode = '42501'; end if;
  if r.author_id <> auth.uid() then raise exception 'only the author can withdraw this report' using errcode = '42501'; end if;
  update public.daily_site_reports set status = 'draft', submitted_at = null, updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'withdrawn', null);
end $$;

revoke all on function public.dsr_withdraw(uuid) from public, anon;
grant execute on function public.dsr_withdraw(uuid) to authenticated;
