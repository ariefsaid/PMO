-- #1422 / FR-BUD-122: archiving a budget and queuing its ERPNext v16 cancellations
-- are one PMO transaction. The sweep owns the external writes; this table is its
-- durable, actor-attributed source when the browser disappears before dispatch.

create table public.budget_archive_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  cancel_erp boolean not null,
  live_target_count integer not null default 0 check (live_target_count >= 0),
  created_at timestamptz not null default now()
);
create index budget_archive_requests_version_idx
  on public.budget_archive_requests(org_id, budget_version_id, created_at desc);

create table public.budget_archive_cancel_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.budget_archive_requests(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  source_mirror_id uuid not null references public.budget_version_account_erp_mirror(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id),
  fiscal_year text not null,
  erp_account text not null,
  erp_budget_name text not null,
  activated_at_witness timestamptz not null,
  pushed_project_start_date date,
  pushed_project_end_date date,
  state text not null default 'pending' check (state in ('pending','complete','superseded','held')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, source_mirror_id)
);
create index budget_archive_cancel_queue_idx
  on public.budget_archive_cancel_intents(org_id, state, created_at, id);

alter table public.budget_archive_requests enable row level security;
alter table public.budget_archive_requests force row level security;
alter table public.budget_archive_cancel_intents enable row level security;
alter table public.budget_archive_cancel_intents force row level security;
revoke all on public.budget_archive_requests from public, anon, authenticated;
revoke all on public.budget_archive_cancel_intents from public, anon, authenticated;
grant all on public.budget_archive_requests to service_role;
grant all on public.budget_archive_cancel_intents to service_role;

-- Direct status writes would bypass the durable request. The authenticated role keeps
-- the same four-role archive affordance through the RPC below.
revoke update (status) on public.budget_versions from authenticated;

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

  -- Preserve archive's existing role, org, active-member, project, and state gates.
  -- The definer is used only to persist the coupled service-owned cancellation queue.
  select r.* into v_request
    from public.budget_archive_requests r
   where r.id = p_archive_request_id and r.org_id = v_org and r.budget_version_id = p_version_id;
  if not found and v_status = 'Archived' then
    -- A retried browser request with a new transport id still resolves to the archive that already
    -- completed. A later reactivation starts a fresh Active→Archived cycle with a new request id.
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

comment on function public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid) is
  '#1422: archives only the caller org''s Active budget (same four write roles as budget_versions_write) and records the v16 ERP cancellation decision atomically. The ERP write is driven later by erpnext-sweep through the actor-attributed outbox.';

revoke all on function public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid) from public, anon;
grant execute on function public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid) to authenticated;
