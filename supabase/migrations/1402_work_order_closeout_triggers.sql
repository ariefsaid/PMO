-- 1402_work_order_closeout_triggers.sql — the issue-time copy and the close guard. #2593; FR-WCO-002, 020..023.

-- ── copy the organisation's list onto a work order when it is issued ───────────────────────────────────────────────────
-- Only Draft to Issued: a work order already Issued when this ships has no checklist and closes as before (OD-WCO-3).
create or replace function public.instantiate_work_order_closeout_items() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.work_order_closeout_items (org_id, work_order_id, project_id, position, name, required, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.required,
         case when t.position = (select min(t2.position) from public.closeout_checklist_templates t2 where t2.org_id = new.org_id)
              then public.native_org_today(new.org_id) end
    from public.closeout_checklist_templates t
   where t.org_id = new.org_id;
  return new;
end; $$;
revoke all on function public.instantiate_work_order_closeout_items() from public, anon, authenticated;
create trigger work_orders_zz_closeout_items after update of status on public.work_orders
  for each row when (old.status = 'Draft' and new.status = 'Issued')
  execute function public.instantiate_work_order_closeout_items();

-- ── the close guard: one predicate for every route that closes a work order ───────────────────────────────────────────
-- transition_work_order (no contract lines) and confirm_work_order_acceptance (final acceptance) both end in an UPDATE that sets
-- status = 'Closed'; neither function is edited. Named after work_orders_zzzz_closing_guard so it fires after it ('_' sorts before 'z').
-- A refusal here rolls back the whole statement, so a final acceptance stays unconfirmed and no closing value is stamped.
create or replace function public.assert_work_order_closeout_complete() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_open integer;
begin
  select count(*) into v_open from public.work_order_closeout_items i
   where i.work_order_id = new.id and i.required and i.done_on is null;
  if v_open > 0 then
    raise exception 'this work order cannot close: % required close-out item(s) are not done', v_open
      using errcode = '55000', detail = 'closeout-incomplete';
  end if;
  new.closed_by := auth.uid();
  return new;
end; $$;
revoke all on function public.assert_work_order_closeout_complete() from public, anon, authenticated;
create trigger work_orders_zzzzzz_closeout_guard before update of status on public.work_orders
  for each row when (new.status = 'Closed' and old.status is distinct from 'Closed')
  execute function public.assert_work_order_closeout_complete();
