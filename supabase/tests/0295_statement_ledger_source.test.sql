-- AC-001/005 support: GL source carries company/opening/book and exact decimal precision.
begin;
select plan(5);
select ok((select data_type='numeric' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='debit'), 'debit is unscaled numeric');
select ok((select numeric_scale is null from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='debit'), 'debit has no fixed fractional scale');
select ok((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='company'), 'legacy company remains nullable');
select ok((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='is_opening'), 'legacy opening remains nullable');
select ok((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='erp_gl_entry_mirror' and column_name='finance_book'), 'legacy finance book remains nullable');
select * from finish();
rollback;
