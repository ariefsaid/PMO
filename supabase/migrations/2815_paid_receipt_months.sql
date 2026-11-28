-- 2815: the home and finance "collected" figures read Paid receipts summed per currency and month by the server,
-- instead of every Paid receipt ever recorded (one page per thousand receipts, growing forever).
-- Same rows as the browser read (Paid incoming payments the caller may read; security invoker, so RLS decides), and
-- the same rules: a receipt with no date counts toward nothing but its presence; an unknown amount makes its month and
-- currency unknown (unknown_count), and the browser still treats one unknown amount anywhere as it did.
-- total is text so a month's sum reaches the browser exact to the cent at any size.
-- New function only; no table, policy or grant on data changes.
-- Rollback: supabase/migrations/rollback/2815_paid_receipt_months_down.sql

create or replace function public.get_paid_receipt_months()
  returns table (currency text, month text, total text, receipt_count int, unknown_count int)
  language sql stable security invoker set search_path = public
as $$
  select ip.currency, to_char(ip.date, 'YYYY-MM'), sum(ip.amount)::text, count(*)::int,
         count(*) filter (where ip.amount is null)::int
    from public.incoming_payments ip
   where ip.status = 'Paid'
   group by ip.currency, to_char(ip.date, 'YYYY-MM')
   order by 2 nulls first, 1
$$;
revoke all on function public.get_paid_receipt_months() from public;
revoke execute on function public.get_paid_receipt_months() from anon;
grant execute on function public.get_paid_receipt_months() to authenticated, service_role;
