-- #1462 rollback — reversible only when NO legacy archive decision exists.
--
-- ⚑ REFUSES WHILE ANY legacy intent exists, INCLUDING a terminal one. Dropping the kind or the column
-- would destroy the audit trail of a cancellation PMO actually issued (or held), and would let a later
-- replay mint a second ERP write for the same document. There is no lossless downgrade, so refuse.
do $$
begin
  if exists (select 1 from public.budget_archive_cancel_intents where source_kind = 'legacy') then
    raise exception 'legacy budget archive cancellations prevent rollback';
  end if;
end $$;

-- The pre-fix archive transaction (0387), restored byte-for-byte for the account-only behaviour.
create or replace function public.archive_budget_version_with_cancel_intent(
  p_version_id uuid,
  p_cancel_erp boolean default false,
  p_archive_request_id uuid default gen_random_uuid()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_project uuid;
  v_status text;
  v_version_org uuid;
  v_activated_at timestamptz;
  v_binding_major integer;
  v_live_count integer := 0;
  v_request public.budget_archive_requests%rowtype;
  v_jobs jsonb := '[]'::jsonb;
  v_updated integer;
begin
  if v_actor is null or v_org is null
     or not public.is_active_member()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to archive this budget version' using errcode = '42501';
  end if;

  select v.org_id, v.project_id, v.status, v.activated_at
    into v_version_org, v_project, v_status, v_activated_at
    from public.budget_versions v
   where v.id = p_version_id
   for update;
  if not found or v_version_org <> v_org
     or not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
    raise exception 'budget version not found or not writable' using errcode = '42501';
  end if;

  select r.* into v_request
    from public.budget_archive_requests r
   where r.id = p_archive_request_id and r.org_id = v_org and r.budget_version_id = p_version_id;
  if not found and v_status = 'Archived' then
    select r.* into v_request
      from public.budget_archive_requests r
     where r.org_id = v_org and r.budget_version_id = p_version_id
     order by r.created_at desc, r.id desc limit 1;
  end if;
  if found then
    select coalesce(jsonb_agg(i.id order by i.id), '[]'::jsonb) into v_jobs
      from public.budget_archive_cancel_intents i where i.request_id = v_request.id;
    return jsonb_build_object(
      'request_id', v_request.id,
      'cancel_erp', v_request.cancel_erp,
      'live_target_count', v_request.live_target_count,
      'intent_ids', v_jobs
    );
  end if;

  if v_status is distinct from 'Active' then
    raise exception 'only an Active budget version can be archived' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.budget_versions other
              where other.project_id = v_project and other.org_id = v_org
                and other.id <> p_version_id and other.status = 'Active') then
    raise exception 'archive the current Active version only when the project has no Active successor' using errcode = 'P0001';
  end if;

  select b.version_major into v_binding_major
    from public.external_org_bindings b
   where b.org_id = v_org and b.external_tier = 'erpnext' and b.activated_at is not null;
  if p_cancel_erp and v_binding_major is distinct from 16 then
    raise exception 'ERPNext Budget cancellation is available only for version 16' using errcode = 'P0001';
  end if;

  if v_binding_major = 16 then
    perform 1
      from public.budget_version_account_erp_mirror m
     where m.org_id = v_org and m.budget_version_id = p_version_id
       and m.budget_intent = 'ensure'
       and m.erp_budget_name is not null
       and m.erp_cancelled_at is null
       and m.erp_docstatus is distinct from 2
       and m.activated_at_witness = v_activated_at
     for update;
    select count(*)::integer into v_live_count
      from public.budget_version_account_erp_mirror m
     where m.org_id = v_org and m.budget_version_id = p_version_id
       and m.budget_intent = 'ensure'
       and m.erp_budget_name is not null
       and m.erp_cancelled_at is null
       and m.erp_docstatus is distinct from 2
       and m.activated_at_witness = v_activated_at;
  end if;

  insert into public.budget_archive_requests
    (id, org_id, project_id, budget_version_id, requested_by, cancel_erp, live_target_count)
  values (p_archive_request_id, v_org, v_project, p_version_id, v_actor, p_cancel_erp, v_live_count)
  returning * into v_request;

  if p_cancel_erp and v_live_count > 0 then
    insert into public.budget_archive_cancel_intents
      (org_id, request_id, project_id, budget_version_id, source_mirror_id, actor_user_id,
       fiscal_year, erp_account, erp_budget_name, activated_at_witness,
       pushed_project_start_date, pushed_project_end_date)
    select m.org_id, v_request.id, v_project, p_version_id, m.id, v_actor,
           m.fiscal_year, m.erp_account, m.erp_budget_name, m.activated_at_witness,
           m.pushed_project_start_date, m.pushed_project_end_date
      from public.budget_version_account_erp_mirror m
     where m.org_id = v_org and m.budget_version_id = p_version_id
       and m.budget_intent = 'ensure'
       and m.erp_budget_name is not null
       and m.erp_cancelled_at is null
       and m.erp_docstatus is distinct from 2
       and m.activated_at_witness = v_activated_at;

    get diagnostics v_updated = row_count;
    update public.budget_version_account_erp_mirror m
       set budget_intent = 'remove', push_state = 'pending', push_error = null
      from public.budget_archive_cancel_intents i
     where i.request_id = v_request.id and i.source_mirror_id = m.id;
    select coalesce(jsonb_agg(i.id order by i.id), '[]'::jsonb) into v_jobs
      from public.budget_archive_cancel_intents i where i.request_id = v_request.id;
    update public.budget_archive_requests set live_target_count = v_updated where id = v_request.id;
    v_request.live_target_count := v_updated;
  elsif not p_cancel_erp and v_live_count > 0 then
    insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
    select v_org, p.id, 'warning', 'Action required',
           'ERPNext is still enforcing the archived budget for this project. Cancel its ERPNext Budget documents or activate a new PMO budget.',
           jsonb_build_object('action_required', 'budget-archive-live-erp', 'projectId', v_project, 'versionId', p_version_id)
      from public.profiles p
     where p.org_id = v_org and p.status = 'active' and p.role in ('Admin','Finance')
       and not exists (
         select 1 from public.notifications n
          where n.org_id = v_org and n.owner_id = p.id and n.read_at is null
            and n.metadata @> jsonb_build_object('action_required', 'budget-archive-live-erp', 'projectId', v_project, 'versionId', p_version_id)
       );
  end if;

  update public.budget_versions set status = 'Archived'
   where id = p_version_id and org_id = v_org and status = 'Active';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'only an Active budget version can be archived' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'request_id', v_request.id,
    'cancel_erp', v_request.cancel_erp,
    'live_target_count', v_request.live_target_count,
    'intent_ids', v_jobs
  );
end;
$$;
revoke all on function public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid) from public, anon;
grant execute on function public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid) to authenticated;

-- The pre-fix service transaction (0404), restored byte-for-byte.
create or replace function public.transition_budget_archive_cancel_intent(
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

drop trigger if exists enforce_budget_archive_outbox_state on public.external_command_outbox;
drop function if exists public.enforce_budget_archive_outbox_state();
drop function if exists public.get_budget_archive_targets(uuid);
drop function if exists public.budget_archive_target_inventory(uuid);
drop function if exists public.budget_legacy_identity(uuid, text);

-- Restore the pre-fix intent key/columns. Only account intents can exist here.
alter table public.budget_archive_cancel_intents
  drop constraint if exists budget_archive_cancel_intents_request_source_unique;
alter table public.budget_archive_cancel_intents
  drop constraint if exists budget_archive_cancel_intents_source_account_check;
alter table public.budget_archive_cancel_intents
  drop constraint if exists budget_archive_cancel_intents_source_kind_check;
alter table public.budget_archive_cancel_intents drop column if exists source_kind;
alter table public.budget_archive_cancel_intents alter column erp_account set not null;
alter table public.budget_archive_cancel_intents
  add constraint budget_archive_cancel_intents_request_id_source_mirror_id_key
  unique (request_id, source_mirror_id);

-- Remove the disclosure notices this migration backfilled, so a downgrade leaves no PMO claim about a
-- cancellation capability the old code does not have. Operator-created rows are untouched.
delete from public.notifications
 where metadata @> jsonb_build_object('action_required', 'budget-archive-legacy-live-erp');
