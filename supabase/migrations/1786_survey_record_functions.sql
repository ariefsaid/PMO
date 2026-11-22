-- 1786_survey_record_functions.sql — survey-cap-record: the writers of the survey record. All SECURITY DEFINER, each refusing a field
-- account first, then re-asserting membership, organisation and role (a definer body bypasses RLS). Who may record and confirm follows
-- the BAST flow: record = may_record_project_progress on an Issued work order; confirm = Admin or Finance, and not the recorder unless
-- the organisation's only active member (basis stored). Lock order as confirm_work_order_acceptance (0339): billing lock, then the
-- work-order row. Every refusal is a code and a sentence (refusals catalogue). Reversal: rollback/1786_survey_record_functions_down.sql.

-- shared: lock the work order and return its facts; refuses when the work order is not Issued.
create function public.survey_lock_work_order(p_work_order uuid) returns table (project_id uuid, org_id uuid)
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_status public.work_order_status; v_project uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  perform public.lock_work_order_billing(p_work_order);
  select w.status, w.project_id into v_status, v_project from public.work_orders w
   where w.id = p_work_order and w.org_id = v_org for update;
  if not found then raise exception 'SVY_NOT_FOUND: work order not found' using errcode = 'P0002'; end if;
  if v_status <> 'Issued' then
    raise exception 'SVY_NOT_ISSUED: surveys are recorded and confirmed only while the work order is issued' using errcode = '55000';
  end if;
  return query select v_project, v_org;
end $$;
revoke all on function public.survey_lock_work_order(uuid) from public, anon, authenticated;

create function public.record_survey(
  p_work_order uuid, p_boq_item uuid, p_date date, p_surveyed numeric, p_quality_ready numeric,
  p_participants jsonb, p_supersedes uuid default null, p_note text default null) returns uuid
  language plpgsql security definer set search_path = public as $$
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
end $$;
revoke all on function public.record_survey(uuid, uuid, date, numeric, numeric, jsonb, uuid, text) from public, anon;
grant execute on function public.record_survey(uuid, uuid, date, numeric, numeric, jsonb, uuid, text) to authenticated;

-- shared: a draft the caller may change (its recorder, Admin or Finance), with the work order locked.
create function public.survey_lock_draft(p_id uuid) returns public.survey_records
  language plpgsql security definer set search_path = public as $$
declare v_wo uuid; v_r public.survey_records;
begin
  perform public.assert_not_light();
  select r.work_order_id into v_wo from public.survey_records r where r.id = p_id and r.org_id = public.auth_org_id();
  if not found then raise exception 'SVY_NOT_FOUND: survey record not found' using errcode = 'P0002'; end if;
  perform 1 from public.survey_lock_work_order(v_wo);
  select * into v_r from public.survey_records r where r.id = p_id for update;
  if v_r.status <> 'draft' or v_r.archived_at is not null then
    raise exception 'SVY_FROZEN: a confirmed or discarded survey record cannot be changed; record a correction instead' using errcode = '42501';
  end if;
  return v_r;
end $$;
revoke all on function public.survey_lock_draft(uuid) from public, anon, authenticated;

create function public.attach_survey_document(p_id uuid, p_document uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_r public.survey_records; v_d record;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_r := public.survey_lock_draft(p_id);
  if not (v_r.recorded_by = auth.uid() or public.auth_role() in ('Admin','Finance')) then
    raise exception 'SVY_NOT_PERMITTED: only the person who recorded the survey, Finance or an Admin can change a draft' using errcode = '42501';
  end if;
  select d.org_id, d.project_id, d.status, d.file_path into v_d from public.project_documents d where d.id = p_document;
  if not found or v_d.org_id is distinct from v_r.org_id or v_d.project_id is distinct from v_r.project_id
     or v_d.status not in ('Issued','Approved') or nullif(btrim(coalesce(v_d.file_path, '')), '') is null then
    raise exception 'SVY_DOCUMENT_INVALID: attach an issued or approved document with a file from this work order''s project' using errcode = '23514';
  end if;
  insert into public.survey_record_documents (record_id, document_id, org_id, attached_by)
  values (p_id, p_document, v_r.org_id, auth.uid()) on conflict do nothing;
  perform public.log_audit('survey.document.attach', v_r.org_id, auth.uid(), p_id, jsonb_build_object('document_id', p_document));
end $$;
revoke all on function public.attach_survey_document(uuid, uuid) from public, anon;
grant execute on function public.attach_survey_document(uuid, uuid) to authenticated;

create function public.archive_survey_draft(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_r public.survey_records;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_r := public.survey_lock_draft(p_id);
  if not (v_r.recorded_by = auth.uid() or public.auth_role() in ('Admin','Finance')) then
    raise exception 'SVY_NOT_PERMITTED: only the person who recorded the survey, Finance or an Admin can discard a draft' using errcode = '42501';
  end if;
  update public.survey_records set archived_at = now() where id = p_id;
  perform public.log_audit('survey.archive', v_r.org_id, auth.uid(), p_id, '{}'::jsonb);
end $$;
revoke all on function public.archive_survey_draft(uuid) from public, anon;
grant execute on function public.archive_survey_draft(uuid) to authenticated;

create function public.confirm_survey(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_r public.survey_records; v_basis text := 'standard'; v_sole boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_r := public.survey_lock_draft(p_id);
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'SVY_CONFIRM_ROLE: only Finance or an Admin can confirm a survey' using errcode = '42501';
  end if;
  if v_r.recorded_by = auth.uid() then
    select count(*) = 1 and bool_or(p.id = auth.uid()) into v_sole
      from public.profiles p where p.org_id = v_r.org_id and public.is_active_member(p.id);
    if not coalesce(v_sole, false) then
      raise exception 'SVY_RECORDER_CONFIRMS: the person who recorded a survey cannot confirm it; ask Finance or an Admin to confirm' using errcode = '42501';
    end if;
    v_basis := 'sole_operator';
  end if;
  if v_r.quality_ready_quantity > 0 and not exists (select 1 from public.survey_record_documents d where d.record_id = p_id) then
    raise exception 'SVY_QUALITY_NEEDS_DOCUMENT: attach the quality documents before confirming a survey with a quality-ready quantity' using errcode = '23514';
  end if;
  update public.survey_records set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = clock_timestamp(), confirm_basis = v_basis
   where id = p_id;
  if v_r.supersedes_id is not null then
    update public.survey_records set superseded_at = clock_timestamp() where id = v_r.supersedes_id;
  end if;
  perform public.log_audit('survey.confirm', v_r.org_id, auth.uid(), p_id,
    jsonb_build_object('work_order_id', v_r.work_order_id, 'boq_item_id', v_r.boq_item_id, 'surveyed', v_r.surveyed_quantity, 'basis', v_basis));
end $$;
revoke all on function public.confirm_survey(uuid) from public, anon;
grant execute on function public.confirm_survey(uuid) to authenticated;
