-- Rollback 2800_vendor_payment_terms_check.sql — drops the payment-terms sanity bound.
alter table public.companies
  drop constraint if exists companies_payment_terms_days_sane;
