-- 0811 — #1275: receipt withholding by tax article (DD-WHA-1..7).
-- §1 organizations: one prepaid account per article, 0232's precedent (column UPDATE grant + Admin-only org UPDATE
--    policy, audited). tax_prepaid_account stays the default account.
-- §2 incoming_payments.withholding_article: the article the client withheld under; null = not stated. Not
--    client-writable (0178 revoked insert/update); written by the service-role mirror on a PMO-originated create.
--    No pairing CHECK with withheld_amount (0273 §5a).
-- §3 projects.receipt_withholding_article: the receipt form's pre-fill only; no write path reads it (DD-VWH-19).
-- §4 the org account audit names the changed column; the receipt create audit records the article.
-- Rollback: supabase/migrations/rollback/0811_receipt_withholding_article_down.sql (revert the S1 dispatch first).

alter table public.organizations
  add column pph23_prepaid_account text
    check (pph23_prepaid_account is null or length(btrim(pph23_prepaid_account)) between 1 and 140),
  add column pph4_2_prepaid_account text
    check (pph4_2_prepaid_account is null or length(btrim(pph4_2_prepaid_account)) between 1 and 140);
grant update(pph23_prepaid_account, pph4_2_prepaid_account) on public.organizations to authenticated;

alter table public.incoming_payments
  add column withholding_article text check (withholding_article is null or withholding_article in ('pph23','pph4_2'));

alter table public.projects
  add column receipt_withholding_article text
    check (receipt_withholding_article is null or receipt_withholding_article in ('pph23','pph4_2'));
grant insert(receipt_withholding_article), update(receipt_withholding_article) on public.projects to authenticated;

-- Change-capture registry (AC-CHG-011): a user-editable project field, so captured (SELECT is table-wide).
update public.record_history_config
   set captured = captured || '{"receipt_withholding_article":"enum"}'::jsonb
 where entity_type = 'project'
   and not (captured ? 'receipt_withholding_article');

create or replace function public.audit_org_withholding_account() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.tax_prepaid_account is distinct from old.tax_prepaid_account then
    perform public.log_audit('org.withholding_account.change',new.id,auth.uid(),new.id,
      jsonb_build_object('from',old.tax_prepaid_account,'to',new.tax_prepaid_account));
  end if;
  if new.pph23_prepaid_account is distinct from old.pph23_prepaid_account then
    perform public.log_audit('org.withholding_account.change',new.id,auth.uid(),new.id,
      jsonb_build_object('column','pph23_prepaid_account','from',old.pph23_prepaid_account,'to',new.pph23_prepaid_account));
  end if;
  if new.pph4_2_prepaid_account is distinct from old.pph4_2_prepaid_account then
    perform public.log_audit('org.withholding_account.change',new.id,auth.uid(),new.id,
      jsonb_build_object('column','pph4_2_prepaid_account','from',old.pph4_2_prepaid_account,'to',new.pph4_2_prepaid_account));
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
                                              'withholding_slip_number', new.withholding_slip_number,
                                              'withholding_article',     new.withholding_article));
  return new;
end; $$;

-- On-database asserts (hosted grant defaults differ from local Docker).
do $$ begin
  if has_column_privilege('authenticated','public.incoming_payments','withholding_article','UPDATE')
     or has_column_privilege('authenticated','public.incoming_payments','withholding_article','INSERT') then
    raise exception '0811: incoming_payments.withholding_article must not be client-writable';
  end if;
end $$;
