-- Reverse of 1235. Refuses while any checklist item exists (it would discard the organisation's list).
do $$ begin
  if exists (select 1 from public.clearance_items) then
    raise exception 'refusing to drop clearance_items: it holds rows' using errcode = 'P0001';
  end if;
end $$;
drop table public.clearance_items;
revoke update (clearance_checklist_enabled) on public.organizations from authenticated;
alter table public.organizations drop column clearance_checklist_enabled;
