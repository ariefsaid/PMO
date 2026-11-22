-- 1742_manpower_need_notices.sql — who must act next, and who hears the outcome (FR-MPN-009, FR-MPN-010).
--   my_manpower_to_fill()  open needs with places still to fill, for the people who may write needs (manpower_can_manage). Derived on
--                          read, nothing stored: a need that is met or cancelled, or whose places are all linked, is simply not in the
--                          next read. Counts only (1741).
--   notify_manpower_need_outcome()  when a need is marked met or cancelled, its creator gets one in-app notice (notify_workflow_user,
--                          which never notifies the acting user). Plain English like every 0237 workflow notice.
-- Mutation check: drop the manpower_can_manage() predicate (a non-writer then sees rows); remove the status-change guard (a repeat update
-- notifies twice); drop the status filter (a met need stays listed).
-- REVERSE: supabase/migrations/rollback/1742_manpower_need_notices_down.sql

create function public.my_manpower_to_fill()
  returns table (need_id uuid, project_id uuid, needed_by date, open_count integer)
  language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.project_id, n.needed_by, p.open_count
    from public.manpower_needs n
    join public.manpower_need_progress() p on p.need_id = n.id
   where public.assert_not_light()                                                                            -- field account refused by body (2711, 1530)
     and public.manpower_can_manage()                                                                          -- mut:fill_audience
     and n.org_id = public.auth_org_id() and n.status = 'open' and p.open_count > 0                            -- mut:fill_status
   order by n.needed_by, n.id
$$;
revoke all on function public.my_manpower_to_fill() from public, anon;
grant execute on function public.my_manpower_to_fill() to authenticated;

create function public.notify_manpower_need_outcome() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is distinct from old.status and new.status in ('met', 'cancelled') and new.created_by is not null then    -- mut:outcome_guard
    perform public.notify_workflow_user(new.org_id, new.created_by,
      case new.status when 'met' then 'Manpower need met' else 'Manpower need cancelled' end,
      case new.status when 'met' then 'A manpower need you recorded is now met.' else 'A manpower need you recorded was cancelled.' end,
      'info', 'manpower_need', new.id, 'Manpower need');
  end if;
  return new;
end $$;
revoke all on function public.notify_manpower_need_outcome() from public, anon, authenticated;
create trigger manpower_needs_outcome_notice after update of status on public.manpower_needs
  for each row execute function public.notify_manpower_need_outcome();
