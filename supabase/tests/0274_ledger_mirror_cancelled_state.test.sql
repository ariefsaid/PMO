-- 0274_ledger_mirror_cancelled_state.test.sql — #901 [pgTAP]: the Payment Ledger mirror carries ERPNext's
-- `delinked` flag (the GL mirror's `is_cancelled` already exists, 0101), defaulting to false, and no user
-- JWT can write either flag (machine-written ERP truth, ADR-0048 — only the service-role feed sets them).
begin;
select plan(8);

select has_column('public', 'erp_payment_ledger_mirror', 'delinked', 'PLE mirror has a delinked column');
select col_type_is('public', 'erp_payment_ledger_mirror', 'delinked', 'boolean', 'delinked is boolean');
select col_not_null('public', 'erp_payment_ledger_mirror', 'delinked', 'delinked is NOT NULL');
select col_default_is('public', 'erp_payment_ledger_mirror', 'delinked', 'false', 'delinked defaults to false');

insert into organizations (id, name) values ('a2670000-0000-0000-0000-000000000001', '0267 Ledger Org');
insert into public.erp_payment_ledger_mirror (org_id, erp_name, account, amount, erp_modified)
  values ('a2670000-0000-0000-0000-000000000001', 'PLE-0267', 'Creditors - PSC', 10, '2026-10-07 10:00:00');
select is(
  (select delinked from public.erp_payment_ledger_mirror where erp_name = 'PLE-0267'),
  false,
  'a row fed before the flag existed (or without it) reads as live'
);

select ok(
  not has_column_privilege('authenticated', 'public.erp_payment_ledger_mirror', 'delinked', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.erp_payment_ledger_mirror', 'delinked', 'INSERT'),
  'authenticated cannot write delinked'
);
select ok(
  not has_column_privilege('authenticated', 'public.erp_gl_entry_mirror', 'is_cancelled', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.erp_gl_entry_mirror', 'is_cancelled', 'INSERT'),
  'authenticated cannot write is_cancelled'
);
select ok(
  not has_column_privilege('anon', 'public.erp_payment_ledger_mirror', 'delinked', 'UPDATE')
  and not has_column_privilege('anon', 'public.erp_gl_entry_mirror', 'is_cancelled', 'UPDATE'),
  'anon cannot write either flag'
);

select * from finish();
rollback;
