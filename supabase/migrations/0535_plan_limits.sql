-- 0535_plan_limits.sql — plan limits (S5): seats, active projects, monthly AI allowance.
--
-- FR-PLN-010/011/012, AC-PLN-009/010/011, spec D10–D12, plan Decisions 3–4
-- (docs/plans/2026-11-02-plans-and-feature-switches.md § "S5 — detailed plan").
--
-- 0534 belongs to the S2 enforcement slice; dev's migration head is above this number, so this file
-- depends only on 0001 / 0044 / 0047 / 0066 / 0067 / 0076 / 0179 / 0461 / 0530–0533 and is safe
-- whether it applies before or after 0536+.
--
-- THREE LIMITS, three shapes:
--   • seats — counted as `profiles.status = 'active'` in the org. A pending invite IS that row: the
--     admin-invite-user edge fn writes it at issuance (index.ts:157) and its saga removes the auth
--     user if that write fails (index.ts:165-178), so no reservation table and no third
--     representation exists to drift. The organisations ROW LOCK is what makes the count exact:
--     lock → count → the row write all happen in ONE transaction (the BEFORE INSERT trigger), so two
--     concurrent invites serialise (0170_automation_cap_race.sql is the precedent, 0163 its proof).
--     ⚑ The lock covers the ROW WRITE, never the invite email: `inviteUserByEmail` runs after the
--     authorising transaction ends, which is exactly why the trigger — not the pre-issuance
--     `assert_seat_available` — is the authority, and why the pre-check exists only to refuse before
--     an email is sent.
--   • active projects — `archived_at is null and status not in ('Loss Tender','Declined')`
--     (`project_counts_toward_limit`). Close Out counts: it is on-hand delivery (0044:52), still
--     carrying work. Reactivation is any UPDATE crossing INTO the counted set (transition_project's
--     revival edges, 0461:193/201/209, or clearing archived_at), so the guard fires there too. There
--     is no project-create RPC (the FE inserts directly, src/lib/db/projects.ts:257), so a trigger is
--     the only place the cap can bind for every writer.
--   • monthly AI allowance — additive, never expiring (plan Decision 4: the pool is a balance over an
--     append-only ledger, 0067:13). One message credit = $0.005 (spec D10), single-sourced here as
--     `plan_ai_credit_unit_usd()`. NULL allowance = NO grant (plan Decision 3). Idempotency is the
--     (org_id, period) primary key on org_ai_allowance_grants: `on conflict do nothing`, so a retried
--     cron fire or a manual re-run writes no second grant.
--
-- TYPED REFUSALS: `PL001` (seats) and `PL002` (active projects), following the `BW001` precedent
-- (0262_billing_by_work_order.sql:15). P0001 is already carried by hundreds of unrelated refusals, so
-- a per-limit code is what lets the FE localise exactly these two (pmo-portal/pages/AdminUsers.tsx,
-- pmo-portal/pages/ProjectNew.tsx) while every state-machine error keeps its own message.
--
-- MONEY/ATTRIBUTION: `credits.granted_by` becomes nullable. A scheduled system grant has no human
-- granter; the alternative — stamping a real person's profile — would forge attribution on a money
-- row, and `owner_id` took the same treatment for the org pool (0066:16).
--
-- Reversibility: supabase/migrations/rollback/0535_plan_limits_down.sql (and, pre-production,
-- `supabase db reset` — ADR-0006).

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — The limits reader. Private: the plan registry itself is RPC-only (0530), so limits are read
--      by the definer helpers below and will be projected to the UI by a later slice's RPC, never by
--      a direct table grant.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.org_plan_limits(p_org_id uuid)
returns table(plan_id text, seat_limit integer, project_limit integer, ai_monthly_messages integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.seat_limit, p.project_limit, p.ai_monthly_messages
    from public.plans p
   where p.id = coalesce(
     (select op.plan_id from public.org_plans op where op.org_id = p_org_id),
     'enterprise')            -- absent assignment resolves Enterprise, exactly like 0532:80
$$;
revoke all on function public.org_plan_limits(uuid) from public, anon, authenticated, service_role;

-- The seat count itself, in one place so the RPC and the trigger can never drift.
create or replace function public.org_seat_usage(p_org_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from public.profiles
   where org_id = p_org_id and status = 'active'
$$;
revoke all on function public.org_seat_usage(uuid) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — The seat check: lock the organisation row, then count. This is the ONE implementation both the
--      caller-facing pre-check and the profiles trigger go through.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.plan_enforce_seat_limit(p_org_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_plan  text;
  v_limit integer;
  v_used  integer;
begin
  -- Lock FIRST, count second (0170's rule: a count-then-lock is not serialization-proof). Under READ
  -- COMMITTED — Supabase's session default — the count re-reads the newly committed state once the
  -- lock is granted, so the second concurrent invite sees the first one's row.
  perform 1 from public.organizations where id = p_org_id for update;
  if not found then
    raise exception 'unknown_org' using errcode = 'P0002';
  end if;

  select l.plan_id, l.seat_limit into v_plan, v_limit
    from public.org_plan_limits(p_org_id) l;
  if v_limit is null then
    return;                                   -- NULL = unlimited (D3), no counting needed
  end if;

  select public.org_seat_usage(p_org_id) into v_used;
  if v_used >= v_limit then
    raise exception 'seat_limit_reached: the % plan allows % seats; this organisation already uses %',
      v_plan, v_limit, v_used
      using errcode = 'PL001';
  end if;
end $$;
revoke all on function public.plan_enforce_seat_limit(uuid) from public, anon, authenticated, service_role;

-- The caller-facing pre-check, consumed by pmo-portal/src/lib/invite/inviteHandler.ts before the edge
-- fn issues anything, so an over-limit invite is refused BEFORE an email is sent. Authority mirrors
-- the invite path itself (0065:109-122): an active member who is an Operator, or an Admin of that org.
create or replace function public.assert_seat_available(p_org_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not (public.is_operator()
          or (p_org_id = public.auth_org_id() and public.auth_role() = 'Admin')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform public.plan_enforce_seat_limit(p_org_id);
end $$;
revoke all on function public.assert_seat_available(uuid) from public, anon;
grant execute on function public.assert_seat_available(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — The seat guard on profiles: INSERT (a new member or a pending invite), and an UPDATE that
--      re-activates a disabled profile (a re-enabled user consumes a seat like any other).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.enforce_org_seat_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status::text <> 'active' then
    return new;                               -- a disabled profile holds no seat
  end if;
  if tg_op = 'UPDATE' and old.status::text = 'active' then
    return new;                               -- already seated: an edit consumes no new slot
  end if;

  -- SECURITY (0170's lesson): this trigger is SECURITY DEFINER, so it runs BEFORE profiles' RLS
  -- WITH CHECK would reject a foreign org_id — without this explicit guard, "at cap" vs the eventual
  -- RLS refusal would distinguish two states for an org the caller does not belong to. The predicate
  -- is exactly profiles_admin_insert's (0179:166) plus the Operator clause the invite path uses.
  if auth.uid() is not null
     and not (public.is_operator()
              or (new.org_id = public.auth_org_id()
                  and public.auth_role() = 'Admin'
                  and public.is_active_member())) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform public.plan_enforce_seat_limit(new.org_id);
  return new;
end $$;
revoke all on function public.enforce_org_seat_limit() from public, anon, authenticated, service_role;

drop trigger if exists profiles_plan_seat_guard on public.profiles;
create trigger profiles_plan_seat_guard
  before insert or update of status on public.profiles
  for each row execute function public.enforce_org_seat_limit();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — The active-project cap on projects: INSERT, and any UPDATE that crosses INTO the counted set
--      (a reactivation), or out of it and back.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- The counted-set predicate, immutable and single-sourced so a read projection (the "Your plan" usage
-- screen in a later slice) and this guard can never disagree about what "active" means.
create or replace function public.project_counts_toward_limit(
  p_status public.project_status, p_archived_at timestamptz
) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p_archived_at is null
     and p_status is not null
     and p_status::text <> all (array['Loss Tender','Declined']::text[])
$$;
revoke all on function public.project_counts_toward_limit(public.project_status, timestamptz) from public, anon;
grant execute on function public.project_counts_toward_limit(public.project_status, timestamptz)
  to authenticated, service_role;

create or replace function public.enforce_org_project_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_plan  text;
  v_limit integer;
  v_used  integer;
begin
  if not public.project_counts_toward_limit(new.status, new.archived_at) then
    return new;                               -- archived / lost / declined consumes no slot
  end if;
  if tg_op = 'UPDATE' and public.project_counts_toward_limit(old.status, old.archived_at) then
    return new;                               -- already active: no new slot is being taken
  end if;

  -- SECURITY (0170's lesson, as above): assert the document's org against the caller before the
  -- count, so the refusal cannot distinguish "at cap" from "not your org".
  if auth.uid() is not null and new.org_id is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform 1 from public.organizations where id = new.org_id for update;
  if not found then
    raise exception 'unknown_org' using errcode = 'P0002';
  end if;

  select l.plan_id, l.project_limit into v_plan, v_limit
    from public.org_plan_limits(new.org_id) l;
  if v_limit is null then
    return new;                               -- NULL = unlimited (D3)
  end if;

  select count(*) into v_used
    from public.projects p
   where p.org_id = new.org_id
     and public.project_counts_toward_limit(p.status, p.archived_at);
  if v_used >= v_limit then
    raise exception 'project_limit_reached: the % plan allows % active projects; this organisation already has %',
      v_plan, v_limit, v_used
      using errcode = 'PL002';
  end if;
  return new;
end $$;
revoke all on function public.enforce_org_project_limit() from public, anon, authenticated, service_role;

drop trigger if exists projects_plan_cap_guard on public.projects;
create trigger projects_plan_cap_guard
  before insert or update of status, archived_at on public.projects
  for each row execute function public.enforce_org_project_limit();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — The monthly AI allowance: one credit unit, one ledger, one idempotent job.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Spec D10: one message credit covers up to $0.005 (a heavier message uses more, which the existing
-- per-turn metering already handles). Single-sourced so a plan edit can never silently change the
-- exchange rate in two places.
create or replace function public.plan_ai_credit_unit_usd()
returns numeric
language sql immutable parallel safe set search_path = '' as $$
  select 0.005::numeric
$$;
revoke all on function public.plan_ai_credit_unit_usd() from public, anon;
grant execute on function public.plan_ai_credit_unit_usd() to authenticated, service_role;

-- One row per org per month. The (org_id, period) key IS the idempotency: the tick inserts with
-- `on conflict do nothing` and skips the credit when the row already exists, so a retried or manual
-- re-run can never double-grant. `credit_id` points at the credits row the grant minted.
create table public.org_ai_allowance_grants (
  org_id               uuid    not null references public.organizations(id) on delete cascade,
  period               date    not null,
  plan_id              text    not null references public.plans(id),
  ai_monthly_messages  integer not null check (ai_monthly_messages > 0),
  amount               numeric not null check (amount > 0),
  credit_id            uuid    references public.credits(id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint org_ai_allowance_grants_period_month_start
    check (period = date_trunc('month', period::timestamp)::date),
  primary key (org_id, period)
);

alter table public.org_ai_allowance_grants enable row level security;
alter table public.org_ai_allowance_grants force  row level security;

comment on table public.org_ai_allowance_grants is
  'Monthly AI allowance grants (FR-PLN-012). Append-only bookkeeping for idempotency: the money itself '
  'lives in public.credits. No client policy — written only by plan_monthly_ai_allowance_tick().';
comment on column public.org_ai_allowance_grants.period is
  'First day of the granted month (UTC), the idempotency key together with org_id.';
comment on column public.org_ai_allowance_grants.credit_id is
  'The credits row this grant minted, so a ledger row and its money are always reconcilable.';

revoke all on table public.org_ai_allowance_grants from public, anon, authenticated;
grant select, insert on table public.org_ai_allowance_grants to service_role;

-- System-attributed grants: no human granted them, so no profile may be named (0066 did the same for
-- owner_id). The FE never reads granted_by; the audit row carries the attribution.
alter table public.credits alter column granted_by drop not null;

create or replace function public.plan_monthly_ai_allowance_tick(p_period date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_period  date := date_trunc('month', coalesce(p_period, (now() at time zone 'utc')::date)::timestamp)::date;
  v_org     uuid;
  v_plan    text;
  v_msgs    integer;
  v_amount  numeric;
  v_credit  uuid;
  v_granted integer := 0;
begin
  for v_org, v_plan, v_msgs in
    select o.id, l.plan_id, l.ai_monthly_messages
      from public.organizations o
      join lateral public.org_plan_limits(o.id) l on true
     where l.ai_monthly_messages is not null
       and l.ai_monthly_messages > 0
     order by o.id
  loop
    v_amount := v_msgs * public.plan_ai_credit_unit_usd();

    insert into public.org_ai_allowance_grants (org_id, period, plan_id, ai_monthly_messages, amount)
      values (v_org, v_period, v_plan, v_msgs, v_amount)
      on conflict (org_id, period) do nothing;
    if not found then
      continue;                               -- this org already had this month's grant
    end if;

    insert into public.credits (org_id, owner_id, amount, note, granted_by)
      values (v_org, null, v_amount,
              format('plan-monthly-ai-allowance: %s plan, %s messages (%s)', v_plan, v_msgs, v_period),
              null)
      returning id into v_credit;

    update public.org_ai_allowance_grants
       set credit_id = v_credit
     where org_id = v_org and period = v_period;

    perform public.log_audit('plans.ai_allowance.grant', v_org, null, null,
      jsonb_build_object('period', v_period, 'plan_id', v_plan,
                         'ai_monthly_messages', v_msgs, 'amount', v_amount));
    v_granted := v_granted + 1;
  end loop;
  return v_granted;
end $$;
revoke all on function public.plan_monthly_ai_allowance_tick(date) from public, anon, authenticated;
grant execute on function public.plan_monthly_ai_allowance_tick(date) to service_role;

-- Scheduled the way this repo schedules jobs (0094:51-71, 0564): `cron.schedule` upserts by name, so a
-- re-apply is idempotent and the row exists in `supabase db reset`. Runs on the 1st at 01:13 UTC —
-- after the day's other jobs (03:xx purges) have no interaction with it.
create extension if not exists pg_cron;
select cron.schedule(
  'plan-monthly-ai-allowance',
  '13 1 1 * *',
  'select public.plan_monthly_ai_allowance_tick()'
);

notify pgrst, 'reload schema';
