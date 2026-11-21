-- 1367_claim_billing_step_edit.sql — edit a live claim's step list: change, add, remove, move (#2680).
-- FR-CBS-011..014; proven by supabase/tests/1365_claim_billing_steps.test.sql (AC-CBS-004..008). The steps are the existing
-- claim_billing_stages rows; billing_stages_open (the one invoice-gate predicate) and its two triggers are NOT changed.
-- Roles (OD-CBS-1): Finance or an Admin edit anything; a Project Manager of the project may change only a step's owner role and
-- target date. Removing an open step is a waiver for the gate, so it is Finance/Admin only, with a reason, audited (as a skip is).
-- Completed and skipped steps never change; a claim with an invoice keeps its structure (owner role and target date stay editable).
-- Lock order as 1361/1362: the claim row, then the step row.
-- ── REVERSE: rollback/1367_claim_billing_step_edit_down.sql ──────────────────────────────────────────────────────────

-- ── shared guard: membership, role, organisation, claim lock, withdrawn/invoiced freeze ──────────────────────────────────
create function public.lock_claim_for_step_edit(p_claim uuid, p_structural boolean) returns public.progress_claims
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_role user_role := public.auth_role();
  v_c    public.progress_claims;
  v_pm   uuid;
begin
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or a Project Manager can edit billing steps' using errcode = '42501';
  end if;
  if p_structural and v_role = 'Project Manager' then
    raise exception 'only Finance or an Admin can change the list of billing steps' using errcode = '42501';
  end if;
  if p_claim is null then raise exception 'progress claim not found' using errcode = 'P0002'; end if;
  select * into v_c from public.progress_claims pc where pc.id = p_claim and pc.org_id = v_org for update;
  if not found then raise exception 'progress claim not found' using errcode = 'P0002'; end if;
  if v_role = 'Project Manager' then
    select p.project_manager_id into v_pm from public.projects p where p.id = v_c.project_id;
    if v_pm is distinct from auth.uid() then
      raise exception 'only the project''s manager can edit this claim''s billing steps' using errcode = '42501';
    end if;
  end if;
  if v_c.withdrawn_at is not null then
    raise exception 'this progress claim was withdrawn' using errcode = '55000', detail = 'claim-withdrawn';
  end if;
  if p_structural and public.billing_claim_invoiced(p_claim) then
    raise exception 'this claim has an invoice; its list of steps can no longer change' using errcode = '55000', detail = 'claim-invoiced';
  end if;
  return v_c;
end; $$;
revoke all on function public.lock_claim_for_step_edit(uuid, boolean) from public, anon, authenticated;

-- ── shared renumber: open steps take positions after the finished prefix in the given order; the first open one is current ─
create function public.renumber_claim_steps(p_claim uuid, p_open_ids uuid[], p_start date) returns void
  language plpgsql security definer set search_path = public as $$
declare v_k int;
begin
  select count(*) into v_k from public.claim_billing_stages s
   where s.claim_id = p_claim and (s.completed_on is not null or s.skipped_on is not null);
  set constraints public.claim_billing_stages_claim_id_position_key deferred;
  update public.claim_billing_stages s set position = v_k + o.n::int
    from unnest(p_open_ids) with ordinality as o(id, n) where s.id = o.id and s.claim_id = p_claim;
  update public.claim_billing_stages s
     set started_on = case when s.id = p_open_ids[1] then coalesce(p_start, public.native_org_today(s.org_id)) end
   where s.claim_id = p_claim and s.id = any(p_open_ids);
  set constraints public.claim_billing_stages_claim_id_position_key immediate;
end; $$;
revoke all on function public.renumber_claim_steps(uuid, uuid[], date) from public, anon, authenticated;

-- ── change a step: owner role and target date (PM allowed); name, target days, flags (Finance/Admin) ───────────────────
create function public.update_claim_billing_step(p_stage uuid, p_patch jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_claim  uuid;
  v_s      public.claim_billing_stages;
  v_struct boolean;
  v_name   text; v_days numeric; v_owner user_role; v_on date; v_cs boolean; v_opt boolean;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or a Project Manager can edit billing steps' using errcode = '42501';
  end if;
  if p_stage is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'billing step not found' using errcode = 'P0002';
  end if;
  select s.claim_id into v_claim from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  if not found then raise exception 'billing step not found' using errcode = 'P0002'; end if;
  v_struct := p_patch ?| array['name','target_days','client_side','optional'];
  perform public.lock_claim_for_step_edit(v_claim, v_struct);
  select * into v_s from public.claim_billing_stages s where s.id = p_stage for update;
  if v_s.completed_on is not null or v_s.skipped_on is not null then
    raise exception 'a finished billing step cannot be changed' using errcode = '55000', detail = 'stage-not-editable';
  end if;
  v_name := v_s.name; v_days := v_s.target_days; v_owner := v_s.owner_role; v_on := v_s.target_on;
  v_cs := v_s.client_side; v_opt := v_s.optional;
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

  update public.claim_billing_stages s
     set name = v_name, target_days = v_days::smallint, owner_role = v_owner, target_on = v_on, client_side = v_cs, optional = v_opt,
         -- a changed target restarts the once-only overdue notice
         overdue_notified_at = case when v_days is distinct from v_s.target_days::numeric or v_on is distinct from v_s.target_on
                                    then null else s.overdue_notified_at end
   where s.id = v_s.id;
  perform public.log_audit('billing_step.update', v_s.org_id, auth.uid(), v_claim,
    jsonb_build_object('stage_id', v_s.id, 'fields', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)));
end; $$;
revoke all on function public.update_claim_billing_step(uuid, jsonb) from public, anon;
grant execute on function public.update_claim_billing_step(uuid, jsonb) to authenticated, service_role;

-- ── add a step after a position (never before a finished step) ──────────────────────────────────────────────────────────
create function public.add_claim_billing_step(p_claim uuid, p_after_position integer, p_step jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_c     public.progress_claims;
  v_n     int; v_k int; v_new uuid; v_start date; v_ids uuid[]; v_before uuid[]; v_after uuid[];
  v_name  text; v_days numeric; v_owner user_role; v_on date; v_doc jsonb; v_dpos int := 0;
begin
  perform public.assert_is_active_member();
  v_c := public.lock_claim_for_step_edit(p_claim, true);
  if p_step is null or jsonb_typeof(p_step) <> 'object' then
    raise exception 'every billing step needs a name' using errcode = '23514', detail = 'stage-name-missing';
  end if;
  v_name := btrim(coalesce(p_step ->> 'name', ''));
  if v_name = '' or length(v_name) > 120 then
    raise exception 'every billing step needs a name' using errcode = '23514', detail = 'stage-name-missing';
  end if;
  v_days := null;
  if p_step ? 'target_days' and jsonb_typeof(p_step -> 'target_days') <> 'null' then
    if jsonb_typeof(p_step -> 'target_days') <> 'number' then
      raise exception 'a step target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
    end if;
    v_days := (p_step ->> 'target_days')::numeric;
    if v_days <> trunc(v_days) or v_days < 1 or v_days > 365 then
      raise exception 'a step target is a whole number of days, 1 to 365' using errcode = '23514', detail = 'stage-target-invalid';
    end if;
  end if;
  v_owner := nullif(btrim(coalesce(p_step ->> 'owner_role', '')), '')::user_role;
  v_on := nullif(btrim(coalesce(p_step ->> 'target_on', '')), '')::date;
  perform 1 from public.claim_billing_stages s where s.claim_id = p_claim for update;
  select count(*), count(*) filter (where s.completed_on is not null or s.skipped_on is not null)
    into v_n, v_k from public.claim_billing_stages s where s.claim_id = p_claim;
  if v_n >= 20 then
    raise exception 'a claim has at most 20 billing steps' using errcode = '22023', detail = 'stages-shape';
  end if;
  if p_after_position is null or p_after_position > v_n then
    raise exception 'position out of range' using errcode = '22023', detail = 'stages-shape';
  end if;
  if p_after_position < v_k then
    raise exception 'a step cannot be placed before a finished step' using errcode = '55000', detail = 'stage-not-editable';
  end if;
  select s.started_on into v_start from public.claim_billing_stages s
   where s.claim_id = p_claim and s.completed_on is null and s.skipped_on is null order by s.position limit 1;

  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, owner_role, target_on)
  values (v_c.org_id, p_claim, v_c.project_id, v_n + 1, v_name, coalesce((p_step ->> 'client_side')::boolean, false), v_days::smallint,
          coalesce((p_step ->> 'optional')::boolean, false), v_owner, v_on)
  returning id into v_new;
  if jsonb_typeof(p_step -> 'documents') = 'array' then
    if jsonb_array_length(p_step -> 'documents') > 20 then
      raise exception 'a billing step lists at most 20 documents' using errcode = '22023', detail = 'stages-shape';
    end if;
    for v_doc in select x from jsonb_array_elements(p_step -> 'documents') x loop
      v_dpos := v_dpos + 1;
      if jsonb_typeof(v_doc) <> 'object' or coalesce(btrim(v_doc ->> 'name'), '') = '' then
        raise exception 'every checklist document needs a name' using errcode = '23514', detail = 'document-name-missing';
      end if;
      insert into public.claim_billing_stage_documents (org_id, stage_id, claim_id, position, name, required)
      values (v_c.org_id, v_new, p_claim, v_dpos, btrim(v_doc ->> 'name'), coalesce((v_doc ->> 'required')::boolean, true));
    end loop;
  end if;
  select coalesce(array_agg(s.id order by s.position), '{}') into v_before from public.claim_billing_stages s
   where s.claim_id = p_claim and s.completed_on is null and s.skipped_on is null and s.id <> v_new and s.position <= p_after_position;
  select coalesce(array_agg(s.id order by s.position), '{}') into v_after from public.claim_billing_stages s
   where s.claim_id = p_claim and s.completed_on is null and s.skipped_on is null and s.id <> v_new and s.position > p_after_position;
  v_ids := v_before || v_new || v_after;
  perform public.renumber_claim_steps(p_claim, v_ids, v_start);
  perform public.log_audit('billing_step.add', v_c.org_id, auth.uid(), p_claim,
    jsonb_build_object('stage_id', v_new, 'name', v_name, 'after_position', p_after_position));
  return v_new;
end; $$;
revoke all on function public.add_claim_billing_step(uuid, integer, jsonb) from public, anon;
grant execute on function public.add_claim_billing_step(uuid, integer, jsonb) to authenticated, service_role;

-- ── remove an open step: a waiver for the invoice gate, so reason + Finance/Admin + audit ──────────────────────────────
create function public.remove_claim_billing_step(p_stage uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id(); v_claim uuid; v_s public.claim_billing_stages;
  v_reason text := nullif(btrim(p_reason), ''); v_ids uuid[];
begin
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or a Project Manager can edit billing steps' using errcode = '42501';
  end if;
  if p_stage is null then raise exception 'billing step not found' using errcode = 'P0002'; end if;
  select s.claim_id into v_claim from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  if not found then raise exception 'billing step not found' using errcode = 'P0002'; end if;
  perform public.lock_claim_for_step_edit(v_claim, true);
  select * into v_s from public.claim_billing_stages s where s.id = p_stage for update;
  if v_s.completed_on is not null or v_s.skipped_on is not null then
    raise exception 'a finished billing step cannot be removed' using errcode = '55000', detail = 'stage-not-editable';
  end if;
  if v_reason is null or char_length(v_reason) not between 3 and 500 then
    raise exception 'give a reason of 3 to 500 characters' using errcode = '23514', detail = 'step-reason-invalid';
  end if;
  delete from public.claim_billing_stages s where s.id = v_s.id;
  select coalesce(array_agg(s.id order by s.position), '{}') into v_ids from public.claim_billing_stages s
   where s.claim_id = v_claim and s.completed_on is null and s.skipped_on is null;
  perform public.renumber_claim_steps(v_claim, v_ids, public.native_org_today(v_org));
  perform public.log_audit('billing_step.remove', v_org, auth.uid(), v_claim,
    jsonb_build_object('stage_id', v_s.id, 'name', v_s.name, 'position', v_s.position, 'reason', v_reason));
end; $$;
revoke all on function public.remove_claim_billing_step(uuid, text) from public, anon;
grant execute on function public.remove_claim_billing_step(uuid, text) to authenticated, service_role;

-- ── move an open step to a position after the finished prefix ──────────────────────────────────────────────────────────
create function public.move_claim_billing_step(p_stage uuid, p_new_position integer) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id(); v_claim uuid; v_s public.claim_billing_stages;
  v_n int; v_k int; v_start date; v_rest uuid[];
begin
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only Finance, an Admin or a Project Manager can edit billing steps' using errcode = '42501';
  end if;
  if p_stage is null then raise exception 'billing step not found' using errcode = 'P0002'; end if;
  select s.claim_id into v_claim from public.claim_billing_stages s where s.id = p_stage and s.org_id = v_org;
  if not found then raise exception 'billing step not found' using errcode = 'P0002'; end if;
  perform public.lock_claim_for_step_edit(v_claim, true);
  select * into v_s from public.claim_billing_stages s where s.id = p_stage for update;
  if v_s.completed_on is not null or v_s.skipped_on is not null then
    raise exception 'a finished billing step cannot be moved' using errcode = '55000', detail = 'stage-not-editable';
  end if;
  select count(*), count(*) filter (where s.completed_on is not null or s.skipped_on is not null)
    into v_n, v_k from public.claim_billing_stages s where s.claim_id = v_claim;
  if p_new_position is null or p_new_position > v_n then
    raise exception 'position out of range' using errcode = '22023', detail = 'stages-shape';
  end if;
  if p_new_position <= v_k then
    raise exception 'a step cannot be placed before a finished step' using errcode = '55000', detail = 'stage-not-editable';
  end if;
  select s.started_on into v_start from public.claim_billing_stages s
   where s.claim_id = v_claim and s.completed_on is null and s.skipped_on is null order by s.position limit 1;
  select coalesce(array_agg(s.id order by s.position), '{}') into v_rest from public.claim_billing_stages s
   where s.claim_id = v_claim and s.completed_on is null and s.skipped_on is null and s.id <> v_s.id;
  perform public.renumber_claim_steps(v_claim,
    v_rest[1:(p_new_position - v_k - 1)] || v_s.id || v_rest[(p_new_position - v_k):v_n], v_start);
  perform public.log_audit('billing_step.move', v_org, auth.uid(), v_claim,
    jsonb_build_object('stage_id', v_s.id, 'from', v_s.position, 'to', p_new_position));
end; $$;
revoke all on function public.move_claim_billing_step(uuid, integer) from public, anon;
grant execute on function public.move_claim_billing_step(uuid, integer) to authenticated, service_role;
