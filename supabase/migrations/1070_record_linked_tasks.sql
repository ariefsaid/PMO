-- 1070_record_linked_tasks.sql — #2587: a task may follow one purchase, expense claim/advance or material request.
-- Spec docs/specs/record-linked-tasks.spec.md (FR-RLT-001..021); plan docs/plans/2026-11-20-record-linked-tasks.md.
-- Proven by supabase/tests/1070_record_linked_tasks.test.sql. Not a money path: a task only reads a record's status.
--   §1 link + close columns on tasks, one-link / no-proof checks, one-open-task-per-link indexes.
--   §2 end-state lists (one place) and the status reader.
--   §3 check_task_record_link: the link guard (caller rights, so an unreadable record is a missing one) + the
--      close-column guard (a client can never write closed_by_*).
--   §4 enforce_assignee_status_only gains exactly one exception: Done while the linked record is in an end state.
--   §5 change-history registry.
-- The close function, its triggers and the read function are in 1071 / 1072.
-- ── REVERSE: supabase/migrations/rollback/1070_record_linked_tasks_down.sql ─────────────────────────────

-- ── §1 columns, checks, indexes ──────────────────────────────────────────────────────────────────────────
-- ⚑ The FKs keep the default NO ACTION: a hard delete of a record FK-blocks (23503) while any task row names it, as 0206's
-- meeting_id does. Archiving a task leaves its row, so only clearing the link releases the record (FR-RLT-005).
alter table public.tasks
  add column procurement_id        uuid references public.procurements(id),
  add column expense_claim_id      uuid references public.expense_claims(id),
  add column material_request_id   uuid references public.material_requests(id),
  add column closed_by_record_type   text,
  add column closed_by_record_status text,
  add column closed_by_record_at     timestamptz;

alter table public.tasks
  add constraint tasks_one_record_link
    check (num_nonnulls(procurement_id, expense_claim_id, material_request_id) <= 1),
  add constraint tasks_close_reason_shape
    check ((closed_by_record_type is null) = (closed_by_record_status is null)
       and (closed_by_record_type is null) = (closed_by_record_at is null)
       and (closed_by_record_type is null or closed_by_record_type in ('procurement','expense_claim','material_request'))),
  -- FR-RLT-019 / AC-RLT-012: a proof-required task (#2531) never also carries a record link.
  add constraint tasks_record_link_no_proof
    check (not proof_required or num_nonnulls(procurement_id, expense_claim_id, material_request_id) = 0);

-- FK-block scans and the close read these; the unique ones are the concurrency backstop for FR-RLT-006.
create index tasks_procurement_link_idx      on public.tasks (procurement_id)      where procurement_id is not null;
create index tasks_expense_claim_link_idx    on public.tasks (expense_claim_id)    where expense_claim_id is not null;
create index tasks_material_request_link_idx on public.tasks (material_request_id) where material_request_id is not null;

create unique index tasks_procurement_open_uniq on public.tasks (procurement_id)
  where procurement_id is not null and status <> 'Done' and archived_at is null and tombstoned_at is null;
create unique index tasks_expense_claim_open_uniq on public.tasks (expense_claim_id)
  where expense_claim_id is not null and status <> 'Done' and archived_at is null and tombstoned_at is null;
create unique index tasks_material_request_open_uniq on public.tasks (material_request_id)
  where material_request_id is not null and status <> 'Done' and archived_at is null and tombstoned_at is null;

-- ── §2 end states: the SINGLE list (spec "Definitions"); the app reads is_end_state, never its own copy ───────
-- ⚑ Adding a status to procurement_status / expense_claim_status / material_requests.status means updating this table.
create function public.record_status_is_end(p_type text, p_status text) returns boolean
  language sql immutable set search_path = public, pg_temp as $$
  select case p_type
    when 'procurement'      then p_status in ('Paid','Cancelled')
    when 'expense_claim'    then p_status in ('Paid','Cancelled')
    when 'material_request' then p_status in ('fulfilled','rejected','cancelled')
    else false end
$$;
revoke all on function public.record_status_is_end(text, text) from public, anon;
grant execute on function public.record_status_is_end(text, text) to authenticated, service_role;

-- Caller rights (no security definer): row security of the record table decides what is seen (FR-RLT-011).
create function public.record_link_status(p_type text, p_id uuid) returns text
  language plpgsql stable set search_path = public, pg_temp as $$
declare v text;
begin
  if p_type = 'procurement' then
    select status::text into v from public.procurements where id = p_id;
  elsif p_type = 'expense_claim' then
    select status::text into v from public.expense_claims where id = p_id;
  elsif p_type = 'material_request' then
    select status into v from public.material_requests where id = p_id;
  end if;
  return v;
end $$;
revoke all on function public.record_link_status(text, uuid) from public, anon;
grant execute on function public.record_link_status(text, uuid) to authenticated, service_role;

-- True while the task's linked record (as the caller sees it) is in an end state.
create function public.task_link_record_ended(p_procurement uuid, p_expense uuid, p_material uuid) returns boolean
  language plpgsql stable set search_path = public, pg_temp as $$
declare v_type text; v_id uuid; v_status text;
begin
  if p_procurement is not null then v_type := 'procurement';      v_id := p_procurement;
  elsif p_expense is not null then  v_type := 'expense_claim';    v_id := p_expense;
  elsif p_material is not null then v_type := 'material_request'; v_id := p_material;
  else return false; end if;
  v_status := public.record_link_status(v_type, v_id);
  return v_status is not null and public.record_status_is_end(v_type, v_status);
end $$;
revoke all on function public.task_link_record_ended(uuid, uuid, uuid) from public, anon;
grant execute on function public.task_link_record_ended(uuid, uuid, uuid) to authenticated, service_role;

-- ── §3 the link guard ─────────────────────────────────────────────────────────────────────────────────────
-- ⚑ INVOKER rights on purpose (unlike 0206's definer check): the `select` below runs under the caller's row security, so a
-- record the caller cannot read gets the same answer as a record that does not exist, and no second copy of three tables'
-- policies lives here (FR-RLT-002). The service-role path sees what service_role sees.
create function public.check_task_record_link() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
declare
  v_type text; v_id uuid; v_org uuid; v_project uuid; v_status text;
  v_clash_id uuid; v_clash_name text;
  v_open boolean;
begin
  -- Close columns: written only by the database's close function (current_user is its owner there). A client role
  -- (authenticated / anon / service_role) can never forge a system close; no session value is consulted (FR-RLT-014/020).
  if ((tg_op = 'INSERT' and new.closed_by_record_type is not null)
      or (tg_op = 'UPDATE' and (new.closed_by_record_type, new.closed_by_record_status, new.closed_by_record_at)
            is distinct from (old.closed_by_record_type, old.closed_by_record_status, old.closed_by_record_at)))
     and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'the close reason is set by the system only' using errcode = '42501';
  end if;

  if new.procurement_id is not null then v_type := 'procurement';      v_id := new.procurement_id;
  elsif new.expense_claim_id is not null then v_type := 'expense_claim';    v_id := new.expense_claim_id;
  elsif new.material_request_id is not null then v_type := 'material_request'; v_id := new.material_request_id;
  else return new; end if;

  v_open := new.status <> 'Done' and new.archived_at is null and new.tombstoned_at is null;
  -- the link set or changed?
  if tg_op = 'INSERT'
     or (new.procurement_id, new.expense_claim_id, new.material_request_id)
        is distinct from (old.procurement_id, old.expense_claim_id, old.material_request_id) then
    if v_type = 'procurement' then
      select r.org_id, r.project_id, r.status::text into v_org, v_project, v_status from public.procurements r where r.id = v_id;
    elsif v_type = 'expense_claim' then
      select r.org_id, r.project_id, r.status::text into v_org, v_project, v_status from public.expense_claims r where r.id = v_id;
    else
      select r.org_id, r.project_id, r.status into v_org, v_project, v_status from public.material_requests r where r.id = v_id;
    end if;
    -- One message for "missing", "not readable" and "another organisation" (no existence oracle).
    if v_org is null or v_org is distinct from new.org_id then
      raise exception 'choose a record you can open' using errcode = '42501';
    end if;
    if v_project is not null and new.project_id is not null and v_project is distinct from new.project_id then
      raise exception 'the record belongs to a different project than the task' using errcode = '23514';
    end if;
    if public.record_status_is_end(v_type, v_status) then
      raise exception 'this record is already finished' using errcode = '23514';
    end if;
  end if;

  -- One open task per link (FR-RLT-006): a pre-insert guard names the existing task; the partial unique index is the
  -- concurrency backstop (a bare 23505 is mapped to the same wording by the app).
  if v_open and (tg_op = 'INSERT'
      or (new.procurement_id, new.expense_claim_id, new.material_request_id)
         is distinct from (old.procurement_id, old.expense_claim_id, old.material_request_id)
      or old.status = 'Done' or old.archived_at is not null or old.tombstoned_at is not null) then
    select t.id, t.name into v_clash_id, v_clash_name
      from public.tasks t
     where t.id <> new.id
       and t.status <> 'Done' and t.archived_at is null and t.tombstoned_at is null
       and ((v_type = 'procurement' and t.procurement_id = v_id)
         or (v_type = 'expense_claim' and t.expense_claim_id = v_id)
         or (v_type = 'material_request' and t.material_request_id = v_id))
     limit 1;
    if v_clash_id is not null then
      raise exception 'an open task already exists for this record' using errcode = '23505',
        detail = v_clash_id::text, hint = v_clash_name;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_task_record_link() from public, anon;

-- zz: after the 0206 / 1038 guards, before nothing that matters; fires on every insert/update (the close columns are checked
-- there too).
create trigger tasks_zz_check_record_link
  before insert or update on public.tasks
  for each row execute function public.check_task_record_link();

-- ── §4 the column pin: the creator may link; the system close is the one new Done exception ───────────────
-- Body = 0355's (HEAD) + (a) the three link columns on the creator allow-list, (b) the close exception.
-- ⚑ (b) is NOT "a session value": it is true only while the record is itself in an end state, read under the caller's
-- rights (inside the definer close function that is its owner), and only status/completed_at/close columns may differ.
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
declare
  k_external_allowed constant text[] :=
    array['milestone_id','completed_at','tombstoned_at','source_updated_at'];
  k_assignee_allowed constant text[] := array['status','completed_at'];
  k_creator_allowed constant text[] :=
    array['name','description','priority','status','assignee_id','milestone_id','parent_task_id',
          'project_id','start_date','end_date','completed_at','last_update','meeting_id',
          'procurement_id','expense_claim_id','material_request_id'];
  k_close_allowed constant text[] :=
    array['status','completed_at','closed_by_record_type','closed_by_record_status','closed_by_record_at'];
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.task_domain_externally_owned(new.project_id) then
    return new;
  end if;

  if public.task_domain_externally_owned(new.project_id) then
    if to_jsonb(new) - k_external_allowed is distinct from to_jsonb(old) - k_external_allowed then
      -- Message byte-preserved from 0093/0140/0146/0199 — asserted verbatim elsewhere.
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- FR-RLT-014: a linked task may move to Done while its record is in an end state (status + close columns only).
  if new.status = 'Done' and old.status is distinct from 'Done'
     and num_nonnulls(new.procurement_id, new.expense_claim_id, new.material_request_id) = 1
     and (new.procurement_id, new.expense_claim_id, new.material_request_id)
         is not distinct from (old.procurement_id, old.expense_claim_id, old.material_request_id)
     and to_jsonb(new) - k_close_allowed is not distinct from to_jsonb(old) - k_close_allowed
     and public.task_link_record_ended(new.procurement_id, new.expense_claim_id, new.material_request_id) then
    return new;
  end if;

  if auth_role() in ('Admin','Executive','Project Manager') then
    return new;
  end if;

  if old.created_by is not null and old.created_by = (select auth.uid()) then
    if to_jsonb(new) - k_creator_allowed is distinct from to_jsonb(old) - k_creator_allowed then
      raise exception 'creator may edit task fields, not lifecycle or provenance columns'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if to_jsonb(new) - k_assignee_allowed is distinct from to_jsonb(old) - k_assignee_allowed then
    -- Message byte-preserved from 0016 onward — first_class_tasks.test.sql matches it verbatim.
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

-- ── §5 change history (record_changes_catalog_gate: every column is captured, flagged or omitted) ─────────
update public.record_history_config
   set captured = captured || '{"procurement_id":"ref","expense_claim_id":"ref","material_request_id":"ref",
                                "closed_by_record_type":"text","closed_by_record_status":"text"}'::jsonb,
       omit_cols = array_append(omit_cols, 'closed_by_record_at')
 where entity_type = 'task' and not (captured ? 'procurement_id');
