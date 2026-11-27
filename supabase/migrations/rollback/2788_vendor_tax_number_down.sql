-- Rollback 2788_vendor_tax_number.sql — removes the vendor tax-number side table.
drop table if exists public.company_tax_numbers cascade;
drop function if exists public.stamp_company_tax_number();
