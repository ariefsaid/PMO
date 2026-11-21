-- 1366 down.
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
    insert into public.billing_stage_templates (org_id, project_id, position, name, client_side, target_days, optional)
    values (v_org, p_project, v_pos, btrim(v_stage ->> 'name'), coalesce((v_stage ->> 'client_side')::boolean, false),
            v_days::smallint, coalesce((v_stage ->> 'optional')::boolean, false))
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
drop function if exists public.load_billing_step_template_onto_claim(uuid, uuid);
drop function if exists public.load_billing_step_template_onto_project(uuid, uuid);
drop function if exists public.archive_billing_step_template(uuid);
drop function if exists public.save_billing_step_template(uuid, text, jsonb);
drop function if exists public.billing_claim_invoiced(uuid);
