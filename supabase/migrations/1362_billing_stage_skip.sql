-- 1362_billing_stage_skip.sql — mark an optional billing stage not needed, with a reason (#2592). FR-BSX-020/021/024/030/031.
-- Finance or an Admin only (a Project Manager completes stages, cannot waive one). The skip is final and counts as complete for the
-- invoice gate (billing_stages_open, 1361). Proven by supabase/tests/1360_billing_stage_targets.test.sql (AC-BSX-007/008/011).
-- ── REVERSE: rollback/1362_billing_stage_skip_down.sql ───────────────────────────────────────────────────────────────

create function public.skip_billing_stage(p_stage uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid      := public.auth_org_id();
  v_role   user_role := public.auth_role();
  v_claim  uuid;
  v_wd     timestamptz;
  v_s      public.claim_billing_stages;
  v_reason text := nullif(btrim(p_reason), '');
  v_today  date;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can mark a billing stage not needed' using errcode = '42501';
  end if;
  if p_stage is null then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  select s.claim_id into v_claim from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  if not found then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  -- Same lock order as lock_billing_stage_claim: the claim row, then the stage row.
  select pc.withdrawn_at into v_wd from public.progress_claims pc where pc.id = v_claim for update;
  select * into v_s from public.claim_billing_stages s where s.id = p_stage for update;
  if v_wd is not null or not v_s.optional or v_s.completed_on is not null or v_s.skipped_on is not null
     or v_s.started_on is null
     or exists (select 1 from public.claim_billing_stages e where e.claim_id = v_s.claim_id and e.position < v_s.position
                  and e.completed_on is null and e.skipped_on is null) then
    raise exception 'this billing stage cannot be marked not needed' using errcode = '55000', detail = 'stage-not-skippable';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'give a reason of 3 to 500 characters' using errcode = '23514', detail = 'skip-reason-invalid';
  end if;

  v_today := public.native_org_today(v_s.org_id);
  update public.claim_billing_stages s
     set skipped_on = greatest(v_today, s.started_on), skipped_by = auth.uid(), skipped_reason = v_reason
   where s.id = v_s.id;
  update public.claim_billing_stages s set started_on = greatest(v_today, v_s.started_on)
   where s.claim_id = v_s.claim_id
     and s.position = (select min(s2.position) from public.claim_billing_stages s2 where s2.claim_id = v_s.claim_id and s2.position > v_s.position);
  perform public.log_audit('billing_stage.skip', v_s.org_id, auth.uid(), v_s.claim_id,
    jsonb_build_object('stage_id', v_s.id, 'position', v_s.position, 'reason', v_reason));
end; $$;
revoke all on function public.skip_billing_stage(uuid, text) from public, anon;
grant execute on function public.skip_billing_stage(uuid, text) to authenticated, service_role;
