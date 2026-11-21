-- 1366_billing_step_template_rpcs.sql — organisation step templates: save, archive, load onto a project or a claim (#2680).
-- FR-CBS-001..004/020; proven by supabase/tests/1365_claim_billing_steps.test.sql (AC-CBS-001..003). Loading COPIES: nothing links
-- a project or claim to its template (OD-CBS-4). Finance or an Admin writes templates; Loading onto a claim is Finance/Admin too.
-- ── REVERSE: rollback/1366_billing_step_template_rpcs_down.sql ───────────────────────────────────────────────────────

-- ── has this claim an invoice (native, or an ERP command)? Used by the claim-step functions to freeze structure ──────────
create function public.billing_claim_invoiced(p_claim uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sales_invoices si where si.id = p_claim)
      or exists (select 1 from public.external_command_outbox o where o.domain = 'revenue' and o.pmo_record_id = p_claim::text)
$$;
revoke all on function public.billing_claim_invoiced(uuid) from public, anon, authenticated;
grant execute on function public.billing_claim_invoiced(uuid) to service_role;

-- ── the project's list now reads an optional owner role per stage (everything else as 1361) ────────────────────────────
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
  v_days  numeric;
  v_owner user_role;
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
    v_days := null;
    if v_stage ? 'target_days' and jsonb_typeof(v_stage -> 'target_days') <> 'null' then
      if jsonb_typeof(v_stage -> 'target_days') <> 'number' then
        raise exception 'a stage target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
      end if;
      v_days := (v_stage ->> 'target_days')::numeric;
      if v_days <> trunc(v_days) or v_days < 1 or v_days > 365 then
        raise exception 'a stage target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
      end if;
    end if;
    v_owner := nullif(btrim(coalesce(v_stage ->> 'owner_role', '')), '')::user_role;  -- 22P02 for a role that does not exist
    insert into public.billing_stage_templates (org_id, project_id, position, name, client_side, target_days, optional, owner_role)
    values (v_org, p_project, v_pos, btrim(v_stage ->> 'name'), coalesce((v_stage ->> 'client_side')::boolean, false),
            v_days::smallint, coalesce((v_stage ->> 'optional')::boolean, false), v_owner)
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
revoke all on function public.set_billing_stage_template(uuid, jsonb) from public, anon;
grant execute on function public.set_billing_stage_template(uuid, jsonb) to authenticated, service_role;

-- ── save (create or replace the steps of) a template ───────────────────────────────────────────────────────────────────
create function public.save_billing_step_template(p_template uuid, p_name text, p_steps jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_id    uuid      := p_template;
  v_name  text      := btrim(coalesce(p_name, ''));
  v_stage jsonb; v_doc jsonb; v_pos int := 0; v_dpos int; v_sid uuid; v_days numeric; v_owner user_role;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can save a billing step template' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'a template needs a name of up to 120 characters' using errcode = '23514', detail = 'template-name-invalid';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 20 then
    raise exception 'a template is a list of at most 20 steps' using errcode = '22023', detail = 'stages-shape';
  end if;
  if v_id is null then
    insert into public.billing_step_templates (org_id, name, created_by) values (v_org, v_name, auth.uid()) returning id into v_id;
  else
    perform 1 from public.billing_step_templates t where t.id = v_id and t.org_id = v_org and t.archived_at is null for update;
    if not found then raise exception 'template not found' using errcode = 'P0002', detail = 'template-not-found'; end if;
    update public.billing_step_templates set name = v_name where id = v_id;
    delete from public.billing_step_template_steps where template_id = v_id;
  end if;
  for v_stage in select x from jsonb_array_elements(p_steps) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_stage) <> 'object' or coalesce(btrim(v_stage ->> 'name'), '') = '' then
      raise exception 'every step needs a name' using errcode = '23514', detail = 'stage-name-missing';
    end if;
    v_days := null;
    if v_stage ? 'target_days' and jsonb_typeof(v_stage -> 'target_days') <> 'null' then
      if jsonb_typeof(v_stage -> 'target_days') <> 'number' then
        raise exception 'a step target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
      end if;
      v_days := (v_stage ->> 'target_days')::numeric;
      if v_days <> trunc(v_days) or v_days < 1 or v_days > 365 then
        raise exception 'a step target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
      end if;
    end if;
    v_owner := nullif(btrim(coalesce(v_stage ->> 'owner_role', '')), '')::user_role;
    insert into public.billing_step_template_steps (org_id, template_id, position, name, owner_role, target_days, client_side, optional)
    values (v_org, v_id, v_pos, btrim(v_stage ->> 'name'), v_owner, v_days::smallint,
            coalesce((v_stage ->> 'client_side')::boolean, false), coalesce((v_stage ->> 'optional')::boolean, false))
    returning id into v_sid;
    v_dpos := 0;
    if jsonb_typeof(v_stage -> 'documents') = 'array' then
      if jsonb_array_length(v_stage -> 'documents') > 20 then
        raise exception 'a step lists at most 20 documents' using errcode = '22023', detail = 'stages-shape';
      end if;
      for v_doc in select x from jsonb_array_elements(v_stage -> 'documents') x loop
        v_dpos := v_dpos + 1;
        if jsonb_typeof(v_doc) <> 'object' or coalesce(btrim(v_doc ->> 'name'), '') = '' then
          raise exception 'every checklist document needs a name' using errcode = '23514', detail = 'document-name-missing';
        end if;
        insert into public.billing_step_template_documents (org_id, step_id, position, name, required)
        values (v_org, v_sid, v_dpos, btrim(v_doc ->> 'name'), coalesce((v_doc ->> 'required')::boolean, true));
      end loop;
    end if;
  end loop;
  perform public.log_audit('billing_step_template.save', v_org, auth.uid(), v_id, jsonb_build_object('steps', v_pos));
  return v_id;
end; $$;
revoke all on function public.save_billing_step_template(uuid, text, jsonb) from public, anon;
grant execute on function public.save_billing_step_template(uuid, text, jsonb) to authenticated, service_role;

-- ── archive: it can no longer be loaded; what was copied from it is untouched ──────────────────────────────────────────
create function public.archive_billing_step_template(p_template uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can archive a billing step template' using errcode = '42501';
  end if;
  update public.billing_step_templates set archived_at = now() where id = p_template and org_id = v_org and archived_at is null;
  if not found then raise exception 'template not found' using errcode = 'P0002', detail = 'template-not-found'; end if;
  perform public.log_audit('billing_step_template.archive', v_org, auth.uid(), p_template, '{}'::jsonb);
end; $$;
revoke all on function public.archive_billing_step_template(uuid) from public, anon;
grant execute on function public.archive_billing_step_template(uuid) to authenticated, service_role;

-- ── load onto a project: its list becomes a copy (claims already made are not touched) ─────────────────────────────────
create function public.load_billing_step_template_onto_project(p_project uuid, p_template uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role(); v_n int;
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set a project''s billing stages' using errcode = '42501';
  end if;
  perform 1 from public.projects p where p.id = p_project and p.org_id = v_org for update;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  perform 1 from public.billing_step_templates t where t.id = p_template and t.org_id = v_org and t.archived_at is null;
  if not found then raise exception 'template not found' using errcode = 'P0002', detail = 'template-not-found'; end if;

  delete from public.billing_stage_templates t where t.project_id = p_project;
  insert into public.billing_stage_templates (org_id, project_id, position, name, client_side, target_days, optional, owner_role)
  select v_org, p_project, s.position, s.name, s.client_side, s.target_days, s.optional, s.owner_role
    from public.billing_step_template_steps s where s.template_id = p_template;
  get diagnostics v_n = row_count;
  insert into public.billing_stage_template_documents (org_id, template_id, position, name, required)
  select v_org, bt.id, d.position, d.name, d.required
    from public.billing_step_template_steps s
    join public.billing_stage_templates bt on bt.project_id = p_project and bt.position = s.position
    join public.billing_step_template_documents d on d.step_id = s.id
   where s.template_id = p_template;
  perform public.log_audit('billing_step_template.load_project', v_org, auth.uid(), p_project,
    jsonb_build_object('template_id', p_template, 'stages', v_n));
  return v_n;
end; $$;
revoke all on function public.load_billing_step_template_onto_project(uuid, uuid) from public, anon;
grant execute on function public.load_billing_step_template_onto_project(uuid, uuid) to authenticated, service_role;

-- ── load onto a claim whose steps are untouched: replace them with a copy, the first current from today ───────────────
create function public.load_billing_step_template_onto_claim(p_claim uuid, p_template uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
  v_c public.progress_claims; v_n int;
begin
  perform public.assert_is_active_member();
  -- Loading can shorten a claim's list, which waives steps for the gate exactly as removal does (OD-CBS-1): Finance or an Admin only.
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can load a billing step template onto a claim' using errcode = '42501';
  end if;
  -- Same claim row lock as the other stage writers.
  select * into v_c from public.progress_claims pc where pc.id = p_claim and pc.org_id = v_org for update;
  if not found then raise exception 'progress claim not found' using errcode = 'P0002'; end if;
  if v_c.kind <> 'progress' then
    raise exception 'only a progress claim has billing steps' using errcode = '55000', detail = 'claim-has-no-steps';
  end if;
  perform 1 from public.billing_step_templates t where t.id = p_template and t.org_id = v_org and t.archived_at is null;
  if not found then raise exception 'template not found' using errcode = 'P0002', detail = 'template-not-found'; end if;
  if not exists (select 1 from public.billing_step_template_steps t where t.template_id = p_template) then
    raise exception 'this template has no steps' using errcode = '22023', detail = 'template-empty';
  end if;
  if v_c.withdrawn_at is not null or public.billing_claim_invoiced(p_claim)
     or exists (select 1 from public.claim_billing_stages s where s.claim_id = p_claim and (s.completed_on is not null or s.skipped_on is not null))
     or exists (select 1 from public.claim_billing_stage_documents d where d.claim_id = p_claim and d.document_id is not null) then
    raise exception 'this claim''s steps have started; they can no longer be replaced from a template'
      using errcode = '55000', detail = 'claim-steps-started';
  end if;

  delete from public.claim_billing_stages s where s.claim_id = p_claim;
  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, owner_role, started_on)
  select v_org, p_claim, v_c.project_id, t.position, t.name, t.client_side, t.target_days, t.optional, t.owner_role,
         case when t.position = (select min(t2.position) from public.billing_step_template_steps t2 where t2.template_id = p_template)
              then public.native_org_today(v_org) end
    from public.billing_step_template_steps t where t.template_id = p_template;
  get diagnostics v_n = row_count;
  insert into public.claim_billing_stage_documents (org_id, stage_id, claim_id, position, name, required)
  select v_org, cs.id, p_claim, d.position, d.name, d.required
    from public.billing_step_template_steps t
    join public.claim_billing_stages cs on cs.claim_id = p_claim and cs.position = t.position
    join public.billing_step_template_documents d on d.step_id = t.id
   where t.template_id = p_template;
  perform public.log_audit('billing_step_template.load_claim', v_org, auth.uid(), p_claim,
    jsonb_build_object('template_id', p_template, 'steps', v_n));
  return v_n;
end; $$;
revoke all on function public.load_billing_step_template_onto_claim(uuid, uuid) from public, anon;
grant execute on function public.load_billing_step_template_onto_claim(uuid, uuid) to authenticated, service_role;
