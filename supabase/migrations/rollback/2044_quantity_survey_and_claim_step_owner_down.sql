-- Reverses 2044_quantity_survey_and_claim_step_owner.sql: the live bodies and policies from before it.

CREATE OR REPLACE FUNCTION public.record_survey(p_work_order uuid, p_boq_item uuid, p_date date, p_surveyed numeric, p_quality_ready numeric, p_participants jsonb, p_supersedes uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project uuid; v_org uuid; v_id uuid; v_p jsonb; v_old public.survey_records; v_basis text;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select l.project_id, l.org_id into v_project, v_org from public.survey_lock_work_order(p_work_order) l;
  if not public.may_record_project_progress(v_project) then
    raise exception 'SVY_NOT_PERMITTED: you may record a survey on a project you manage, unless you are Finance, an Executive or an Admin' using errcode = '42501';
  end if;
  if p_date is null or p_surveyed is null or p_quality_ready is null or p_surveyed < 0 or p_quality_ready < 0
     or p_surveyed = 'Infinity'::numeric or p_surveyed <> round(p_surveyed, 3) or p_quality_ready <> round(p_quality_ready, 3) then
    raise exception 'SVY_BAD_QUANTITY: enter a date and quantities that are zero or more, with at most 3 decimals' using errcode = '23514';
  end if;
  if p_quality_ready > p_surveyed then
    raise exception 'SVY_QUALITY_OVER: the quality-ready quantity cannot be more than the surveyed quantity' using errcode = '23514';
  end if;
  if p_participants is null or jsonb_typeof(p_participants) <> 'array' or jsonb_array_length(p_participants) not between 1 and 30 then
    raise exception 'SVY_NEEDS_PARTICIPANT: record who took part in the survey, at least one person' using errcode = '23514';
  end if;
  select b.earning_basis into v_basis from public.boq_items b
   where b.id = p_boq_item and b.org_id = v_org
     and exists (select 1 from public.work_order_lines wl where wl.work_order_id = p_work_order and wl.boq_item_id = p_boq_item);
  if not found then
    raise exception 'SVY_NOT_ALLOCATED: this contract line is not allocated to the work order' using errcode = '23514';
  end if;
  if v_basis = 'lump_sum' then
    raise exception 'SVY_LUMP_SUM: a survey is recorded on a unit-rate line, not a lump-sum line' using errcode = '23514';
  end if;
  if p_supersedes is not null then
    select * into v_old from public.survey_records r
     where r.id = p_supersedes and r.org_id = v_org and r.work_order_id = p_work_order and r.boq_item_id = p_boq_item;
    if not found or v_old.status <> 'confirmed' or v_old.superseded_at is not null then
      raise exception 'SVY_NOT_CORRECTABLE: only a confirmed survey of the same line that has not been corrected can be corrected' using errcode = '23514';
    end if;
    if exists (select 1 from public.survey_records r where r.supersedes_id = p_supersedes and r.archived_at is null) then
      raise exception 'SVY_ALREADY_CORRECTED: a correction of this survey is already open; confirm or discard it first' using errcode = '23514';
    end if;
  end if;
  insert into public.survey_records (org_id, project_id, work_order_id, boq_item_id, survey_date, surveyed_quantity,
                                     quality_ready_quantity, note, recorded_by, supersedes_id)
  values (v_org, v_project, p_work_order, p_boq_item, p_date, p_surveyed, p_quality_ready, nullif(btrim(p_note), ''), auth.uid(), p_supersedes)
  returning id into v_id;
  for v_p in select x from jsonb_array_elements(p_participants) x loop
    if jsonb_typeof(v_p) <> 'object' or coalesce(btrim(v_p ->> 'name'), '') = '' or length(btrim(v_p ->> 'name')) > 120 then
      raise exception 'SVY_NEEDS_PARTICIPANT: every participant needs a name of 1 to 120 characters' using errcode = '23514';
    end if;
    insert into public.survey_participants (org_id, record_id, name, company, role_label, profile_id)
    values (v_org, v_id, btrim(v_p ->> 'name'), nullif(btrim(v_p ->> 'company'), ''), nullif(btrim(v_p ->> 'role'), ''),
            (select p.id from public.profiles p where p.id = nullif(v_p ->> 'profile_id', '')::uuid and p.org_id = v_org));
  end loop;
  perform public.log_audit('survey.record', v_org, auth.uid(), v_id,
    jsonb_build_object('work_order_id', p_work_order, 'boq_item_id', p_boq_item, 'surveyed', p_surveyed, 'quality_ready', p_quality_ready, 'supersedes', p_supersedes));
  return v_id;
end $function$
;

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
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or a Project Manager can record billing stages' using errcode = '42501';
  end if;
  select s.claim_id into v_claim from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  if not found then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  -- Same row lock as attach_claim_evidence, withdraw_progress_claim and the outbox fence.
  select pc.withdrawn_at into v_wd from public.progress_claims pc where pc.id = v_claim for update;
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

alter policy progress_claims_engineer_read_scope on public.progress_claims
  using ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]));

alter policy progress_claim_lines_engineer_read_scope on public.progress_claim_lines
  using ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]));

alter policy progress_claim_evidence_engineer_read_scope on public.progress_claim_evidence
  using ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]));

alter policy claim_billing_stages_engineer_read_scope on public.claim_billing_stages
  using ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]));

alter policy claim_billing_stage_documents_engineer_read_scope on public.claim_billing_stage_documents
  using ((select public.auth_role()) = any (array['Admin'::user_role, 'Executive'::user_role, 'Project Manager'::user_role, 'Finance'::user_role]));
