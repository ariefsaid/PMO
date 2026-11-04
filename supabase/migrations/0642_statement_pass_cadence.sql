-- 0642_statement_pass_cadence.sql — the native financial-statement report batch gets its OWN
-- per-org freshness marker, so its cadence is independent of the full sweep's cadence.
--
-- 0358 stamps a per-org "full run completed" marker (`erp_sweep_full_run`) and the sweep's inbound
-- and statement work rides it. That is the right shape for the inbound passes, whose unit of work is
-- one bounded tick, and the wrong shape for the native report batch: 0427's deferral deliberately
-- leaves a deferred full run due again on the NEXT tick (0 seconds = continue next tick), and a batch
-- is a multi-segment, resumable protocol that must be driven at a bounded rate, not at the tick rate.
-- Coupling the two meant the batch cadence followed however often the full run happened.
--
-- This table is the batch's own marker: `completed_at` = when a pass last PUBLISHED a generation.
-- `defer_erp_statement_pass` writes it backwards from the retry instant by 55 minutes so ONE rule —
-- `statementPassDue` in the edge function — covers "hourly" (published), "retry at the next five-minute boundary"
-- (failed / unfinished) and "continue on the next eligible tick". Both writers re-check the caller's
-- live `erp_sweep_lock` lease, exactly like 0358's `mark_erp_full_sweep_done` / 0427's
-- `defer_erp_full_sweep`, so a tick whose lease lapsed can never stamp or defer.
--
-- Rollback: rollback/0642_statement_pass_cadence_down.sql (drops the RPCs, then the table).

create table public.erp_statement_pass_run (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  completed_at timestamptz not null
);

alter table public.erp_statement_pass_run enable row level security;
alter table public.erp_statement_pass_run force row level security;
revoke all on public.erp_statement_pass_run from anon, authenticated;
grant all on public.erp_statement_pass_run to service_role;

-- The sweep's own holder stamps a completed (published) statement pass.
create or replace function public.mark_erp_statement_pass_done(p_org_id uuid, p_holder uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.erp_sweep_lock
     where org_id = p_org_id and holder = p_holder and locked_until > now()
  ) then
    return false;
  end if;
  insert into public.erp_statement_pass_run (org_id, completed_at) values (p_org_id, now())
  on conflict (org_id) do update set completed_at = excluded.completed_at;
  return true;
end;
$$;

revoke execute on function public.mark_erp_statement_pass_done(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_erp_statement_pass_done(uuid, uuid) to service_role;

-- The sweep's 300-second retry selects the next UTC five-minute boundary using the DB clock;
-- other values remain elapsed-second delays. The 55-minute offset matches statementPassDue in TypeScript.
create or replace function public.defer_erp_statement_pass(p_org_id uuid, p_holder uuid, p_due_in_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.erp_sweep_lock
     where org_id = p_org_id and holder = p_holder and locked_until > now()
  ) then
    return false;
  end if;
  insert into public.erp_statement_pass_run (org_id, completed_at)
  values (p_org_id, case when p_due_in_seconds = 300
    then to_timestamp((floor(extract(epoch from now()) / 300) + 1) * 300) - interval '55 minutes'
    else now() - interval '55 minutes' + make_interval(secs => greatest(coalesce(p_due_in_seconds, 0), 0)) end)
  on conflict (org_id) do update set completed_at = excluded.completed_at;
  return true;
end;
$$;

revoke execute on function public.defer_erp_statement_pass(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.defer_erp_statement_pass(uuid, uuid, int) to service_role;
