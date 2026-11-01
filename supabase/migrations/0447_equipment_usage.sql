-- 0447_equipment_usage.sql — #1519 S1: thin equipment asset reference, usage entries, the draft → submitted →
-- approved|rejected transition with approver ≠ author, bulk asset-week approve, archive. Spec:
-- docs/specs/equipment-usage.spec.md (signed 2026-11-01; OQ-1..9 defaults are rulings, OD-GRILL-20261101).
-- Plan: docs/plans/2026-11-01-equipment-usage.md S1. Proven by supabase/tests/equipment_usage.test.sql and
-- supabase/tests/equipment_rls.test.sql. Nothing here writes to the ERP.
-- ── REVERSE (also supabase/migrations/rollback/0447_equipment_usage_down.sql) ──────────────────────────
--   drop function if exists public.archive_equipment_usage(uuid);
--   drop function if exists public.approve_equipment_usage_week(uuid, date);
--   drop function if exists public.transition_equipment_usage(uuid, text, text);
--   drop function if exists public.save_equipment_usage(jsonb);
--   drop function if exists public.equipment_usage_transition_core(uuid, text, text);
--   drop function if exists public.equipment_can_approve(uuid, public.user_role, uuid, uuid);
--   drop function if exists public.equipment_entry_locked_unit(uuid, uuid, date);
--   drop function if exists public.equipment_org_today(uuid);
--   drop table if exists public.equipment_usage_entries;   -- drops its triggers
--   drop function if exists public.audit_equipment_usage_delete();
--   drop table if exists public.equipment_assets;

-- ── tables, indexes, org stamp (S1.2) ───────────────────────────────────────────────────────────────
create table public.equipment_assets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  code          text not null check (char_length(btrim(code)) between 1 and 40),
  name          text not null check (char_length(btrim(name)) between 1 and 120),
  default_unit  text not null default 'hours' check (default_unit in ('hours','days')),
  external_tier text,          -- OQ-9: reserved for the #1511/#899 mirror adoption; no client write grant
  external_ref  text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz,
  constraint equipment_assets_external_pair check ((external_tier is null) = (external_ref is null))
);
create unique index equipment_assets_code_live on public.equipment_assets (org_id, lower(btrim(code))) where archived_at is null;
create unique index equipment_assets_external on public.equipment_assets (org_id, external_tier, external_ref) where external_ref is not null;
create trigger equipment_assets_stamp_org_id before insert on public.equipment_assets for each row execute function public.stamp_org_id();

create table public.equipment_usage_entries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,  -- stated by the RPC, no default
  asset_id       uuid not null references public.equipment_assets(id) on delete restrict,
  project_id     uuid not null references public.projects(id) on delete restrict,
  work_date      date not null,
  quantity       numeric(6,2) not null,
  unit           text not null check (unit in ('hours','days')),
  kind           text not null default 'work' check (kind in ('work','standby')),
  fuel_litres    numeric(10,2),
  trips          int,
  note           text check (note is null or char_length(note) <= 500),
  status         text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Rejected')),
  author_id      uuid not null references public.profiles(id),
  approver_id    uuid references public.profiles(id),
  approved_at    timestamptz,
  decision_notes text check (decision_notes is null or char_length(decision_notes) <= 500),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  constraint equipment_usage_quantity_range check (quantity >= 0 and ((unit = 'hours' and quantity <= 24) or (unit = 'days' and quantity <= 1))),
  constraint equipment_usage_fuel_range check (fuel_litres is null or (fuel_litres >= 0 and fuel_litres < 'Infinity'::numeric)),
  constraint equipment_usage_trips_range check (trips is null or trips >= 0),
  constraint equipment_usage_sod check (approver_id is null or approver_id <> author_id),
  constraint equipment_usage_approved_stamped check ((status = 'Approved') = (approved_at is not null))
);
create unique index equipment_usage_one_per_day on public.equipment_usage_entries (org_id, asset_id, project_id, work_date, kind) where archived_at is null;
-- NFR-EQU-003: the allocation and totals reads scan by (org, asset, date) on approved rows.
create index equipment_usage_asset_date on public.equipment_usage_entries (org_id, asset_id, work_date, status);
create index equipment_usage_project_date on public.equipment_usage_entries (org_id, project_id, work_date) where status = 'Approved' and archived_at is null;
create index equipment_usage_author on public.equipment_usage_entries (author_id);

-- ── RLS and grants (S1.3, FR-EQU-062/063/064) ──────────────────────────────────────────────────────
alter table public.equipment_assets enable row level security;  alter table public.equipment_assets force row level security;
alter table public.equipment_usage_entries enable row level security;  alter table public.equipment_usage_entries force row level security;

-- every active member reads the asset reference (the usage grid needs the picker)
create policy equipment_assets_select on public.equipment_assets for select
  using (org_id = public.auth_org_id() and public.is_active_member());
-- FR-EQU-022: Admin or PM keeps the thin reference by hand
create policy equipment_assets_insert on public.equipment_assets for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Project Manager'));
create policy equipment_assets_update on public.equipment_assets for update
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Project Manager'))
  with check (org_id = public.auth_org_id());
create policy equipment_assets_delete on public.equipment_assets for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
revoke all on public.equipment_assets from public, anon, authenticated;
grant select, delete on public.equipment_assets to authenticated;
grant insert (code, name, default_unit) on public.equipment_assets to authenticated;
grant update (code, name, default_unit, archived_at) on public.equipment_assets to authenticated;

-- entries: own rows, or the usage audience; Engineers never see another's entry (FR-EQU-062)
create policy equipment_usage_entries_select on public.equipment_usage_entries for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and (author_id = auth.uid() or public.auth_role() in ('Admin','Finance','Executive','Project Manager')));
create policy equipment_usage_entries_delete on public.equipment_usage_entries for delete
  using (org_id = public.auth_org_id() and public.is_active_member() and public.auth_role() = 'Admin');
revoke all on public.equipment_usage_entries from public, anon, authenticated;
grant select, delete on public.equipment_usage_entries to authenticated;   -- no INSERT/UPDATE: RPCs only (PQ-8)
grant all on public.equipment_assets, public.equipment_usage_entries to service_role;

create function public.audit_equipment_usage_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('equipment_usage.delete', old.org_id, auth.uid(), old.id, jsonb_build_object('before', to_jsonb(old)));
  return old;
end $$;
revoke all on function public.audit_equipment_usage_delete() from public, anon, authenticated;
create trigger equipment_usage_entries_audit_delete after delete on public.equipment_usage_entries
  for each row execute function public.audit_equipment_usage_delete();

-- ── internal helpers (S1.4) ────────────────────────────────────────────────────────────────────────
-- Internal helpers are plain (invoker) functions: called only from the definers below, which run as owner, so they
-- need no definer bit and stay off the isolation denominator (0376 cost_attribution_normalize pattern).
create function public.equipment_org_today(p_org uuid) returns date
  language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone coalesce(o.default_timezone, 'UTC'))::date from public.organizations o where o.id = p_org
$$;  -- NFR-EQU-004, same cut as 0247:724

-- S1 stub: no costing settings exist yet. S2 replaces the body (same signature) with the unit a covering
-- hire_rate / actual_cost-units setting fixes (FR-EQU-032).
create function public.equipment_entry_locked_unit(p_org uuid, p_asset uuid, p_date date) returns text
  language sql stable set search_path = public, pg_temp as $$ select null::text $$;

-- FR-EQU-061: PM for projects they manage, Executive, Finance, Admin. Author exclusion is checked by the caller FIRST.
create function public.equipment_can_approve(p_uid uuid, p_role public.user_role, p_org uuid, p_project uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(p_role in ('Admin','Executive','Finance')
                  or (p_role = 'Project Manager' and exists (
                        select 1 from public.projects p where p.id = p_project and p.org_id = p_org and p.project_manager_id = p_uid)),
                  false)
$$;
revoke all on function public.equipment_org_today(uuid) from public, anon, authenticated;
revoke all on function public.equipment_entry_locked_unit(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.equipment_can_approve(uuid, public.user_role, uuid, uuid) from public, anon, authenticated;

-- ── save_equipment_usage (S1.5) ─────────────────────────────────────────────────────────────────────
create function public.save_equipment_usage(p_entry jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_id uuid; v_asset uuid; v_project uuid; v_date date; v_qty numeric; v_fuel numeric; v_trips int;
  v_unit text; v_kind text; v_note text; v_cur public.equipment_usage_entries; v_after public.equipment_usage_entries;
  v_locked text; v_day numeric;
begin
  perform public.assert_is_active_member();
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'entry must be a JSON object' using errcode = '22023';
  end if;
  begin
    v_id := nullif(p_entry->>'id','')::uuid;            v_asset := (p_entry->>'asset_id')::uuid;
    v_project := (p_entry->>'project_id')::uuid;        v_date := (p_entry->>'work_date')::date;
    v_qty := (p_entry->>'quantity')::numeric;           v_fuel := nullif(p_entry->>'fuel_litres','')::numeric;
    v_trips := nullif(p_entry->>'trips','')::int;
  exception when others then
    raise exception 'asset_id, project_id, work_date, quantity, fuel_litres or trips is malformed' using errcode = '22023';
  end;
  v_unit := p_entry->>'unit'; v_kind := coalesce(nullif(p_entry->>'kind',''), 'work');
  v_note := nullif(btrim(coalesce(p_entry->>'note','')), '');
  if v_unit is null or v_unit not in ('hours','days') then raise exception 'unit must be hours or days' using errcode = '22023'; end if;
  if v_kind not in ('work','standby') then raise exception 'kind must be work or standby' using errcode = '22023'; end if;
  if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty < 0 or round(v_qty, 2) <> v_qty then
    raise exception 'quantity must be zero or more, with at most 2 decimals' using errcode = '22023';
  end if;
  if (v_unit = 'hours' and v_qty > 24) or (v_unit = 'days' and v_qty > 1) then
    raise exception 'one entry holds at most 24 hours or 1 day' using errcode = '22023';
  end if;
  if v_fuel is not null and (v_fuel::text in ('NaN','Infinity','-Infinity') or v_fuel < 0 or round(v_fuel, 2) <> v_fuel) then
    raise exception 'fuel litres must be zero or more' using errcode = '22023';
  end if;
  if v_trips is not null and v_trips < 0 then raise exception 'trips must be zero or more' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'the note is at most 500 characters' using errcode = '22023'; end if;
  if v_date is null or v_date > public.equipment_org_today(v_org) then
    raise exception 'the work date is in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';   -- SECURITY: the org re-assertion MUST stay
  end if;
  if not exists (select 1 from public.equipment_assets a where a.id = v_asset and a.org_id = v_org and a.archived_at is null) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  v_locked := public.equipment_entry_locked_unit(v_org, v_asset, v_date);
  if v_locked is not null and v_locked <> v_unit then
    raise exception 'this asset is costed per % on that date; log it in %', v_locked, v_locked using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.equipment_usage_entries (org_id, asset_id, project_id, work_date, quantity, unit, kind,
                                                fuel_litres, trips, note, status, author_id)
    values (v_org, v_asset, v_project, v_date, v_qty, v_unit, v_kind, v_fuel, v_trips, v_note, 'Draft', v_uid)
    returning * into v_after;                                   -- 23505 from equipment_usage_one_per_day
    perform public.log_audit('equipment_usage.create', v_org, v_uid, v_after.id, jsonb_build_object('to', 'Draft', 'after', to_jsonb(v_after)));
  else
    select * into v_cur from public.equipment_usage_entries e where e.id = v_id for update;
    if not found or v_cur.org_id is distinct from v_org then raise exception 'entry not found' using errcode = 'P0002'; end if;
    if v_cur.author_id is distinct from v_uid then raise exception 'only the author edits an entry' using errcode = '42501'; end if;  -- null-safe
    if v_cur.status not in ('Draft','Rejected') or v_cur.archived_at is not null then
      raise exception 'only a draft or rejected entry can be edited' using errcode = '22023';
    end if;
    update public.equipment_usage_entries set asset_id = v_asset, project_id = v_project, work_date = v_date, quantity = v_qty,
           unit = v_unit, kind = v_kind, fuel_litres = v_fuel, trips = v_trips, note = v_note, updated_at = now()
     where id = v_id returning * into v_after;
    perform public.log_audit('equipment_usage.update', v_org, v_uid, v_id, jsonb_build_object('before', to_jsonb(v_cur), 'after', to_jsonb(v_after)));
  end if;
  -- OQ-7 / PQ-12: warn, never block, when the asset's day exceeds 24 h across projects
  select coalesce(sum(case when e.unit = 'hours' then e.quantity else e.quantity * 24 end), 0) into v_day
    from public.equipment_usage_entries e
   where e.org_id = v_org and e.asset_id = v_asset and e.work_date = v_date and e.archived_at is null and e.status <> 'Rejected';
  return jsonb_build_object('id', v_after.id, 'status', v_after.status, 'day_total_hours', v_day, 'over_24h', v_day > 24);
end $$;

-- ── transition core, single and bulk RPCs, archive (S1.6) ──────────────────────────────────────────
create function public.equipment_usage_transition_core(p_id uuid, p_to text, p_notes text) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e public.equipment_usage_entries;
  v_legal jsonb := jsonb_build_object('Draft', jsonb_build_array('Submitted'), 'Submitted', jsonb_build_array('Approved','Rejected'),
                                      'Rejected', jsonb_build_array('Draft'), 'Approved', jsonb_build_array('Draft'));
  v_action text;
begin
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found then raise exception 'entry not found' using errcode = 'P0002'; end if;
  -- SECURITY: definer bypasses RLS; this org re-assertion MUST stay.
  if v_e.org_id is distinct from public.auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_e.archived_at is not null then raise exception 'an archived entry cannot move' using errcode = '22023'; end if;
  if p_to is null or not coalesce((v_legal -> v_e.status) ? p_to, false) then
    raise exception 'illegal transition % -> %', v_e.status, p_to using errcode = '22023';
  end if;
  if p_to = 'Submitted' or (v_e.status = 'Rejected' and p_to = 'Draft') then
    if v_uid is distinct from v_e.author_id then raise exception 'not authorized' using errcode = '42501'; end if;
    v_action := case when p_to = 'Submitted' then 'submitted' else 'redraft' end;
  elsif p_to in ('Approved','Rejected') then
    -- SoD FIRST, ALWAYS (FR-EQU-011, the 0180 transition_timesheet order). Do not reorder.
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot decide own equipment usage' using errcode = '42501'; end if;
    if not public.equipment_can_approve(v_uid, v_role, v_e.org_id, v_e.project_id) then
      raise exception 'not authorized' using errcode = '42501';
    end if;
    v_action := lower(p_to);
  else  -- Approved -> Draft: Admin reopen (FR-EQU-012), never by the author
    if v_uid is not distinct from v_e.author_id then raise exception 'separation of duties: cannot reopen own equipment usage' using errcode = '42501'; end if;
    if v_role is distinct from 'Admin' then raise exception 'only an Admin reopens approved usage' using errcode = '42501'; end if;
    v_action := 'reopen';
  end if;
  update public.equipment_usage_entries
     set status = p_to,
         approver_id = case when p_to in ('Approved','Rejected') then v_uid when p_to = 'Draft' then null else approver_id end,
         approved_at = case when p_to = 'Approved' then now() else null end,
         decision_notes = case when p_to in ('Approved','Rejected') or v_action = 'reopen' then nullif(btrim(coalesce(p_notes,'')), '')
                               else decision_notes end,
         updated_at = now()
   where id = p_id;
  perform public.log_audit('equipment_usage.' || v_action, v_e.org_id, v_uid, p_id,
    jsonb_build_object('from', v_e.status, 'to', p_to, 'notes', p_notes));
  return p_to;
end $$;
revoke all on function public.equipment_usage_transition_core(uuid, text, text) from public, anon, authenticated;

create function public.transition_equipment_usage(p_id uuid, p_to text, p_notes text default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_is_active_member();
  return public.equipment_usage_transition_core(p_id, p_to, p_notes);
end $$;

-- OQ-8 / PQ-7: approve one asset-week; each approval runs the single-entry checks.
create function public.approve_equipment_usage_week(p_asset_id uuid, p_week_start date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_role public.user_role := public.auth_role(); v_e record;
        v_ok int := 0; v_own int := 0; v_denied int := 0;
begin
  perform public.assert_is_active_member();
  if p_week_start is null then raise exception 'week_start is required' using errcode = '22023'; end if;
  if not exists (select 1 from public.equipment_assets a where a.id = p_asset_id and a.org_id = public.auth_org_id()) then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;
  for v_e in select e.id, e.author_id, e.project_id from public.equipment_usage_entries e
              where e.org_id = public.auth_org_id() and e.asset_id = p_asset_id and e.status = 'Submitted' and e.archived_at is null
                and e.work_date between p_week_start and p_week_start + 6
              order by e.work_date, e.id for update loop
    if v_e.author_id is not distinct from v_uid then v_own := v_own + 1;
    elsif not public.equipment_can_approve(v_uid, v_role, public.auth_org_id(), v_e.project_id) then v_denied := v_denied + 1;
    else perform public.equipment_usage_transition_core(v_e.id, 'Approved', null); v_ok := v_ok + 1;
    end if;
  end loop;
  return jsonb_build_object('approved', v_ok, 'skipped_own', v_own, 'skipped_not_permitted', v_denied);
end $$;

-- FR-EQU-064: soft archive. Author while Draft/Rejected; Admin while not Approved (reopen first).
create function public.archive_equipment_usage(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_e public.equipment_usage_entries;
begin
  perform public.assert_is_active_member();
  select * into v_e from public.equipment_usage_entries e where e.id = p_id for update;
  if not found or v_e.org_id is distinct from public.auth_org_id() then raise exception 'entry not found' using errcode = 'P0002'; end if;
  if v_e.status = 'Approved' then raise exception 'reopen approved usage before archiving it' using errcode = '22023'; end if;
  if not (v_e.author_id is not distinct from auth.uid() and v_e.status in ('Draft','Rejected')) and public.auth_role() is distinct from 'Admin' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.equipment_usage_entries set archived_at = now(), updated_at = now() where id = p_id and archived_at is null;
  perform public.log_audit('equipment_usage.archive', v_e.org_id, auth.uid(), p_id, jsonb_build_object('status', v_e.status));
end $$;

alter function public.save_equipment_usage(jsonb) owner to postgres;
alter function public.transition_equipment_usage(uuid, text, text) owner to postgres;
alter function public.approve_equipment_usage_week(uuid, date) owner to postgres;
alter function public.archive_equipment_usage(uuid) owner to postgres;
revoke all on function public.save_equipment_usage(jsonb), public.transition_equipment_usage(uuid, text, text),
  public.approve_equipment_usage_week(uuid, date), public.archive_equipment_usage(uuid) from public, anon, authenticated;
grant execute on function public.save_equipment_usage(jsonb), public.transition_equipment_usage(uuid, text, text),
  public.approve_equipment_usage_week(uuid, date), public.archive_equipment_usage(uuid) to authenticated;

-- ── self-assertion (S1.8): internals stay internal, nothing new is reachable by anon or PUBLIC ──────
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('equipment_org_today', 'equipment_entry_locked_unit', 'equipment_can_approve', 'equipment_usage_transition_core')
     and (p.prosecdef or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then raise exception '0447: internal helper is a definer or client-executable: %', v_bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles r on r.oid = a.grantee
   where n.nspname = 'public'
     and (p.proname like 'equipment\_%' or p.proname in ('save_equipment_usage', 'transition_equipment_usage',
          'approve_equipment_usage_week', 'archive_equipment_usage', 'audit_equipment_usage_delete'))
     and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or r.rolname = 'anon');
  if v_bad is not null then raise exception '0447: function executable by anon or PUBLIC: %', v_bad; end if;
end $$;
