-- Rollback 2786_vendor_record_fields.sql — drops the three PMO-native vendor columns and
-- removes them from the record-change history catalogue.
update public.record_history_config
  set captured = captured - 'vendor_code' - 'address' - 'payment_terms_days'
  where table_name = 'companies';

alter table public.companies
  drop column if exists vendor_code,
  drop column if exists address,
  drop column if exists payment_terms_days;
