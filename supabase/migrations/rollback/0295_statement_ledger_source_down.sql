-- Refuse lossy narrowing to the former numeric(14,2) GL amount columns.
do $$
begin
  if exists (
    select 1 from public.erp_gl_entry_mirror
    where debit is not null and (debit <> trunc(debit, 2) or abs(debit) > 999999999999.99)
       or credit is not null and (credit <> trunc(credit, 2) or abs(credit) > 999999999999.99)
  ) then
    raise exception 'cannot narrow GL debit/credit: rows exceed numeric(14,2) precision' using errcode = '22003';
  end if;
end;
$$;

drop index if exists public.erp_gl_entry_mirror_org_company_date_account_idx;
drop index if exists public.erp_gl_entry_mirror_org_company_id_idx;
alter table public.erp_gl_entry_mirror
  alter column debit type numeric(14,2) using debit::numeric(14,2),
  alter column credit type numeric(14,2) using credit::numeric(14,2);
alter table public.erp_gl_entry_mirror
  drop column if exists finance_book,
  drop column if exists is_opening,
  drop column if exists company;
