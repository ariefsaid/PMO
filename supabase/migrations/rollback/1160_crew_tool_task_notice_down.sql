-- Reverse of 1160: restores 0237's notify_task_assignment() body.
create or replace function public.notify_task_assignment() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then return new; end if;
  perform public.notify_workflow_user(new.org_id, new.assignee_id, 'A task was assigned to you',
    new.name, 'info', 'task', new.id, new.name);
  return new;
end; $$;
revoke execute on function public.notify_task_assignment() from public, anon, authenticated;
