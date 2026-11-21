-- 1361 down: restores the 1021 bodies of the five functions. A claim already holding a skipped stage must be reviewed before
-- this runs: the restored predicate treats a skipped stage as still open.

create or replace function public.set_billing_stage_template(p_project uuid, p_stages jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_stage jsonb;
  v_doc   jsonb;
  v_pos   int := 0;
  v_dpos  int;
  v_tid   uuid;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set a project''s billing stages' using errcode = '42501';
  end if;
  perform 1 from public.projects p where p.id = p_project and p.org_id = v_org for update;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  if p_stages is null or jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) > 20 then
    raise exception 'the billing stages are a list of at most 20 stages' using errcode = '22023', detail = 'stages-shape';
  end if;

  delete from public.billing_stage_templates t where t.project_id = p_project;
  for v_stage in select x from jsonb_array_elements(p_stages) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_stage) <> 'object' or coalesce(btrim(v_stage ->> 'name'), '') = '' then
      raise exception 'every billing stage needs a name' using errcode = '23514', detail = 'stage-name-missing';
    end if;
    insert into public.billing_stage_templates (org_id, project_id, position, name, client_side)
    values (v_org, p_project, v_pos, btrim(v_stage ->> 'name'), coalesce((v_stage ->> 'client_side')::boolean, false))
    returning id into v_tid;
    v_dpos := 0;
    if jsonb_typeof(v_stage -> 'documents') = 'array' then
      if jsonb_array_length(v_stage -> 'documents') > 20 then
        raise exception 'a billing stage lists at most 20 documents' using errcode = '22023', detail = 'stages-shape';
      end if;
      for v_doc in select x from jsonb_array_elements(v_stage -> 'documents') x loop
        v_dpos := v_dpos + 1;
        if jsonb_typeof(v_doc) <> 'object' or coalesce(btrim(v_doc ->> 'name'), '') = '' then
          raise exception 'every checklist document needs a name' using errcode = '23514', detail = 'document-name-missing';
        end if;
        insert into public.billing_stage_template_documents (org_id, template_id, position, name, required)
        values (v_org, v_tid, v_dpos, btrim(v_doc ->> 'name'), coalesce((v_doc ->> 'required')::boolean, true));
      end loop;
    end if;
  end loop;

  perform public.log_audit('billing_stage_template.set', v_org, auth.uid(), p_project, jsonb_build_object('stages', v_pos));
  return v_pos;
end; $$;

create or replace function public.instantiate_claim_billing_stages() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'progress' then return new; end if;
  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.client_side,
         case when t.position = (select min(t2.position) from public.billing_stage_templates t2 where t2.project_id = new.project_id)
              then public.native_org_today(new.org_id) end
    from public.billing_stage_templates t
   where t.project_id = new.project_id and t.org_id = new.org_id;
  insert into public.claim_billing_stage_documents (org_id, stage_id, claim_id, position, name, required)
  select new.org_id, s.id, new.id, d.position, d.name, d.required
    from public.claim_billing_stages s
    join public.billing_stage_templates t on t.project_id = new.project_id and t.position = s.position
    join public.billing_stage_template_documents d on d.template_id = t.id
   where s.claim_id = new.id;
  return new;
end; $$;

create or replace function public.lock_billing_stage_claim(p_stage uuid) returns public.claim_billing_stages
  language plpgsql security definer set search_path = public as $$
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
  return v_s;
end; $$;

create or replace function public.complete_billing_stage(p_stage uuid, p_completed_on date, p_client_reference text default null,
                                                         p_note text default null) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_s    public.claim_billing_stages;
  v_prev date;
  v_ref  text := nullif(btrim(p_client_reference), '');
begin
  perform public.assert_is_active_member();
  if p_stage is null then raise exception 'billing stage not found' using errcode = 'P0002'; end if;
  v_s := public.lock_billing_stage_claim(p_stage);
  if exists (select 1 from public.claim_billing_stages s where s.claim_id = v_s.claim_id and s.position < v_s.position and s.completed_on is null) then
    raise exception 'complete the earlier billing stages first' using errcode = '55000', detail = 'stage-out-of-order';
  end if;
  if exists (select 1 from public.claim_billing_stage_documents d where d.stage_id = v_s.id and d.required and d.document_id is null) then
    raise exception 'attach every required document before completing this stage' using errcode = '55000', detail = 'stage-documents-missing';
  end if;
  if p_completed_on is null or p_completed_on > public.native_org_today(v_s.org_id) then
    raise exception 'the completion date cannot be in the future' using errcode = '22023', detail = 'stage-date-future';
  end if;
  select max(s.completed_on) into v_prev from public.claim_billing_stages s where s.claim_id = v_s.claim_id and s.position < v_s.position;
  if p_completed_on < coalesce(v_prev, v_s.started_on) then
    raise exception 'a stage cannot complete before the previous one' using errcode = '22023', detail = 'stage-date-before-previous';
  end if;
  if v_s.client_side and v_ref is null then
    raise exception 'record the client''s document number for a step done in the client''s system'
      using errcode = '23514', detail = 'client-reference-missing';
  end if;

  update public.claim_billing_stages s
     set completed_on = p_completed_on, client_reference = v_ref, note = coalesce(nullif(btrim(p_note), ''), s.note),
         completed_by = auth.uid(), completed_at = now()
   where s.id = v_s.id;
  update public.claim_billing_stages s set started_on = p_completed_on
   where s.claim_id = v_s.claim_id
     and s.position = (select min(s2.position) from public.claim_billing_stages s2 where s2.claim_id = v_s.claim_id and s2.position > v_s.position);
  perform public.log_audit('billing_stage.complete', v_s.org_id, auth.uid(), v_s.claim_id,
    jsonb_build_object('stage_id', v_s.id, 'position', v_s.position, 'completed_on', p_completed_on, 'client_reference', v_ref));
end; $$;

create or replace function public.billing_stages_open(p_claim uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.claim_billing_stages s where s.claim_id = p_claim and s.completed_on is null)
$$;
