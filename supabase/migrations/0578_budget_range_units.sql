-- #1472 S4/S5: add exact range identity and durable range operation state to the existing budget seam.
-- Rollback is guarded by budget_range_units_revert(); it refuses once any range history exists.

alter table public.budget_version_account_erp_mirror
  add column to_fiscal_year text;
alter table public.budget_version_account_erp_mirror
  add constraint budget_account_mirror_range_check
  check (to_fiscal_year is null or to_fiscal_year <> '');
-- PostgreSQL truncates the generated default constraint name at 63 bytes. Resolve the existing
-- account-grain key by its ordered columns so the migration never depends on the truncated spelling.
do $$
declare
  old_constraint text;
  account_grain smallint[];
begin
  select array_agg(a.attnum::smallint order by requested.ordinality)
    into account_grain
    from unnest(array['org_id','budget_version_id','fiscal_year','erp_account'])
         with ordinality as requested(column_name, ordinality)
    join pg_attribute a on a.attrelid='public.budget_version_account_erp_mirror'::regclass
                       and a.attname=requested.column_name and a.attnum>0 and not a.attisdropped;
  select c.conname into strict old_constraint
    from pg_constraint c
   where c.conrelid='public.budget_version_account_erp_mirror'::regclass
     and c.contype='u' and c.conkey=account_grain;
  execute format('alter table public.budget_version_account_erp_mirror drop constraint %I', old_constraint);
end $$;
alter table public.budget_version_account_erp_mirror
  add constraint budget_version_account_erp_mirror_scope_unique
  unique nulls not distinct (org_id, budget_version_id, fiscal_year, erp_account, to_fiscal_year);
-- Append the range end-year after the former annual key so the unique index keeps serving the
-- established (org, version, year, account) status/ref lookup through its leftmost prefix.
create index budget_account_mirror_range_lookup_idx
  on public.budget_version_account_erp_mirror(org_id, fiscal_year, to_fiscal_year, erp_account, budget_version_id);

alter table public.budget_archive_cancel_intents
  add column to_fiscal_year text;
alter table public.budget_archive_cancel_intents
  add column erp_modified text;
alter table public.budget_archive_cancel_intents
  add constraint budget_archive_cancel_intents_range_check
  check (to_fiscal_year is null or (source_kind = 'account' and to_fiscal_year <> ''));
create index budget_archive_cancel_range_queue_idx
  on public.budget_archive_cancel_intents(org_id, project_id, fiscal_year, to_fiscal_year, erp_account, state);

create or replace view public.budget_push_mirror_rows with (security_invoker=true) as
  select id,org_id,budget_version_id,fiscal_year,push_state,push_error,unmapped_categories,
         activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,pushed_at,
         created_at,pushed_project_start_date,pushed_project_end_date,''::text as erp_account,'ensure'::text as budget_intent,null::text as to_fiscal_year
    from public.budget_version_erp_mirror
  union all
  select id,org_id,budget_version_id,fiscal_year,push_state,push_error,unmapped_categories,
         activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,pushed_at,
         created_at,pushed_project_start_date,pushed_project_end_date,erp_account,budget_intent,to_fiscal_year
    from public.budget_version_account_erp_mirror;
grant select on public.budget_push_mirror_rows to authenticated,service_role;
revoke all on public.budget_push_mirror_rows from anon;

alter table public.external_command_outbox add column budget_range_operation jsonb;
comment on column public.external_command_outbox.budget_range_operation is
  'Generation-fenced provisional ERPNext Budget draft/cancellation witness for the anchorless range workflow; never an external reference.';

create or replace function public.budget_account_identity(
  p_version uuid, p_fy text, p_to_fy text, p_account text
) returns text language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare from_token text; to_token text;
begin
  if p_version is null or p_fy is null or p_fy='' or p_to_fy is null or p_to_fy=''
     or p_account is null or btrim(p_account)='' then
    raise exception 'Invalid budget range identity' using errcode='22023';
  end if;
  from_token := public.budget_fiscal_year_token(p_fy);
  to_token := public.budget_fiscal_year_token(p_to_fy);
  return p_version::text || ':r:' || length(from_token)::text || ':' || from_token || ':'
    || length(to_token)::text || ':' || to_token || ':' || encode(convert_to(p_account,'UTF8'),'hex');
end $$;
revoke all on function public.budget_account_identity(uuid,text,text,text) from public,anon;
grant execute on function public.budget_account_identity(uuid,text,text,text) to authenticated,service_role;

create or replace function public.read_budget_range_outbox_state(
  p_id uuid, p_generation integer, p_payload_digest text, p_identity text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v public.external_command_outbox;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  select * into v from public.external_command_outbox o
   where o.id=p_id and o.claim_generation=p_generation and o.state='committing'
     and o.domain='budget' and o.operation='create' and o.pmo_record_id=p_identity
     and o.payload_digest=p_payload_digest and o.payload->>'outbox_identity'=p_identity
     and o.payload->>'budget_mode'='whole_project'
     and nullif(o.payload->>'to_fiscal_year','') is not null;
  if not found then
    raise exception 'range budget outbox claim is stale or does not match its immutable command' using errcode='P0001';
  end if;
  return v.budget_range_operation;
end $$;
revoke all on function public.read_budget_range_outbox_state(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.read_budget_range_outbox_state(uuid,integer,text,text) to service_role;

create or replace function public.advance_budget_range_outbox_stage(
  p_id uuid, p_generation integer, p_payload_digest text, p_identity text,
  p_expected_stage text, p_next jsonb
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.external_command_outbox; old_stage text; next_stage text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  if jsonb_typeof(p_next) is distinct from 'object'
     or p_next->>'identity' is distinct from p_identity
     or p_next->>'payloadDigest' is distinct from p_payload_digest
     or p_next->>'stage' not in ('cancel_started','cancelled','post_started','draft_witnessed',
       'distribution_put_started','distribution_saved','submit_started','submitted') then
    raise exception 'invalid range budget operation state' using errcode='22023';
  end if;
  select * into v from public.external_command_outbox o
   where o.id=p_id and o.claim_generation=p_generation and o.state='committing'
     and o.domain='budget' and o.operation='create' and o.pmo_record_id=p_identity
     and o.payload_digest=p_payload_digest and o.payload->>'outbox_identity'=p_identity
     and o.payload->>'budget_mode'='whole_project'
     and nullif(o.payload->>'to_fiscal_year','') is not null
   for update;
  if not found then return false; end if;
  old_stage := v.budget_range_operation->>'stage';
  next_stage := p_next->>'stage';
  if old_stage is distinct from p_expected_stage then return false; end if;
  if not (
       (old_stage is null and next_stage in ('cancel_started','post_started'))
    or (old_stage='cancel_started' and next_stage='cancelled')
    or (old_stage='cancelled' and next_stage='post_started')
    or (old_stage='post_started' and next_stage='draft_witnessed')
    or (old_stage='draft_witnessed' and next_stage='distribution_put_started')
    or (old_stage='distribution_put_started' and next_stage in ('distribution_put_started','distribution_saved'))
    or (old_stage='distribution_saved' and next_stage='submit_started')
    or (old_stage='submit_started' and next_stage in ('submit_started','submitted'))
  ) then
    raise exception 'invalid range budget stage transition' using errcode='22023';
  end if;
  if next_stage in ('draft_witnessed','distribution_put_started','distribution_saved','submit_started','submitted')
     and (nullif(p_next->>'draftName','') is null or nullif(p_next->>'initialModified','') is null
       or nullif(p_next->>'initialFingerprint','') is null or p_next->>'initialFingerprint' !~ '^[0-9a-f]{64}$'
       or nullif(p_next->>'expectedDistributionFingerprint','') is null
       or p_next->>'expectedDistributionFingerprint' !~ '^[0-9a-f]{64}$'
       or nullif(p_next->>'draftOwner','') is null) then
    raise exception 'range budget draft witness is incomplete' using errcode='22023';
  end if;
  if next_stage in ('distribution_saved','submit_started','submitted')
     and (nullif(p_next->>'savedModified','') is null or nullif(p_next->>'savedFingerprint','') is null
       or p_next->>'savedFingerprint' !~ '^[0-9a-f]{64}$') then
    raise exception 'range budget saved distribution witness is incomplete' using errcode='22023';
  end if;
  update public.external_command_outbox set budget_range_operation=p_next, updated_at=now()
   where id=p_id and claim_generation=p_generation and state='committing';
  return found;
end $$;
revoke all on function public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb) to service_role;

create or replace function public.enforce_budget_archive_outbox_state()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_project_id uuid;
  v_version_project_id uuid;
  v_version_status text;
  v_job_id uuid;
  v_fiscal_year text;
  v_account text;
  v_job public.budget_archive_cancel_intents%rowtype;
  v_request public.budget_archive_requests%rowtype;
  v_identity text;
  v_key text;
  v_mode text;
  v_to_fiscal_year text;
  v_has_archive_marker boolean;
  v_budget_intent text;
  v_predecessor text;
  v_predecessor_modified text;
  v_predecessor_count integer;
begin
  if new.domain <> 'budget' or new.operation <> 'create' then
    return new;
  end if;
  v_has_archive_marker := coalesce(new.payload ? 'budget_archive_cancel_job_id', false)
    or coalesce(new.payload ? 'budget_archive_source_mirror_id', false)
    or new.idempotency_key like 'bud15-archive:%'
    or new.idempotency_key like 'bud16-archive:%';
  if new.payload->>'erp_doc_kind' is distinct from 'budget' then
    if v_has_archive_marker then
      raise exception 'budget archive marker requires erp_doc_kind=budget' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.external_tier is distinct from 'erpnext' or new.state is distinct from 'pending'
     or new.actor_user_id is null then
    raise exception 'budget outbox command requires a pending actor-attributed ERPNext row' using errcode = 'P0001';
  end if;
  begin
    v_version_id := (new.payload->>'id')::uuid;
  exception when others then
    raise exception 'budget outbox command has no canonical version id' using errcode = 'P0001';
  end;

  if v_has_archive_marker and nullif(new.payload->>'budget_archive_cancel_job_id', '') is null then
    raise exception 'budget archive outbox command has an invalid job id' using errcode = 'P0001';
  end if;
  if not v_has_archive_marker then
    if new.pmo_record_id <> v_version_id::text
       and new.pmo_record_id not like v_version_id::text || ':%' then
      raise exception 'budget outbox identity does not match its version' using errcode = 'P0001';
    end if;
    select v.project_id into v_project_id
      from public.budget_versions v
     where v.id = v_version_id and v.org_id = new.org_id;
    if not found or v_project_id is null
       or (nullif(new.payload->>'projectId', '') is not null
           and new.payload->>'projectId' is distinct from v_project_id::text) then
      raise exception 'budget outbox command requires its project to match the budget version' using errcode = 'P0001';
    end if;
    perform 1 from public.projects p
     where p.id = v_project_id and p.org_id = new.org_id
     for update;
    if not found then
      raise exception 'budget outbox command project not found' using errcode = 'P0001';
    end if;
    select v.status, v.project_id into v_version_status, v_version_project_id
      from public.budget_versions v
     where v.id = v_version_id and v.org_id = new.org_id
     for share;
    if not found or v_version_project_id is distinct from v_project_id or v_version_status <> 'Active' then
      raise exception 'budget outbox command requires an Active budget version' using errcode = 'P0001';
    end if;

    v_fiscal_year := nullif(new.payload->>'fiscal_year', '');
    v_account := nullif(new.payload->>'erp_account', '');
    v_mode := new.payload->>'budget_mode';
    v_to_fiscal_year := nullif(new.payload->>'to_fiscal_year', '');
    if v_mode='whole_project' then
      v_budget_intent := new.payload->>'budget_intent';
      v_predecessor := nullif(new.payload->>'budget_predecessor', '');
      v_predecessor_modified := nullif(new.payload->>'budget_predecessor_modified', '');
      if v_fiscal_year is null or v_to_fiscal_year is null or v_account is null
         or v_budget_intent is null or v_budget_intent not in ('ensure','remove')
         or new.pmo_record_id is distinct from public.budget_account_identity(v_version_id,v_fiscal_year,v_to_fiscal_year,v_account)
         or new.payload->>'outbox_identity' is distinct from new.pmo_record_id
         or not exists (select 1 from public.external_org_bindings b where b.org_id=new.org_id
           and b.external_tier='erpnext' and b.version_major=16 and b.activated_at is not null) then
        raise exception 'whole-project budget outbox identity or ERPNext v16 binding is invalid' using errcode='P0001';
      end if;
      if v_budget_intent='remove' and (v_predecessor is null or v_predecessor_modified is null) then
        raise exception 'whole-project account removal requires an exact predecessor witness' using errcode='P0001';
      end if;
      if (v_predecessor is null) <> (v_predecessor_modified is null) then
        raise exception 'whole-project predecessor name and modified witness must be supplied together' using errcode='P0001';
      end if;
      if v_predecessor is not null then
        select count(*)::integer into v_predecessor_count
          from public.budget_version_account_erp_mirror m
          join public.budget_versions source_version
            on source_version.id=m.budget_version_id and source_version.org_id=m.org_id
          join public.external_refs r
            on r.org_id=m.org_id and r.domain='budget' and r.external_tier='erpnext'
           and r.pmo_record_id=case when m.to_fiscal_year is not null
             then public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.to_fiscal_year,m.erp_account) end
           and r.external_record_id=m.erp_budget_name
         where m.org_id=new.org_id and m.budget_version_id<>v_version_id
           and source_version.project_id=v_project_id and source_version.status in ('Active','Archived')
           and m.fiscal_year=v_fiscal_year and m.to_fiscal_year=v_to_fiscal_year and m.erp_account=v_account
           and m.erp_budget_name=v_predecessor and m.erp_modified=v_predecessor_modified
           and m.erp_docstatus=1 and m.erp_cancelled_at is null and m.push_state='pushed'
           and m.activated_at_witness=source_version.activated_at;
        if v_predecessor_count <> 1 then
          raise exception 'whole-project predecessor is not an exact reconciled PMO witness' using errcode='P0001';
        end if;
      end if;
    elsif v_to_fiscal_year is not null then
      raise exception 'only whole-project budgets may carry a range end year' using errcode='P0001';
    end if;
    if exists (
      select 1
        from public.budget_archive_cancel_intents i
       where i.org_id = new.org_id and i.project_id = v_project_id
         and (v_mode='whole_project' or i.to_fiscal_year is not null
              or v_fiscal_year is null or i.fiscal_year is null or i.fiscal_year = v_fiscal_year)
         and (v_account is null or i.source_kind = 'legacy' or i.erp_account is null or i.erp_account = v_account)
         and (
           i.state in ('pending', 'held')
           or (i.state = 'superseded' and exists (
             select 1 from public.external_command_outbox issued
              where issued.org_id = i.org_id and issued.domain = 'budget'
                and issued.payload->>'budget_archive_cancel_job_id' = i.id::text
           ))
         )
    ) then
      raise exception 'budget push is blocked by an unresolved archive cancellation' using errcode = 'P0001';
    end if;
    if exists (
      select 1
        from public.external_command_outbox o
        left join public.budget_versions command_version
          on command_version.org_id = o.org_id
         and command_version.id = case
           when o.payload->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (o.payload->>'id')::uuid end
       where o.org_id = new.org_id and o.domain = 'budget' and o.operation = 'create'
         and o.state <> 'confirmed' and o.idempotency_key <> new.idempotency_key
         and o.payload->>'erp_doc_kind' = 'budget'
         and (command_version.project_id = v_project_id or command_version.id is null)
         and (v_mode='whole_project' or o.payload->>'budget_mode'='whole_project'
              or v_fiscal_year is null or nullif(o.payload->>'fiscal_year', '') is null
              or o.payload->>'fiscal_year' = v_fiscal_year)
         and (v_account is null or o.payload->>'source_kind' = 'legacy'
              or nullif(o.payload->>'erp_account', '') is null
              or o.payload->>'erp_account' = v_account)
    ) then
      raise exception 'an overlapping budget command is unsettled for this project grain' using errcode = 'P0001';
    end if;
    return new;
  end if;

  begin
    v_job_id := (new.payload->>'budget_archive_cancel_job_id')::uuid;
  exception when others then
    raise exception 'budget archive outbox command has an invalid job id' using errcode = 'P0001';
  end;
  select i.project_id into v_project_id
    from public.budget_archive_cancel_intents i
   where i.id = v_job_id and i.org_id = new.org_id;
  if not found or v_project_id is null then
    raise exception 'budget archive outbox command has no durable intent' using errcode = 'P0001';
  end if;
  perform 1 from public.projects p
   where p.id = v_project_id and p.org_id = new.org_id
   for update;
  if not found then
    raise exception 'budget archive outbox project not found' using errcode = 'P0001';
  end if;
  select v.status, v.project_id into v_version_status, v_version_project_id
    from public.budget_versions v
   where v.id = v_version_id and v.org_id = new.org_id
   for share;
  if not found or v_version_project_id is distinct from v_project_id then
    raise exception 'budget archive outbox command version does not match its project' using errcode = 'P0001';
  end if;
  select i.* into v_job
    from public.budget_archive_cancel_intents i
   where i.id = v_job_id and i.org_id = new.org_id and i.state = 'pending'
   for update;
  if not found then
    raise exception 'budget archive outbox command has no pending durable intent' using errcode = 'P0001';
  end if;
  select r.* into v_request
    from public.budget_archive_requests r
   where r.id = v_job.request_id and r.org_id = new.org_id;
  if not found or v_job.project_id is distinct from v_project_id
     or v_request.project_id <> v_job.project_id or v_request.budget_version_id <> v_job.budget_version_id
     or v_request.requested_by <> v_job.actor_user_id or new.actor_user_id is distinct from v_job.actor_user_id
     or v_request.cancel_erp is distinct from true
     or (new.payload->>'projectId')::uuid is distinct from v_job.project_id
     or v_version_id is distinct from v_job.budget_version_id
     or new.payload->>'fiscal_year' is distinct from v_job.fiscal_year
     or new.payload->>'to_fiscal_year' is distinct from v_job.to_fiscal_year
     or (v_job.to_fiscal_year is not null and (new.payload->>'budget_mode' is distinct from 'whole_project'
         or new.payload->>'budget_predecessor_modified' is distinct from v_job.erp_modified))
     or new.payload->>'budget_intent' is distinct from 'remove'
     or new.payload->>'budget_predecessor' is distinct from v_job.erp_budget_name
     or new.payload->>'outbox_identity' is distinct from (case when v_job.source_kind = 'legacy'
          then public.budget_legacy_identity(v_job.budget_version_id, v_job.fiscal_year)
          else case when v_job.to_fiscal_year is null then public.budget_account_identity(v_job.budget_version_id, v_job.fiscal_year, v_job.erp_account) else public.budget_account_identity(v_job.budget_version_id, v_job.fiscal_year, v_job.to_fiscal_year, v_job.erp_account) end
        end)
     or nullif(new.payload->>'activated_at', '')::timestamptz is distinct from v_job.activated_at_witness
     or nullif(new.payload->>'project_start_date', '')::date is distinct from v_job.pushed_project_start_date
     or nullif(new.payload->>'project_end_date', '')::date is distinct from v_job.pushed_project_end_date
     or new.payload->>'budget_archive_source_mirror_id' is distinct from v_job.source_mirror_id::text
     or (v_job.source_kind = 'legacy' and (new.payload->>'source_kind' is distinct from 'legacy' or new.payload->>'erp_account' is not null))
     or (v_job.source_kind = 'account' and (new.payload->>'source_kind' is not null or new.payload->>'erp_account' is distinct from v_job.erp_account)) then
    raise exception 'budget archive outbox command does not match its durable request' using errcode = 'P0001';
  end if;
  if v_version_status <> 'Archived' then
    raise exception 'budget archive outbox command requires its version to remain Archived' using errcode = 'P0001';
  end if;
  v_identity := case when v_job.source_kind = 'legacy'
    then public.budget_legacy_identity(v_job.budget_version_id, v_job.fiscal_year)
    else case when v_job.to_fiscal_year is null then public.budget_account_identity(v_job.budget_version_id, v_job.fiscal_year, v_job.erp_account) else public.budget_account_identity(v_job.budget_version_id, v_job.fiscal_year, v_job.to_fiscal_year, v_job.erp_account) end
  end;
  v_key := case when v_job.source_kind = 'legacy' then 'bud15-archive:' else 'bud16-archive:' end
    || v_identity || ':' || floor(extract(epoch from v_job.activated_at_witness) * 1000)::bigint::text;
  if new.pmo_record_id is distinct from v_identity or new.idempotency_key is distinct from v_key then
    raise exception 'budget archive outbox identity does not match its durable request' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from public.external_command_outbox o
      left join public.budget_versions command_version
        on command_version.org_id = o.org_id
       and command_version.id = case
         when o.payload->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (o.payload->>'id')::uuid end
     where o.org_id = v_job.org_id and o.domain = 'budget' and o.operation = 'create'
       and o.state <> 'confirmed'
       and o.payload->>'erp_doc_kind' = 'budget'
       and o.payload->>'budget_archive_cancel_job_id' is null
       and (command_version.project_id = v_job.project_id or command_version.id is null)
       and (v_job.source_kind = 'legacy' or o.payload->>'source_kind' = 'legacy'
            or nullif(o.payload->>'erp_account', '') is null
            or o.payload->>'erp_account' = v_job.erp_account)
  ) then
    raise exception 'an overlapping budget command is unsettled for this project grain' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_budget_archive_outbox_state() from public, anon, authenticated;
drop trigger if exists enforce_budget_archive_outbox_state on public.external_command_outbox;
drop trigger if exists external_command_outbox_zz_enforce_budget_archive_outbox_state on public.external_command_outbox;
create trigger external_command_outbox_zz_enforce_budget_archive_outbox_state
  before insert on public.external_command_outbox
  for each row when (new.domain = 'budget' and new.operation = 'create')
  execute function public.enforce_budget_archive_outbox_state();

drop function public.get_budget_archive_targets(uuid);
create function public.get_budget_archive_targets(p_version_id uuid)
returns table (
  source_kind text,
  page_key text,
  fiscal_year text,
  to_fiscal_year text,
  erp_budget_name text,
  eligible boolean,
  reason text,
  push_state text,
  erp_docstatus smallint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid := public.auth_org_id();
  v_project uuid;
  v_version_org uuid;
begin
  if v_actor is null or v_org is null or not public.is_active_member()
     or public.auth_role() not in ('Admin', 'Executive', 'Project Manager', 'Finance') then
    raise exception 'not authorized to read budget archive targets' using errcode = '42501';
  end if;
  select v.org_id, v.project_id into v_version_org, v_project
    from public.budget_versions v where v.id = p_version_id;
  if v_version_org is null or v_version_org <> v_org
     or not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
    raise exception 'budget version not found' using errcode = '42501';
  end if;
  return query
    select i.source_kind, md5(i.source_kind || ':' || i.source_mirror_id::text),
           i.fiscal_year, case when i.source_kind='account' then a.to_fiscal_year else null::text end,
           i.erp_budget_name, i.eligible, i.reason, i.push_state, i.erp_docstatus
      from public.budget_archive_target_inventory(p_version_id) i
      left join public.budget_version_account_erp_mirror a
        on i.source_kind='account' and a.id=i.source_mirror_id and a.budget_version_id=p_version_id
     order by md5(i.source_kind || ':' || i.source_mirror_id::text);
end $$;
comment on function public.get_budget_archive_targets(uuid) is
  '#1462: read-only disclosure of every known potentially live ERPNext Budget for a version, with a safe eligibility reason. The archive RPC re-checks every predicate under lock.';
revoke all on function public.get_budget_archive_targets(uuid) from public, anon;
grant execute on function public.get_budget_archive_targets(uuid) to authenticated;

create or replace function public.budget_archive_target_inventory(p_version_id uuid)
returns table (
  source_kind text,
  source_mirror_id uuid,
  fiscal_year text,
  erp_account text,
  erp_budget_name text,
  activated_at_witness timestamptz,
  pushed_project_start_date date,
  pushed_project_end_date date,
  push_state text,
  erp_docstatus smallint,
  eligible boolean,
  reason text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with version_row as (
    select v.id, v.org_id, v.project_id, v.activated_at
      from public.budget_versions v
     where v.id = p_version_id
  ),
  binding as (
    select b.version_major, b.activated_at
      from public.external_org_bindings b
      join version_row vr on vr.org_id = b.org_id
     where b.external_tier = 'erpnext'
     limit 1
  ),
  project_versions as (
    select v.id from public.budget_versions v
      join version_row vr on vr.project_id = v.project_id and vr.org_id = v.org_id
  ),
  budget_commands as (
    select o.org_id, o.payload->>'id' as version_id,
           nullif(o.payload->>'fiscal_year', '') as fiscal_year,
           nullif(o.payload->>'erp_account', '') as erp_account,
           o.payload->>'source_kind' as source_kind,
           command_version.project_id
      from public.external_command_outbox o
      join version_row vr on vr.org_id = o.org_id
      left join public.budget_versions command_version
        on command_version.org_id = o.org_id
       and command_version.id = case
         when o.payload->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (o.payload->>'id')::uuid end
     where o.domain = 'budget' and o.operation = 'create'
       and o.state <> 'confirmed' and o.payload->>'erp_doc_kind' = 'budget'
  ),
  -- ⚑ CONSERVATIVE CANDIDATES. "Potentially live" is the DEFAULT, not an inference: a nonempty ERP name
  -- with no cancellation tombstone and a docstatus that is not 2 counts regardless of push state, binding,
  -- activation witness or account intent. A failed retry can still leave a live document behind.
  candidates as (
    select 'account'::text as source_kind, m.id as source_mirror_id, m.fiscal_year, m.to_fiscal_year,
           m.erp_account, m.erp_budget_name, m.activated_at_witness,
           m.pushed_project_start_date, m.pushed_project_end_date,
           m.push_state, m.erp_docstatus
      from public.budget_version_account_erp_mirror m
      join version_row vr on vr.id = m.budget_version_id and vr.org_id = m.org_id
     where m.erp_budget_name is not null and btrim(m.erp_budget_name) <> ''
       and m.erp_cancelled_at is null
       and (m.erp_docstatus is null or m.erp_docstatus <> 2)
    union all
    select 'legacy', m.id, m.fiscal_year,
           null::text as to_fiscal_year, null::text, m.erp_budget_name, m.activated_at_witness,
           m.pushed_project_start_date, m.pushed_project_end_date,
           m.push_state, m.erp_docstatus
      from public.budget_version_erp_mirror m
      join version_row vr on vr.id = m.budget_version_id and vr.org_id = m.org_id
     where m.erp_budget_name is not null and btrim(m.erp_budget_name) <> ''
       and m.erp_cancelled_at is null
       and (m.erp_docstatus is null or m.erp_docstatus <> 2)
  ),
  evaluated as (
    select c.*,
           case when c.source_kind = 'legacy'
                then public.budget_legacy_identity(p_version_id, c.fiscal_year)
                else case when c.to_fiscal_year is null
                  then public.budget_account_identity(p_version_id, c.fiscal_year, c.erp_account)
                  else public.budget_account_identity(p_version_id, c.fiscal_year, c.to_fiscal_year, c.erp_account) end
           end as identity,
           -- Exactly ONE mirror source for this exact document name across BOTH tables and every
           -- version of the project: two sources naming one document cannot both be its provenance.
           (
             select count(*)::integer
               from (
                 select a.id
                   from public.budget_version_account_erp_mirror a
                   join project_versions pv on pv.id = a.budget_version_id
                  where a.erp_budget_name = c.erp_budget_name
                    and a.erp_cancelled_at is null
                    and (a.erp_docstatus is null or a.erp_docstatus <> 2)
                 union all
                 select l.id
                   from public.budget_version_erp_mirror l
                   join project_versions pv on pv.id = l.budget_version_id
                  where l.erp_budget_name = c.erp_budget_name
                    and l.erp_cancelled_at is null
                    and (l.erp_docstatus is null or l.erp_docstatus <> 2)
               ) sources
           ) as source_count
           ,(
             select count(*)::integer
               from public.external_refs r
              where r.org_id = (select vr.org_id from version_row vr)
                and r.domain = 'budget'
                and r.external_tier = 'erpnext'
                and r.pmo_record_id = (case when c.source_kind = 'legacy' then public.budget_legacy_identity(p_version_id, c.fiscal_year) else case when c.to_fiscal_year is null then public.budget_account_identity(p_version_id, c.fiscal_year, c.erp_account) else public.budget_account_identity(p_version_id, c.fiscal_year, c.to_fiscal_year, c.erp_account) end end)
                and r.external_record_id = c.erp_budget_name
           ) as ref_count
           ,exists (
             select 1 from budget_commands o
              where o.version_id = p_version_id::text
                 or (
                   (o.project_id = (select vr.project_id from version_row vr) or o.project_id is null)
                   and (c.source_kind = 'legacy' or o.source_kind = 'legacy' or o.erp_account is null
                        or c.erp_account is null or o.erp_account = c.erp_account)
                 )
           ) as command_unsettled
      from candidates c
  )
  select e.source_kind, e.source_mirror_id, e.fiscal_year, e.erp_account, e.erp_budget_name,
         e.activated_at_witness, e.pushed_project_start_date, e.pushed_project_end_date,
         e.push_state, e.erp_docstatus,
         (
           case
             when (select b.activated_at from binding b) is null then false
             when e.source_kind = 'legacy'
               then (select b.version_major from binding b) = 15
             else (select b.version_major from binding b) = 16
           end
           and (select vr.activated_at from version_row vr) is not null
           and e.activated_at_witness = (select vr.activated_at from version_row vr)
           and e.pushed_project_start_date is not null
           and e.source_count = 1
           and e.ref_count = 1
           and not e.command_unsettled
           and not exists (
             select 1 from public.budget_versions active
              where active.org_id = (select vr.org_id from version_row vr)
                and active.project_id = (select vr.project_id from version_row vr)
                and active.status = 'Active'
                and active.id <> p_version_id
           )
         ) as eligible,
         case
           when (select b.activated_at from binding b) is null then 'binding-unavailable'
           when e.source_kind = 'legacy' and (select b.version_major from binding b) = 16 then 'legacy-v16-shape-unproven'
           when e.source_kind = 'legacy' and (select b.version_major from binding b) is distinct from 15 then 'binding-unsupported'
           when e.source_kind = 'account' and (select b.version_major from binding b) is distinct from 16 then 'binding-unsupported'
           when (select vr.activated_at from version_row vr) is null then 'activation-unproven'
           when e.activated_at_witness is null or e.activated_at_witness <> (select vr.activated_at from version_row vr) then 'witness-changed'
           when e.pushed_project_start_date is null then 'span-unproven'
           when e.source_count <> 1 then 'ambiguous-sources'
           when e.ref_count <> 1 then 'provenance-unproven'
           when e.command_unsettled then 'command-unsettled'
           when exists (
             select 1 from public.budget_versions active
              where active.org_id = (select vr.org_id from version_row vr)
                and active.project_id = (select vr.project_id from version_row vr)
                and active.status = 'Active'
                and active.id <> p_version_id
           ) then 'active-successor'
           else 'eligible'
         end as reason
    from evaluated e;
$$;
revoke all on function public.budget_archive_target_inventory(uuid) from public, anon, authenticated;
grant execute on function public.budget_archive_target_inventory(uuid) to service_role;

create or replace function public.record_outbox_ref(
  p_id uuid, p_generation int,
  p_domain text, p_pmo_record_id text, p_external_tier text, p_external_record_id text
) returns int
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v public.external_command_outbox;
  dest public.budget_version_account_erp_mirror;
  src public.budget_version_account_erp_mirror;
  dest_version public.budget_versions;
  src_version public.budget_versions;
  src_project uuid;
  dest_project uuid;
  existing_ref public.external_refs;
begin
  select * into v from public.external_command_outbox where id=p_id for update;
  if v.id is null or v.claim_generation is distinct from p_generation or v.state <> 'committed' then
    return 0;
  end if;

  if v.domain='budget' and v.pmo_record_id ~* '^[0-9a-f-]{36}:(a:|r:)' then
    -- Caller identity is deliberately ignored. The destination is derived from the locked command.
    select * into dest from public.budget_version_account_erp_mirror m
     where m.org_id=v.org_id
       and (case when m.to_fiscal_year is null then public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account) else public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.to_fiscal_year,m.erp_account) end)=v.pmo_record_id
     for update;
    if dest.id is null then return 0; end if;
    select * into dest_version from public.budget_versions bv where bv.id=dest.budget_version_id and bv.org_id=v.org_id for update;
    if dest_version.id is null or dest_version.status <> 'Active'
       or dest.activated_at_witness is distinct from dest_version.activated_at
       -- 0379: the slot carries NO name until the success writer runs AFTER this ref, so a NULL name is
       -- the ordinary fresh state. Only a slot that already names a DIFFERENT Budget is refused.
       or (dest.erp_budget_name is not null and dest.erp_budget_name is distinct from p_external_record_id)
       -- 0379: the name must be the one this command's own commit stored, so a slot with no name cannot be
       -- claimed for any other Budget.
       or (v.external_record_id is not null and v.external_record_id is distinct from p_external_record_id)
       or p_external_tier is distinct from v.external_tier then
      return 0;
    end if;

    select * into existing_ref from public.external_refs r
     where r.org_id=v.org_id and r.domain='budget' and r.external_tier=v.external_tier
       and r.external_record_id=p_external_record_id
     for update;
    if existing_ref.org_id is not null and existing_ref.pmo_record_id <> v.pmo_record_id then
      select m.* into src
        from public.budget_version_account_erp_mirror m
        join public.budget_versions bv on bv.id=m.budget_version_id
       where m.org_id=v.org_id and m.erp_budget_name=p_external_record_id
         and m.push_state='pushed' and m.erp_docstatus=1
         and (case when m.to_fiscal_year is null then public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account) else public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.to_fiscal_year,m.erp_account) end)=existing_ref.pmo_record_id
       for update of m;
      if src.id is null or src.erp_account is distinct from dest.erp_account
         or src.fiscal_year is distinct from dest.fiscal_year
         or src.to_fiscal_year is distinct from dest.to_fiscal_year then return 0; end if;
      select * into src_version from public.budget_versions where id=src.budget_version_id for update;
      if src_version.id is null or src_version.status='Active'
         or src.activated_at_witness is distinct from src_version.activated_at then return 0; end if;
      src_project := src_version.project_id;
      dest_project := dest_version.project_id;
      if src_project is distinct from dest_project then return 0; end if;
      if dest.id is null then return 0; end if;
      update public.external_refs
         set pmo_record_id=v.pmo_record_id, external_tier=v.external_tier
       where org_id=v.org_id and domain='budget'
         and pmo_record_id=existing_ref.pmo_record_id and external_record_id=p_external_record_id;
      if not found then return 0; end if;
      return 1;
    elsif existing_ref.org_id is not null then
      if existing_ref.pmo_record_id=v.pmo_record_id then return 1; end if;
      return 0;
    end if;

    insert into public.external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id)
      values(v.org_id,'budget',v.pmo_record_id,v.external_tier,p_external_record_id)
      on conflict(org_id,domain,pmo_record_id) do nothing;
    if exists(select 1 from public.external_refs r where r.org_id=v.org_id and r.domain='budget'
      and r.pmo_record_id=v.pmo_record_id and r.external_tier=v.external_tier
      and r.external_record_id=p_external_record_id) then return 1; end if;
    return 0;
  end if;

  if v.domain = 'companies' and v.operation = 'create' and v.payload ->> 'erp_doc_kind' = 'contact' then
    insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
      values (v.org_id, v.domain, v.pmo_record_id, p_external_tier, p_external_record_id)
      on conflict (org_id, domain, pmo_record_id) do nothing;
    if not exists (select 1 from public.external_refs r where r.org_id=v.org_id and r.domain=v.domain
      and r.pmo_record_id=v.pmo_record_id and r.external_tier=p_external_tier
      and r.external_record_id=p_external_record_id) then
      raise exception 'Contact mapping identity conflict' using errcode='23505';
    end if;
    return 1;
  end if;
  insert into public.external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
    values (v.org_id,v.domain,v.pmo_record_id,p_external_tier,p_external_record_id)
    on conflict (org_id,domain,pmo_record_id)
      do update set external_record_id=excluded.external_record_id,external_tier=excluded.external_tier;
  return 1;
end; $$;
revoke all on function public.record_outbox_ref(uuid,integer,text,text,text,text) from public;
grant execute on function public.record_outbox_ref(uuid,integer,text,text,text,text) to service_role;


create or replace function public.transition_budget_archive_cancel_intent(
  p_org_id uuid, p_intent_id uuid, p_action text, p_reason text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i public.budget_archive_cancel_intents%rowtype;
  a public.budget_version_account_erp_mirror%rowtype;
  l public.budget_version_erp_mirror%rowtype;
  v public.budget_versions%rowtype;
  v_project_id uuid;
  v_version_id uuid;
  event_code text;
  v_stale boolean := false;
  v_mirror_state text;
begin
  if p_action not in ('held', 'superseded', 'retry') or p_action is null then
    raise exception 'invalid archive transition' using errcode = '22023';
  end if;
  select project_id, budget_version_id into v_project_id, v_version_id
    from public.budget_archive_cancel_intents
   where id=p_intent_id and org_id=p_org_id;
  if not found then raise exception 'archive intent not found' using errcode='P0001'; end if;
  perform 1 from public.projects
   where id=v_project_id and org_id=p_org_id
   for update;
  if not found then raise exception 'archive project not found' using errcode='P0001'; end if;
  select * into v from public.budget_versions
   where id=v_version_id and org_id=p_org_id
   for update;
  select * into i from public.budget_archive_cancel_intents
   where id=p_intent_id and org_id=p_org_id for update;
  if not found then raise exception 'archive intent not found' using errcode='P0001'; end if;
  if i.state <> 'pending' then
    if i.state = p_action then return 'already'; end if;
    raise exception 'archive intent is no longer pending' using errcode='P0001';
  end if;
  if i.project_id is distinct from v_project_id or i.budget_version_id is distinct from v_version_id
     or v.id is null or v.project_id is distinct from i.project_id or v.status <> 'Archived'
     or v.activated_at is distinct from i.activated_at_witness then
    v_stale := true;
  elsif i.source_kind = 'legacy' then
    select * into l from public.budget_version_erp_mirror
     where id=i.source_mirror_id and org_id=i.org_id for update;
    if l.id is null or l.budget_version_id is distinct from i.budget_version_id
       or l.fiscal_year is distinct from i.fiscal_year
       or l.erp_budget_name is distinct from i.erp_budget_name
       or l.activated_at_witness is distinct from i.activated_at_witness
       or l.pushed_project_start_date is distinct from i.pushed_project_start_date
       or l.pushed_project_end_date is distinct from i.pushed_project_end_date
       or l.erp_cancelled_at is not null or l.erp_docstatus = 2
       or (p_action = 'held' and l.push_state not in ('pending','failed','pushed'))
       or (p_action in ('retry','superseded') and l.push_state not in ('pending','failed')) then
      v_stale := true;
    else
      v_mirror_state := case when p_action='retry' then 'failed' else 'held' end;
    end if;
  else
    select * into a from public.budget_version_account_erp_mirror
     where id=i.source_mirror_id and org_id=i.org_id for update;
    if a.id is null or a.budget_version_id is distinct from i.budget_version_id
       or a.fiscal_year is distinct from i.fiscal_year or a.erp_account is distinct from i.erp_account
       or (i.to_fiscal_year is not null and (a.to_fiscal_year is distinct from i.to_fiscal_year
           or a.erp_modified is distinct from i.erp_modified))
       or a.erp_budget_name is distinct from i.erp_budget_name
       or a.activated_at_witness is distinct from i.activated_at_witness
       or a.pushed_project_start_date is distinct from i.pushed_project_start_date
       or a.pushed_project_end_date is distinct from i.pushed_project_end_date
       or a.budget_intent is distinct from 'remove' or a.erp_cancelled_at is not null
       or a.erp_docstatus = 2
       or (p_action = 'held' and a.push_state not in ('pending','failed','pushed'))
       or (p_action in ('retry','superseded') and a.push_state not in ('pending','failed')) then
      v_stale := true;
    else
      v_mirror_state := case when p_action='retry' then 'failed' else 'held' end;
    end if;
  end if;

  if v_stale then
    event_code := 'budget-archive-cancel-stale';
  else
    update public.budget_archive_cancel_intents
       set state=case when p_action='retry' then 'pending' else p_action end,
           last_error=case when p_action='superseded' then null else left(p_reason,1000) end,
           updated_at=now()
     where id=i.id and org_id=i.org_id and state='pending';
    if i.source_kind = 'legacy' then
      update public.budget_version_erp_mirror
         set push_state=v_mirror_state,
             push_error='budget-archive-cancel-' || p_action
       where id=i.source_mirror_id and org_id=i.org_id;
    else
      update public.budget_version_account_erp_mirror
         set push_state=v_mirror_state,
             push_error='budget-archive-cancel-' || p_action
       where id=i.source_mirror_id and org_id=i.org_id;
    end if;
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

create function public.budget_range_units_revert() returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.budget_versions where budget_mode='whole_project')
     or exists(select 1 from public.budget_version_account_erp_mirror where to_fiscal_year is not null)
     or exists(select 1 from public.budget_archive_cancel_intents where to_fiscal_year is not null)
     or exists(select 1 from public.external_command_outbox where budget_range_operation is not null
       or pmo_record_id ~* '^[0-9a-f-]{36}:r:')
     or exists(select 1 from public.external_refs where domain='budget' and pmo_record_id ~* '^[0-9a-f-]{36}:r:') then
    raise exception '0578 rollback refused: range budget history would be stranded';
  end if;
  drop function if exists public.get_budget_archive_targets(uuid);
  drop function if exists public.budget_archive_target_inventory(uuid);
  drop trigger if exists external_command_outbox_zz_enforce_budget_archive_outbox_state on public.external_command_outbox;
  drop trigger if exists enforce_budget_archive_outbox_state on public.external_command_outbox;
  drop function if exists public.enforce_budget_archive_outbox_state();
  drop function if exists public.read_budget_range_outbox_state(uuid,integer,text,text);
  drop function if exists public.advance_budget_range_outbox_stage(uuid,integer,text,text,text,jsonb);
  drop function if exists public.budget_account_identity(uuid,text,text,text);
  drop view public.budget_push_mirror_rows;
  alter table public.external_command_outbox drop column budget_range_operation;
  drop index if exists public.budget_archive_cancel_range_queue_idx;
  alter table public.budget_archive_cancel_intents drop constraint if exists budget_archive_cancel_intents_range_check;
  alter table public.budget_archive_cancel_intents drop column erp_modified;
  alter table public.budget_archive_cancel_intents drop column to_fiscal_year;
  drop index if exists public.budget_account_mirror_range_lookup_idx;
  alter table public.budget_version_account_erp_mirror drop constraint if exists budget_version_account_erp_mirror_scope_unique;
  alter table public.budget_version_account_erp_mirror drop constraint if exists budget_account_mirror_range_check;
  alter table public.budget_version_account_erp_mirror drop column to_fiscal_year;
  alter table public.budget_version_account_erp_mirror
    add constraint budget_version_account_erp_mirror_org_id_budget_version_id_fiscal_year_erp_account_key
    unique (org_id,budget_version_id,fiscal_year,erp_account);
end $$;
revoke all on function public.budget_range_units_revert() from public,anon;
grant execute on function public.budget_range_units_revert() to service_role;
