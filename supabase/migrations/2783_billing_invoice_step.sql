-- 2783_billing_invoice_step.sql — a billing step list may name ONE step as the invoice step (#3022).
-- The invoice gate (billing_stages_open, used by the native invoice and ERP outbox triggers, neither of which changes) then
-- requires only the steps BEFORE the invoice step; the invoice step itself and the steps after it stay open and completable
-- after the invoice. A list with no invoice step keeps the full gate (every step), exactly as before.
-- The mark is copied like every other step field: org template -> project list -> claim snapshot. Only Finance or an Admin
-- sets it (the same right that edits a list or removes a claim step); on a claim with an invoice it is frozen (structural).
-- Payments are not gated by steps (unchanged). Bodies are restated from head with only the invoice-step lines added.
-- Proven by supabase/tests/2783_billing_invoice_step.test.sql. REVERSE: rollback/2783_billing_invoice_step_down.sql

-- drops: billing_stages_open(uuid) | "select exists (select 1 from public.claim_billing_stages s where s.claim_id = p_claim and s.completed_on is null and s.skipped_on is null)" | restated with the invoice-step column or rule added (#3022)
-- drops: instantiate_claim_billing_stages() | "insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, owner_role, started_on)" | restated with the invoice-step column or rule added (#3022)
-- drops: instantiate_claim_billing_stages() | "select new.org_id, new.id, new.project_id, t.position, t.name, t.client_side, t.target_days, t.optional, t.owner_role," | restated with the invoice-step column or rule added (#3022)
-- drops: load_billing_step_template_onto_claim(uuid,uuid) | "insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, owner_role, started_on)" | restated with the invoice-step column or rule added (#3022)
-- drops: load_billing_step_template_onto_claim(uuid,uuid) | "select v_org, p_claim, v_c.project_id, t.position, t.name, t.client_side, t.target_days, t.optional, t.owner_role," | restated with the invoice-step column or rule added (#3022)
-- drops: load_billing_step_template_onto_project(uuid,uuid) | "insert into public.billing_stage_templates (org_id, project_id, position, name, client_side, target_days, optional, owner_role)" | restated with the invoice-step column or rule added (#3022)
-- drops: load_billing_step_template_onto_project(uuid,uuid) | "select v_org, p_project, s.position, s.name, s.client_side, s.target_days, s.optional, s.owner_role" | restated with the invoice-step column or rule added (#3022)
-- drops: save_billing_step_template(uuid,text,jsonb) | "insert into public.billing_step_template_steps (org_id, template_id, position, name, owner_role, target_days, client_side, optional, claim_evidence_enabled)" | restated with the invoice-step column or rule added (#3022)
-- drops: save_billing_step_template(uuid,text,jsonb) | "coalesce((v_stage ->> 'client_side')::boolean, false), coalesce((v_stage ->> 'optional')::boolean, false), v_mark)" | restated with the invoice-step column or rule added (#3022)
-- drops: set_billing_stage_template(uuid,jsonb) | "insert into public.billing_stage_templates (org_id, project_id, position, name, client_side, target_days, optional, owner_role)" | restated with the invoice-step column or rule added (#3022)
-- drops: set_billing_stage_template(uuid,jsonb) | "v_days::smallint, coalesce((v_stage ->> 'optional')::boolean, false), v_owner)" | restated with the invoice-step column or rule added (#3022)
-- drops: update_claim_billing_step(uuid,jsonb) | "v_name   text; v_days numeric; v_owner user_role; v_on date; v_cs boolean; v_opt boolean;" | restated with the invoice-step column or rule added (#3022)
-- drops: update_claim_billing_step(uuid,jsonb) | "v_struct := p_patch ?| array['name','target_days','client_side','optional'];" | restated with the invoice-step column or rule added (#3022)
-- drops: update_claim_billing_step(uuid,jsonb) | "v_cs := v_s.client_side; v_opt := v_s.optional;" | restated with the invoice-step column or rule added (#3022)
-- drops: update_claim_billing_step(uuid,jsonb) | "set name = v_name, target_days = v_days::smallint, owner_role = v_owner, target_on = v_on, client_side = v_cs, optional = v_opt," | restated with the invoice-step column or rule added (#3022)

alter table public.billing_step_template_steps add column invoice_step boolean not null default false;
alter table public.billing_stage_templates     add column invoice_step boolean not null default false;
alter table public.claim_billing_stages        add column invoice_step boolean not null default false;
create unique index billing_step_template_steps_one_invoice_step on public.billing_step_template_steps (template_id) where invoice_step;
create unique index billing_stage_templates_one_invoice_step     on public.billing_stage_templates (project_id) where invoice_step;
create unique index claim_billing_stages_one_invoice_step        on public.claim_billing_stages (claim_id) where invoice_step;

-- ── billing_stages_open ──
CREATE OR REPLACE FUNCTION public.billing_stages_open(p_claim uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  select exists (select 1 from public.claim_billing_stages s where s.claim_id = p_claim and s.completed_on is null and s.skipped_on is null
                   and s.position < coalesce((select i.position from public.claim_billing_stages i
                                               where i.claim_id = p_claim and i.invoice_step), 32767))
$function$;
;

-- ── save_billing_step_template ──
CREATE OR REPLACE FUNCTION public.save_billing_step_template(p_template uuid, p_name text, p_steps jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_id    uuid      := p_template;
  v_name  text      := btrim(coalesce(p_name, ''));
  v_stage jsonb; v_doc jsonb; v_pos int := 0; v_dpos int; v_sid uuid; v_days numeric; v_owner user_role;
  v_old_marks jsonb := '{}'::jsonb; v_seen jsonb := '{}'::jsonb;
  v_source text; v_old_mark boolean; v_mark boolean;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_not_light();
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
  if (select count(*) from jsonb_array_elements(p_steps) x
       where jsonb_typeof(x) = 'object' and jsonb_typeof(x -> 'invoice_step') = 'boolean' and (x ->> 'invoice_step')::boolean) > 1 then
    raise exception 'only one step can be the invoice step' using errcode = '23514', detail = 'invoice-step-repeated';
  end if;
  if v_id is null then
    insert into public.billing_step_templates (org_id, name, created_by) values (v_org, v_name, auth.uid()) returning id into v_id;
  else
    perform 1 from public.billing_step_templates t where t.id = v_id and t.org_id = v_org and t.archived_at is null for update;
    if not found then raise exception 'template not found' using errcode = 'P0002', detail = 'template-not-found'; end if;
    select coalesce(jsonb_object_agg(s.id::text, s.claim_evidence_enabled), '{}'::jsonb) into v_old_marks
      from public.billing_step_template_steps s where s.template_id = v_id and s.org_id = v_org;
    if v_role <> 'Admin'
       and exists (select 1 from jsonb_each_text(v_old_marks) m where m.value = 'true')
       and not exists (select 1 from jsonb_array_elements(p_steps) x where x ? 'template_step_id') then
      raise exception 'WBS_EVIDENCE_MARK: reopen the template before editing its marked steps' using errcode = '42501';
    end if;
    -- A designation belongs to the named step and its document requirements, not
    -- merely to a caller-supplied UUID. Finance may reorder it, but may not
    -- remove it or change what that designation means.
    if v_role <> 'Admin' and exists (
      select 1 from public.billing_step_template_steps marked
       where marked.template_id = v_id and marked.org_id = v_org and marked.claim_evidence_enabled
         and not exists (
           select 1 from jsonb_array_elements(p_steps) candidate
            where candidate ->> 'template_step_id' = marked.id::text
              and btrim(coalesce(candidate ->> 'name', '')) = marked.name
              and (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'required', d.required) order by d.position), '[]'::jsonb)
                     from public.billing_step_template_documents d where d.step_id = marked.id)
                  = (select coalesce(jsonb_agg(jsonb_build_object('name', btrim(coalesce(doc ->> 'name', '')),
                            'required', coalesce((doc ->> 'required')::boolean, true)) order by ord), '[]'::jsonb)
                       from jsonb_array_elements(case when jsonb_typeof(candidate -> 'documents') = 'array'
                          then candidate -> 'documents' else '[]'::jsonb end) with ordinality as docs(doc, ord))
         )
    ) then
      raise exception 'WBS_EVIDENCE_MARK: only an Admin can remove or repurpose a designated step' using errcode = '42501';
    end if;
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
    v_source := nullif(v_stage ->> 'template_step_id', '');
    if v_source is not null and (not (v_old_marks ? v_source) or v_seen ? v_source) then
      raise exception 'WBS_EVIDENCE_MARK: template step is invalid or repeated' using errcode = '23514';
    end if;
    if v_source is not null then v_seen := v_seen || jsonb_build_object(v_source, true); end if;
    v_old_mark := coalesce((v_old_marks ->> v_source)::boolean, false);
    if v_stage ? 'claim_evidence_enabled' and jsonb_typeof(v_stage -> 'claim_evidence_enabled') <> 'boolean' then
      raise exception 'WBS_EVIDENCE_MARK: choose on or off' using errcode = '22023';
    end if;
    v_mark := coalesce((v_stage ->> 'claim_evidence_enabled')::boolean, v_old_mark);
    if v_role <> 'Admin' and v_mark is distinct from v_old_mark then
      raise exception 'WBS_EVIDENCE_MARK: only an Admin can choose which step documents count as claim evidence' using errcode = '42501';
    end if;
    insert into public.billing_step_template_steps (org_id, template_id, position, name, owner_role, target_days, client_side, optional, claim_evidence_enabled, invoice_step)
    values (v_org, v_id, v_pos, btrim(v_stage ->> 'name'), v_owner, v_days::smallint,
            coalesce((v_stage ->> 'client_side')::boolean, false), coalesce((v_stage ->> 'optional')::boolean, false), v_mark,
            coalesce((v_stage ->> 'invoice_step')::boolean, false))
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
end; $function$;
;

-- ── set_billing_stage_template ──
CREATE OR REPLACE FUNCTION public.set_billing_stage_template(p_project uuid, p_stages jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
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
  perform public.assert_not_light();
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

  if (select count(*) from jsonb_array_elements(p_stages) x
       where jsonb_typeof(x) = 'object' and jsonb_typeof(x -> 'invoice_step') = 'boolean' and (x ->> 'invoice_step')::boolean) > 1 then
    raise exception 'only one step can be the invoice step' using errcode = '23514', detail = 'invoice-step-repeated';
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
    insert into public.billing_stage_templates (org_id, project_id, position, name, client_side, target_days, optional, owner_role, invoice_step)
    values (v_org, p_project, v_pos, btrim(v_stage ->> 'name'), coalesce((v_stage ->> 'client_side')::boolean, false),
            v_days::smallint, coalesce((v_stage ->> 'optional')::boolean, false), v_owner, coalesce((v_stage ->> 'invoice_step')::boolean, false))
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
end; $function$;
;

-- ── load_billing_step_template_onto_project ──
CREATE OR REPLACE FUNCTION public.load_billing_step_template_onto_project(p_project uuid, p_template uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role(); v_n int;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set a project''s billing stages' using errcode = '42501';
  end if;
  perform 1 from public.projects p where p.id = p_project and p.org_id = v_org for update;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  perform 1 from public.billing_step_templates t where t.id = p_template and t.org_id = v_org and t.archived_at is null;
  if not found then raise exception 'template not found' using errcode = 'P0002', detail = 'template-not-found'; end if;

  delete from public.billing_stage_templates t where t.project_id = p_project;
  insert into public.billing_stage_templates (org_id, project_id, position, name, client_side, target_days, optional, owner_role, invoice_step)
  select v_org, p_project, s.position, s.name, s.client_side, s.target_days, s.optional, s.owner_role, s.invoice_step
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
end; $function$;
;

-- ── load_billing_step_template_onto_claim ──
CREATE OR REPLACE FUNCTION public.load_billing_step_template_onto_claim(p_claim uuid, p_template uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_role user_role := public.auth_role();
  v_c public.progress_claims; v_n int;
begin
  perform public.assert_not_light();
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
  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, owner_role, invoice_step, started_on)
  select v_org, p_claim, v_c.project_id, t.position, t.name, t.client_side, t.target_days, t.optional, t.owner_role, t.invoice_step,
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
end; $function$;
;

-- ── instantiate_claim_billing_stages ──
CREATE OR REPLACE FUNCTION public.instantiate_claim_billing_stages()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
begin
  if new.kind <> 'progress' then return new; end if;
  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, owner_role, invoice_step, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.client_side, t.target_days, t.optional, t.owner_role, t.invoice_step,
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
end; $function$;
;

-- ── update_claim_billing_step ──
CREATE OR REPLACE FUNCTION public.update_claim_billing_step(p_stage uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
declare
  v_org    uuid := public.auth_org_id();
  v_claim  uuid;
  v_s      public.claim_billing_stages;
  v_struct boolean;
  v_name   text; v_days numeric; v_owner user_role; v_on date; v_cs boolean; v_opt boolean; v_inv boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or a Project Manager can edit billing steps' using errcode = '42501';
  end if;
  if p_stage is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'billing step not found' using errcode = 'P0002';
  end if;
  select s.claim_id into v_claim from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  if not found then raise exception 'billing step not found' using errcode = 'P0002'; end if;
  v_struct := p_patch ?| array['name','target_days','client_side','optional','invoice_step'];
  -- Moving the invoice step changes which steps the invoice waits for (a waiver, as removing a step): Finance or an Admin.
  if p_patch ? 'invoice_step' and public.auth_role() not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can choose the invoice step' using errcode = '42501';
  end if;
  perform public.lock_claim_for_step_edit(v_claim, v_struct);
  select * into v_s from public.claim_billing_stages s where s.id = p_stage for update;
  if v_s.completed_on is not null or v_s.skipped_on is not null then
    raise exception 'a finished billing step cannot be changed' using errcode = '55000', detail = 'stage-not-editable';
  end if;
  v_name := v_s.name; v_days := v_s.target_days; v_owner := v_s.owner_role; v_on := v_s.target_on;
  v_cs := v_s.client_side; v_opt := v_s.optional; v_inv := v_s.invoice_step;
  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if v_name = '' or length(v_name) > 120 then
      raise exception 'every billing step needs a name' using errcode = '23514', detail = 'stage-name-missing';
    end if;
  end if;
  if p_patch ? 'target_days' then
    v_days := null;
    if jsonb_typeof(p_patch -> 'target_days') = 'number' then
      v_days := (p_patch ->> 'target_days')::numeric;
      if v_days <> trunc(v_days) or v_days < 1 or v_days > 365 then
        raise exception 'a step target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
      end if;
    elsif jsonb_typeof(p_patch -> 'target_days') <> 'null' then
      raise exception 'a step target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
    end if;
  end if;
  if p_patch ? 'owner_role' then v_owner := nullif(btrim(coalesce(p_patch ->> 'owner_role', '')), '')::user_role; end if;
  if p_patch ? 'target_on' then v_on := nullif(btrim(coalesce(p_patch ->> 'target_on', '')), '')::date; end if;
  if p_patch ? 'client_side' then v_cs := coalesce((p_patch ->> 'client_side')::boolean, v_cs); end if;
  if p_patch ? 'optional' then v_opt := coalesce((p_patch ->> 'optional')::boolean, v_opt); end if;
  if p_patch ? 'invoice_step' then v_inv := coalesce((p_patch ->> 'invoice_step')::boolean, v_inv); end if;
  if v_inv and not v_s.invoice_step
     and exists (select 1 from public.claim_billing_stages s where s.claim_id = v_claim and s.invoice_step and s.id <> v_s.id) then
    raise exception 'only one step can be the invoice step' using errcode = '23514', detail = 'invoice-step-repeated';
  end if;

  update public.claim_billing_stages s
     set name = v_name, target_days = v_days::smallint, owner_role = v_owner, target_on = v_on, client_side = v_cs, optional = v_opt, invoice_step = v_inv,
         -- a changed target restarts the once-only overdue notice
         overdue_notified_at = case when v_days is distinct from v_s.target_days::numeric or v_on is distinct from v_s.target_on
                                    then null else s.overdue_notified_at end
   where s.id = v_s.id;
  perform public.log_audit('billing_step.update', v_s.org_id, auth.uid(), v_claim,
    jsonb_build_object('stage_id', v_s.id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)));
end; $function$;
;

