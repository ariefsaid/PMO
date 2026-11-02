-- #1514 T2: assemble a draft time-and-materials claim from approved timesheet hours.
-- A claim freezes the rate, unit, label and rate version on each line; each source hour sits in at most one live claim
-- (partial unique index); an approved week that feeds a live claim cannot be reopened (transition_timesheet).
-- Sign-off, the invoice bridge and withdraw land in T3 (0517); withdraw will set the claim Withdrawn and its sources not live.

create table public.tm_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_order_id uuid references public.work_orders(id),
  period_from date not null,
  period_to date not null,
  status text not null default 'Draft' check (status in ('Draft', 'SignedOff', 'Withdrawn')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  gross_amount numeric(14,2) not null default 0 check (gross_amount >= 0),
  prepared_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  confirm_basis text check (confirm_basis in ('standard', 'sole_operator')),
  document_id uuid references public.project_documents(id),
  note text,
  created_at timestamptz not null default now(),
  constraint tm_claims_period check (period_to >= period_from),
  constraint tm_claims_signed_off_shape check (
    status <> 'SignedOff' or (confirmed_by is not null and confirm_basis is not null and document_id is not null))
);
create index tm_claims_project_status_idx on public.tm_claims (org_id, project_id, status);

create table public.tm_claim_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  claim_id uuid not null references public.tm_claims(id) on delete cascade,
  line_key uuid not null,
  rate_version integer not null check (rate_version >= 1),
  kind text not null check (kind in ('labour')),
  label text not null,
  unit text not null check (unit in ('hour', 'day')),
  units numeric(10,2) not null check (units > 0),
  rate numeric(14,2) not null check (rate >= 0),
  amount numeric(14,2) not null,
  unique (claim_id, line_key, rate_version),
  unique (id, claim_id),
  constraint tm_claim_lines_amount check (amount = round(units * rate, 2))
);

create table public.tm_claim_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  claim_id uuid not null references public.tm_claims(id) on delete cascade,
  claim_line_id uuid not null,
  source_kind text not null check (source_kind in ('timesheet_entry', 'equipment_usage')),
  source_id uuid not null,
  units numeric(10,2) not null check (units > 0),
  is_live boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (claim_line_id, claim_id) references public.tm_claim_lines(id, claim_id) on delete cascade
);
-- The authority for "an hour is billed once": the RPC pre-check only produces a friendlier message.
create unique index tm_claim_sources_one_live on public.tm_claim_sources (source_kind, source_id) where is_live;
create index tm_claim_sources_source_idx on public.tm_claim_sources (source_id);
create index tm_claim_sources_claim_idx on public.tm_claim_sources (claim_id);

create trigger tm_claims_stamp_org_id before insert on public.tm_claims
  for each row execute function public.stamp_org_id();
create trigger tm_claim_lines_stamp_org_id before insert on public.tm_claim_lines
  for each row execute function public.stamp_org_id();
create trigger tm_claim_sources_stamp_org_id before insert on public.tm_claim_sources
  for each row execute function public.stamp_org_id();

alter table public.tm_claims enable row level security;
alter table public.tm_claims force row level security;
create policy tm_claims_select on public.tm_claims for select
  using (org_id = public.auth_org_id() and public.is_active_member() and (
    public.auth_role() in ('Admin', 'Finance', 'Executive')
    or (public.auth_role() = 'Project Manager' and exists (
      select 1 from public.projects p
       where p.id = tm_claims.project_id and p.org_id = tm_claims.org_id
         and p.project_manager_id = auth.uid()))
  ));
-- Lines and sources are visible exactly when their claim is (the subquery runs under the claim policy).
alter table public.tm_claim_lines enable row level security;
alter table public.tm_claim_lines force row level security;
create policy tm_claim_lines_select on public.tm_claim_lines for select
  using (org_id = public.auth_org_id() and exists (select 1 from public.tm_claims c where c.id = tm_claim_lines.claim_id));
alter table public.tm_claim_sources enable row level security;
alter table public.tm_claim_sources force row level security;
create policy tm_claim_sources_select on public.tm_claim_sources for select
  using (org_id = public.auth_org_id() and exists (select 1 from public.tm_claims c where c.id = tm_claim_sources.claim_id));

revoke all on public.tm_claims, public.tm_claim_lines, public.tm_claim_sources from public, anon, authenticated;
grant select on public.tm_claims, public.tm_claim_lines, public.tm_claim_sources to authenticated;
grant all on public.tm_claims, public.tm_claim_lines, public.tm_claim_sources to service_role;

-- Is this source in a live claim? Used by the reopen guard (and, in T5, the usage archive guard).
create function public.tm_source_is_live(p_kind text, p_id uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.tm_claim_sources s where s.source_kind = p_kind and s.source_id = p_id and s.is_live)
$$;

-- The single source for preview and assemble: approved, not-yet-claimed hours of one project in a date range, each with
-- the rate version in force on its date, or the reason it cannot be priced. Nothing is priced by guess.
-- Resolution: the person's assignment on the entry date -> that line's version whose window (cut at applies_to) holds the date.
create function public.tm_assignable_sources(p_project uuid, p_from date, p_to date)
returns table (
  source_kind text, source_id uuid, user_id uuid, entry_date date, units numeric,
  line_key uuid, rate_version integer, kind text, label text, unit text, rate numeric, unrated_reason text)
language sql stable set search_path = public, pg_temp as $$
  with e as (
    select en.id, en.org_id, ts.user_id, en.entry_date, en.hours
      from public.timesheet_entries en
      join public.timesheets ts on ts.id = en.timesheet_id
     where en.org_id = public.auth_org_id() and ts.org_id = en.org_id
       and en.project_id = p_project and ts.status = 'Approved'
       and en.entry_date between p_from and p_to and en.hours > 0
       and not exists (select 1 from public.tm_claim_sources s
                        where s.source_kind = 'timesheet_entry' and s.source_id = en.id and s.is_live)
  ), a as (
    select e.*, (select ca.line_key from public.contract_rate_assignees ca
                  where ca.org_id = e.org_id and ca.project_id = p_project and ca.user_id = e.user_id
                    and ca.effective_from <= e.entry_date and e.entry_date <= coalesce(ca.effective_to, 'infinity'::date)
                  limit 1) as assigned_line
      from e
  )
  select 'timesheet_entry'::text, a.id, a.user_id, a.entry_date, a.hours::numeric,
         a.assigned_line, r.version, r.kind, r.label, r.unit, r.rate,
         case when a.assigned_line is null then 'no_assignee'
              when r.id is null then 'no_rate'
              when r.unit <> 'hour' then 'unit_not_supported' end
    from a
    left join lateral (
      select l.* from public.contract_rate_lines l
       where l.org_id = a.org_id and l.project_id = p_project and l.line_key = a.assigned_line
         and l.effective_from <= a.entry_date
         and a.entry_date <= least(coalesce(l.effective_to, 'infinity'::date), coalesce(l.applies_to, 'infinity'::date))
       order by l.version desc limit 1) r on true
   order by a.entry_date, a.id
$$;

create function public.assemble_tm_claim(
  p_project uuid, p_from date, p_to date, p_work_order uuid default null, p_exclude jsonb default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_currency text;
  v_wo_project uuid;
  v_exclude uuid[] := '{}';
  v_id uuid := gen_random_uuid();
  v_count integer;
  v_other uuid;
begin
  perform public.assert_is_active_member();
  if p_project is null or p_from is null or p_to is null or p_to < p_from then
    raise exception 'a project and a valid date range are required' using errcode = '22023';
  end if;
  if p_exclude is not null then
    begin
      if jsonb_typeof(p_exclude) <> 'array' then raise exception 'x'; end if;
      select coalesce(array_agg(x::uuid), '{}') into v_exclude from jsonb_array_elements_text(p_exclude) x;
    exception when others then
      raise exception 'exclude must be a list of source ids' using errcode = '22023';
    end;
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  -- SECURITY: the role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  if not public.may_record_project_progress(p_project) then
    raise exception 'not authorized to prepare a time-and-materials claim for this project' using errcode = '42501';
  end if;
  -- Lock order as create_progress_claim: the work order's billing lock, then the project row.
  if p_work_order is not null then
    perform public.lock_work_order_billing(p_work_order);
    select wo.project_id into v_wo_project from public.work_orders wo where wo.id = p_work_order and wo.org_id = v_org;
    if v_wo_project is distinct from p_project then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
  end if;
  select p.currency into v_currency from public.projects p where p.id = p_project and p.org_id = v_org for update;
  -- Hold the Approved weeks while we read them: a concurrent reopen takes the row lock first, so the helper below
  -- either sees the week Draft (and offers nothing) or this claim is live before the reopen checks.
  perform 1 from public.timesheets t
   where t.org_id = v_org and t.status = 'Approved'
     and t.id in (select en.timesheet_id from public.timesheet_entries en
                   where en.org_id = v_org and en.project_id = p_project and en.entry_date between p_from and p_to)
   order by t.id for share;

  begin
    with src as materialized (
      select s.* from public.tm_assignable_sources(p_project, p_from, p_to) s
       where s.unrated_reason is null and s.source_id <> all (v_exclude)
    ), grp as (
      select s.line_key, s.rate_version, s.kind, s.label, s.unit, s.rate, sum(s.units) as units
        from src s group by 1, 2, 3, 4, 5, 6
    ), ins_claim as (
      insert into public.tm_claims (id, org_id, project_id, work_order_id, period_from, period_to, currency, gross_amount, prepared_by)
      select v_id, v_org, p_project, p_work_order, p_from, p_to, v_currency,
             (select sum(round(g.units * g.rate, 2)) from grp g), v_uid
       where exists (select 1 from src)
      returning id
    ), ins_lines as (
      insert into public.tm_claim_lines (org_id, claim_id, line_key, rate_version, kind, label, unit, units, rate, amount)
      select v_org, c.id, g.line_key, g.rate_version, g.kind, g.label, g.unit, g.units, g.rate, round(g.units * g.rate, 2)
        from grp g cross join ins_claim c
      returning id, claim_id, line_key, rate_version
    ), ins_sources as (
      insert into public.tm_claim_sources (org_id, claim_id, claim_line_id, source_kind, source_id, units)
      select v_org, l.claim_id, l.id, s.source_kind, s.source_id, s.units
        from src s join ins_lines l on l.line_key = s.line_key and l.rate_version = s.rate_version
      returning 1
    )
    select count(*) into v_count from ins_sources;
  exception when unique_violation then
    select s.claim_id into v_other
      from public.tm_claim_sources s join public.timesheet_entries en on en.id = s.source_id
     where s.is_live and s.source_kind = 'timesheet_entry' and en.project_id = p_project
       and en.entry_date between p_from and p_to
     limit 1;
    raise exception 'an hour is already in claim %', v_other using errcode = 'P0001';
  end;
  if v_count = 0 then
    raise exception 'no approved, rated hours left to claim in this period' using errcode = 'P0001';
  end if;
  perform public.log_audit('tm_claim.assemble', v_org, v_uid, v_id,
    jsonb_build_object('project_id', p_project, 'period_from', p_from, 'period_to', p_to,
                       'work_order_id', p_work_order, 'sources', v_count));
  return v_id;
end $$;

create function public.deselect_tm_source(p_claim uuid, p_source uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_project uuid;
  v_wo uuid;
  v_status text;
  v_src public.tm_claim_sources;
  v_units numeric;
begin
  perform public.assert_is_active_member();
  select c.project_id, c.work_order_id into v_project, v_wo from public.tm_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  if not public.may_record_project_progress(v_project) then
    raise exception 'not authorized to change this claim' using errcode = '42501';
  end if;
  if v_wo is not null then perform public.lock_work_order_billing(v_wo); end if;
  perform 1 from public.projects p where p.id = v_project and p.org_id = v_org for update;
  select c.status into v_status from public.tm_claims c where c.id = p_claim for update;
  if v_status is distinct from 'Draft' then
    raise exception 'only a Draft claim can be changed (this one is %)', v_status using errcode = 'P0001';
  end if;
  select * into v_src from public.tm_claim_sources s where s.id = p_source and s.claim_id = p_claim for update;
  if not found then raise exception 'source not found in this claim' using errcode = 'P0002'; end if;
  delete from public.tm_claim_sources where id = v_src.id;
  select coalesce(sum(s.units), 0) into v_units from public.tm_claim_sources s where s.claim_line_id = v_src.claim_line_id;
  if v_units = 0 then
    delete from public.tm_claim_lines where id = v_src.claim_line_id;
  else
    update public.tm_claim_lines set units = v_units, amount = round(v_units * rate, 2) where id = v_src.claim_line_id;
  end if;
  update public.tm_claims set gross_amount = coalesce((select sum(l.amount) from public.tm_claim_lines l where l.claim_id = p_claim), 0)
   where id = p_claim;
  perform public.log_audit('tm_claim.deselect', v_org, v_uid, p_claim,
    jsonb_build_object('source_kind', v_src.source_kind, 'source_id', v_src.source_id, 'units', v_src.units));
end $$;

create or replace function public.transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from  timesheet_status;
  v_org   uuid;
  v_owner uuid;
  v_uid   uuid      := auth.uid();
  v_role  user_role := auth_role();
  v_mgr   uuid;
  v_tm_claim uuid;
  -- The transition map (OD-TS-2 config seam): legal (from → [allowed to]) superset, as data.
  -- Slice A (FR-TSC-001): `Approved` is no longer terminal — `Approved → Draft` is the one new edge.
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Submitted'),
    'Submitted', jsonb_build_array('Approved','Rejected'),
    'Rejected',  jsonb_build_array('Draft'),
    'Approved',  jsonb_build_array('Draft')
  );
begin
  perform public.assert_is_active_member();  -- ⚑ 0180 (FR-AMG-001): user-JWT-only caller.
  -- Load + lock the row (serializes concurrent transitions on the SAME timesheet). P0002 if absent.
  select status, org_id, user_id
    into v_from, v_org, v_owner
    from public.timesheets where id = p_timesheet_id for update;
  if v_from is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-TS-003): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-TS-001): (from,to) must be in the data map, else P0001.
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Authorization matrix + SoD (OD-TS-1/OD-TS-4, FR-TS-004/005/006). Resolve the owner's line manager.
  -- SECURITY: these re-assertions MUST stay (definer bypasses RLS).
  select manager_id into v_mgr from public.profiles where id = v_owner;

  if p_to = 'Submitted' then
    -- Submit: only the owner may submit their own Draft sheet (FR-TS-004).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS — even an Admin can never approve/reject their own timesheet (OD-TS-4-D, FR-TS-005).
    -- This `actor = owner` check is intentionally ordered BEFORE the role/manager check so break-glass
    -- can never defeat separation of duties. Do not reorder.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot approve own timesheet' using errcode = '42501';
    end if;
    -- Then: the assigned line manager (exclusive when set); OR Admin/Exec fallback ONLY when manager is
    -- null; OR Admin break-glass (OD-TS-4-D).
    -- HIGH-TS-1: `v_uid is not distinct from v_mgr` is null-safe — it yields FALSE (not NULL) when
    -- v_mgr is null, so `not (false or ...)` no longer short-circuits to NULL and skips the raise.
    -- The Admin/Exec fallback is therefore gated STRICTLY to a null manager; a non-privileged
    -- bystander on a null-manager sheet now correctly hits 42501.
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  elsif p_to = 'Draft' and v_from = 'Approved' then
    -- Slice A (FR-TSC-020/021): re-open an Approved sheet. The AUTHORITY is the same approver
    -- population as the approve arm above — line manager, Admin/Exec-when-manager-null, or Admin
    -- break-glass — and the OWNER is excluded. SoD FIRST (mirrors the approve arm ordering): an
    -- owner can never re-open their own approved sheet, even if they are Admin.
    if v_uid = v_owner then
      raise exception 'separation of duties: cannot re-open own approved timesheet' using errcode = '42501';
    end if;
    if not (v_uid is not distinct from v_mgr
            or (v_mgr is null and v_role in ('Admin','Executive'))
            or v_role = 'Admin') then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    -- #1514 T2 (FR-TM-017): hours that feed a live time-and-materials claim stay approved until the claim is withdrawn.
    if exists (select 1 from public.timesheet_entries e
                where e.timesheet_id = p_timesheet_id and public.tm_source_is_live('timesheet_entry', e.id)) then
      select s.claim_id into v_tm_claim
        from public.timesheet_entries e
        join public.tm_claim_sources s on s.source_kind = 'timesheet_entry' and s.source_id = e.id and s.is_live
       where e.timesheet_id = p_timesheet_id limit 1;
      raise exception 'timesheet hours are in time-and-materials claim %', v_tm_claim using errcode = '55000';
    end if;
    -- FENCE 2 (FR-TSC-008/010, scoped): serialize against a concurrent push insert. The SAME named
    -- per-timesheet advisory lock is acquired by insert_timesheet_outbox_pending (§B), so whichever
    -- side wins the lock the other sees its effect.
    perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
    -- Refuse if ERP may hold a LIVE document — a mirror row with ts_number set and not cancelled
    -- (Luna f1, mirror side). A pushed sheet is refused here; Slice B will fill the cancel-confirmed
    -- admit branch for it. Fail closed on any doubt.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.ts_number is not null and m.erp_cancelled_at is null) then
      raise exception 'reopen-erp-document-held' using errcode = 'P0001';
    end if;
    -- ⚑ THE UNKNOWN ERP OUTCOME (Luna FU-1a round-8 BLOCK — THE money predicate). `post_submit_unknown_at`
    -- is set the moment PMO loses track of a submit's result and is cleared ONLY by learning a real
    -- `ts_number` or by an audited operator attestation (0157 §2/§5). It is deliberately INDEPENDENT of
    -- `push_state` and of the outbox: those answer "can the backstop retry this?", and a re-queue —
    -- including `release_outbox_hold`, which clears BOTH hold states in one transaction — establishes
    -- NOTHING about what ERPNext holds. Before this predicate, a release therefore opened the correction
    -- path over a live ERP document: re-open + re-approve minted a SECOND Timesheet for the week and the
    -- client's hours double-counted permanently (the original command can never be adopted afterwards,
    -- so it never learns the `ts_number` that would have fenced the second push).
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.post_submit_unknown_at is not null) then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- The mirror's own `held` state, kept as an INDEPENDENT predicate (0152 §B). It fences the pre-0157
    -- residue — a `held` row written before the witness column existed — and any future writer that
    -- parks `held` without stamping one. Same refusal, so the caller sees one story.
    if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id and m.push_state = 'held') then
      raise exception 'reopen-push-outcome-unknown' using errcode = 'P0001';
    end if;
    -- Refuse if ANY non-terminal outbox row exists for this sheet — the after-commit-before-mirror
    -- seam (a `committed` row whose mirror finalize has not run — Luna f1) AND a bare `pending` (a
    -- queued push still claimable/POSTable while this re-open commits — Luna f2).
    --
    -- ⚑ WHAT TERMINAL `failed` DOES AND DOES NOT PROVE (CORRECTED IN ROUND 8; the 0152 text this
    -- replaces was false). `failed` on the OUTBOX means only "no retry is queued". It does NOT mean
    -- "ERP holds no document":
    --   • an operator `release_outbox_hold` writes `failed` over a POST-SUBMIT UNKNOWN (0152 §A) —
    --     that is the round-8 BLOCK, and it is why the predicate above no longer reads push state at all;
    --   • `commitCreate` creates then submits (`erpnext/adapter.ts`), so a create that succeeded and a
    --     submit ERP rejected is terminal `failed` while ERPNext holds a DRAFT Timesheet PMO has no
    --     pointer to (no costing, so clutter rather than a double-count — but not "no document");
    --   • a row written by the PRE-0151 code carries no guarantee at all: a succeeded submit whose
    --     read-back failed was marked terminal `failed` with a `ts_number`-less mirror.
    -- So this arm no longer LEANS on `failed`; it admits `failed` only once the independent
    -- unknown-outcome witness above says the ERP question has actually been answered. THE PRE-0151
    -- DISPOSITION IS UNCHANGED AND STILL EXPLICIT: those rows carry no witness (the column did not
    -- exist), this arm will ADMIT them, and an OPERATOR must establish what ERP holds before trusting
    -- that admit. The census + the operator's action are named in
    -- `docs/plans/2026-07-23-timesheet-reopen-unpushed.md` §9 ("Pre-0151 residue"); an environment that
    -- never ran the P3b push before 0151 has an empty census and nothing to do.
    if exists (select 1 from public.external_command_outbox o
                 where o.org_id = v_org and o.domain = 'timesheets'
                   and o.pmo_record_id = p_timesheet_id::text
                   and o.state in ('pending','committing','committed','quarantined','held')) then
      raise exception 'reopen-push-in-flight' using errcode = 'P0001';
    end if;
    -- ⛔ SLICE B SEAM: the cancel-confirmed ADMIT branch (FR-TSC-008 full) lands HERE — when a
    -- generation-specific correction intent is consumed + its cancel outbox confirmed + mirror
    -- tombstoned, a PUSHED sheet may flip. Slice A admits ONLY the un-pushed case (no live doc, no
    -- unknown outcome, no non-terminal outbox row); a pushed sheet is refused above (Slice B's entry
    -- point). Do NOT widen without the intent table + cancel machinery.
  elsif p_to = 'Draft' and v_from = 'Rejected' then
    -- Rework: only the owner reworks a Rejected sheet back to Draft (FR-TS-006). Byte-for-byte with
    -- 0007 (the arm is narrowed by `v_from`, not widened in authority).
    if v_uid is distinct from v_owner then
      raise exception 'not authorized' using errcode = '42501';
    end if;
  end if;

  -- Atomic single update: status + the relevant stamp(s) in the SAME statement ⇒ no observable partial
  -- state (NFR-TS-ATOM-001). Approved→Draft leaves submitted_at/approved_by/approved_at as-is (OD-TS-4-A:
  -- audit trail of the last cycle; overwritten on the next submit/approve). Unchanged from 0007.
  update public.timesheets set
    status       = p_to,
    submitted_at = case when p_to = 'Submitted'            then now()  else submitted_at end,
    approved_by  = case when p_to in ('Approved','Rejected') then v_uid else approved_by  end,
    approved_at  = case when p_to in ('Approved','Rejected') then now() else approved_at  end
  where id = p_timesheet_id;
end; $$;

-- create or replace keeps transition_timesheet's owner and grants (authenticated EXECUTE, 0007).
revoke all on function public.tm_source_is_live(text, uuid) from public, anon, authenticated;
revoke all on function public.tm_assignable_sources(uuid, date, date) from public, anon, authenticated;
revoke all on function public.assemble_tm_claim(uuid, date, date, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.deselect_tm_source(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assemble_tm_claim(uuid, date, date, uuid, jsonb) to authenticated;
grant execute on function public.deselect_tm_source(uuid, uuid) to authenticated;
alter function public.assemble_tm_claim(uuid, date, date, uuid, jsonb) owner to postgres;
alter function public.deselect_tm_source(uuid, uuid) owner to postgres;

do $$
declare v_bad text;
begin
  select p.oid::regprocedure::text into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('tm_source_is_live', 'tm_assignable_sources', 'assemble_tm_claim', 'deselect_tm_source')
     and (
       (p.proname in ('tm_source_is_live', 'tm_assignable_sources') and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       or has_function_privilege('anon', p.oid, 'EXECUTE')
       or exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       )
     )
   limit 1;
  if v_bad is not null then raise exception '0516 function has an unsafe client grant: %', v_bad; end if;
  if not has_function_privilege('authenticated', 'public.transition_timesheet(uuid, timesheet_status, text)', 'EXECUTE') then
    raise exception '0516 transition_timesheet lost authenticated EXECUTE';
  end if;
end $$;
