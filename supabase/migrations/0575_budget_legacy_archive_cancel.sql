-- #1462 — archiving a budget must disclose EVERY known potentially live ERPNext Budget, including the
-- year-grained ones an older push version created, and may explicitly cancel exactly those documents.
--
-- ⚑ CANCEL ONLY (ADR-0048/0059, FR-BUD-140/152). Nothing here posts, amends, replaces or re-creates an
-- ERP Budget. Replacement belongs to a deliberate revision; an archive removal of a control must never
-- mint a NEW control with a figure PMO did not re-approve.
--
-- ⚑ ABSENCE IS NOT EVIDENCE. A missing activation witness, an unreadable/unknown binding, an ambiguous
-- ownership record, an unresolved ERPNext command or a successor that still needs the document is a
-- HOLD — never "there is nothing live". Those targets are counted, warned about, and excluded from
-- automatic cancellation, so an archive can never silently claim to have removed an ERP control it did
-- not remove.
--
-- ⚑ LEGACY PROVENANCE IS NEVER INVENTED. The older (pre-v16) mirror's own document name, fiscal year,
-- timestamps and ref are carried as they are. No account is synthesized for a legacy row, and a 15→16
-- re-bind does not "upgrade" an old document into an account-grained one.

-- ── 1. The durable intent learns WHICH mirror it names ─────────────────────────────────────────────
alter table public.budget_archive_cancel_intents
  add column source_kind text not null default 'account';

alter table public.budget_archive_cancel_intents
  add constraint budget_archive_cancel_intents_source_kind_check
  check (source_kind in ('account', 'legacy'));

alter table public.budget_archive_cancel_intents alter column erp_account drop not null;

alter table public.budget_archive_cancel_intents
  add constraint budget_archive_cancel_intents_source_account_check
  check (
    (source_kind = 'legacy' and erp_account is null)
    or (source_kind = 'account' and erp_account is not null and btrim(erp_account) <> '')
  );

-- One request may now name the SAME mirror id through both kinds only if the kinds differ, so the key
-- includes the kind. (Mirror ids are independent per table; the kind disambiguates them.)
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.budget_archive_cancel_intents'::regclass
       and con.contype = 'u'
       and con.conkey = (
         select array_agg(a.attnum order by a.attnum)
           from pg_attribute a
          where a.attrelid = 'public.budget_archive_cancel_intents'::regclass
            and a.attname in ('request_id', 'source_mirror_id')
       )
  loop
    execute format('alter table public.budget_archive_cancel_intents drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.budget_archive_cancel_intents
  add constraint budget_archive_cancel_intents_request_source_unique
  unique (request_id, source_kind, source_mirror_id);

-- Keep lifecycle eligibility stable while a budget command enters the durable outbox.
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
begin
  if new.domain <> 'budget' or new.operation <> 'create' or new.payload->>'erp_doc_kind' <> 'budget' then
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

  if nullif(new.payload->>'budget_archive_cancel_job_id', '') is null then
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
create trigger enforce_budget_archive_outbox_state
  before insert on public.external_command_outbox
  for each row when (new.domain = 'budget' and new.operation = 'create')
  execute function public.enforce_budget_archive_outbox_state();

-- ── 2. The legacy (year-qualified) identity, the SQL twin of budgetLegacyIdentity() ────────────────
create function public.budget_legacy_identity(p_version uuid, p_fiscal_year text)
returns text
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_version is null or p_fiscal_year is null or p_fiscal_year = '' then
    raise exception 'Invalid legacy budget identity' using errcode = '22023';
  end if;
  return p_version::text || ':' || public.budget_fiscal_year_token(p_fiscal_year);
end $$;
revoke all on function public.budget_legacy_identity(uuid, text) from public, anon;
grant execute on function public.budget_legacy_identity(uuid, text) to authenticated, service_role;

-- ── 3. ONE inventory definition, used by the archive transaction AND the operator read ────────────
-- Security invoker: it is called from the definer bodies below (which run as the owner, so RLS does not
-- hide the machine tables) and by service_role. It is never granted to a JWT role directly.
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

-- ── 4. The operator-visible read: one row per conservative candidate ──────────────────────────────
-- Deliberately exposes NO internal reference, mirror id or outbox identity: the browser only needs to
-- say "this year / this document name / can PMO cancel it, and if not, why". The archive transaction
-- re-evaluates every predicate under lock, so this read is a disclosure, never an authorization.
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

-- ── 5. The archive transaction: one decision, both kinds, all-or-nothing ──────────────────────────
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
  v_candidate_names integer := 0;
  v_candidate_rows integer := 0;
  v_ineligible integer := 0;
  v_created integer := 0;
  v_request public.budget_archive_requests%rowtype;
  v_jobs jsonb := '[]'::jsonb;
  v_updated integer;
begin
  if v_actor is null or v_org is null
     or not public.is_active_member()
     or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to archive this budget version' using errcode = '42501';
  end if;

  select v.org_id, v.project_id
    into v_version_org, v_project
    from public.budget_versions v
   where v.id = p_version_id;
  if not found or v_version_org <> v_org then
    raise exception 'budget version not found or not writable' using errcode = '42501';
  end if;
  perform 1 from public.projects p
   where p.id = v_project and p.org_id = v_org
   for update;
  if not found then
    raise exception 'budget version not found or not writable' using errcode = '42501';
  end if;
  select v.status, v.activated_at
    into v_status, v_activated_at
    from public.budget_versions v
   where v.id = p_version_id and v.org_id = v_org and v.project_id = v_project
   for update;
  if not found then
    raise exception 'budget version not found or not writable' using errcode = '42501';
  end if;

  -- Preserve archive's existing role, org, active-member, project, and state gates.
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
  -- Recheck the version lifecycle under the same lock order used by budget command admission.
  if exists (
    select 1 from public.external_command_outbox o
     where o.org_id = v_org and o.domain = 'budget'
       and (o.pmo_record_id = p_version_id::text or o.pmo_record_id like p_version_id::text || ':%')
       and o.state <> 'confirmed'
  ) then
    raise exception 'an ERPNext Budget command is unsettled; retry the archive after it has completed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.budget_versions other
              where other.project_id = v_project and other.org_id = v_org
                and other.id <> p_version_id and other.status = 'Active') then
    raise exception 'archive the current Active version only when the project has no Active successor' using errcode = 'P0001';
  end if;

  -- Lock the mirror rows of BOTH kinds in a stable (source_kind, id) order. The order is what makes two
  -- concurrent archives of one version serialize instead of deadlocking.
  perform 1 from public.budget_version_account_erp_mirror m
   where m.org_id = v_org and m.budget_version_id = p_version_id
   order by m.id for update;
  perform 1 from public.budget_version_erp_mirror m
   where m.org_id = v_org and m.budget_version_id = p_version_id
   order by m.id for update;

  select count(distinct i.erp_budget_name)::integer, count(*)::integer
    into v_candidate_names, v_candidate_rows
    from public.budget_archive_target_inventory(p_version_id) i;
  select count(*)::integer into v_ineligible
    from public.budget_archive_target_inventory(p_version_id) i
   where not i.eligible;

  if exists (
    select 1 from public.budget_archive_target_inventory(p_version_id) i
     where i.reason = 'command-unsettled'
  ) then
    raise exception 'an ERPNext Budget command is unsettled; retry the archive after it has completed' using errcode = 'P0001';
  end if;

  if p_cancel_erp and v_ineligible > 0 then
    raise exception 'ERPNext Budget cancellation is unavailable for every known live target of this budget (% of % target(s) cannot be proven safe: ambiguous provenance, a changed witness, an unsettled ERPNext command or an unsupported binding). Archive without cancellation and cancel the document in ERPNext, or retry once the other change has settled.', v_ineligible, v_candidate_rows
      using errcode = 'P0001';
  end if;

  insert into public.budget_archive_requests
    (id, org_id, project_id, budget_version_id, requested_by, cancel_erp, live_target_count)
  values (p_archive_request_id, v_org, v_project, p_version_id, v_actor, p_cancel_erp, v_candidate_names)
  returning * into v_request;

  if p_cancel_erp and v_candidate_rows > 0 then
    insert into public.budget_archive_cancel_intents
      (org_id, request_id, project_id, budget_version_id, source_kind, source_mirror_id, actor_user_id,
       fiscal_year, erp_account, erp_budget_name, activated_at_witness,
       pushed_project_start_date, pushed_project_end_date)
    select v_org, v_request.id, v_project, p_version_id, i.source_kind, i.source_mirror_id, v_actor,
           i.fiscal_year, i.erp_account, i.erp_budget_name, i.activated_at_witness,
           i.pushed_project_start_date, i.pushed_project_end_date
      from public.budget_archive_target_inventory(p_version_id) i
     where i.eligible;

    get diagnostics v_created = row_count;
    if v_created <> v_candidate_rows then
      raise exception 'ERPNext Budget cancellation inventory changed while archiving; no cancellation was queued'
        using errcode = 'P0001';
    end if;

    update public.budget_version_account_erp_mirror m
       set budget_intent = 'remove', push_state = 'pending', push_error = null
      from public.budget_archive_cancel_intents i
     where i.request_id = v_request.id and i.source_kind = 'account' and i.source_mirror_id = m.id;

    update public.budget_version_erp_mirror m
       set push_state = 'pending', push_error = null
      from public.budget_archive_cancel_intents i
     where i.request_id = v_request.id and i.source_kind = 'legacy' and i.source_mirror_id = m.id;

    select coalesce(jsonb_agg(i.id order by i.id), '[]'::jsonb) into v_jobs
      from public.budget_archive_cancel_intents i where i.request_id = v_request.id;
    update public.budget_archive_requests set live_target_count = v_created where id = v_request.id;
    v_request.live_target_count := v_created;
  elsif v_candidate_names > 0 then
    -- Archive WITHOUT cancellation (or nothing eligible to cancel). The operator is told, durably, that
    -- ERPNext may still enforce a budget for this project — including when automatic cancellation is
    -- unavailable, when the binding is missing/unknown, and for a legacy document.
    insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
    select v_org, p.id, 'warning', 'Action required',
           'ERPNext may still be enforcing a budget for this project after this archive. Cancel the listed ERPNext Budget documents, or activate a new PMO budget.',
           jsonb_build_object(
             'action_required', 'budget-archive-live-erp',
             'projectId', v_project,
             'versionId', p_version_id,
             'targetCount', v_candidate_names,
             'cancellationUnavailable', v_ineligible > 0
           )
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
  '#1422/#1462: archives only the caller org''s Active budget (same four write roles as budget_versions_write) and records the ERP cancellation decision atomically for BOTH mirror kinds. The ERP write is driven later by erpnext-sweep through the actor-attributed outbox.';

revoke all on function public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid) from public, anon;
grant execute on function public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid) to authenticated;

-- ── 6. The service transaction is source-kind aware ───────────────────────────────────────────────
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

-- ── 7. Durable warning for previously archived versions ──────────────────────────────────────────
-- Set-based, idempotent (deduped against the same unread notice) and deliberately creates NO
-- cancellation job: nobody decided to cancel these, so an operator must resolve them in ERPNext.
-- Stale/null witnesses and unsupported bindings stay in the candidate set so operators get actionable
-- context even when automatic cancellation cannot be proven.
insert into public.notifications (org_id, owner_id, severity, title, body, metadata)
select c.org_id, p.id, 'warning', 'Action required',
       'ERPNext still enforces a budget created before the current push version for this archived project. Cancel that ERPNext Budget, or activate a new PMO budget.',
       jsonb_build_object(
         'action_required', 'budget-archive-legacy-live-erp',
         'projectId', c.project_id,
         'versionId', c.budget_version_id,
         'targetCount', c.target_count
       )
  from (
    select lm.org_id, v.project_id, lm.budget_version_id,
           count(distinct lm.erp_budget_name)::integer as target_count
      from public.budget_version_erp_mirror lm
      join public.budget_versions v on v.id = lm.budget_version_id
     where v.status = 'Archived'
       and lm.erp_budget_name is not null and btrim(lm.erp_budget_name) <> ''
       and lm.erp_cancelled_at is null
       and (lm.erp_docstatus is null or lm.erp_docstatus <> 2)
     group by lm.org_id, v.project_id, lm.budget_version_id
  ) c
  join public.profiles p
    on p.org_id = c.org_id and p.status = 'active' and p.role in ('Admin','Finance')
 where not exists (
   select 1 from public.notifications n
    where n.org_id = c.org_id and n.owner_id = p.id and n.read_at is null
      and n.metadata @> jsonb_build_object(
        'action_required', 'budget-archive-legacy-live-erp',
        'projectId', c.project_id,
        'versionId', c.budget_version_id
      )
 );
