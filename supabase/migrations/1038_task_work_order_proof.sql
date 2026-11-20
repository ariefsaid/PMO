-- 1038_task_work_order_proof.sql — #2531: a task may belong to a work order and may require proof of completion.
-- Spec docs/specs/task-work-order-proof.spec.md (FR-TWOP-001..016); plan docs/plans/2026-11-20-task-work-order-proof.md.
-- Proven by supabase/tests/1038_task_work_order_proof.test.sql. Not a money path.
--   §1 tasks.work_order_id + tasks.proof_required.
--   §2 check_task_work_order: the link rule (own project and org, no project-less link, no new link to a Cancelled WO,
--      no project move while linked, structure roles only may set either column on insert).
--      Update-time relinking by an assignee/creator is already refused by the 0200/0355 column allowlist pin,
--      because neither column is on any allowlist.
--   §3 task_proofs + RLS + org stamp + count cap + append-only on a Done proof-required task + audit rows.
--   §4 guard_task_done_needs_proof: the database refuses Done with no live proof, whichever policy admitted the write.
--   §5 private bucket task-proofs + storage policies (read = the task read rule; write = assignee or structure role).
-- ── REVERSE: supabase/migrations/rollback/1038_task_work_order_proof_down.sql ──────────────────────────────

-- ── §1 columns ────────────────────────────────────────────────────────────────────────────────────────────
alter table public.tasks
  add column work_order_id  uuid references public.work_orders(id),
  add column proof_required boolean not null default false;
create index tasks_work_order_idx on public.tasks (work_order_id) where work_order_id is not null;

-- ── §2 the link rule ──────────────────────────────────────────────────────────────────────────────────────
-- Definer: it must read work_orders whatever the caller's RLS. Never client-callable.
create function public.check_task_work_order() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_project uuid; v_status public.work_order_status;
begin
  -- Structure columns on INSERT: an Engineer/Finance creator (0204) may not set either. No auth.uid() = server authority.
  if tg_op = 'INSERT' and auth.uid() is not null
     and (new.work_order_id is not null or new.proof_required)
     and auth_role() not in ('Admin','Executive','Project Manager') then
    raise exception 'only a manager may link a task to a work order or require proof' using errcode = '42501';
  end if;

  if new.work_order_id is null then
    return new;
  end if;

  -- Moving a linked task to another project: name the way out (FR-TWOP-004).
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id
     and new.work_order_id is not distinct from old.work_order_id then
    raise exception 'task is linked to a work order of its current project; clear the work order before moving it'
      using errcode = '23514';
  end if;

  if new.project_id is null then
    raise exception 'a task without a project cannot name a work order' using errcode = '23514';
  end if;

  select w.org_id, w.project_id, w.status into v_org, v_project, v_status
    from public.work_orders w where w.id = new.work_order_id;
  if v_org is distinct from new.org_id or v_project is distinct from new.project_id then
    raise exception 'work order must belong to the task''s own project' using errcode = '23514';
  end if;
  if v_status = 'Cancelled'
     and (tg_op = 'INSERT' or new.work_order_id is distinct from old.work_order_id) then
    raise exception 'a cancelled work order takes no new tasks' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.check_task_work_order() from public;

create trigger tasks_zz_check_work_order
  before insert or update of work_order_id, project_id on public.tasks
  for each row execute function public.check_task_work_order();

-- Change-history registry (record_changes_catalog_gate): both new columns are captured row history.
update public.record_history_config
   set captured = captured || '{"work_order_id":"ref","proof_required":"bool"}'::jsonb
 where entity_type = 'task';

-- ── §3 task_proofs ────────────────────────────────────────────────────────────────────────────────────────
create table public.task_proofs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  task_id     uuid not null references public.tasks(id) on delete cascade,
  file_path   text not null,
  file_name   text,
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index task_proofs_task_idx on public.task_proofs (task_id, created_at desc) where archived_at is null;
alter table public.task_proofs enable row level security;
alter table public.task_proofs force  row level security;

-- Read = the task's own read rule (tasks_select is org-wide for active members).
create policy task_proofs_select on public.task_proofs for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and exists (select 1 from public.tasks t where t.id = task_proofs.task_id and t.org_id = (select public.auth_org_id())));

-- Add / remove (remove = soft-archive, ADR-0018): the assignee and the structure roles, never on an externally-owned task.
create policy task_proofs_insert on public.task_proofs for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and exists (select 1 from public.tasks t where t.id = task_proofs.task_id and t.org_id = (select public.auth_org_id())
      and ((select public.auth_role()) in ('Admin','Executive','Project Manager') or t.assignee_id = (select auth.uid()))
      and not public.task_domain_externally_owned(t.project_id)));
create policy task_proofs_update on public.task_proofs for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
    and exists (select 1 from public.tasks t where t.id = task_proofs.task_id and t.org_id = (select public.auth_org_id())
      and ((select public.auth_role()) in ('Admin','Executive','Project Manager') or t.assignee_id = (select auth.uid()))
      and not public.task_domain_externally_owned(t.project_id)))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- No client delete; the only client-writable column on update is archived_at.
revoke delete on public.task_proofs from authenticated, anon;
revoke update on public.task_proofs from authenticated, anon;
grant select, insert on public.task_proofs to authenticated;
grant update (archived_at) on public.task_proofs to authenticated;

-- org stamp from the parent task; a client-sent org other than the task's is refused by the policy.
create function public.task_proofs_before_insert() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_live int;
begin
  select t.org_id into v_org from public.tasks t where t.id = new.task_id;
  if v_org is null then
    raise exception 'task not found' using errcode = '23503';
  end if;
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    new.org_id := v_org;
  end if;
  -- task_proofs_stamp_org_id runs first and stamps the caller's org: a task in another org is refused here, as RLS would.
  if new.org_id <> v_org then
    raise exception 'task is not in your organisation' using errcode = '42501';
  end if;
  -- The file must exist. Only for the caller's own org, so a probe of another org's paths falls through to RLS (42501).
  if new.org_id = auth_org_id()
     and not exists (select 1 from storage.objects o where o.bucket_id = 'task-proofs' and o.name = new.file_path) then
    raise exception 'proof object not found' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.task_id::text, 0));
  select count(*) into v_live from public.task_proofs p where p.task_id = new.task_id and p.archived_at is null;
  if v_live >= 10 then
    raise exception 'a task holds at most 10 proof attachments' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.task_proofs_before_insert() from public;
create trigger task_proofs_stamp_org_id before insert on public.task_proofs
  for each row execute function public.stamp_org_id();
create trigger task_proofs_zz_before_insert before insert on public.task_proofs
  for each row execute function public.task_proofs_before_insert();

-- FR-TWOP-013: the proof of a Done proof-required task is append-only.
create function public.task_proofs_guard_remove() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text; v_req boolean;
begin
  if old.archived_at is not null and new.archived_at is null then
    raise exception 'removed proof cannot be restored' using errcode = '23514';
  end if;
  if new.archived_at is not null and old.archived_at is null then
    -- Same per-task lock as the Done guard: whichever commits second re-reads the other's result.
    perform pg_advisory_xact_lock(hashtextextended(new.task_id::text, 0));
    select t.status::text, t.proof_required into v_status, v_req from public.tasks t where t.id = new.task_id;
    if v_status = 'Done' and v_req then
      raise exception 'proof of a completed task cannot be removed; reopen the task first' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.task_proofs_guard_remove() from public;
create trigger task_proofs_guard_remove before update on public.task_proofs
  for each row execute function public.task_proofs_guard_remove();

-- FR-TWOP-016: audit rows.
create function public.task_proofs_audit() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit('task_proof.add', new.org_id, auth.uid(), new.id,
      jsonb_build_object('task_id', new.task_id));
  elsif new.archived_at is not null and old.archived_at is null then
    perform public.log_audit('task_proof.remove', new.org_id, auth.uid(), new.id,
      jsonb_build_object('task_id', new.task_id));
  end if;
  return new;
end $$;
revoke all on function public.task_proofs_audit() from public;
create trigger task_proofs_audit after insert or update of archived_at on public.task_proofs
  for each row execute function public.task_proofs_audit();

-- ── §4 the Done guard (FR-TWOP-012) ───────────────────────────────────────────────────────────────────────
-- Fires for every path (assignee policy, structure policy, definer RPCs); only a transition INTO Done is gated, so
-- toggling proof_required on an already-Done task leaves its status alone (FR-TWOP-014).
create function public.guard_task_done_needs_proof() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Lock in its own statement so the check below takes a fresh snapshot and sees a just-committed removal.
  if new.status = 'Done' and new.proof_required and (tg_op = 'INSERT' or old.status is distinct from 'Done') then
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
  end if;
  if new.status = 'Done' and new.proof_required
     and (tg_op = 'INSERT' or old.status is distinct from 'Done')
     and not exists (select 1 from public.task_proofs p where p.task_id = new.id and p.archived_at is null) then
    raise exception 'proof of completion is required before this task can be Done' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_task_done_needs_proof() from public;
create trigger tasks_zz_done_needs_proof
  before insert or update of status, proof_required on public.tasks
  for each row execute function public.guard_task_done_needs_proof();

-- ── §5 storage: private bucket, 15 MB, the document type allowlist (0025 minus CAD/text) ───────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('task-proofs', 'task-proofs', false, 15728640, array[
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
  on conflict (id) do nothing;

-- Path {org}/{task_id}/{proof_id}/{filename}: 4 segments.
create policy storage_objects_task_proof_read on storage.objects for select
  using (bucket_id = 'task-proofs' and (select auth.uid()) is not null and (select public.is_active_member())
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and exists (select 1 from public.tasks t
      where t.id::text = split_part(name, '/', 2) and t.org_id = (select public.auth_org_id())));
create policy storage_objects_task_proof_write on storage.objects for insert
  with check (bucket_id = 'task-proofs' and (select auth.uid()) is not null and (select public.is_active_member())
    and split_part(name, '/', 1) = (select public.auth_org_id())::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and exists (select 1 from public.tasks t
      where t.id::text = split_part(name, '/', 2) and t.org_id = (select public.auth_org_id())
        and ((select public.auth_role()) in ('Admin','Executive','Project Manager') or t.assignee_id = (select auth.uid()))
        and not public.task_domain_externally_owned(t.project_id)));
