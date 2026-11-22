-- 1772_wo_billing_step_functions.sql — the writers of a work order's billing step list. Spec docs/specs/billing-steps.spec.md (FR-WBS-006/007/010).
-- Rollback: supabase/migrations/rollback/1772_wo_billing_step_functions_down.sql
-- Pattern: 1401/1418 (close-out). All SECURITY DEFINER: a field account, membership, organisation and role are re-asserted; the work-order row is
-- locked FOR UPDATE first (the order transition_work_order and confirm_work_order_acceptance take); every write leaves an audit event. ADVISORY:
-- nothing here reads or writes claim_billing_stages, and billing_stages_open is not touched. Every refusal is `WBS_CODE: sentence` (refusals catalogue).
-- Acting on a step: a holder of billing_steps_run, a holder of the step's owner role, or its named person (a Project Manager level person acts
-- through the run right only on the projects they manage, as for claims). Hidden-from beats all of them except the named person (wo_step_readable).

-- ── tell the people a step is waiting for (in-app notice; the email goes through the existing per-organisation billing_step switch) ──────────────
-- Recipients: the named person, else the active holders of the owner role, else the Admins. A role the step is hidden from is never told, and a
-- hidden step's notice does not name the step (extra-role email copies cannot leak what the step is called).
create function public.notify_wo_step_opened(p_step public.work_order_billing_steps) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_who uuid; v_label text; v_found boolean := false; v_body text;
begin
  select coalesce(w.wo_number, w.title) into v_label from public.work_orders w where w.id = p_step.work_order_id;
  v_body := case when cardinality(p_step.hidden_from_role_keys) > 0
                 then format('A billing step of work order %s is now open and waiting for you.', v_label)
                 else format('Billing step "%s" of work order %s is now open and waiting for you.', p_step.name, v_label) end;
  for v_who in
    select distinct x from (
      select p_step.assignee_id as x where p_step.assignee_id is not null
      union all
      select m.id from public.profiles m
       where p_step.assignee_id is null and p_step.owner_role_key is not null and m.org_id = p_step.org_id
         and m.status = 'active' and m.built_in_role = p_step.owner_role_key
         and not (m.built_in_role = any (p_step.hidden_from_role_keys))
    ) r
  loop
    v_found := true;
    perform public.notify_workflow_user(p_step.org_id, v_who, 'A billing step is waiting for you', v_body, 'info', 'work_order',
                                        p_step.work_order_id, v_label, 'billing_step');
  end loop;
  if not v_found then
    for v_who in
      select a.id from public.profiles a
       where a.org_id = p_step.org_id and a.role = 'Admin' and a.status = 'active'
         and not coalesce(a.built_in_role = any (p_step.hidden_from_role_keys), false)
    loop
      perform public.notify_workflow_user(p_step.org_id, v_who, 'A billing step is waiting for you', v_body, 'info', 'work_order',
                                          p_step.work_order_id, v_label, 'billing_step');
    end loop;
  end if;
end; $$;
revoke all on function public.notify_wo_step_opened(public.work_order_billing_steps) from public, anon, authenticated;

-- ── shared: check the caller may act on a step, lock its work order and the step, return the locked step ─────────────────────────────────────
create function public.lock_wo_billing_step(p_step uuid) returns public.work_order_billing_steps
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_me     uuid := auth.uid();
  v_key    text := public.actor_built_in_role();
  v_s      public.work_order_billing_steps;
  v_status public.work_order_status;
  v_pm     uuid;
  v_own    boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select * into v_s from public.work_order_billing_steps s where s.id = p_step and s.org_id = v_org;
  -- A step the caller may not read is "not found": the refusal never says a hidden step exists.
  if not found or not public.wo_step_readable(v_s.assignee_id, v_s.owner_role_key, v_s.hidden_from_role_keys) then
    raise exception 'WBS_NOT_FOUND: billing step not found' using errcode = 'P0002';
  end if;
  -- Same row lock as transition_work_order and confirm_work_order_acceptance.
  select w.status into v_status from public.work_orders w where w.id = v_s.work_order_id and w.org_id = v_org for update;
  if v_status is distinct from 'Issued' then
    raise exception 'WBS_NOT_ISSUED: billing steps change only while the work order is issued' using errcode = '55000';
  end if;
  select * into v_s from public.work_order_billing_steps s where s.id = p_step for update;
  v_own := v_s.assignee_id = v_me or (v_s.owner_role_key is not null and v_s.owner_role_key = v_key);
  if not (v_own or public.actor_may_run_billing_steps()) then
    raise exception 'WBS_NOT_YOURS: only the step''s person, a holder of its role or a person who runs billing steps can change it' using errcode = '42501';
  end if;
  if not v_own and public.auth_role() = 'Project Manager' then
    select pr.project_manager_id into v_pm from public.projects pr where pr.id = v_s.project_id;
    if v_pm is distinct from v_me then
      raise exception 'WBS_NOT_PM: only the project''s manager can change this step' using errcode = '42501';
    end if;
  end if;
  return v_s;
end; $$;
revoke all on function public.lock_wo_billing_step(uuid) from public, anon, authenticated;

-- ── name or clear the person on a step ───────────────────────────────────────────────────────────────────────────────────────────────
create function public.assign_work_order_step(p_step uuid, p_person uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_s public.work_order_billing_steps; v_new public.work_order_billing_steps;
begin
  perform public.assert_not_light();
  if p_step is null then raise exception 'WBS_NOT_FOUND: billing step not found' using errcode = 'P0002'; end if;
  v_s := public.lock_wo_billing_step(p_step);
  if v_s.done_on is not null or v_s.skipped_on is not null then
    raise exception 'WBS_CLOSED: this billing step is already finished' using errcode = '55000';
  end if;
  if p_person is not null and not exists (
       select 1 from public.profiles p
        where p.id = p_person and p.org_id = v_s.org_id and p.status = 'active' and public.is_active_member(p.id)
          and not public.is_light_role_key(p.built_in_role)) then
    raise exception 'WBS_ASSIGNEE: choose an active member of the organisation with a full account' using errcode = '23514';
  end if;
  update public.work_order_billing_steps s set assignee_id = p_person where s.id = v_s.id returning * into v_new;
  if p_person is not null and v_s.started_on is not null and p_person is distinct from v_s.assignee_id then
    perform public.notify_wo_step_opened(v_new);
  end if;
  perform public.log_audit('wo_billing_step.assign', v_s.org_id, auth.uid(), v_s.work_order_id,
    jsonb_build_object('step_id', v_s.id, 'position', v_s.position, 'assignee_id', p_person));
end; $$;
revoke all on function public.assign_work_order_step(uuid, uuid) from public, anon;
grant execute on function public.assign_work_order_step(uuid, uuid) to authenticated, service_role;

-- ── attach a project document: to one of the step's checklist slots, or (no slot) as an extra attachment ───────────────────────────────
create function public.attach_work_order_step_document(p_step uuid, p_slot uuid, p_document uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_s      public.work_order_billing_steps;
  v_d_org  uuid; v_d_proj uuid; v_status public.doc_status; v_file text; v_title text;
  v_slot   uuid;
begin
  perform public.assert_not_light();
  if p_step is null then raise exception 'WBS_NOT_FOUND: billing step not found' using errcode = 'P0002'; end if;
  v_s := public.lock_wo_billing_step(p_step);
  if v_s.done_on is not null or v_s.skipped_on is not null then
    raise exception 'WBS_CLOSED: this billing step is already finished' using errcode = '55000';
  end if;
  select d.org_id, d.project_id, d.status, d.file_path, d.title into v_d_org, v_d_proj, v_status, v_file, v_title
    from public.project_documents d where d.id = p_document;
  if not found or v_d_org is distinct from v_s.org_id or v_d_proj is distinct from v_s.project_id then
    raise exception 'WBS_DOC_INVALID: the document must be one of the work order''s project documents' using errcode = '23514';
  end if;
  if v_status not in ('Issued','Approved') then
    raise exception 'WBS_DOC_INVALID: only an issued or approved document can be attached' using errcode = '23514';
  end if;
  if v_file is null or btrim(v_file) = '' then
    raise exception 'WBS_DOC_INVALID: the document has no file attached' using errcode = '23514';
  end if;
  if p_slot is null then
    insert into public.work_order_billing_step_documents (org_id, step_id, work_order_id, position, name, required, document_id, attached_by, attached_at)
    select v_s.org_id, v_s.id, v_s.work_order_id, coalesce(max(x.position), 0) + 1, left(btrim(coalesce(v_title, 'Attachment')), 200), false,
           p_document, auth.uid(), now()
      from public.work_order_billing_step_documents x where x.step_id = v_s.id
    returning id into v_slot;
  else
    update public.work_order_billing_step_documents x
       set document_id = p_document, attached_by = auth.uid(), attached_at = now()
     where x.id = p_slot and x.step_id = v_s.id returning x.id into v_slot;
    if v_slot is null then raise exception 'WBS_SLOT: that attachment slot is not on this billing step' using errcode = 'P0002'; end if;
  end if;
  perform public.log_audit('wo_billing_step.document.attach', v_s.org_id, auth.uid(), v_s.work_order_id,
    jsonb_build_object('step_id', v_s.id, 'position', v_s.position, 'slot_id', v_slot, 'document_id', p_document, 'document_status', v_status));
end; $$;
revoke all on function public.attach_work_order_step_document(uuid, uuid, uuid) from public, anon;
grant execute on function public.attach_work_order_step_document(uuid, uuid, uuid) to authenticated, service_role;

-- ── mark a step done: it must be the current step, with its required documents, and it opens the next one ───────────────────────────────
create function public.complete_work_order_step(p_step uuid, p_done_on date) returns void
  language plpgsql security definer set search_path = public as $$
declare v_s public.work_order_billing_steps; v_next public.work_order_billing_steps;
begin
  perform public.assert_not_light();
  if p_step is null then raise exception 'WBS_NOT_FOUND: billing step not found' using errcode = 'P0002'; end if;
  v_s := public.lock_wo_billing_step(p_step);
  if v_s.done_on is not null or v_s.skipped_on is not null then
    raise exception 'WBS_CLOSED: this billing step is already finished' using errcode = '55000';
  end if;
  if v_s.started_on is null then
    raise exception 'WBS_OUT_OF_ORDER: finish the earlier billing steps first' using errcode = '55000';
  end if;
  if exists (select 1 from public.work_order_billing_step_documents d where d.step_id = v_s.id and d.required and d.document_id is null) then
    raise exception 'WBS_DOCS_MISSING: attach every required document before finishing this step' using errcode = '55000';
  end if;
  if p_done_on is null or p_done_on > public.native_org_today(v_s.org_id) then
    raise exception 'WBS_DATE_FUTURE: the finish date cannot be in the future' using errcode = '22023';
  end if;
  if p_done_on < v_s.started_on then
    raise exception 'WBS_DATE_BEFORE_START: a step cannot finish before it started' using errcode = '22023';
  end if;
  update public.work_order_billing_steps s set done_on = p_done_on, done_by = auth.uid(), done_at = now() where s.id = v_s.id;
  update public.work_order_billing_steps s set started_on = p_done_on
   where s.work_order_id = v_s.work_order_id and s.started_on is null
     and s.position = (select min(s2.position) from public.work_order_billing_steps s2 where s2.work_order_id = v_s.work_order_id and s2.position > v_s.position)
  returning * into v_next;
  if v_next.id is not null then perform public.notify_wo_step_opened(v_next); end if;
  perform public.log_audit('wo_billing_step.complete', v_s.org_id, auth.uid(), v_s.work_order_id,
    jsonb_build_object('step_id', v_s.id, 'position', v_s.position, 'done_on', p_done_on));
end; $$;
revoke all on function public.complete_work_order_step(uuid, date) from public, anon;
grant execute on function public.complete_work_order_step(uuid, date) to authenticated, service_role;

-- ── skip an optional current step: it opens the next one ──────────────────────────────────────────────────────────────────────────────
create function public.skip_work_order_step(p_step uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_s public.work_order_billing_steps; v_next public.work_order_billing_steps; v_today date;
begin
  perform public.assert_not_light();
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
  v_today := public.native_org_today(v_s.org_id);
  update public.work_order_billing_steps s set skipped_on = v_today, skipped_by = auth.uid() where s.id = v_s.id;
  update public.work_order_billing_steps s set started_on = v_today
   where s.work_order_id = v_s.work_order_id and s.started_on is null
     and s.position = (select min(s2.position) from public.work_order_billing_steps s2 where s2.work_order_id = v_s.work_order_id and s2.position > v_s.position)
  returning * into v_next;
  if v_next.id is not null then perform public.notify_wo_step_opened(v_next); end if;
  perform public.log_audit('wo_billing_step.skip', v_s.org_id, auth.uid(), v_s.work_order_id,
    jsonb_build_object('step_id', v_s.id, 'position', v_s.position));
end; $$;
revoke all on function public.skip_work_order_step(uuid) from public, anon;
grant execute on function public.skip_work_order_step(uuid) to authenticated, service_role;

-- ── settings: the organisation's default template, and the role fields of a template's steps (Admin or Finance) ───────────────────────────
create function public.set_default_billing_step_template(p_template uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_role public.user_role := public.auth_role();
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'WBS_SETTER_ROLE: only Finance or an Admin can choose the default billing step template' using errcode = '42501';
  end if;
  if p_template is not null and not exists (
       select 1 from public.billing_step_templates t where t.id = p_template and t.org_id = v_org and t.archived_at is null) then
    raise exception 'WBS_TEMPLATE_NOT_FOUND: that billing step template does not exist or is archived' using errcode = 'P0002';
  end if;
  insert into public.org_billing_step_settings (org_id, default_template_id, updated_by, updated_at)
  values (v_org, p_template, auth.uid(), now())
  on conflict (org_id) do update set default_template_id = excluded.default_template_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  perform public.log_audit('billing_step_template.set_default', v_org, auth.uid(), v_org, jsonb_build_object('template_id', p_template));
end; $$;
revoke all on function public.set_default_billing_step_template(uuid) from public, anon;
grant execute on function public.set_default_billing_step_template(uuid) to authenticated, service_role;

-- p_roles: [{"position": 1, "owner_role_key": "...", "hidden_from_role_keys": ["..."]}]. Positions not listed keep their values.
create function public.set_billing_step_template_roles(p_template uuid, p_roles jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id(); v_role public.user_role := public.auth_role();
  v_item jsonb; v_pos int; v_key text; v_hidden text[]; v_n int := 0; v_rows int;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'WBS_SETTER_ROLE: only Finance or an Admin can set who owns and who sees a billing step' using errcode = '42501';
  end if;
  perform 1 from public.billing_step_templates t where t.id = p_template and t.org_id = v_org and t.archived_at is null for update;
  if not found then raise exception 'WBS_TEMPLATE_NOT_FOUND: that billing step template does not exist or is archived' using errcode = 'P0002'; end if;
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' or jsonb_array_length(p_roles) > 20 then
    raise exception 'WBS_TEMPLATE_ROLE: the roles of a template are a list of at most 20 steps' using errcode = '22023';
  end if;
  for v_item in select x from jsonb_array_elements(p_roles) x loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'position') <> 'number' then
      raise exception 'WBS_TEMPLATE_ROLE: each entry names a step position' using errcode = '22023';
    end if;
    v_pos := (v_item ->> 'position')::int;
    v_key := nullif(btrim(coalesce(v_item ->> 'owner_role_key', '')), '');
    v_hidden := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_item -> 'hidden_from_role_keys') = 'array'
                                                                     then v_item -> 'hidden_from_role_keys' else '[]'::jsonb end)), '{}');
    if v_key is not null and not exists (select 1 from public.built_in_roles r where r.key = v_key and not public.is_light_role_key(r.key)) then
      raise exception 'WBS_TEMPLATE_ROLE: choose a role from the organisation''s role list; field accounts cannot own a billing step' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(v_hidden) h where not exists (select 1 from public.built_in_roles r where r.key = h and not public.is_light_role_key(r.key))) then
      raise exception 'WBS_TEMPLATE_ROLE: choose roles from the organisation''s role list; field accounts cannot be named here' using errcode = '23514';
    end if;
    update public.billing_step_template_steps s set owner_role_key = v_key, hidden_from_role_keys = v_hidden
     where s.template_id = p_template and s.position = v_pos;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'WBS_TEMPLATE_ROLE: the template has no step at that position' using errcode = '23514'; end if;
    v_n := v_n + 1;
  end loop;
  perform public.log_audit('billing_step_template.set_roles', v_org, auth.uid(), p_template, jsonb_build_object('steps', v_n));
  return v_n;
end; $$;
revoke all on function public.set_billing_step_template_roles(uuid, jsonb) from public, anon;
grant execute on function public.set_billing_step_template_roles(uuid, jsonb) to authenticated, service_role;
