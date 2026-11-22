-- 1773_wo_billing_step_issue_trigger.sql — copy the organisation's default billing step template onto a work order when it is issued. FR-WBS-001/002.
-- Rollback: supabase/migrations/rollback/1773_wo_billing_step_issue_trigger_down.sql
-- Only Draft to Issued (as the close-out copy, 1402): a work order already Issued when this ships has no list. No default template, an archived
-- one or an empty one makes no list and no error. The copy is a snapshot; the first step is current from the issue day and its people are told.
create function public.instantiate_work_order_billing_steps() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_tpl uuid; v_today date; v_first public.work_order_billing_steps; v_n int;
begin
  select s.default_template_id into v_tpl
    from public.org_billing_step_settings s
    join public.billing_step_templates t on t.id = s.default_template_id and t.org_id = s.org_id and t.archived_at is null
   where s.org_id = new.org_id;
  if v_tpl is null then return new; end if;
  v_today := public.native_org_today(new.org_id);
  insert into public.work_order_billing_steps
    (org_id, work_order_id, project_id, position, name, owner_role_key, target_days, optional, hidden_from_role_keys, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.owner_role_key, t.target_days, t.optional, t.hidden_from_role_keys,
         case when t.position = (select min(t2.position) from public.billing_step_template_steps t2 where t2.template_id = v_tpl) then v_today end
    from public.billing_step_template_steps t where t.template_id = v_tpl and t.org_id = new.org_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then return new; end if;
  insert into public.work_order_billing_step_documents (org_id, step_id, work_order_id, position, name, required)
  select new.org_id, ws.id, new.id, d.position, d.name, d.required
    from public.billing_step_template_steps t
    join public.work_order_billing_steps ws on ws.work_order_id = new.id and ws.position = t.position
    join public.billing_step_template_documents d on d.step_id = t.id
   where t.template_id = v_tpl;
  select * into v_first from public.work_order_billing_steps s where s.work_order_id = new.id and s.started_on is not null order by s.position limit 1;
  if v_first.id is not null then perform public.notify_wo_step_opened(v_first); end if;
  return new;
end; $$;
revoke all on function public.instantiate_work_order_billing_steps() from public, anon, authenticated;
create trigger work_orders_zz_billing_steps after update of status on public.work_orders
  for each row when (old.status = 'Draft' and new.status = 'Issued')
  execute function public.instantiate_work_order_billing_steps();
