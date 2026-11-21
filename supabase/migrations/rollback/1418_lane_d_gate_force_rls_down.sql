-- Reverses 1418: restores the pre-gate RPC bodies and un-forces RLS.

create or replace function public.attach_closeout_item_document(p_item uuid, p_document uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_i      public.work_order_closeout_items;
  v_d_org  uuid;
  v_d_proj uuid;
  v_status public.doc_status;
  v_file   text;
begin
  if p_item is null then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  v_i := public.lock_closeout_item(p_item);
  select d.org_id, d.project_id, d.status, d.file_path into v_d_org, v_d_proj, v_status, v_file
    from public.project_documents d where d.id = p_document;
  if not found or v_d_org is distinct from v_org or v_d_proj is distinct from v_i.project_id then
    raise exception 'the document must be one of the work order''s project documents' using errcode = '23514', detail = 'item-document-invalid';
  end if;
  if v_status not in ('Issued','Approved') then
    raise exception 'only an issued or approved document can be attached' using errcode = '23514', detail = 'item-document-invalid';
  end if;
  if v_file is null or btrim(v_file) = '' then
    raise exception 'the document has no file attached' using errcode = '23514', detail = 'item-document-invalid';
  end if;
  update public.work_order_closeout_items i
     set document_id = p_document, attached_by = auth.uid(), attached_at = now()
   where i.id = p_item;
  perform public.log_audit('closeout_item.document.attach', v_org, auth.uid(), v_i.work_order_id,
    jsonb_build_object('item_id', p_item, 'position', v_i.position, 'document_id', p_document, 'document_status', v_status));
end; $$;

create or replace function public.complete_closeout_item(p_item uuid, p_done_on date) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_i    public.work_order_closeout_items;
  v_prev date;
begin
  if p_item is null then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  v_i := public.lock_closeout_item(p_item);
  -- Order applies across REQUIRED items only: an optional item never holds the items after it, and an optional item itself
  -- can be marked done whenever its document is attached.
  if v_i.required and exists (select 1 from public.work_order_closeout_items i
              where i.work_order_id = v_i.work_order_id and i.required and i.position < v_i.position and i.done_on is null) then
    raise exception 'complete the earlier close-out items first' using errcode = '55000', detail = 'item-out-of-order';
  end if;
  if v_i.document_id is null then
    raise exception 'attach a document before marking this item done' using errcode = '55000', detail = 'item-document-missing';
  end if;
  if p_done_on is null or p_done_on > public.native_org_today(v_i.org_id) then
    raise exception 'the done date cannot be in the future' using errcode = '22023', detail = 'item-date-invalid';
  end if;
  select max(i.done_on) into v_prev from public.work_order_closeout_items i
   where i.work_order_id = v_i.work_order_id and i.required and v_i.required and i.position < v_i.position;
  if p_done_on < coalesce(v_prev, v_i.started_on) then
    raise exception 'an item cannot be done before the previous one' using errcode = '22023', detail = 'item-date-invalid';
  end if;
  update public.work_order_closeout_items i
     set done_on = p_done_on, done_by = auth.uid(), done_at = now()
   where i.id = v_i.id;
  -- A done required item starts the next required item; an optional item has been current since the work order was issued.
  if v_i.required then
    update public.work_order_closeout_items i set started_on = p_done_on
     where i.work_order_id = v_i.work_order_id
       and i.position = (select min(i2.position) from public.work_order_closeout_items i2
                          where i2.work_order_id = v_i.work_order_id and i2.required and i2.position > v_i.position);
  end if;
  perform public.log_audit('closeout_item.complete', v_i.org_id, auth.uid(), v_i.work_order_id,
    jsonb_build_object('item_id', v_i.id, 'position', v_i.position, 'done_on', p_done_on));
end; $$;

create or replace function public.safety_save_talk(p_day uuid, p_topic text, p_presenter text, p_held_at timestamptz, p_attendees jsonb)
  returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_talk uuid;
  v_org uuid;
  a jsonb;
begin
  if not public.safety_day_writable(p_day) then
    raise exception 'safety day is not open for entry' using errcode = '42501';
  end if;
  if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' or jsonb_array_length(p_attendees) = 0 then
    raise exception 'a toolbox talk needs at least one attendee' using errcode = '23514';
  end if;
  select org_id into v_org from public.safety_days where id = p_day;
  insert into public.safety_toolbox_talks (org_id, day_id, topic, presenter, held_at)
    values (v_org, p_day, p_topic, p_presenter, p_held_at) returning id into v_talk;
  for a in select * from jsonb_array_elements(p_attendees) loop
    insert into public.safety_toolbox_attendees (org_id, day_id, talk_id, worker_id, visitor_name)
      values (v_org, p_day, v_talk, nullif(a ->> 'worker_id', '')::uuid, nullif(btrim(coalesce(a ->> 'visitor_name', '')), ''));
  end loop;
  return v_talk;
end $$;

create or replace function public.submit_safety_day(p_day uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.safety_days%rowtype;
begin
  select * into d from public.safety_days where id = p_day and org_id = public.auth_org_id();
  if not found or not public.safety_may_enter(d.project_id) then
    raise exception 'not allowed to submit this safety day' using errcode = '42501';
  end if;
  if d.author_id is distinct from auth.uid() then
    raise exception 'only the author submits a safety day' using errcode = '42501';
  end if;
  if d.status <> 'draft' then
    raise exception 'this safety day is already locked' using errcode = '23514';
  end if;
  if exists (select 1 from public.safety_checklist_answers c where c.day_id = d.id and c.answer = 'no' and btrim(coalesce(c.note, '')) = '') then
    raise exception 'a checklist item answered no needs a note' using errcode = '23514';
  end if;
  perform set_config('pmo.safety_internal', 'on', true);
  update public.safety_days set status = 'locked', submitted_at = now() where id = d.id;
  perform set_config('pmo.safety_internal', 'off', true);
end $$;

create or replace function public.correct_safety_day(p_day uuid, p_reason text) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d public.safety_days%rowtype;
  v_new uuid;
  t record;
  v_talk uuid;
begin
  select * into d from public.safety_days where id = p_day and org_id = public.auth_org_id();
  if not found or not public.safety_may_enter(d.project_id) then
    raise exception 'not allowed to correct this safety day' using errcode = '42501';
  end if;
  if d.status <> 'locked' then
    raise exception 'only a locked safety day is corrected' using errcode = '23514';
  end if;
  if exists (select 1 from public.safety_days s where s.supersedes_id = d.id) then
    raise exception 'this safety day already has a correction' using errcode = '23505';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a correction needs a reason' using errcode = '23514';
  end if;
  perform set_config('pmo.safety_internal', 'on', true);
  insert into public.safety_days (org_id, work_order_id, work_date, version, supersedes_id, correction_reason, author_id)
    values (d.org_id, d.work_order_id, d.work_date, d.version + 1, d.id, btrim(p_reason), auth.uid()) returning id into v_new;
  insert into public.safety_fitness_checks (org_id, day_id, worker_id, visitor_name, check_type_id, result, note)
    select org_id, v_new, worker_id, visitor_name, check_type_id, result, note from public.safety_fitness_checks where day_id = d.id;
  insert into public.safety_checklist_answers (org_id, day_id, item_id, label, position, answer, note)
    select org_id, v_new, item_id, label, position, answer, note from public.safety_checklist_answers where day_id = d.id;
  insert into public.safety_permits (org_id, day_id, permit_number, type_id, valid_from, valid_to, issued_by, state)
    select org_id, v_new, permit_number, type_id, valid_from, valid_to, issued_by, state from public.safety_permits where day_id = d.id;
  for t in select * from public.safety_toolbox_talks where day_id = d.id loop
    insert into public.safety_toolbox_talks (org_id, day_id, topic, presenter, held_at)
      values (t.org_id, v_new, t.topic, t.presenter, t.held_at) returning id into v_talk;
    insert into public.safety_toolbox_attendees (org_id, day_id, talk_id, worker_id, visitor_name)
      select org_id, v_new, v_talk, worker_id, visitor_name from public.safety_toolbox_attendees where talk_id = t.id;
    -- the same stored file stays readable through the original photo row (its id is in the object path)
    insert into public.safety_toolbox_photos (org_id, day_id, talk_id, file_path, uploaded_by)
      select org_id, v_new, v_talk, file_path, uploaded_by from public.safety_toolbox_photos where talk_id = t.id;
  end loop;
  perform set_config('pmo.safety_internal', 'off', true);
  return v_new;
end $$;

alter table public.site_checkpoint_templates no force row level security;
alter table public.site_checkpoints no force row level security;
alter table public.incident_tasks no force row level security;

drop policy incident_tasks_select on public.incident_tasks;
create policy incident_tasks_select on public.incident_tasks for select to authenticated using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and public.org_feature_enabled((select public.auth_org_id()), 'incidents')
);

drop policy task_groups_insert on public.task_groups;
drop policy task_groups_update on public.task_groups;
drop policy task_groups_delete on public.task_groups;
create policy task_groups_write on public.task_groups for all
  using (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())))
  with check (org_id = (select public.auth_org_id()) and (select public.auth_role()) in ('Admin','Project Manager')
    and exists (select 1 from public.projects p where p.id = task_groups.project_id and p.org_id = (select public.auth_org_id())));
