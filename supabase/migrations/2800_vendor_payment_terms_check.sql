-- 2800_vendor_payment_terms_check.sql — #3025 review should-fix: the PMO-native
-- payment_terms_days column (2786) carries its own sanity bound.
--
-- Payment terms are a whole number of days in a sane range: an int column cannot hold fractions,
-- so the rule is "null (unset) or 0..365". Every existing row is null, so the constraint is safe
-- to add in place; future writes beyond the bound are refused with the constraint's 23514.
-- The form enforces the same bound before the round trip (companies.form.paymentTermsDays).
--
-- Proof: supabase/tests/vendor_payment_terms_check.test.sql (bounds accepted, out-of-range and
-- negative refused).
-- Rollback: supabase/migrations/rollback/2800_vendor_payment_terms_check_down.sql

alter table public.companies
  add constraint companies_payment_terms_days_sane
  check (payment_terms_days is null or (payment_terms_days >= 0 and payment_terms_days <= 365));
