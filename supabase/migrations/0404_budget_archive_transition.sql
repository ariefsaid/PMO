-- Atomic service-owned archive reconciliation and durable operator signal.
create function public.transition_budget_archive_cancel_intent(
  p_org_id uuid, p_intent_id uuid, p_action text, p_reason text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i public.budget_archive_cancel_intents%rowtype;
  m public.budget_version_account_erp_mirror%rowtype;
  v public.budget_versions%rowtype;
  event_code text;
begin
  if p_action not in ('held', 'superseded', 'retry') or p_action is null then
    raise exception 'invalid archive transition' using errcode = '22023';
  end if;
  select * into i from public.budget_archive_cancel_intents
   where id=p_intent_id and org_id=p_org_id for update;
  if not found then raise exception 'archive intent not found' using errcode='P0001'; end if;
  if i.state <> 'pending' then
    if i.state = p_action then return 'already'; end if;
    raise exception 'archive intent is no longer pending' using errcode='P0001';
  end if;
  select * into v from public.budget_versions where id=i.budget_version_id and org_id=i.org_id for update;
  select * into m from public.budget_version_account_erp_mirror
   where id=i.source_mirror_id and org_id=i.org_id for update;
  if v.id is null or v.project_id is distinct from i.project_id or v.status <> 'Archived'
     or v.activated_at is distinct from i.activated_at_witness
     or m.id is null or m.budget_version_id is distinct from i.budget_version_id
     or m.fiscal_year is distinct from i.fiscal_year or m.erp_account is distinct from i.erp_account
     or m.erp_budget_name is distinct from i.erp_budget_name
     or m.activated_at_witness is distinct from i.activated_at_witness
     or m.pushed_project_start_date is distinct from i.pushed_project_start_date
     or m.pushed_project_end_date is distinct from i.pushed_project_end_date
     or m.budget_intent is distinct from 'remove' or m.erp_cancelled_at is not null
     or m.erp_docstatus = 2
     or (p_action = 'held' and m.push_state not in ('pending','failed','pushed'))
     or (p_action in ('retry','superseded') and m.push_state not in ('pending','failed')) then
    event_code := 'budget-archive-cancel-stale';
  else
    update public.budget_archive_cancel_intents
       set state=case when p_action='retry' then 'pending' else p_action end,
           last_error=case when p_action='superseded' then null else left(p_reason,1000) end,
           updated_at=now()
     where id=i.id and org_id=i.org_id and state='pending';
    update public.budget_version_account_erp_mirror
       set push_state=case when p_action='retry' then 'failed' else 'held' end,
           push_error='budget-archive-cancel-' || p_action
     where id=m.id and org_id=i.org_id;
    if p_action <> 'superseded' then event_code := 'budget-archive-cancel-' || p_action; end if;
  end if;
  -- The intent lock serializes retries. 0071's existing drain and retention own delivery.
  if event_code is not null and not exists (
    select 1 from public.error_events e where e.fn='erpnext-sweep' and e.error_code=event_code
      and e.org_id=i.org_id and e.context_id=i.id::text
  ) then
    insert into public.error_events (fn,error_code,context_id,org_id)
    values ('erpnext-sweep',event_code,i.id::text,i.org_id);
  end if;
  if event_code='budget-archive-cancel-stale' then return 'stale'; end if;
  return 'applied';
end $$;
revoke all on function public.transition_budget_archive_cancel_intent(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.transition_budget_archive_cancel_intent(uuid,uuid,text,text) to service_role;
