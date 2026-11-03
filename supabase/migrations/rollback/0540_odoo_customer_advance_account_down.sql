-- Reverses 0540_odoo_customer_advance_account.sql. The binding config keeps its last choice as unused data.
do $$
begin
  if exists (
    select 1 from public.sales_invoices where odoo_attention = 'advance-account-mismatch'
  ) then
    raise exception 'sales invoices carry the C4 attention state; rollback refused to preserve invoice review data'
      using errcode = '55000';
  end if;
end $$;

alter table public.sales_invoices
  drop constraint sales_invoices_odoo_attention_check,
  add constraint sales_invoices_odoo_attention_check check (
    odoo_attention in ('total-mismatch', 'cost-account-missing', 'money-unreadable', 'lines-unreadable')
  );

drop function if exists public.set_odoo_customer_advance_account(uuid,uuid,text);
