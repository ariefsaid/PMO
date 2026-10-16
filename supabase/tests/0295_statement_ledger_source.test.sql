-- AC-001/005 support: GL source carries company/opening/book and exact decimal precision.
begin;
select plan(8);
select ok((select data_type='numeric' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='debit'), 'debit is unscaled numeric');
select ok((select numeric_scale is null from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='debit'), 'debit has no fixed fractional scale');
select ok((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='company'), 'legacy company remains nullable');
select ok((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='is_opening'), 'legacy opening remains nullable');
select ok((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='finance_book'), 'legacy finance book remains nullable');
insert into public.erp_gl_entry_mirror(org_id, erp_name, company, account, debit, credit, is_opening, finance_book, erp_modified)
values ('00000000-0000-0000-0000-000000000001', 'GL-SYNTHETIC-PRECISION', 'Synthetic Co', 'Synthetic Account', 0.123456789, 12345678901234567890.123456789, 'Yes', null, '2026-01-01');
select is((select debit from public.erp_gl_entry_mirror where erp_name='GL-SYNTHETIC-PRECISION'), 0.123456789::numeric, 'nine decimal debit round-trips');
select is((select credit from public.erp_gl_entry_mirror where erp_name='GL-SYNTHETIC-PRECISION'), 12345678901234567890.123456789::numeric, 'large high-precision credit round-trips');
select ok(to_regclass('public.erp_gl_entry_mirror_org_company_date_account_idx') is not null, 'company/date/account hot index exists');
select * from finish();
rollback;
