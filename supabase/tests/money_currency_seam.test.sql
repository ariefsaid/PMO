-- money_currency_seam.test.sql — 0187_money_currency_seam.sql (OD-CR-5 / DD-XING-4(1) / #478 part A).
--
-- Owns AC-CUR-001..010. No spec file owns this slice (#478 graduated straight from the crossing grill),
-- so the AC ids are introduced here and referenced from the migration header — `grep -r AC-CUR-` finds
-- exactly this file.
--
-- ⚑ The load-bearing assertion is AC-CUR-004: BEFORE-row triggers fire in ALPHABETICAL ORDER of
-- trigger name, so `<tbl>_zz_stamp_currency` must sort AFTER `<tbl>_stamp_org_id` or the currency is
-- resolved against the SEED org instead of the caller's real org. Rename the trigger to anything that
-- sorts earlier and AC-CUR-004 goes red.
begin;
select plan(13);

-- ── Fixtures: two orgs with DIFFERENT currencies, so "stamped from the row's own org" cannot pass
--    by accidentally agreeing with the seed org's USD. ────────────────────────────────────────────
insert into organizations (id, name, default_currency) values
  ('04780000-0000-0000-0000-000000000001','#478 Org EUR','EUR'),
  ('04780000-0000-0000-0000-000000000002','#478 Org JPY (flipped revenue+procurement)','JPY');
insert into auth.users (id, email) values
  ('04780000-0000-0000-0000-0000000000a1','cur-eur@example.com'),
  ('04780000-0000-0000-0000-0000000000a2','cur-jpy@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04780000-0000-0000-0000-0000000000a1','04780000-0000-0000-0000-000000000001','EUR Admin','cur-eur@example.com','Admin','active'),
  ('04780000-0000-0000-0000-0000000000a2','04780000-0000-0000-0000-000000000002','JPY Admin','cur-jpy@example.com','Admin','active');
insert into companies (id, org_id, name, type) values
  ('04780000-0000-0000-0000-0000000000f1','04780000-0000-0000-0000-000000000001','#478 Customer','Client'),
  ('04780000-0000-0000-0000-0000000000f2','04780000-0000-0000-0000-000000000002','#478 Vendor','Vendor');

-- ── §A — the column exists, NOT NULL, on every one of the 12 enumerated money tables, and none of
--    them carries a column DEFAULT (the value comes from the trigger, never a constant). ──────────
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'currency' and is_nullable = 'NO'
      and table_name in ('projects','procurements','procurement_quotations','budget_versions',
        'budget_projections','purchase_requests','rfqs','purchase_orders','payments',
        'procurement_invoices','sales_invoices','incoming_payments')),
  12::bigint,
  'AC-CUR-001 every one of the 12 PMO-owned money tables has a NOT NULL `currency` column');

-- The column DEFAULT is the 'XXX' SENTINEL and nothing else. It exists so a NOT NULL column stays
-- OPTIONAL on `Insert` (Supabase typegen would otherwise force every DAL write path to hand-carry a
-- currency — the exact client-threading OD-CR-5's trigger removes), and 'XXX' is ISO-4217's own "no
-- currency" code, so overriding it can never clobber a deliberately-stated one. If this assertion
-- ever reads a plausible currency like 'USD', the sentinel has become a silent wrong answer.
select is(
  (select array_agg(distinct column_default::text order by column_default::text) from information_schema.columns
    where table_schema = 'public' and column_name = 'currency'
      and table_name in ('projects','procurements','procurement_quotations','budget_versions',
        'budget_projections','purchase_requests','rfqs','purchase_orders','payments',
        'procurement_invoices','sales_invoices','incoming_payments')),
  array['''XXX''::text'],
  'AC-CUR-002 the only column DEFAULT on `currency` is the ''XXX'' sentinel the trigger overrides');

-- …and it never reaches a stored row. The trigger treats 'XXX' as "the caller stated nothing" (0074's
-- rule verbatim) and resolves the org's real currency; the CHECK is the failsafe behind it, so a row
-- whose org the trigger could NOT resolve fails loudly (23514) instead of storing a currency-less
-- money row. Drop either half and this goes red: without the trigger clause the row stores 'XXX'
-- and the CHECK raises; without the CHECK a resolution failure stores 'XXX' silently.
insert into projects (id, org_id, name, status, currency) values
  ('04780000-0000-0000-0000-0000000000c3','04780000-0000-0000-0000-000000000001','#478 Sentinel Project','Ongoing Project','XXX');
select is(
  (select currency from projects where id = '04780000-0000-0000-0000-0000000000c3'),
  'EUR',
  'AC-CUR-002b the ''XXX'' sentinel never reaches a stored row — it resolves to the org currency');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations'
      and column_name = 'default_currency' and is_nullable = 'NO'),
  1::bigint,
  'AC-CUR-003 organizations.default_currency exists and is NOT NULL');

-- ── §B — the stamp: an owner/service insert (auth_org_id() null, stamp_org_id no-ops) resolves the
--    currency from the ROW's org, not from a global constant. ───────────────────────────────────
insert into projects (id, org_id, name, status) values
  ('04780000-0000-0000-0000-0000000000c1','04780000-0000-0000-0000-000000000001','#478 EUR Project','Ongoing Project');
select is(
  (select currency from projects where id = '04780000-0000-0000-0000-0000000000c1'),
  'EUR',
  'AC-CUR-004a an unstated currency is stamped from the row org''s default_currency (EUR), not USD');

-- An explicitly-supplied currency is left alone (the multi-currency seam OD-CR-5 asks to architect
-- for, and what DD-IMP-1's import descriptor sets).
insert into projects (id, org_id, name, status, currency) values
  ('04780000-0000-0000-0000-0000000000c2','04780000-0000-0000-0000-000000000001','#478 SGD Project','Ongoing Project','SGD');
select is(
  (select currency from projects where id = '04780000-0000-0000-0000-0000000000c2'),
  'SGD',
  'AC-CUR-005 an explicitly-supplied currency is preserved, never overwritten by the org default');

-- Shape: ISO-4217 alpha-3 only.
select throws_ok(
  $$ insert into projects (org_id, name, status, currency)
       values ('04780000-0000-0000-0000-000000000001','#478 Bad Currency','Ongoing Project','usd') $$,
  '23514',
  null,
  'AC-CUR-006 a non-ISO-4217 currency ("usd") is rejected by the CHECK');

-- ── §C — ⚑ TRIGGER ORDER. A non-seed-org AUTHENTICATED insert that relies on the org_id column
--    DEFAULT (the seed org) must end up with the caller's OWN org currency. This passes only if
--    stamp_currency runs AFTER stamp_org_id. ────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"04780000-0000-0000-0000-0000000000a2","role":"authenticated"}';
insert into sales_invoices (id, amount, invoice_date, tax_treatment, tax_amount)
  values ('04780000-0000-0000-0000-0000000000e1', 100.00, '2026-08-19', 'exclusive', 11.00);
reset role;
reset request.jwt.claims;
select is(
  (select currency from sales_invoices where id = '04780000-0000-0000-0000-0000000000e1'),
  'JPY',
  'AC-CUR-004b a non-seed-org authenticated insert is stamped with THAT org''s currency (JPY) — '
  'stamp_currency fires AFTER stamp_org_id');

-- ── §D — grant posture. has_column_privilege is TRUE under a table-level grant too, so these three
--    together pin the real shape: insertable where the client authors, never updatable, and not
--    granted at all on the RPC-only tables. ───────────────────────────────────────────────────────
select is(has_column_privilege('authenticated','public.sales_invoices','currency','INSERT'), true,
  'AC-CUR-007 authenticated may INSERT sales_invoices.currency (a column-level grant was required)');
select is(has_column_privilege('authenticated','public.sales_invoices','currency','UPDATE'), false,
  'AC-CUR-008 authenticated may NOT UPDATE sales_invoices.currency — no re-denominating a money row');
select is(has_column_privilege('authenticated','public.payments','currency','INSERT'), false,
  'AC-CUR-009 payments.currency gets no client INSERT grant — that table writes through its RPC only');

-- ── §E — `currency` is inside the *_native_mirror_guard denial set. Flip both domains for the JPY
--    org, then attempt a NON-service-role currency change. Run as the table OWNER so the column-grant
--    layer cannot mask the guard (sales_invoices has no client UPDATE grant at all, 0176) — the JWT
--    claims are what the guard reads, and they say `authenticated`, not `service_role`. ───────────
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('04780000-0000-0000-0000-000000000002','erpnext','revenue'),
  ('04780000-0000-0000-0000-000000000002','erpnext','procurement');

insert into procurements (id, org_id, title, status) values
  ('04780000-0000-0000-0000-0000000000d1','04780000-0000-0000-0000-000000000002','#478 Case','Draft');
insert into payments (id, org_id, procurement_id, pay_number, date, amount, status) values
  ('04780000-0000-0000-0000-0000000000d2','04780000-0000-0000-0000-000000000002',
   '04780000-0000-0000-0000-0000000000d1','PAY-478-001','2026-08-19',50.00,'Scheduled');

set local request.jwt.claims = '{"sub":"04780000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ update sales_invoices set currency = 'USD' where id = '04780000-0000-0000-0000-0000000000e1' $$,
  '42501',
  'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-CUR-010a sales_invoices_native_mirror_guard pins `currency` while revenue is externally-owned');
select throws_ok(
  $$ update payments set currency = 'USD' where id = '04780000-0000-0000-0000-0000000000d2' $$,
  '42501',
  'payments native fields are read-only while procurement is externally-owned',
  'AC-CUR-010b payments_native_mirror_guard pins `currency` while procurement is externally-owned');
reset request.jwt.claims;

select finish();
rollback;
