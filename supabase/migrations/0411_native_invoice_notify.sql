-- 0411_native_invoice_notify.sql — #1595 (AC-AIN-NAT-002): a PMO customer invoice raised as a Draft waits for an
-- approver, so tell them. Same shape as 0237's hand-offs (notify_workflow_user: active same-org member, never the actor).
--   • sales_invoices INSERT, pmo_native, status 'Draft' → every active Admin / Finance except the author
-- ⚑ MIRRORS the approver arm of public.transition_native_sales_invoice (0275 §4): Admin or Finance, not the author.
--   A change there MUST change this list too. ERP-path drafts (pmo_native = false) are approved in the ERP: no row here.
-- Rollback: supabase/migrations/rollback/0411_native_invoice_notify_down.sql.

create or replace function public.notify_native_invoice_draft() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_customer text;
begin
  if not new.pmo_native or new.status is distinct from 'Draft' then return new; end if;
  select c.name into v_customer from public.companies c where c.id = new.customer_id;
  for r in select p.id from public.profiles p
            where p.org_id = new.org_id
              and p.role in ('Admin','Finance')
              and p.id is distinct from new.author_user_id
  loop
    perform public.notify_workflow_user(new.org_id, r.id, 'Customer invoice awaiting your approval',
      v_customer, 'info', 'sales_invoice', new.id, v_customer);
  end loop;
  return new;
end; $$;
revoke execute on function public.notify_native_invoice_draft() from public, anon, authenticated;
create trigger sales_invoices_notify_native_draft_trg
  after insert on public.sales_invoices
  for each row execute function public.notify_native_invoice_draft();
