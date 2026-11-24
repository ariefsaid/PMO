-- Rollback for 2600_work_order_shared_claim_evidence.sql
-- Restores attach_work_order_step_document (1772), create_progress_claim (0924 + 1530),
-- restores the template copy functions and drops the helper, setter and designation columns.

create or replace function public.attach_work_order_step_document(p_step uuid, p_slot uuid, p_document uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_s      public.work_order_billing_steps;
  v_d_org  uuid; v_d_proj uuid; v_status public.doc_status; v_file text; v_title text; v_cat uuid;
  v_slot   uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if p_step is null then raise exception 'WBS_NOT_FOUND: billing step not found' using errcode = 'P0002'; end if;
  v_s := public.lock_wo_billing_step(p_step);
  if v_s.done_on is not null or v_s.skipped_on is not null then
    raise exception 'WBS_CLOSED: this billing step is already finished' using errcode = '55000';
  end if;
  select d.org_id, d.project_id, d.status, d.file_path, d.title, d.category_id into v_d_org, v_d_proj, v_status, v_file, v_title, v_cat
    from public.project_documents d where d.id = p_document;
  if not found or v_d_org is distinct from v_s.org_id or v_d_proj is distinct from v_s.project_id
     or not coalesce(public.document_category_visible(v_cat, v_d_org), false)
     or not coalesce(v_status in ('Issued','Approved'), false) or coalesce(btrim(v_file), '') = '' then
    raise exception 'WBS_DOC_INVALID: choose an issued or approved document with a file from this work order''s project that you may see' using errcode = '23514';
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

create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
  v_locked_count integer;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  perform public.assert_feature_on(public.auth_org_id(), 'sales_invoices');
  if p_kind in ('down_payment', 'progress') then
    perform 1 from public.organizations o where o.id = v_org for share;
  end if;
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;
  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null and not public.domain_externally_owned(v_org, 'revenue') then
      v_item := public.native_down_payment_item();
    end if;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;
  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or (p_work_order_id is not null and not exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id and wl.work_order_id=p_work_order_id)) or (p_work_order_id is null and exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id))) then
      raise exception 'every line must be allocated to the selected work order, or have no allocation for a project-level claim'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;
    perform b.id
      from public.boq_items b
      join jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric) on x.boq_item_id = b.id
     order by b.id
     for share of b;
    get diagnostics v_locked_count = row_count;
    if v_locked_count <> jsonb_array_length(p_lines) then
      raise exception 'every progress claim line must lock a BoQ row' using errcode = '23514';
    end if;
    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;
    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;
    if v_recovery > 0 and v_dp_item = public.native_down_payment_item() and public.domain_externally_owned(v_org, 'revenue') then
      select o.down_payment_item into v_dp_item from public.organizations o where o.id = v_org;
      if v_dp_item is null then
        raise exception 'set the down payment item in Administration → Accounting before recovering the down payment'
          using errcode = 'P0001';
      end if;
    end if;
    if p_work_order_id is not null then
      perform public.assert_work_order_invoiceable(v_org, p_work_order_id, p_project_id, v_id::text, v_gross, v_currency);
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
    if v_gross is distinct from (select coalesce(sum(l.amount),0) from public.progress_claim_lines l where l.claim_id=v_id) then
      raise exception 'the progress claim header must equal the sum of its priced lines' using errcode = '23514';
    end if;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;
  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;

drop trigger if exists tm_claims_reuse_work_order_evidence on public.tm_claims;
drop function if exists public.copy_work_order_evidence_after_tm_signoff();
drop function if exists public.copy_work_order_evidence_to_claim(uuid, uuid);
drop function if exists public.set_work_order_step_claim_evidence(uuid, boolean);


create or replace function public.instantiate_work_order_billing_steps() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_tpl uuid; v_today date; v_first public.work_order_billing_steps; v_n int;
begin
  select s.default_template_id into v_tpl
    from public.org_billing_step_settings s
    join public.billing_step_templates t on t.id = s.default_template_id and t.org_id = s.org_id and t.archived_at is null
   where s.org_id = new.org_id;
  if v_tpl is null then return new; end if;
  v_today := public.native_org_today(new.org_id);
  insert into public.work_order_billing_steps
    (org_id, work_order_id, project_id, position, name, owner_role_key, target_days, optional, hidden_from_role_keys, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.owner_role_key, t.target_days, t.optional, t.hidden_from_role_keys,
         case when t.position = (select min(t2.position) from public.billing_step_template_steps t2 where t2.template_id = v_tpl) then v_today end
    from public.billing_step_template_steps t where t.template_id = v_tpl and t.org_id = new.org_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then return new; end if;
  insert into public.work_order_billing_step_documents (org_id, step_id, work_order_id, position, name, required)
  select new.org_id, ws.id, new.id, d.position, d.name, d.required
    from public.billing_step_template_steps t
    join public.work_order_billing_steps ws on ws.work_order_id = new.id and ws.position = t.position
    join public.billing_step_template_documents d on d.step_id = t.id
   where t.template_id = v_tpl;
  select * into v_first from public.work_order_billing_steps s where s.work_order_id = new.id and s.started_on is not null order by s.position limit 1;
  if v_first.id is not null then perform public.notify_wo_step_opened(v_first); end if;
  return new;
end; $$;

create or replace function public.save_work_order_steps_as_template(p_work_order uuid, p_name text) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_name  text      := btrim(coalesce(p_name, ''));
  v_id    uuid;
  v_n     int; v_docs int;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'WBS_SETTER_ROLE: only Finance or an Admin can save billing step templates' using errcode = '42501';
  end if;
  -- the list cannot change while it is copied: the work-order row lock every step writer takes
  perform 1 from public.work_orders w where w.id = p_work_order and w.org_id = v_org for update;
  if not found then raise exception 'WBS_ORDER_NOT_FOUND: work order not found' using errcode = 'P0002'; end if;
  if not coalesce((select o.work_order_checklist_enabled from public.organizations o where o.id = v_org), false) then
    raise exception 'WBS_CHECKLIST_OFF: checklist editing is not switched on for this organisation' using errcode = '55000';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'WBS_TEMPLATE_NAME: a template needs a name of up to 120 characters' using errcode = '23514';
  end if;
  select count(*) into v_n from public.work_order_billing_steps s where s.work_order_id = p_work_order and s.org_id = v_org;
  if v_n = 0 then
    raise exception 'WBS_TEMPLATE_EMPTY: this checklist has no steps to save as a template' using errcode = '22023';
  end if;
  -- one active template per name in an organisation (the unique index of 1365)
  begin
    insert into public.billing_step_templates (org_id, name, created_by) values (v_org, v_name, auth.uid()) returning id into v_id;
  exception when unique_violation then
    raise exception 'WBS_TEMPLATE_TAKEN: an active template with this name already exists' using errcode = '23505';
  end;
  insert into public.billing_step_template_steps
    (org_id, template_id, position, name, owner_role_key, hidden_from_role_keys, target_days, client_side, optional)
  select v_org, v_id, s.position, s.name, s.owner_role_key, s.hidden_from_role_keys, s.target_days, false, s.optional
    from public.work_order_billing_steps s
   where s.work_order_id = p_work_order and s.org_id = v_org;
  insert into public.billing_step_template_documents (org_id, step_id, position, name, required)
  select v_org, ts.id, d.position, d.name, d.required
    from public.work_order_billing_step_documents d
    join public.work_order_billing_steps s on s.id = d.step_id and s.work_order_id = p_work_order and s.org_id = v_org
    join public.billing_step_template_steps ts on ts.template_id = v_id and ts.position = s.position;
  get diagnostics v_docs = row_count;
  perform public.log_audit('wo_billing_steps.save_as_template', v_org, auth.uid(), v_id,
    jsonb_build_object('work_order_id', p_work_order, 'name', v_name, 'steps', v_n, 'documents', v_docs));
  return v_id;
end; $$;

create or replace function public.save_billing_step_template(p_template uuid, p_name text, p_steps jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid      := public.auth_org_id();
  v_role  user_role := public.auth_role();
  v_id    uuid      := p_template;
  v_name  text      := btrim(coalesce(p_name, ''));
  v_stage jsonb; v_doc jsonb; v_pos int := 0; v_dpos int; v_sid uuid; v_days numeric; v_owner user_role;
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

alter table public.work_order_billing_steps drop column if exists claim_evidence_enabled;
alter table public.billing_step_template_steps drop column if exists claim_evidence_enabled;
