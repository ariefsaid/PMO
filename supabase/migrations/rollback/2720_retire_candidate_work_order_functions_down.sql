-- Rollback of 2720 (#2915): restates what it dropped. Function bodies, grants and search paths are the live catalog at the
-- level before 2720 (so 1480's light-account guard and 2690's pg_temp are included), not the original 1405-1408 text.
-- Not restored: audit_work_order_candidate_row (2720 keeps it), and any storage object (2720 never deletes one).
-- Proof: scripts/test-2720-candidate-rollback.sh (catalog snapshot before, after down, after up again).

CREATE OR REPLACE FUNCTION public.wo_candidate_can_assess(p_candidate uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.work_order_candidates c join public.projects p on p.id = c.project_id
     where c.id = p_candidate and c.status = 'assessing'
       and c.org_id = (select public.auth_org_id()) and (select public.is_active_member())
       and ((select public.auth_role()) in ('Admin', 'Engineer') or p.project_manager_id = (select auth.uid())))
$function$
;
revoke all on function public.wo_candidate_can_assess(uuid) from public, anon, authenticated;
grant execute on function public.wo_candidate_can_assess(uuid) to service_role;
grant execute on function public.wo_candidate_can_assess(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.wo_candidate_item_can_edit(p_item uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.work_order_candidate_items i join public.work_order_candidates c on c.id = i.candidate_id
     where i.id = p_item and c.status = 'assessing' and i.org_id = (select public.auth_org_id())
       and (select public.is_active_member())
       and (public.wo_candidate_can_assess(i.candidate_id) or i.owner_id = (select auth.uid())))
$function$
;
revoke all on function public.wo_candidate_item_can_edit(uuid) from public, anon, authenticated;
grant execute on function public.wo_candidate_item_can_edit(uuid) to service_role;
grant execute on function public.wo_candidate_item_can_edit(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.check_work_order_candidate_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_status text; v_owner_org uuid;
begin
  select c.org_id, c.status into v_org, v_status from public.work_order_candidates c where c.id = new.candidate_id;
  if v_org is distinct from new.org_id then
    raise exception 'CWO_ITEM_CANDIDATE: the candidate is not in this organisation' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.candidate_id is distinct from old.candidate_id or new.org_id is distinct from old.org_id
                           or new.template_item_id is distinct from old.template_item_id) then
    raise exception 'CWO_ITEM_KEY: an assessment item keeps its candidate and template source' using errcode = '23514';
  end if;
  if v_status is distinct from 'assessing' then
    raise exception 'CWO_DECIDED: a decided candidate''s assessment is read-only' using errcode = '23514';
  end if;
  if new.status = 'not_applicable' and (new.note is null or btrim(new.note) = '') then
    raise exception 'CWO_NA_NOTE: marking an item not applicable needs a note' using errcode = '23514';
  end if;
  if new.owner_id is not null then
    select p.org_id into v_owner_org from public.profiles p where p.id = new.owner_id;
    if v_owner_org is distinct from new.org_id then
      raise exception 'CWO_ITEM_OWNER: the owner must be a member of this organisation' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' and new.position = 0 then
    select coalesce(max(i.position), 0) + 1 into new.position from public.work_order_candidate_items i where i.candidate_id = new.candidate_id;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $function$
;
revoke all on function public.check_work_order_candidate_item() from public, anon, authenticated;
grant execute on function public.check_work_order_candidate_item() to service_role;

CREATE OR REPLACE FUNCTION public.check_work_order_candidate_proof()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_org uuid; v_candidate uuid; v_status text;
begin
  select i.org_id, i.candidate_id, c.status into v_org, v_candidate, v_status
    from public.work_order_candidate_items i join public.work_order_candidates c on c.id = i.candidate_id
   where i.id = new.item_id;
  if v_org is distinct from new.org_id then
    raise exception 'CWO_PROOF_ITEM: the item is not in this organisation' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.item_id is distinct from old.item_id or new.file_path is distinct from old.file_path or new.org_id is distinct from old.org_id) then
    raise exception 'CWO_PROOF_KEY: a proof keeps its item and file' using errcode = '23514';
  end if;
  if v_status is distinct from 'assessing' then
    raise exception 'CWO_DECIDED: a decided candidate''s assessment is read-only' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and (array_length(string_to_array(new.file_path, '/'), 1) is distinct from 4
       or split_part(new.file_path, '/', 1) <> new.org_id::text or split_part(new.file_path, '/', 2) <> v_candidate::text
       or split_part(new.file_path, '/', 3) <> new.id::text) then
    raise exception 'CWO_PROOF_PATH: the file must be stored under {organisation}/{candidate}/{proof}/{name}' using errcode = '23514';
  end if;
  return new;
end $function$
;
revoke all on function public.check_work_order_candidate_proof() from public, anon, authenticated;
grant execute on function public.check_work_order_candidate_proof() to service_role;

CREATE OR REPLACE FUNCTION public.check_work_order_candidate_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.created_at is distinct from old.created_at or new.replaces_id is distinct from old.replaces_id then
    raise exception 'CWO_KEY: a candidate keeps its identity, organisation, project and replaced candidate' using errcode = '42501';
  end if;
  if old.status <> 'assessing' then
    raise exception 'CWO_DECIDED: a decided candidate is never reopened or edited' using errcode = '23514';
  end if;
  return new;
end $function$
;
revoke all on function public.check_work_order_candidate_update() from public, anon, authenticated;
grant execute on function public.check_work_order_candidate_update() to service_role;

create trigger zz_work_order_candidate_items_check before insert or update on public.work_order_candidate_items
  for each row execute function public.check_work_order_candidate_item();
create trigger zz_work_order_candidate_proofs_check before insert or update on public.work_order_candidate_proofs
  for each row execute function public.check_work_order_candidate_proof();
create trigger zz_work_order_candidates_check before update on public.work_order_candidates
  for each row execute function public.check_work_order_candidate_update();
create trigger zz_work_order_candidates_audit after insert or update on public.work_order_candidates
  for each row execute function public.audit_work_order_candidate_row();
create trigger zz_work_order_candidate_items_audit after insert or update on public.work_order_candidate_items
  for each row execute function public.audit_work_order_candidate_row();
create trigger zz_work_order_candidate_proofs_audit after insert or update on public.work_order_candidate_proofs
  for each row execute function public.audit_work_order_candidate_row();

create policy work_order_candidates_update on public.work_order_candidates for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.wo_candidate_can_assess(id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy work_order_candidate_items_insert on public.work_order_candidate_items for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.wo_candidate_can_assess(candidate_id));
create policy work_order_candidate_items_update on public.work_order_candidate_items for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.wo_candidate_item_can_edit(id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy work_order_candidate_proofs_insert on public.work_order_candidate_proofs for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.wo_candidate_item_can_edit(item_id));
create policy work_order_candidate_proofs_update on public.work_order_candidate_proofs for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.wo_candidate_item_can_edit(item_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

grant update (title, description, client_reference, offered_on) on public.work_order_candidates to authenticated;
grant insert (candidate_id, label, required, owner_id, target_date, note) on public.work_order_candidate_items to authenticated;
grant update (status, note, owner_id, target_date) on public.work_order_candidate_items to authenticated;
grant insert (id, item_id, file_path, file_name) on public.work_order_candidate_proofs to authenticated;
grant update (archived_at) on public.work_order_candidate_proofs to authenticated;

CREATE OR REPLACE FUNCTION public.create_work_order_candidate(p_project_id uuid, p_title text, p_description text DEFAULT NULL::text, p_client_reference text DEFAULT NULL::text, p_offered_on date DEFAULT NULL::date, p_replaces_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_pm uuid; v_id uuid; v_today date; v_prior public.work_order_candidates;
begin
  perform public.assert_not_light();
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select p.project_manager_id into v_pm from public.projects p where p.id = p_project_id and p.org_id = v_org;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not (public.auth_role() in ('Admin', 'Engineer') or v_pm = v_uid) then
    raise exception 'only an administrator, an engineer or the project''s project manager can open a candidate' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200 then
    raise exception 'CWO_TITLE: a candidate needs a title of 1 to 200 characters' using errcode = '23514';
  end if;
  if p_replaces_id is not null then
    select * into v_prior from public.work_order_candidates c where c.id = p_replaces_id and c.org_id = v_org;
    if not found or v_prior.project_id <> p_project_id or v_prior.status <> 'rejected' then
      raise exception 'CWO_REPLACES: a candidate can replace only a rejected candidate of the same project' using errcode = '23514';
    end if;
  end if;
  select (now() at time zone coalesce(o.default_timezone, 'UTC'))::date into v_today from public.organizations o where o.id = v_org;
  insert into public.work_order_candidates (org_id, project_id, title, description, client_reference, offered_on, replaces_id, created_by)
    values (v_org, p_project_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
            nullif(btrim(coalesce(p_client_reference, '')), ''), coalesce(p_offered_on, v_today), p_replaces_id, v_uid)
    returning id into v_id;
  insert into public.work_order_candidate_items (org_id, candidate_id, template_item_id, label, position, required)
    select v_org, v_id, t.id, t.label, t.position, t.required
      from public.work_order_checklist_items t where t.org_id = v_org and t.archived_at is null order by t.position, t.created_at;
  return v_id;
end $function$
;
revoke all on function public.create_work_order_candidate(uuid,text,text,text,date,uuid) from public, anon, authenticated;
grant execute on function public.create_work_order_candidate(uuid,text,text,text,date,uuid) to service_role;
grant execute on function public.create_work_order_candidate(uuid,text,text,text,date,uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.decide_work_order_candidate(p_candidate_id uuid, p_decision text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_c public.work_order_candidates;
  v_pm uuid; v_tax text; v_reason text; v_blocking text; v_wo uuid;
begin
  perform public.assert_not_light();
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('accepted', 'rejected') then
    raise exception 'CWO_DECISION: the decision is accepted or rejected' using errcode = '22023';
  end if;
  select * into v_c from public.work_order_candidates c where c.id = p_candidate_id and c.org_id = v_org for update;
  if not found then
    raise exception 'candidate not found' using errcode = 'P0002';
  end if;
  select p.project_manager_id, p.tax_treatment into v_pm, v_tax from public.projects p where p.id = v_c.project_id;
  -- ⚑ THE APPROVAL RULE: only the project's Project Manager or an Admin decides.
  if not (public.auth_role() = 'Admin' or v_pm = v_uid) then
    raise exception 'only the project''s project manager or an administrator can decide a candidate' using errcode = '42501';
  end if;
  -- repeat accept: the same work order, nothing created (FR-CWO-013)
  if v_c.status = 'accepted' and p_decision = 'accepted' then
    return jsonb_build_object('status', 'accepted', 'work_order_id', v_c.work_order_id);
  end if;
  if v_c.status <> 'assessing' then
    raise exception 'CWO_DECIDED: this candidate has already been %', v_c.status using errcode = '23514';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) not between 1 and 500 then
    raise exception 'CWO_REASON: a decision needs a reason of 1 to 500 characters' using errcode = '23514';
  end if;
  if p_decision = 'rejected' then
    update public.work_order_candidates set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
     where id = v_c.id;
    return jsonb_build_object('status', 'rejected', 'work_order_id', null);
  end if;
  -- ⚑ required items must be ready (FR-CWO-011)
  select string_agg(i.label, ', ' order by i.position) into v_blocking
    from public.work_order_candidate_items i
   where i.candidate_id = v_c.id and i.required and i.status not in ('passed', 'not_applicable');
  if v_blocking is not null then
    raise exception 'CWO_NOT_READY: required items are not ready: %', v_blocking using errcode = '23514';
  end if;
  insert into public.work_orders (org_id, project_id, title, description, client_po_number, order_value,
                                  tax_treatment, tax_amount, tax_rate, tax_template, status)
    values (v_org, v_c.project_id, v_c.title, v_c.description, v_c.client_reference, 0,
            coalesce(v_tax, 'exclusive'), 0, null, null, 'Draft')
    returning id into v_wo;
  update public.work_order_candidates set status = 'accepted', decided_by = v_uid, decided_at = now(),
         decision_reason = v_reason, work_order_id = v_wo where id = v_c.id;
  return jsonb_build_object('status', 'accepted', 'work_order_id', v_wo);
end $function$
;
revoke all on function public.decide_work_order_candidate(uuid,text,text) from public, anon, authenticated;
grant execute on function public.decide_work_order_candidate(uuid,text,text) to service_role;
grant execute on function public.decide_work_order_candidate(uuid,text,text) to authenticated;

-- ── 1408: bucket and policies
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('work-order-candidate-proofs', 'work-order-candidate-proofs', false, 10485760,
          array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
  on conflict (id) do nothing;

create policy storage_objects_wo_candidate_proof_read on storage.objects for select to authenticated
  using (bucket_id = 'work-order-candidate-proofs' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and exists (select 1 from public.work_order_candidate_proofs p where p.id::text = split_part(name, '/', 3)));

create policy storage_objects_wo_candidate_proof_write on storage.objects for insert to authenticated
  with check (bucket_id = 'work-order-candidate-proofs' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and split_part(name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         and (public.wo_candidate_can_assess(split_part(name, '/', 2)::uuid)
              or exists (select 1 from public.work_order_candidate_items i join public.work_order_candidates c on c.id = i.candidate_id
                          where i.candidate_id::text = split_part(objects.name, '/', 2) and i.owner_id = (select auth.uid())
                            and c.status = 'assessing' and c.org_id = (select public.auth_org_id()))));
