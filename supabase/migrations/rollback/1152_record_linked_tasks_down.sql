-- 1152_record_linked_tasks_down.sql — reverse of 1152 (guard body back to 0355's, then trigger, functions, indexes, columns).
-- Loses record links and close reasons, never tasks.
update public.record_history_config
   set captured = captured - 'procurement_id' - 'expense_claim_id' - 'material_request_id'
                           - 'closed_by_record_type' - 'closed_by_record_status',
       omit_cols = array_remove(omit_cols, 'closed_by_record_at')
 where entity_type = 'task';
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
declare
  k_external_allowed constant text[] :=
    array['milestone_id','completed_at','tombstoned_at','source_updated_at'];
  k_assignee_allowed constant text[] := array['status','completed_at'];
  k_creator_allowed constant text[] :=
    array['name','description','priority','status','assignee_id','milestone_id','parent_task_id',
          'project_id','start_date','end_date','completed_at','last_update','meeting_id'];
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
drop trigger if exists tasks_zz_check_record_link on public.tasks;
drop function if exists public.check_task_record_link();
drop function if exists public.task_link_record_ended(uuid, uuid, uuid);
drop function if exists public.record_link_status(text, uuid);
drop function if exists public.record_status_is_end(text, text);
drop index if exists public.tasks_procurement_open_uniq, public.tasks_expense_claim_open_uniq, public.tasks_material_request_open_uniq;
drop index if exists public.tasks_procurement_link_idx, public.tasks_expense_claim_link_idx, public.tasks_material_request_link_idx;
alter table public.tasks
  drop constraint if exists tasks_record_link_no_proof,
  drop constraint if exists tasks_close_reason_shape,
  drop constraint if exists tasks_one_record_link,
  drop column if exists closed_by_record_at, drop column if exists closed_by_record_status, drop column if exists closed_by_record_type,
  drop column if exists material_request_id, drop column if exists expense_claim_id, drop column if exists procurement_id;
