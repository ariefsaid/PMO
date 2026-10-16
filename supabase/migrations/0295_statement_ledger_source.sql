-- 0295 — source context and ERP-supported GL decimal precision for financial statements.
-- Rollback refuses values that cannot be represented by the previous numeric(14,2) schema.

alter table public.erp_gl_entry_mirror
  add column company text,
  add column is_opening text check (is_opening in ('Yes','No')),
  add column finance_book text;
alter table public.erp_gl_entry_mirror
  alter column debit type numeric using debit::numeric,
  alter column credit type numeric using credit::numeric;

create index erp_gl_entry_mirror_org_company_id_idx
  on public.erp_gl_entry_mirror(org_id, company, id);
create index erp_gl_entry_mirror_org_company_date_account_idx
  on public.erp_gl_entry_mirror(org_id, company, posting_date, account);
