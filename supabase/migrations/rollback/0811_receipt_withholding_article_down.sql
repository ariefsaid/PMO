-- Rollback of 0811 (#1275). Revert the S1 dispatch (article account resolution + mirror stamp) BEFORE running this.
-- Existing receipt money is untouched; the article columns and the per-article accounts are dropped.
create or replace function public.audit_org_withholding_account() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.tax_prepaid_account is distinct from old.tax_prepaid_account then
    perform public.log_audit('org.withholding_account.change',new.id,auth.uid(),new.id,
      jsonb_build_object('from',old.tax_prepaid_account,'to',new.tax_prepaid_account));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_withholding_account() from public,anon,authenticated;

create or replace function public.audit_incoming_payment_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('incoming_payment.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',                  new.status,
                                              'amount',                  new.amount,
                                              'ip_number',               new.ip_number,
                                              'sales_invoice_id',        new.sales_invoice_id,
                                              'received_amount',         new.received_amount,
                                              'withheld_amount',         new.withheld_amount,
                                              'withholding_slip_number', new.withholding_slip_number));
  return new;
end; $$;

revoke update(pph23_prepaid_account, pph4_2_prepaid_account) on public.organizations from authenticated;
revoke insert(receipt_withholding_article), update(receipt_withholding_article) on public.projects from authenticated;
alter table public.organizations drop column pph23_prepaid_account, drop column pph4_2_prepaid_account;
alter table public.incoming_payments drop column withholding_article;
alter table public.projects drop column receipt_withholding_article;
