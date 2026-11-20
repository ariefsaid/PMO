-- 1083_crew_tool_task_notice.sql — #2581: one notification, not two, when a tool task is assigned to the coordinator.
-- report_crew_tool (1082) sends its own notice naming the tool, quantity, kind and crew in the reader's language
-- (FR-CTR-013), so the generic "A task was assigned to you" notice of 0237 is skipped for the INSERT of a tool task.
-- Later reassignments keep the generic notice. Body: 0237's verbatim plus one early return.
-- Reversal: rollback/1083_crew_tool_task_notice_down.sql.
create or replace function public.notify_task_assignment() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Human actor only: server-side writers (ERP sync, seed) have no auth.uid() and must not spam.
  if auth.uid() is null or new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  if tg_op = 'INSERT' and new.crew_tool_report_id is not null then return new; end if;
  perform public.notify_workflow_user(new.org_id, new.assignee_id, 'A task was assigned to you',
    new.name, 'info', 'task', new.id, new.name);
  return new;
end; $$;
revoke execute on function public.notify_task_assignment() from public, anon, authenticated;
