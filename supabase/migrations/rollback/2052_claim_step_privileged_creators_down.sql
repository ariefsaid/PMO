CREATE OR REPLACE FUNCTION public.lock_billing_stage_claim(p_stage uuid)
 RETURNS claim_billing_stages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_s     public.claim_billing_stages;
  v_claim uuid;
  v_wd    timestamptz;
  v_owner public.user_role;
  v_project uuid;
  v_creator uuid;
  v_is_owner boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select s.claim_id, s.owner_role, s.project_id into v_claim, v_owner, v_project
    from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  v_is_owner := v_claim is not null and v_owner is not null and v_role = v_owner                          -- mut:rr_step_owner
                and coalesce(public.actor_may_run_billing_steps(), false)
                and (v_owner <> 'Project Manager'
                     or exists (select 1 from public.projects pr where pr.id = v_project and pr.project_manager_id = auth.uid()));
  if not v_is_owner and (v_role is null or v_role not in ('Admin','Finance','Project Manager')) then
    raise exception 'only Finance, an Admin, a Project Manager or the step''s owner can record billing stages' using errcode = '42501';
  end if;
  if v_claim is null then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  -- Same row lock as attach_claim_evidence, withdraw_progress_claim and the outbox fence.
  select pc.withdrawn_at, pc.created_by into v_wd, v_creator from public.progress_claims pc where pc.id = v_claim for update;
  -- Separation of duties: a step with a named owner is never completed by the claim's creator unless they are that owner.
  if v_owner is not null and not v_is_owner and v_creator is not distinct from auth.uid() then                -- mut:rr_step_creator
    raise exception 'this billing step belongs to its named owner, not to whoever created the claim' using errcode = '42501', detail = 'stage-owner-only';
  end if;
  if v_wd is not null then
    raise exception 'this progress claim was withdrawn' using errcode = '55000', detail = 'claim-withdrawn';
  end if;
  select * into v_s from public.claim_billing_stages s where s.id = p_stage for update;
  if v_s.completed_on is not null then
    raise exception 'this billing stage is already completed' using errcode = '55000', detail = 'stage-already-completed';
  end if;
  if v_s.skipped_on is not null then
    raise exception 'this billing stage was marked not needed' using errcode = '55000', detail = 'stage-already-skipped';
  end if;
  return v_s;
end; $function$
;
