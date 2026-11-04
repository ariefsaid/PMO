-- 0578 rollback is intentionally guarded and refuses to strand any range budget history.
select public.budget_range_units_revert();
drop function public.budget_range_units_revert();

-- Restore the exact final 0379 record_outbox_ref body (annual account and legacy paths unchanged).
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

  if v.domain='budget' and v.pmo_record_id ~* '^[0-9a-f-]{36}:a:' then
    -- Caller identity is deliberately ignored. The destination is derived from the locked command.
    select * into dest from public.budget_version_account_erp_mirror m
     where m.org_id=v.org_id
       and public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account)=v.pmo_record_id
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
         and public.budget_account_identity(m.budget_version_id,m.fiscal_year,m.erp_account)=existing_ref.pmo_record_id
       for update of m;
      if src.id is null or src.erp_account is distinct from dest.erp_account
         or src.fiscal_year is distinct from dest.fiscal_year then return 0; end if;
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


-- Restore the exact final 0575 archive inventory definition.
create function public.budget_archive_target_inventory(p_version_id uuid)
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
    select 'account'::text as source_kind, m.id as source_mirror_id, m.fiscal_year,
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
           null::text, m.erp_budget_name, m.activated_at_witness,
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
                else public.budget_account_identity(p_version_id, c.fiscal_year, c.erp_account)
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
                and r.pmo_record_id = case when c.source_kind = 'legacy'
                  then public.budget_legacy_identity(p_version_id, c.fiscal_year)
                  else public.budget_account_identity(p_version_id, c.fiscal_year, c.erp_account)
                end
                and r.external_record_id = c.erp_budget_name
           ) as ref_count
           ,exists (
             select 1 from budget_commands o
              where o.version_id = p_version_id::text
                 or (
                   (o.project_id = (select vr.project_id from version_row vr) or o.project_id is null)
                   and (o.fiscal_year is null or o.fiscal_year = c.fiscal_year)
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

-- Restore the exact final 0575 archive outbox fence.
create function public.enforce_budget_archive_outbox_state()
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
  v_has_archive_marker boolean;
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
    if exists (
      select 1
        from public.budget_archive_cancel_intents i
       where i.org_id = new.org_id and i.project_id = v_project_id
         and (v_fiscal_year is null or i.fiscal_year is null or i.fiscal_year = v_fiscal_year)
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
         and (v_fiscal_year is null or nullif(o.payload->>'fiscal_year', '') is null
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
     or new.payload->>'budget_intent' is distinct from 'remove'
     or new.payload->>'budget_predecessor' is distinct from v_job.erp_budget_name
     or new.payload->>'outbox_identity' is distinct from (case when v_job.source_kind = 'legacy'
          then public.budget_legacy_identity(v_job.budget_version_id, v_job.fiscal_year)
          else public.budget_account_identity(v_job.budget_version_id, v_job.fiscal_year, v_job.erp_account)
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
    else public.budget_account_identity(v_job.budget_version_id, v_job.fiscal_year, v_job.erp_account)
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
       and (nullif(o.payload->>'fiscal_year', '') is null or o.payload->>'fiscal_year' = v_job.fiscal_year)
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

-- Restore the exact final 0575 archive transition.
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

-- Restore the exact final 0293 invoker union after dropping its range-only column.
create view public.budget_push_mirror_rows with (security_invoker=true) as
  select id,org_id,budget_version_id,fiscal_year,push_state,push_error,unmapped_categories,
         activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,pushed_at,
         created_at,pushed_project_start_date,pushed_project_end_date,''::text as erp_account,'ensure'::text as budget_intent
    from public.budget_version_erp_mirror
  union all
  select id,org_id,budget_version_id,fiscal_year,push_state,push_error,unmapped_categories,
         activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,pushed_at,
         created_at,pushed_project_start_date,pushed_project_end_date,erp_account ,budget_intent
    from public.budget_version_account_erp_mirror;
grant select on public.budget_push_mirror_rows to authenticated,service_role;
revoke all on public.budget_push_mirror_rows from anon;

-- Restore the exact 0575 archive target read API.
create function public.get_budget_archive_targets(p_version_id uuid)
returns table (
  source_kind text,
  page_key text,
  fiscal_year text,
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
           i.fiscal_year, i.erp_budget_name, i.eligible, i.reason,
           i.push_state, i.erp_docstatus
      from public.budget_archive_target_inventory(p_version_id) i
     order by md5(i.source_kind || ':' || i.source_mirror_id::text);
end $$;
comment on function public.get_budget_archive_targets(uuid) is
  '#1462: read-only disclosure of every known potentially live ERPNext Budget for a version, with a safe eligibility reason. The archive RPC re-checks every predicate under lock.';
revoke all on function public.get_budget_archive_targets(uuid) from public, anon;
grant execute on function public.get_budget_archive_targets(uuid) to authenticated;
