-- 0422_imprest_floats_plans.sql — #1515 site imprest S1: org procurement limit, floats, float-amount changes, monthly
-- plans. Spec: docs/specs/site-imprest.spec.md (signed 2026-11-01) · Plan: docs/plans/2026-11-01-site-imprest.md S1.
-- Proven by supabase/tests/imprest_floats.test.sql, imprest_plans.test.sql, imprest_rls.test.sql, imprest_acl.test.sql
-- and the 0178 allow-list.
-- ── REVERSE (manual, in this order; also supabase/migrations/rollback/0422_imprest_floats_plans_down.sql) ──────────
--   drop function if exists public.transition_imprest_plan(uuid, text, text);
--   drop function if exists public.decide_imprest_float_change(uuid, boolean, text);
--   drop function if exists public.propose_imprest_float_amount(uuid, numeric);
--   drop function if exists public.establish_imprest_float(uuid, uuid, numeric);
--   drop function if exists public.set_imprest_procurement_limit(numeric);
--   drop table if exists public.imprest_plan_lines;      -- drops its trigger
--   drop table if exists public.imprest_plans;
--   drop table if exists public.imprest_replenishments;
--   drop table if exists public.imprest_float_changes;
--   drop table if exists public.imprest_floats;
--   drop table if exists public.org_imprest_settings;
--   drop function if exists public.sync_imprest_plan_total();
--   drop function if exists public.assert_imprest_plan_line_editable();
--   drop function if exists public.stamp_imprest_plan_org();
--   drop function if exists public.imprest_funded(uuid);
--   drop function if exists public.imprest_lock_float(uuid);
--   drop function if exists public.imprest_senior_route(uuid, uuid);
--   drop function if exists public.imprest_custodian_eligible(uuid, uuid, uuid);
--   (procurement_doc_counters rows with prefix IMP/REP are harmless; leave them.)

-- §1 helpers. DEFINER for eligibility: it must see the custodian's profile and the project whatever the caller sees.
create or replace function public.imprest_custodian_eligible(p_org uuid, p_project uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select pf.org_id = p_org
       and public.is_active_member(p_profile)
       and public.holds_spend_approval_authority(pf.role)
       and (pf.role = 'Finance'
            or exists (select 1 from public.projects p
                        where p.id = p_project and p.org_id = p_org and p.project_manager_id = p_profile))
      from public.profiles pf where pf.id = p_profile), false)
$$;
comment on function public.imprest_custodian_eligible(uuid, uuid, uuid) is
  '#1515 OQ-IMP-2 / DD-IMP-7.5 — a custodian is an active approval-rank member who holds Finance or manages the project. '
  'Re-checked at every custodian act; NULL-safe and fail-closed.';
revoke all on function public.imprest_custodian_eligible(uuid, uuid, uuid) from public, anon, authenticated;

-- PQ-5: the senior set, never `flat`. Reads spend_approvers exactly as 0247 §8 step 3 does.
create or replace function public.imprest_senior_route(p_org uuid, p_requester uuid)
returns table (route text, approver_ids uuid[]) language sql stable security definer set search_path = public, pg_temp as $$
  with s as (
    select coalesce(array_agg(sa.profile_id order by sa.profile_id) filter (
             where sa.profile_id is distinct from p_requester and pf.status = 'active' and pf.org_id = p_org
               and public.holds_spend_approval_authority(pf.role)), '{}') as ids
      from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
     where sa.org_id = p_org and sa.project_id is null)
  select case when cardinality(s.ids) > 0 then 'org' else 'admin' end, s.ids from s
$$;
revoke all on function public.imprest_senior_route(uuid, uuid) from public, anon, authenticated;

create or replace function public.imprest_lock_float(p_float uuid) returns void
  language sql volatile set search_path = public, pg_temp as $$
  select pg_advisory_xact_lock(hashtextextended('imprest-float:' || p_float::text, 0))
$$;
revoke all on function public.imprest_lock_float(uuid) from public, anon, authenticated;

-- §2 the org procurement limit (OQ-IMP-3, PQ-3).
create table public.org_imprest_settings (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  procurement_limit numeric(14,2) not null,
  updated_by        uuid not null references public.profiles(id),
  updated_at        timestamptz not null default now(),
  constraint org_imprest_settings_limit_range check (procurement_limit > 0 and procurement_limit < 'Infinity'::numeric)
);
alter table public.org_imprest_settings enable row level security;
alter table public.org_imprest_settings force  row level security;
create policy org_imprest_settings_select on public.org_imprest_settings for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.org_imprest_settings from public, anon, authenticated;
grant select on public.org_imprest_settings to authenticated;

create or replace function public.set_imprest_procurement_limit(p_amount numeric) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_old numeric;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'only an Admin sets the procurement limit' using errcode = '42501';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'the procurement limit must be greater than zero' using errcode = 'P0001';
  end if;
  select procurement_limit into v_old from public.org_imprest_settings where org_id = v_org;
  insert into public.org_imprest_settings (org_id, procurement_limit, updated_by) values (v_org, round(p_amount, 2), v_uid)
  on conflict (org_id) do update set procurement_limit = excluded.procurement_limit, updated_by = excluded.updated_by,
                                     updated_at = now();
  perform public.log_audit('imprest_settings.procurement_limit', v_org, v_uid, v_org,
    jsonb_build_object('from', v_old, 'to', round(p_amount, 2)));
end; $$;
revoke all on function public.set_imprest_procurement_limit(numeric) from public, anon;
grant execute on function public.set_imprest_procurement_limit(numeric) to authenticated;

-- §3 tables. org_id has NO default (every writer states it: the 0074/0213 seed-default class).
create table public.imprest_floats (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id),
  project_id           uuid not null references public.projects(id),
  custodian_id         uuid not null references public.profiles(id),
  float_amount         numeric(14,2) not null default 0,
  currency             text not null,
  erp_cash_account_ref text,
  created_by           uuid not null references public.profiles(id),
  created_at           timestamptz not null default now(),
  archived_at          timestamptz,
  constraint imprest_floats_amount_range check (float_amount >= 0 and float_amount < 'Infinity'::numeric),
  constraint imprest_floats_currency_iso4217 check (currency ~ '^[A-Z]{3}$' and currency <> 'XXX'),
  constraint imprest_floats_cash_account_present check (erp_cash_account_ref is null or btrim(erp_cash_account_ref) <> '')
);
create unique index imprest_floats_one_live on public.imprest_floats (org_id, project_id, custodian_id) where archived_at is null;
create index imprest_floats_project_idx on public.imprest_floats (project_id);
create index imprest_floats_custodian_idx on public.imprest_floats (custodian_id);

create table public.imprest_float_changes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  float_id        uuid not null references public.imprest_floats(id),
  proposed_amount numeric(14,2) not null,
  status          text not null default 'Proposed',
  proposed_by     uuid not null references public.profiles(id),
  proposed_at     timestamptz not null default now(),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  notes           text,
  constraint imprest_float_changes_amount_range check (proposed_amount > 0 and proposed_amount < 'Infinity'::numeric),
  constraint imprest_float_changes_status check (status in ('Proposed','Approved','Rejected'))
);
create unique index imprest_float_changes_one_open on public.imprest_float_changes (float_id) where status = 'Proposed';

create table public.imprest_replenishments (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  float_id          uuid not null references public.imprest_floats(id),
  kind              text not null,
  number            text not null,
  status            text not null default 'Requested',
  amount            numeric(14,2) not null,
  requested_by      uuid not null references public.profiles(id),
  requested_at      timestamptz not null default now(),
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  paid_by           uuid references public.profiles(id),
  paid_at           timestamptz,
  paid_on           date,
  payment_reference text,
  decided_notes     text,
  cancelled_at      timestamptz,
  constraint imprest_replenishments_kind   check (kind in ('replenishment','funding')),
  constraint imprest_replenishments_status check (status in ('Requested','Approved','Paid','Rejected','Cancelled')),
  constraint imprest_replenishments_amount_range check (amount > 0 and amount < 'Infinity'::numeric),
  constraint imprest_replenishments_number_unique unique (org_id, number)
);
create index imprest_replenishments_float_idx on public.imprest_replenishments (float_id, status);

-- Σ Paid fundings: the cash head office has put into the float (DD-IMP-2's right-hand side).
create or replace function public.imprest_funded(p_float uuid) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(sum(r.amount), 0) from public.imprest_replenishments r
   where r.float_id = p_float and r.kind = 'funding' and r.status = 'Paid'
$$;
revoke all on function public.imprest_funded(uuid) from public, anon;
grant execute on function public.imprest_funded(uuid) to authenticated;

-- §4 RLS. Visibility = approval rank (spec §5 Visibility; every custodian holds it). No client writes: RPCs only.
alter table public.imprest_floats         enable row level security;
alter table public.imprest_floats         force  row level security;
alter table public.imprest_float_changes  enable row level security;
alter table public.imprest_float_changes  force  row level security;
alter table public.imprest_replenishments enable row level security;
alter table public.imprest_replenishments force  row level security;
create policy imprest_floats_select on public.imprest_floats for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and public.holds_spend_approval_authority(public.auth_role()));
create policy imprest_float_changes_select on public.imprest_float_changes for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_float_changes.float_id));
create policy imprest_replenishments_select on public.imprest_replenishments for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_replenishments.float_id));
revoke all on public.imprest_floats, public.imprest_float_changes, public.imprest_replenishments from public, anon, authenticated;
grant select on public.imprest_floats, public.imprest_float_changes, public.imprest_replenishments to authenticated;

-- §5 float RPCs (FR-IMP-001/002/003, OQ-IMP-7, PQ-2).
create or replace function public.establish_imprest_float(p_project uuid, p_custodian uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid(); v_float uuid; v_cur text;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'only an Admin or Finance member establishes a site float' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_imprest_settings s where s.org_id = v_org) then
    raise exception 'set the org''s procurement limit before establishing a site float' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not public.imprest_custodian_eligible(v_org, p_project, p_custodian) then
    raise exception 'a custodian must be an active Finance member or the manager of this project' using errcode = '23514';
  end if;
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a float amount must be greater than zero' using errcode = 'P0001';
  end if;
  select o.default_currency into v_cur from public.organizations o where o.id = v_org;
  insert into public.imprest_floats (org_id, project_id, custodian_id, currency, created_by)
  values (v_org, p_project, p_custodian, v_cur, v_uid) returning id into v_float;
  insert into public.imprest_float_changes (org_id, float_id, proposed_amount, proposed_by)
  values (v_org, v_float, round(p_amount, 2), v_uid);
  perform public.log_audit('imprest_float.established', v_org, v_uid, v_float,
    jsonb_build_object('project_id', p_project, 'custodian_id', p_custodian, 'proposed_amount', round(p_amount, 2)));
  return v_float;
end; $$;
revoke all on function public.establish_imprest_float(uuid, uuid, numeric) from public, anon;
grant execute on function public.establish_imprest_float(uuid, uuid, numeric) to authenticated;

create or replace function public.propose_imprest_float_amount(p_float uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_f public.imprest_floats%rowtype; v_uid uuid := auth.uid(); v_id uuid;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then
    raise exception 'only an Admin or Finance member proposes a float amount' using errcode = '42501';
  end if;
  select * into v_f from public.imprest_floats where id = p_float;
  if not found or v_f.org_id is distinct from public.auth_org_id() then
    raise exception 'site float not found' using errcode = 'P0002';
  end if;
  perform public.imprest_lock_float(p_float);
  if p_amount is null or not (p_amount > 0 and p_amount < 'Infinity'::numeric) then
    raise exception 'a float amount must be greater than zero' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) < public.imprest_funded(p_float) then
    raise exception 'lowering a float below the cash already funded is a wind-down, not in scope' using errcode = 'P0001';
  end if;
  insert into public.imprest_float_changes (org_id, float_id, proposed_amount, proposed_by)
  values (v_f.org_id, p_float, round(p_amount, 2), v_uid) returning id into v_id;
  perform public.log_audit('imprest_float_change.proposed', v_f.org_id, v_uid, v_id,
    jsonb_build_object('float_id', p_float, 'from', v_f.float_amount, 'to', round(p_amount, 2)));
  return v_id;
end; $$;
revoke all on function public.propose_imprest_float_amount(uuid, numeric) from public, anon;
grant execute on function public.propose_imprest_float_amount(uuid, numeric) to authenticated;

create or replace function public.decide_imprest_float_change(p_change uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.imprest_float_changes%rowtype; v_uid uuid := auth.uid(); v_admin boolean := public.auth_role() = 'Admin';
        v_route record;
begin
  perform public.assert_is_active_member();
  select * into v_c from public.imprest_float_changes where id = p_change for update;
  if not found or v_c.org_id is distinct from public.auth_org_id() then
    raise exception 'float change not found' using errcode = 'P0002';
  end if;
  perform public.imprest_lock_float(v_c.float_id);
  if v_c.status <> 'Proposed' then
    raise exception 'this float change is already %', lower(v_c.status) using errcode = 'P0001';
  end if;
  if v_uid = v_c.proposed_by then
    raise exception 'separation of duties: the proposer cannot decide their own float amount' using errcode = '42501';
  end if;
  select * into v_route from public.imprest_senior_route(v_c.org_id, v_c.proposed_by);
  if not v_admin and not coalesce(v_uid = any (v_route.approver_ids), false) then
    raise exception 'approval routing: a float amount needs the senior approver set%',
      case when v_route.route = 'admin' then ' (none eligible: an Admin)' else '' end using errcode = '42501';
  end if;
  if p_approve and v_c.proposed_amount < public.imprest_funded(v_c.float_id) then
    raise exception 'lowering a float below the cash already funded is a wind-down, not in scope' using errcode = 'P0001';
  end if;
  update public.imprest_float_changes
     set status = case when p_approve then 'Approved' else 'Rejected' end, decided_by = v_uid, decided_at = now(),
         notes = nullif(btrim(p_notes), '')
   where id = p_change;
  if p_approve then
    update public.imprest_floats set float_amount = v_c.proposed_amount where id = v_c.float_id;
  end if;
  perform public.log_audit('imprest_float_change.decided', v_c.org_id, v_uid, p_change,
    jsonb_build_object('float_id', v_c.float_id, 'approved', p_approve, 'amount', v_c.proposed_amount,
                       'route', v_route.route,
                       'break_glass', v_admin and not coalesce(v_uid = any (v_route.approver_ids), false)));
end; $$;
revoke all on function public.decide_imprest_float_change(uuid, boolean, text) from public, anon;
grant execute on function public.decide_imprest_float_change(uuid, boolean, text) to authenticated;

-- §6 monthly plans (FR-IMP-010..016). Lines are client-written by the author while Draft/Rejected (0247 §4 pattern).
create table public.imprest_plans (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  float_id        uuid not null references public.imprest_floats(id),
  month           date not null,
  number          text,
  status          text not null default 'Draft',
  total           numeric(14,2) not null default 0,
  author_id       uuid not null references public.profiles(id) default auth.uid(),
  submitted_at    timestamptz,
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  decision_notes  text,
  is_late         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint imprest_plans_month_first check (month = date_trunc('month', month)::date),
  constraint imprest_plans_status check (status in ('Draft','Submitted','Approved','Rejected','Cancelled')),
  constraint imprest_plans_total_range check (total >= 0 and total < 'Infinity'::numeric),
  constraint imprest_plans_number_unique unique (org_id, number)
);
create unique index imprest_plans_one_live on public.imprest_plans (float_id, month) where status in ('Submitted','Approved');
create index imprest_plans_float_month_idx on public.imprest_plans (float_id, month);

create table public.imprest_plan_lines (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id),
  plan_id         uuid not null references public.imprest_plans(id) on delete cascade,
  budget_category public.budget_category not null,
  planned_amount  numeric(14,2) not null,
  constraint imprest_plan_lines_amount_range check (planned_amount > 0 and planned_amount < 'Infinity'::numeric),
  constraint imprest_plan_lines_one_per_category unique (plan_id, budget_category)
);

-- org_id: a plan inherits its float's; a line inherits its plan's (the 0028 idiom; runs as writer, so an invisible
-- parent leaves NULL and the NOT NULL + RLS WITH CHECK refuse it).
create or replace function public.stamp_imprest_plan_org() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'imprest_plans' then
    select f.org_id into new.org_id from public.imprest_floats f where f.id = new.float_id;
  else
    select p.org_id into new.org_id from public.imprest_plans p where p.id = new.plan_id;
  end if;
  return new;
end; $$;
revoke all on function public.stamp_imprest_plan_org() from public, anon, authenticated;
create trigger imprest_plans_stamp_org before insert on public.imprest_plans
  for each row execute function public.stamp_imprest_plan_org();
create trigger imprest_plan_lines_stamp_org before insert on public.imprest_plan_lines
  for each row execute function public.stamp_imprest_plan_org();

-- The plan total is Σ lines, server-maintained (FR-IMP-010, FR-EXP-004 pattern). DEFINER: clients hold no update grant
-- on total.
create or replace function public.sync_imprest_plan_total() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  update public.imprest_plans p
     set total = coalesce((select sum(l.planned_amount) from public.imprest_plan_lines l where l.plan_id = v_plan), 0)
   where p.id = v_plan;
  return null;
end; $$;
revoke all on function public.sync_imprest_plan_total() from public, anon, authenticated;
create trigger imprest_plan_lines_sync_total after insert or update or delete on public.imprest_plan_lines
  for each row execute function public.sync_imprest_plan_total();

alter table public.imprest_plans      enable row level security;
alter table public.imprest_plans      force  row level security;
alter table public.imprest_plan_lines enable row level security;
alter table public.imprest_plan_lines force  row level security;
create policy imprest_plans_select on public.imprest_plans for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_floats f where f.id = imprest_plans.float_id));
create policy imprest_plans_insert on public.imprest_plans for insert
  with check (org_id = public.auth_org_id() and public.is_active_member() and author_id = auth.uid()
              and status = 'Draft' and public.holds_spend_approval_authority(public.auth_role())
              and exists (select 1 from public.imprest_floats f where f.id = imprest_plans.float_id
                            and f.org_id = public.auth_org_id() and f.archived_at is null));
create policy imprest_plan_lines_select on public.imprest_plan_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_plans p where p.id = imprest_plan_lines.plan_id));
-- The write policy admits the author whatever the status, so a frozen plan's line edit reaches the trigger below and
-- fails loudly with 42501 (AC-IMP-011) instead of silently matching no row.
create policy imprest_plan_lines_write on public.imprest_plan_lines for all
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_plans p where p.id = imprest_plan_lines.plan_id and p.author_id = auth.uid()))
  with check (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.imprest_plans p where p.id = imprest_plan_lines.plan_id and p.author_id = auth.uid()));
-- DEFINER: `FOR UPDATE` on the plan needs an UPDATE grant clients do not hold. Inside a definer current_user is the
-- owner, so the server-writer exemption reads the CALLER's role through the named predicate (0407).
create or replace function public.assert_imprest_plan_line_editable() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  if public.actor_bypasses_rls(coalesce(nullif(current_setting('role', true), 'none'), session_user)::name) then
    return coalesce(new, old);
  end if;
  select p.status into v_status from public.imprest_plans p where p.id = coalesce(new.plan_id, old.plan_id) for update;
  if v_status is distinct from 'Draft' and v_status is distinct from 'Rejected' then
    raise exception 'this plan is % and its lines can no longer be changed (FR-IMP-012)', coalesce(v_status, 'missing')
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end; $$;
revoke all on function public.assert_imprest_plan_line_editable() from public, anon, authenticated;
create trigger imprest_plan_lines_assert_editable before insert or update or delete on public.imprest_plan_lines
  for each row execute function public.assert_imprest_plan_line_editable();
revoke all on public.imprest_plans, public.imprest_plan_lines from public, anon, authenticated;
grant select on public.imprest_plans to authenticated;
grant insert (id, float_id, month) on public.imprest_plans to authenticated;
grant select, delete on public.imprest_plan_lines to authenticated;
grant insert (id, plan_id, budget_category, planned_amount) on public.imprest_plan_lines to authenticated;
grant update (budget_category, planned_amount) on public.imprest_plan_lines to authenticated;

-- §7 the plan state machine (FR-IMP-012..015). Draft→Submitted|Cancelled; Submitted→Approved|Rejected|Cancelled;
-- Rejected→Draft|Cancelled. Approved and Cancelled are terminal.
create or replace function public.transition_imprest_plan(p_id uuid, p_to text, p_notes text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_p      public.imprest_plans%rowtype;
  v_f      public.imprest_floats%rowtype;
  v_uid    uuid := auth.uid();
  v_admin  boolean := public.auth_role() = 'Admin';
  v_tz     text;
  v_today  date;
  v_lines  int;
  v_l      record;
  v_route  record;
  v_routes jsonb := '[]'::jsonb;
  v_glass  boolean := false;
  v_legal  jsonb := jsonb_build_object(
    'Draft', jsonb_build_array('Submitted','Cancelled'), 'Submitted', jsonb_build_array('Approved','Rejected','Cancelled'),
    'Rejected', jsonb_build_array('Draft','Cancelled'), 'Approved', jsonb_build_array(), 'Cancelled', jsonb_build_array());
begin
  perform public.assert_is_active_member();
  select * into v_p from public.imprest_plans where id = p_id for update;
  if not found or v_p.org_id is distinct from public.auth_org_id() then
    raise exception 'plan not found' using errcode = 'P0002';
  end if;
  if not (v_legal -> v_p.status) ? p_to then
    raise exception 'illegal transition % -> %', v_p.status, p_to using errcode = 'P0001';
  end if;
  select * into v_f from public.imprest_floats where id = v_p.float_id;
  -- Lock order (plan delta 5): every spend-line lock BEFORE the float lock, never after — transition_expense_claim
  -- takes spend-line then float, so the reverse here could deadlock. Category order keeps plan approvals consistent.
  if p_to in ('Approved','Rejected') then
    perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_f.project_id::text || ':' || l.budget_category::text, 0))
       from public.imprest_plan_lines l where l.plan_id = p_id order by l.budget_category;
  end if;
  perform public.imprest_lock_float(v_p.float_id);
  v_tz := coalesce((select o.default_timezone from public.organizations o where o.id = v_p.org_id), 'UTC');
  v_today := (now() at time zone v_tz)::date;

  if p_to in ('Approved','Rejected') then
    if v_uid = v_p.author_id then
      raise exception 'separation of duties: the author cannot decide their own plan' using errcode = '42501';
    end if;
    if v_uid = v_f.custodian_id then
      raise exception 'separation of duties: a custodian cannot decide a plan for their own float' using errcode = '42501';
    end if;
  end if;

  if p_to = 'Submitted' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can submit this plan' using errcode = '42501';
    end if;
    select count(*) into v_lines from public.imprest_plan_lines where plan_id = p_id;
    if v_lines = 0 then
      raise exception 'a plan needs at least one line before it can be submitted' using errcode = 'P0001';
    end if;
    if v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    if exists (select 1 from public.imprest_plans o where o.float_id = v_p.float_id and o.month = v_p.month
                 and o.id <> p_id and o.status in ('Submitted','Approved')) then
      raise exception 'this float already has a plan for that month' using errcode = 'P0001';
    end if;
  elsif p_to = 'Draft' then
    if v_uid is distinct from v_p.author_id then
      raise exception 'only the author can reopen this plan' using errcode = '42501';
    end if;
  elsif p_to = 'Cancelled' then
    if not (v_uid = v_p.author_id or v_admin or public.auth_role() = 'Finance') then
      raise exception 'not authorized to cancel this plan' using errcode = '42501';
    end if;
  elsif p_to in ('Approved','Rejected') then
    if p_to = 'Approved' and (v_p.month + interval '1 month')::date <= v_today then
      raise exception 'the plan''s month has ended; it can no longer be approved' using errcode = 'P0001';
    end if;
    if p_to = 'Approved' and v_p.total > v_f.float_amount then
      raise exception 'the plan total % is above the float amount %', v_p.total, v_f.float_amount using errcode = 'P0001';
    end if;
    for v_l in select l.budget_category, l.planned_amount from public.imprest_plan_lines l where l.plan_id = p_id
               order by l.budget_category loop
      select * into v_route from public.spend_approval_route(v_p.org_id, v_f.project_id, v_l.budget_category,
        v_l.planned_amount, v_f.currency, v_p.author_id, v_uid, v_p.submitted_at);
      if coalesce(v_route.route, 'senior') = 'flat' then
        if not (v_admin or public.holds_spend_approval_authority(public.auth_role())) then
          raise exception 'not authorized to decide this plan' using errcode = '42501';
        end if;
      elsif not coalesce(v_uid = any (v_route.approver_ids), false) then
        if not v_admin then
          raise exception 'approval routing: the % line needs %', v_l.budget_category,
            case v_route.route when 'admin' then 'an Admin' else 'a named approver' end using errcode = '42501';
        end if;
        v_glass := true;
      end if;
      v_routes := v_routes || jsonb_build_object('budget_category', v_l.budget_category::text, 'amount', v_l.planned_amount,
                                                 'route', v_route.route, 'reason', v_route.reason);
    end loop;
    perform public.log_audit('imprest_plan.approval_route', v_p.org_id, v_uid, p_id,
      jsonb_build_object('to', p_to, 'lines', v_routes, 'break_glass', v_glass,
                         'late', p_to = 'Approved' and v_p.month <= v_today));
  end if;

  update public.imprest_plans set
    status         = p_to,
    number         = case when p_to = 'Submitted' then coalesce(number, public.next_procurement_doc_number(org_id, 'IMP')) else number end,
    submitted_at   = case when p_to = 'Submitted' then now() else submitted_at end,
    approved_by    = case when p_to = 'Approved' then v_uid when p_to = 'Draft' then null else approved_by end,
    approved_at    = case when p_to = 'Approved' then now() when p_to = 'Draft' then null else approved_at end,
    decision_notes = case when p_to in ('Approved','Rejected') then nullif(btrim(p_notes), '') else decision_notes end,
    is_late        = case when p_to = 'Approved' then v_p.month <= v_today else is_late end
  where id = p_id;
  perform public.log_audit('imprest_plan.transition', v_p.org_id, v_uid, p_id,
    jsonb_build_object('from', v_p.status, 'to', p_to, 'notes', p_notes));
end; $$;
revoke all on function public.transition_imprest_plan(uuid, text, text) from public, anon;
grant execute on function public.transition_imprest_plan(uuid, text, text) to authenticated;

-- §8 closing self-assertion (0270 §6 style): fail the migration if the ACL shape is wrong.
do $$
declare v text;
begin
  foreach v in array array['public.set_imprest_procurement_limit(numeric)', 'public.establish_imprest_float(uuid, uuid, numeric)',
    'public.propose_imprest_float_amount(uuid, numeric)', 'public.decide_imprest_float_change(uuid, boolean, text)',
    'public.transition_imprest_plan(uuid, text, text)'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or not has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0422: % ACL is not the intended shape', v;
    end if;
  end loop;
  foreach v in array array['public.imprest_custodian_eligible(uuid, uuid, uuid)', 'public.imprest_senior_route(uuid, uuid)',
    'public.imprest_lock_float(uuid)', 'public.sync_imprest_plan_total()', 'public.stamp_imprest_plan_org()',
    'public.assert_imprest_plan_line_editable()'] loop
    if has_function_privilege('anon', v, 'EXECUTE') or has_function_privilege('authenticated', v, 'EXECUTE') then
      raise exception '0422: internal % is client-executable', v;
    end if;
  end loop;
  foreach v in array array['public.org_imprest_settings', 'public.imprest_floats', 'public.imprest_float_changes',
    'public.imprest_replenishments'] loop
    if has_table_privilege('anon', v, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege('authenticated', v, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception '0422: % ACL is not the intended shape', v;
    end if;
  end loop;
end $$;
