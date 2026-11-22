-- rollback/1620_dsr_empty_submit_withdraw_down.sql
drop function if exists public.dsr_withdraw(uuid);
-- Back to 1041's dsr_submit with the assert_not_light guard 1461 added (no empty-report refusal).
create or replace function public.dsr_submit(p_report uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; r public.daily_site_reports;
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
  update public.daily_site_reports set status = 'submitted', submitted_at = now(), updated_at = now() where id = r.id;
  perform public.dsr_log(r.id, v_org, 'submitted', null);
end $$;
delete from public.dsr_events where action = 'withdrawn';
alter table public.dsr_events drop constraint dsr_events_action_check;
alter table public.dsr_events add constraint dsr_events_action_check
  check (action in ('created','submitted','validated','returned','corrected','superseded'));
