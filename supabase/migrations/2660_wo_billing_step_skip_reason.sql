-- 2660_wo_billing_step_skip_reason.sql — skipping a work-order billing step records why (#2880), as skip_billing_stage does for a claim step.
-- Rollback: supabase/migrations/rollback/2660_wo_billing_step_skip_reason_down.sql
-- Existing skipped steps keep an empty reason (nothing back-filled); the reason is required from now on, 3 to 500 characters.
-- The reason is on the step row (read by whoever reads the step: wo_step_readable) and on the audit event (the step's history).
alter table public.work_order_billing_steps add column skipped_reason text check (skipped_reason is null or char_length(skipped_reason) between 3 and 500);

drop function public.skip_work_order_step(uuid);
create function public.skip_work_order_step(p_step uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
declare v_s public.work_order_billing_steps; v_next public.work_order_billing_steps; v_today date; v_reason text := nullif(btrim(p_reason), '');
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p_step is null then raise exception 'WBS_NOT_FOUND: billing step not found' using errcode = 'P0002'; end if;
  v_s := public.lock_wo_billing_step(p_step);
  if v_s.done_on is not null or v_s.skipped_on is not null then
    raise exception 'WBS_CLOSED: this billing step is already finished' using errcode = '55000';
  end if;
  if not v_s.optional then
    raise exception 'WBS_NOT_OPTIONAL: only an optional billing step can be skipped' using errcode = '55000';
  end if;
  if v_s.started_on is null then
    raise exception 'WBS_OUT_OF_ORDER: finish the earlier billing steps first' using errcode = '55000';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'WBS_REASON: give a reason of 3 to 500 characters' using errcode = '23514';
  end if;
  v_today := public.native_org_today(v_s.org_id);
  update public.work_order_billing_steps s set skipped_on = v_today, skipped_by = auth.uid(), skipped_reason = v_reason where s.id = v_s.id;
  update public.work_order_billing_steps s set started_on = v_today
   where s.work_order_id = v_s.work_order_id and s.started_on is null
     and s.position = (select min(s2.position) from public.work_order_billing_steps s2 where s2.work_order_id = v_s.work_order_id and s2.position > v_s.position)
  returning * into v_next;
  if v_next.id is not null then perform public.notify_wo_step_opened(v_next); end if;
  perform public.log_audit('wo_billing_step.skip', v_s.org_id, auth.uid(), v_s.work_order_id,
    jsonb_build_object('step_id', v_s.id, 'position', v_s.position, 'reason', v_reason));
end; $$;
revoke all on function public.skip_work_order_step(uuid, text) from public, anon;
grant execute on function public.skip_work_order_step(uuid, text) to authenticated, service_role;
