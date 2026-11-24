-- 2131_headcount_evidence.sql — a head count day may carry evidence: a photo or document the recorder attaches and the approver
-- sees before approving (docs/specs/headcount-evidence.spec.md, FR-HCE-001..006). Plan: docs/plans/2026-11-24-site-evidence-areas.md.
-- The file is an existing project document of the head count's work order's project (the organisation's document storage and its
-- own policies decide who may create or read it); this table only cites it, as the close-out checklist does (1400/1401).
-- Authority to attach or detach is exactly the authority to record the head count (attendance_can_record(crew) or the Project
-- Administrator job role; never a field account)
-- and only while the line is not approved. Reads follow the head count's own policy.
-- Reversal: rollback/2131_headcount_evidence_down.sql (drops the table: the citations are lost, the documents stay).
-- Proven by supabase/tests/2131_headcount_evidence.test.sql.

create table public.headcount_day_documents (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                   references public.organizations(id) on delete cascade,
  headcount_id   uuid not null references public.headcount_days(id) on delete cascade,
  document_id    uuid not null references public.project_documents(id),   -- NO ACTION: a cited document cannot be deleted
  attached_by    uuid not null default auth.uid() references public.profiles(id),
  attached_at    timestamptz not null default now(),
  constraint headcount_day_documents_once unique (headcount_id, document_id)
);
create index headcount_day_documents_document_idx on public.headcount_day_documents (document_id);
create index headcount_day_documents_attached_by_idx on public.headcount_day_documents (attached_by);
create trigger headcount_day_documents_stamp_org_id before insert on public.headcount_day_documents
  for each row execute function public.stamp_org_id();

alter table public.headcount_day_documents enable row level security;
alter table public.headcount_day_documents force row level security;
-- Whoever reads the head count line reads its evidence (the line's own policy decides, under the caller's rights).
create policy headcount_day_documents_select on public.headcount_day_documents for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.headcount_days h where h.id = headcount_day_documents.headcount_id));
create policy light_account_deny_select on public.headcount_day_documents as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
revoke all on public.headcount_day_documents from public, anon, authenticated;
grant select on public.headcount_day_documents to authenticated;
grant all on public.headcount_day_documents to service_role;

create function public.attach_headcount_document(p_headcount uuid, p_document uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_h public.headcount_days;
  v_project uuid;
  v_d_org uuid; v_d_project uuid; v_file text;
  v_id uuid;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_h from public.headcount_days h where h.id = p_headcount and h.org_id = v_org for update;
  if not found then raise exception 'head count not found' using errcode = 'P0002'; end if;
  if not (public.attendance_can_record(v_h.crew_id) or public.actor_holds_job_role('project_administrator')) then
    raise exception 'not authorized' using errcode = '42501'; end if;
  if v_h.approved_at is not null then
    raise exception 'HC_LOCKED: this head count is approved and final' using errcode = '23514';
  end if;
  select w.project_id into v_project from public.work_orders w where w.id = v_h.work_order_id and w.org_id = v_org;
  select d.org_id, d.project_id, d.file_path into v_d_org, v_d_project, v_file from public.project_documents d where d.id = p_document;
  if not found or v_d_org is distinct from v_org or v_d_project is distinct from v_project then
    raise exception 'HCE_DOCUMENT: the file must be a document of this work order''s project' using errcode = '23514';
  end if;
  if v_file is null or btrim(v_file) = '' then
    raise exception 'HCE_DOCUMENT: the document has no file attached' using errcode = '23514';
  end if;
  if (select count(*) from public.headcount_day_documents x where x.headcount_id = p_headcount) >= 10 then
    raise exception 'HCE_LIMIT: a head count carries at most 10 files' using errcode = '23514';
  end if;
  insert into public.headcount_day_documents (org_id, headcount_id, document_id, attached_by)
  values (v_org, p_headcount, p_document, v_uid)
  on conflict (headcount_id, document_id) do update set attached_by = excluded.attached_by
  returning id into v_id;
  perform public.log_audit('headcount_day.attach', v_org, v_uid, p_headcount,
            jsonb_build_object('work_order_id', v_h.work_order_id, 'work_date', v_h.work_date, 'document_id', p_document));
  return v_id;
end $$;
revoke all on function public.attach_headcount_document(uuid, uuid) from public, anon;
grant execute on function public.attach_headcount_document(uuid, uuid) to authenticated;

create function public.detach_headcount_document(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_x public.headcount_day_documents;
  v_h public.headcount_days;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if v_uid is null or v_org is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_x from public.headcount_day_documents x where x.id = p_id and x.org_id = v_org;
  if not found then raise exception 'attachment not found' using errcode = 'P0002'; end if;
  select * into v_h from public.headcount_days h where h.id = v_x.headcount_id for update;
  if not (public.attendance_can_record(v_h.crew_id) or public.actor_holds_job_role('project_administrator')) then
    raise exception 'not authorized' using errcode = '42501'; end if;
  if v_h.approved_at is not null then
    raise exception 'HC_LOCKED: this head count is approved and final' using errcode = '23514';
  end if;
  delete from public.headcount_day_documents x where x.id = p_id;
  perform public.log_audit('headcount_day.detach', v_org, v_uid, v_h.id,
            jsonb_build_object('work_order_id', v_h.work_order_id, 'work_date', v_h.work_date, 'document_id', v_x.document_id));
end $$;
revoke all on function public.detach_headcount_document(uuid) from public, anon;
grant execute on function public.detach_headcount_document(uuid) to authenticated;
