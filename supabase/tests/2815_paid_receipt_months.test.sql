-- 2815: Paid receipts summed per currency and month by the server equal the row-by-row sums the browser made, per role.
begin;
create extension if not exists pgtap;
select plan(7);

insert into public.organizations (id, name, default_currency) values
  ('28150000-0000-0000-0000-00000000000a', 'Receipts A', 'IDR'),
  ('28150000-0000-0000-0000-00000000000b', 'Receipts B', 'IDR');
insert into auth.users (id, email) values
  ('28150000-0000-0000-0000-0000000000a1', 'rcp-fin@example.test'),
  ('28150000-0000-0000-0000-0000000000a2', 'rcp-exec@example.test'),
  ('28150000-0000-0000-0000-0000000000a3', 'rcp-eng@example.test'),
  ('28150000-0000-0000-0000-0000000000b1', 'rcp-b@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('28150000-0000-0000-0000-0000000000a1', '28150000-0000-0000-0000-00000000000a', 'Fin', 'rcp-fin@example.test', 'Finance', 'active'),
  ('28150000-0000-0000-0000-0000000000a2', '28150000-0000-0000-0000-00000000000a', 'Exec', 'rcp-exec@example.test', 'Executive', 'active'),
  ('28150000-0000-0000-0000-0000000000a3', '28150000-0000-0000-0000-00000000000a', 'Eng', 'rcp-eng@example.test', 'Engineer', 'active'),
  ('28150000-0000-0000-0000-0000000000b1', '28150000-0000-0000-0000-00000000000b', 'B Fin', 'rcp-b@example.test', 'Finance', 'active');
insert into public.companies (id, org_id, name, type) values
  ('28150000-0000-0000-0000-0000000000c1', '28150000-0000-0000-0000-00000000000a', 'Client A', 'Client'),
  ('28150000-0000-0000-0000-0000000000c2', '28150000-0000-0000-0000-00000000000b', 'Client B', 'Client');
insert into public.incoming_payments (org_id, customer_id, date, amount, currency, status) values
  ('28150000-0000-0000-0000-00000000000a', '28150000-0000-0000-0000-0000000000c1', '2026-10-03', 1000.10, 'IDR', 'Paid'),
  ('28150000-0000-0000-0000-00000000000a', '28150000-0000-0000-0000-0000000000c1', '2026-10-31', 0.05, 'IDR', 'Paid'),
  ('28150000-0000-0000-0000-00000000000a', '28150000-0000-0000-0000-0000000000c1', '2026-10-15', 999, 'IDR', 'Scheduled'),
  ('28150000-0000-0000-0000-00000000000a', '28150000-0000-0000-0000-0000000000c1', '2026-11-01', 987654321012.34, 'IDR', 'Paid'),
  ('28150000-0000-0000-0000-00000000000a', '28150000-0000-0000-0000-0000000000c1', '2026-11-30', 0.01, 'IDR', 'Paid'),
  ('28150000-0000-0000-0000-00000000000a', '28150000-0000-0000-0000-0000000000c1', '2026-11-02', 50, 'USD', 'Paid'),
  ('28150000-0000-0000-0000-00000000000a', '28150000-0000-0000-0000-0000000000c1', null, 7, 'IDR', 'Paid'),
  ('28150000-0000-0000-0000-00000000000b', '28150000-0000-0000-0000-0000000000c2', '2026-10-03', 5, 'IDR', 'Paid');

set local role authenticated;
set local request.jwt.claims = '{"sub":"28150000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select results_eq($$ select currency, month, total, receipt_count, unknown_count from public.get_paid_receipt_months() $$,
  $$ values ('IDR'::text, null::text, '7.00'::text, 1, 0), ('IDR', '2026-10', '1000.15', 2, 0),
            ('IDR', '2026-11', '987654321012.35', 2, 0), ('USD', '2026-11', '50.00', 1, 0) $$,
  '2815 Finance: Paid receipts by currency and month, exact; the Scheduled receipt is not collected');
-- The row-by-row sum over the rows Finance may read equals the function's sums, month by month.
select is((select string_agg(currency || coalesce(month, '-') || total, ',' order by currency, month) from public.get_paid_receipt_months()),
  (select string_agg(currency || coalesce(m, '-') || t, ',' order by currency, m) from (
     select currency, to_char(date, 'YYYY-MM') m, sum(amount)::text t from public.incoming_payments where status = 'Paid' group by 1, 2) x),
  '2815 Finance: equals the row-by-row sum of readable rows');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"28150000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.get_paid_receipt_months()), 4, '2815 Executive: the same months');
reset role;

-- An Engineer reads no receipts, so has no collected months, exactly as the browser read returned none.
set local role authenticated;
set local request.jwt.claims = '{"sub":"28150000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.get_paid_receipt_months()), (select count(*)::int from (select distinct currency, to_char(date, 'YYYY-MM') from public.incoming_payments where status = 'Paid') x),
  '2815 Engineer: only the receipts they may read');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"28150000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select results_eq($$ select currency, month, total from public.get_paid_receipt_months() $$,
  $$ values ('IDR'::text, '2026-10'::text, '5.00'::text) $$, '2815 the other organisation sees only its own');
reset role;

select is((select prosecdef from pg_proc where oid = 'public.get_paid_receipt_months()'::regprocedure), false, '2815 security invoker');
select ok(not has_function_privilege('anon', 'public.get_paid_receipt_months()', 'execute'), '2815 anon cannot call it');

select * from finish();
rollback;
