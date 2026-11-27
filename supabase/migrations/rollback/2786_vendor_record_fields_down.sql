-- Rollback 2786_vendor_record_fields.sql — drops the three PMO-native vendor columns.
alter table public.companies
  drop column if exists vendor_code,
  drop column if exists address,
  drop column if exists payment_terms_days;
