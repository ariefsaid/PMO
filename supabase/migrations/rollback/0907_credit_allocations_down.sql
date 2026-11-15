-- 0907_credit_allocations_down.sql — the STAGED rollback of 0907.
--
-- Lives in supabase/migrations/rollback/ so `supabase db reset` never applies it. Run deliberately:
--   psql "$DB_URL" -f supabase/migrations/rollback/0907_credit_allocations_down.sql
--
-- Drops per-user allocations. The org pool (credits) is untouched, so every balance is unchanged.

drop function if exists public.admin_move_credit_allocation(uuid, uuid, numeric);
drop trigger if exists credit_allocations_within_pool on public.credit_allocations;
drop function if exists public.credit_allocations_within_pool();
drop table if exists public.credit_allocations;
