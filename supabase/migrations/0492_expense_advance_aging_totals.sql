-- 0492_expense_advance_aging_totals.sql — T-12: advance-aging bucket totals computed over EVERY visible outstanding
-- advance, not over the 500-row page the list shows. The card's totals were summed from the capped rows, so an org with
-- more than 500 outstanding advances read a partial sum as its exposure.
-- Reads get_expense_advance_aging() (0247 §9) so the visibility, the outstanding sum, the org-day age and the bucket
-- edges stay one definition. SECURITY INVOKER: RLS on expense_claims decides whose advances are summed, exactly as for
-- the list.
-- REVERSE: supabase/migrations/rollback/0492_expense_advance_aging_totals_down.sql

create or replace function public.get_expense_advance_aging_totals()
returns table (currency text, bucket text, outstanding numeric, advance_count bigint)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select a.currency, a.bucket, sum(a.outstanding), count(*)
    from public.get_expense_advance_aging() a
   group by a.currency, a.bucket
   order by a.currency, a.bucket
$$;
revoke all on function public.get_expense_advance_aging_totals() from public, anon;
grant execute on function public.get_expense_advance_aging_totals() to authenticated;
