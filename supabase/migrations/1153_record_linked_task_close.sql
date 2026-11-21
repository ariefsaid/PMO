-- 1153_record_linked_task_close.sql — #2587: the system close (FR-RLT-012..018) and the live-status read (FR-RLT-009..011).
-- Proven by supabase/tests/1152_record_linked_tasks.test.sql.
-- ── REVERSE: supabase/migrations/rollback/1153_record_linked_task_close_down.sql ─────────────────────────

-- ── the close function: definer, never client-callable (FR-RLT-014) ──────────────────────────────────────
-- Sets every OPEN task of the record to Done and stores why (the three closed_by_* columns); completed_at is stamped by the
-- existing trigger. A task in an externally-owned domain is skipped (a local close would fight the sync). It never raises
-- into the record's own transaction: any failure here is a warning and the record's write still succeeds (FR-RLT-013).
create function public.close_tasks_for_record(p_type text, p_id uuid, p_status text) returns integer
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer := 0;
begin
  if not public.record_status_is_end(p_type, p_status) then
    return 0;
  end if;
  begin
    update public.tasks t
       set status = 'Done',
           closed_by_record_type = p_type,
           closed_by_record_status = p_status,
           closed_by_record_at = now()
     where t.status <> 'Done' and t.archived_at is null and t.tombstoned_at is null
       and ((p_type = 'procurement' and t.procurement_id = p_id)
         or (p_type = 'expense_claim' and t.expense_claim_id = p_id)
         or (p_type = 'material_request' and t.material_request_id = p_id))
       and not public.task_domain_externally_owned(t.project_id);
    get diagnostics v_n = row_count;
  exception when others then
    raise warning 'close_tasks_for_record(%, %): skipped: %', p_type, p_id, sqlerrm;
    return 0;
  end;
  return v_n;
end $$;
revoke all on function public.close_tasks_for_record(text, uuid, text) from public, anon, authenticated, service_role;

-- ── triggers on the three record tables ──────────────────────────────────────────────────────────────────
-- ⚑ Each trigger names the spec table (docs/specs/record-linked-tasks.spec.md "Definitions") and the end-state list in
-- record_status_is_end(): a status-enum change is not made without updating both. A status that is not listed is not an end
-- state, so a new status never closes a task by default.
create function public.trg_close_linked_tasks() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.close_tasks_for_record(tg_argv[0], new.id, new.status::text);
  return null;
end $$;
revoke all on function public.trg_close_linked_tasks() from public, anon, authenticated, service_role;

create trigger procurements_close_linked_tasks
  after update of status on public.procurements
  for each row when (old.status is distinct from new.status)
  execute function public.trg_close_linked_tasks('procurement');
create trigger expense_claims_close_linked_tasks
  after update of status on public.expense_claims
  for each row when (old.status is distinct from new.status)
  execute function public.trg_close_linked_tasks('expense_claim');
create trigger material_requests_close_linked_tasks
  after update of status on public.material_requests
  for each row when (old.status is distinct from new.status)
  execute function public.trg_close_linked_tasks('material_request');
comment on trigger procurements_close_linked_tasks on public.procurements is
  '#2587 close open linked tasks at an end state; list = record_status_is_end(); spec docs/specs/record-linked-tasks.spec.md';
comment on trigger expense_claims_close_linked_tasks on public.expense_claims is
  '#2587 close open linked tasks at an end state; list = record_status_is_end(); spec docs/specs/record-linked-tasks.spec.md';
comment on trigger material_requests_close_linked_tasks on public.material_requests is
  '#2587 close open linked tasks at an end state; list = record_status_is_end(); spec docs/specs/record-linked-tasks.spec.md';

-- ── the live-status read (FR-RLT-009..011) ───────────────────────────────────────────────────────────────
-- SECURITY INVOKER: each record table's own row security decides what is returned. A record the caller cannot read comes
-- back as readable=false with only the type; no number, status or end-state flag.
create function public.task_linked_records(p_task_ids uuid[])
  returns table (task_id uuid, link_type text, record_id uuid, label text, status text, is_end_state boolean, readable boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select t.id,
         case when t.procurement_id is not null then 'procurement'
              when t.expense_claim_id is not null then 'expense_claim'
              else 'material_request' end,
         coalesce(p.id, e.id, m.id),
         coalesce(coalesce(p.po_number, p.pr_number, p.code, p.title), coalesce(e.claim_number, e.title), m.number),
         coalesce(p.status::text, e.status::text, m.status),
         case when p.id is not null then public.record_status_is_end('procurement', p.status::text)
              when e.id is not null then public.record_status_is_end('expense_claim', e.status::text)
              when m.id is not null then public.record_status_is_end('material_request', m.status) end,
         coalesce(p.id, e.id, m.id) is not null
    from public.tasks t
    left join public.procurements p on p.id = t.procurement_id
    left join public.expense_claims e on e.id = t.expense_claim_id
    left join public.material_requests m on m.id = t.material_request_id
   where t.id = any (p_task_ids)
     and num_nonnulls(t.procurement_id, t.expense_claim_id, t.material_request_id) = 1
$$;
revoke all on function public.task_linked_records(uuid[]) from public, anon;
grant execute on function public.task_linked_records(uuid[]) to authenticated, service_role;
