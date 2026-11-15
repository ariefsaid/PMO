-- 0907_credit_allocations.sql — layer 2 of the credit model (#564): an org-Admin splits the org's
-- AI credit pool among its users. A split is a REDISTRIBUTION of a fixed pool, never a mint.
--
-- The three layers (docs/backlog.md, ADR-0049):
--   1. Grant  — an Operator adds credits to the org pool (`credits`, Operator-only INSERT). Raises the total.
--   2. Allocate (this migration) — an org-Admin divides the pool among users. CANNOT change the total.
--   3. Buy    — deferred; it must go through a payment flow, never a `credits` INSERT.
--
-- Invariant, held by the database on every write path:
--   pool total(org)  = Σ credits.amount where org_id = org        (untouched here: allocations live
--                                                                   in their own table)
--   Σ credit_allocations.amount where org_id = org  ≤  pool total(org)
--   unallocated(org) = pool total − Σ allocations
-- The pool total is the GRANTED total, not the remaining balance: an allocation is a user's slice of
-- what the org was granted, and that user's own spend is drawn from their slice. Measuring against the
-- remaining balance would make a fully used, correctly sized allocation read as an over-allocation.
--
-- How it is held:
--   • admin_move_credit_allocation(from, to, amount) is the only client writer. It moves `amount`
--     between two buckets (a user, or NULL = the unallocated pool) in one transaction under the
--     org's credit advisory lock, so a debit and its credit land together or not at all, and two
--     concurrent re-splits serialize (the second sees the first's committed rows).
--   • A deferred constraint trigger re-checks the invariant at commit for ANY write (a privileged
--     direct write that skips the RPC included), under the same lock.
--   • Removing a user (profile delete) cascades their row away, which returns it to the pool.
--   • authenticated may only SELECT (own row, or the whole org for Admin/Executive). No INSERT/UPDATE/
--     DELETE grant.
--
-- Metering against a user's allocation and the Admin allocation screen are separate slices.
--
-- Reversibility (ADR-0006): supabase db reset. Staged rollback: rollback/0907_credit_allocations_down.sql

create table public.credit_allocations (
  org_id      uuid not null references public.organizations(id),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  amount      numeric not null check (amount > 0),
  -- who last moved credit into or out of this row. A plain uuid, not a second profiles FK: one FK
  -- keeps PostgREST embeds of profiles unambiguous (postgrest_embed_ambiguity_guard).
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index credit_allocations_user_idx on public.credit_allocations (user_id);

alter table public.credit_allocations enable row level security;
alter table public.credit_allocations force row level security;

revoke all on table public.credit_allocations from public, anon, authenticated;
grant select on table public.credit_allocations to authenticated;
grant all on table public.credit_allocations to service_role;

create policy credit_allocations_select on public.credit_allocations for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      user_id = (select auth.uid())
      or (select public.auth_role()) in ('Admin','Executive')
    )
  );

-- ── The database backstop: Σ allocations ≤ pool total, and the user belongs to the row's org. ─────
create or replace function public.credit_allocations_within_pool() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_pool      numeric;
  v_allocated numeric;
begin
  -- A deferred event can outlive its row (later moved to zero, or its user removed): the check is
  -- about the rows that exist at commit, so a row that no longer exists has nothing to check.
  if not exists (select 1 from public.credit_allocations a
                  where a.org_id = new.org_id and a.user_id = new.user_id) then
    return null;
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.org_id = new.org_id) then
    raise exception 'allocation_user_not_in_org' using errcode = '23514';
  end if;
  -- Same key as reserve_credits / admin_move_credit_allocation: concurrent writers for one org
  -- serialize, and this statement's fresh snapshot then sees every committed allocation.
  perform pg_advisory_xact_lock(hashtext('credits:' || new.org_id::text));
  select coalesce(sum(amount), 0) into v_pool      from public.credits            where org_id = new.org_id;
  select coalesce(sum(amount), 0) into v_allocated from public.credit_allocations where org_id = new.org_id;
  if v_allocated > v_pool then
    raise exception 'allocation_exceeds_pool' using errcode = '23514';
  end if;
  return null;
end $$;
revoke all on function public.credit_allocations_within_pool() from public, anon, authenticated;

create constraint trigger credit_allocations_within_pool
  after insert or update on public.credit_allocations
  deferrable initially deferred
  for each row execute function public.credit_allocations_within_pool();

-- ── The only client writer: move credit between two buckets of one org. ──────────────────────────
-- p_from_user / p_to_user: a user in the caller's org, or NULL for the org's unallocated pool.
create or replace function public.admin_move_credit_allocation(
  p_from_user uuid,
  p_to_user   uuid,
  p_amount    numeric
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org       uuid := public.auth_org_id();
  v_pool      numeric;
  v_allocated numeric;
  v_held      numeric;
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_positive' using errcode = '23514';
  end if;
  if p_from_user is not distinct from p_to_user then
    raise exception 'same_bucket' using errcode = '22023';
  end if;
  if (p_from_user is not null and not exists (select 1 from public.profiles where id = p_from_user and org_id = v_org))
     or (p_to_user is not null and not exists (select 1 from public.profiles where id = p_to_user and org_id = v_org)) then
    raise exception 'user_not_in_org' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || v_org::text));

  -- Debit the source bucket first; refuse before anything is written.
  if p_from_user is null then
    select coalesce(sum(amount), 0) into v_pool      from public.credits            where org_id = v_org;
    select coalesce(sum(amount), 0) into v_allocated from public.credit_allocations where org_id = v_org;
    if v_pool - v_allocated < p_amount then
      raise exception 'insufficient_unallocated' using errcode = '23514';
    end if;
  else
    select amount into v_held from public.credit_allocations
     where org_id = v_org and user_id = p_from_user for update;
    if coalesce(v_held, 0) < p_amount then
      raise exception 'insufficient_allocation' using errcode = '23514';
    end if;
    if v_held = p_amount then
      delete from public.credit_allocations where org_id = v_org and user_id = p_from_user;
    else
      update public.credit_allocations
         set amount = amount - p_amount, updated_by = auth.uid(), updated_at = now()
       where org_id = v_org and user_id = p_from_user;
    end if;
  end if;

  -- Credit the destination bucket (the unallocated pool needs no row).
  if p_to_user is not null then
    insert into public.credit_allocations (org_id, user_id, amount, updated_by)
      values (v_org, p_to_user, p_amount, auth.uid())
    on conflict (org_id, user_id) do update
      set amount = public.credit_allocations.amount + excluded.amount,
          updated_by = excluded.updated_by, updated_at = now();
  end if;
end $$;

revoke all on function public.admin_move_credit_allocation(uuid, uuid, numeric) from public, anon;
grant execute on function public.admin_move_credit_allocation(uuid, uuid, numeric) to authenticated;
