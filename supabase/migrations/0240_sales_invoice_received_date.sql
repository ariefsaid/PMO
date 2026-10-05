-- #767: the client's RECEIPT date drives the invoice due date (AC-DUE-001..003).
-- Reversal: supabase/migrations/rollback/0240_sales_invoice_received_date_down.sql.
--
-- `received_date`  — PMO-recorded date the client received the invoice (nullable). Never before the
--                    invoice date. Written ONLY through set_sales_invoice_received_date() below:
--                    `authenticated` holds no UPDATE grant on sales_invoices (0176), and receipt is
--                    learned after submission, so a narrow RPC is the one path for both states.
-- `erp_due_date`   — ERP's own due_date, mirrored read-only (service-role mirror writer only).

alter table public.sales_invoices
  add column received_date date,
  add column erp_due_date date,
  add constraint sales_invoices_received_after_invoice
    check (received_date is null or invoice_date is null or received_date >= invoice_date);

-- Insert grant is column-level (0176): received_date / erp_due_date are deliberately NOT granted.

create or replace function public.set_sales_invoice_received_date(p_si_id uuid, p_received_date date)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row public.sales_invoices;
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  -- Org comes from the row; same revenue write set as submit/cancel (Admin + Finance); offboarded
  -- members refused (0130).
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status = 'Cancelled' then
    raise exception 'cannot record a receipt date on a cancelled invoice' using errcode = '23514';
  end if;
  update public.sales_invoices set received_date = p_received_date where id = p_si_id
    returning * into v_row;
  return v_row;
end; $$;

revoke all on function public.set_sales_invoice_received_date(uuid, date) from public, anon;
grant execute on function public.set_sales_invoice_received_date(uuid, date) to authenticated;

comment on function public.set_sales_invoice_received_date(uuid, date) is
  '#767: records (or clears, with NULL) the date the client received the invoice. Admin/Finance, any non-cancelled state.';
