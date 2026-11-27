-- 2786_vendor_record_fields.sql — #3025 slice 1 (AC-3025): a vendor record holds a code, an
-- address and payment terms natively.
--
-- Before this migration `companies` carried only name/type/short_name natively (plus the ERP
-- mirror columns a native create/edit never wrote), so an organisation without an accounting
-- connection could load its vendor master by name only — addresses, vendor codes and payment
-- terms stayed in a spreadsheet. These three PMO-native columns close that for everything except
-- the tax number, which is sensitive and lands on its own branch (2788) with its own read rule.
--
-- They are deliberately plain, nullable columns (the 0226 short_name precedent): the directory
-- carries table-level column grants (0075) under the four-role write policy, and 0273 ruled
-- column-grant conversion out for this table. No RLS or policy changes: reads and writes keep
-- the exact grants and policies every other companies column has.
--
-- Proof: supabase/tests/vendor_record_fields.test.sql (columns present, the write-role gate and
-- the second-organisation read refusal unchanged).
-- Rollback: supabase/migrations/rollback/2786_vendor_record_fields_down.sql

alter table public.companies
  add column vendor_code text,
  add column address text,
  add column payment_terms_days int;

-- The record-change history catalogue (0260) captures a fixed column set per table: the three
-- new columns join `captured` so a vendor edit's before/after shows them (the int renders as
-- the 0260 `number` kind).
update public.record_history_config
  set captured = captured || '{"vendor_code":"text","address":"text","payment_terms_days":"number"}'::jsonb
  where table_name = 'companies';

comment on column public.companies.vendor_code is
  '#3025: the buyer''s own vendor/supplier code for the record, kept in PMO natively (not the ERP mirror).';
comment on column public.companies.address is
  '#3025: the vendor''s address, kept in PMO natively.';
comment on column public.companies.payment_terms_days is
  '#3025: agreed payment terms in days, kept in PMO natively (not the ERP mirror column erp_payment_terms_days).';
