-- 0270_native_revenue_acl.test.sql — #784 NFR-NAR-001: the four PMO revenue writers are client-callable SECURITY
-- DEFINER functions with a pinned search_path, never anon; the helper and the employ guard are not client-executable;
-- no new column is client-writable (including DD-NAR-16's opening stamp and DD-NAR-17's overpaid figure).
begin;
create extension if not exists pgtap;
select plan(5);

select ok(not exists (
  select 1 from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                        ('public.transition_native_sales_invoice(uuid,text)'),
                        ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                        ('public.cancel_native_receipt(uuid)')) f(sig)
   where has_function_privilege('anon', sig, 'execute')),
  'NFR-NAR-001 anon cannot execute any PMO revenue writer');
select ok(not exists (
  select 1 from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                        ('public.transition_native_sales_invoice(uuid,text)'),
                        ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                        ('public.cancel_native_receipt(uuid)')) f(sig)
   where not has_function_privilege('authenticated', sig, 'execute')),
  'NFR-NAR-001 a signed-in member can call all four (each checks role and SoD itself)');
select ok(not exists (
  select 1 from (values ('public.create_native_sales_invoice(uuid,uuid,jsonb,uuid)'),
                        ('public.transition_native_sales_invoice(uuid,text)'),
                        ('public.record_native_receipt(uuid,numeric,numeric,numeric,text,date)'),
                        ('public.cancel_native_receipt(uuid)')) f(sig)
   join pg_proc p on p.oid = f.sig::regprocedure
   where not p.prosecdef or p.proconfig is distinct from array['search_path=public']),
  'NFR-NAR-001 all four are SECURITY DEFINER with search_path pinned to public');
select ok(not exists (
  select 1 from (values ('public.native_invoice_settled(uuid)'), ('public.assert_revenue_employable()')) f(sig)
   where has_function_privilege('anon', sig, 'execute') or has_function_privilege('authenticated', sig, 'execute')),
  'NFR-NAR-001 the settled-amount helper and the employ guard are not client-executable');
select ok(not exists (
  select 1 from (values ('sales_invoices','pmo_native'), ('sales_invoices','pmo_number'), ('sales_invoices','native_lines'),
                        ('sales_invoices','approved_by_id'), ('sales_invoices','approved_at'),
                        ('sales_invoices','overpaid_amount'), ('sales_invoices','erp_opening_amount'),
                        ('sales_invoices','erp_opening_at'),
                        ('incoming_payments','pmo_native'), ('incoming_payments','pmo_number'),
                        ('incoming_payments','cancelled_at')) c(t, col)
   where has_column_privilege('authenticated', 'public.' || c.t, c.col, 'INSERT')
      or has_column_privilege('authenticated', 'public.' || c.t, c.col, 'UPDATE')),
  'NFR-NAR-001 no client writes a PMO marker, number, line set, stamp, overpaid figure or ERP opening stamp directly');

select * from finish();
rollback;
