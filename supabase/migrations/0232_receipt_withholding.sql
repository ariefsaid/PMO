-- #762. Reversal: restore the incoming-payment guard from0189, then drop these columns/trigger/function.
-- Existing receipt money remains unchanged; absent historical withholding is unknown.
alter table public.organizations add column tax_prepaid_account text
  check (tax_prepaid_account is null or (length(btrim(tax_prepaid_account)) between 1 and 140));
grant update(tax_prepaid_account) on public.organizations to authenticated;
-- The existing active-member, own-org, Admin-only organization UPDATE policy applies.
alter table public.incoming_payments
  add column received_amount numeric(14,2) check (received_amount >= 0),
  add column withheld_amount numeric(14,2) check (withheld_amount >= 0),
  add column withholding_slip_number text,
  add constraint incoming_payments_withholding_balance check
    (withheld_amount is null or withheld_amount = 0 or
      (amount is not null and received_amount is not null and received_amount + withheld_amount = amount)),
  add constraint incoming_payments_withholding_slip check
    (withheld_amount is null or withheld_amount = 0 or
      (withholding_slip_number is not null and length(btrim(withholding_slip_number)) between 1 and 140));

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
create trigger organizations_audit_withholding_account after update on public.organizations
  for each row execute function public.audit_org_withholding_account();

create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.received_amount is distinct from old.received_amount
     or new.withheld_amount is distinct from old.withheld_amount
     or new.withholding_slip_number is distinct from old.withholding_slip_number
     or new.currency is distinct from old.currency               -- 0187 (#478)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
