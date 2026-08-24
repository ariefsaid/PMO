-- sales_invoice_tax_treatment.test.sql — 0188_sales_invoice_tax_treatment.sql
-- (DD-XING-4(2) / #478 part B). Owns AC-TAX-001..011; `grep -r AC-TAX-` finds exactly this file.
--
-- The point of the migration under test is that a PMO-authored sales invoice can no longer be saved
-- in a state from which an ERPNext tax treatment cannot be reconstructed. The irrecoverable fact is
-- `tax_treatment` — whether this row's `amount` already includes `tax_amount` — so the assertions
-- that matter are the ones proving it CANNOT be absent, CANNOT be a value outside the two-value
-- domain, and CANNOT be silently defaulted.
begin;
select plan(16);

insert into organizations (id, name, default_currency) values
  ('04880000-0000-0000-0000-000000000001','#478 Tax Org','IDR');
insert into auth.users (id, email) values
  ('04880000-0000-0000-0000-0000000000a1','tax-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04880000-0000-0000-0000-0000000000a1','04880000-0000-0000-0000-000000000001','Tax Admin','tax-admin@example.com','Admin','active');
insert into companies (id, org_id, name, type) values
  ('04880000-0000-0000-0000-0000000000f1','04880000-0000-0000-0000-000000000001','#478 Tax Customer','Client');

-- ── §A — shape: NOT NULL and NO DEFAULT. A DEFAULT would be exactly the "silent value that could be
--    wrong in either direction" this slice exists to forbid. ───────────────────────────────────────
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_invoices'
      and column_name in ('tax_treatment','tax_amount') and is_nullable = 'NO'),
  2::bigint,
  'AC-TAX-001 sales_invoices.tax_treatment and .tax_amount are both NOT NULL');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_invoices'
      and column_name in ('tax_treatment','tax_amount','tax_rate','tax_template')
      and column_default is not null),
  0::bigint,
  'AC-TAX-002 none of the four tax columns carries a DEFAULT — an omitted treatment must FAIL, '
  'never quietly become one of the two answers');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'sales_invoices'
      and column_name in ('tax_rate','tax_template') and is_nullable = 'YES'),
  2::bigint,
  'AC-TAX-003 tax_rate and tax_template are NULLABLE by decision — a mirrored ERP invoice keeps its '
  'rate on the taxes child table and a standalone org has no ERPNext template');

-- ── §B — the marker cannot be absent, and cannot be anything but the two answers. ────────────────
select throws_ok(
  $$ insert into sales_invoices (org_id, customer_id, amount, tax_amount)
       values ('04880000-0000-0000-0000-000000000001','04880000-0000-0000-0000-0000000000f1',1000.00, 0) $$,
  '23502',
  null,
  'AC-TAX-004 an invoice with NO tax_treatment is refused (not-null violation) — the ambiguous row '
  'that #478 exists to make unsaveable');

select throws_ok(
  $$ insert into sales_invoices (org_id, customer_id, amount, tax_amount, tax_treatment)
       values ('04880000-0000-0000-0000-000000000001','04880000-0000-0000-0000-0000000000f1',1000.00, 0, 'unknown') $$,
  '23514',
  null,
  'AC-TAX-005 tax_treatment outside {inclusive, exclusive} is refused — no third "we do not know" state');

select throws_ok(
  $$ insert into sales_invoices (org_id, customer_id, amount, tax_treatment)
       values ('04880000-0000-0000-0000-000000000001','04880000-0000-0000-0000-0000000000f1',1000.00,'exclusive') $$,
  '23502',
  null,
  'AC-TAX-006 an invoice with no tax_amount is refused — the split is never inferred from the total');

-- Both answers are genuinely storable, and round-trip.
insert into sales_invoices (id, org_id, customer_id, amount, tax_treatment, tax_amount, tax_rate, tax_template)
values ('04880000-0000-0000-0000-0000000000e1','04880000-0000-0000-0000-000000000001',
        '04880000-0000-0000-0000-0000000000f1',1000.00,'exclusive',110.00,11.000,'Indonesia PPN 11% - RIS');
insert into sales_invoices (id, org_id, customer_id, amount, tax_treatment, tax_amount)
values ('04880000-0000-0000-0000-0000000000e2','04880000-0000-0000-0000-000000000001',
        '04880000-0000-0000-0000-0000000000f1',1110.00,'inclusive',110.00);
select is(
  (select string_agg(tax_treatment, ',' order by id) from sales_invoices
     where org_id = '04880000-0000-0000-0000-000000000001'),
  'exclusive,inclusive',
  'AC-TAX-007 both markers are storable and round-trip verbatim');

-- The reconstruction the whole slice is for: net and gross are determinable from (amount, tax_amount,
-- tax_treatment) alone, and the two rows above describe the SAME invoice under the two conventions.
select is(
  (select count(distinct net || '/' || gross) from (
     select case when tax_treatment = 'inclusive' then amount - tax_amount else amount end as net,
            case when tax_treatment = 'inclusive' then amount else amount + tax_amount end as gross
       from sales_invoices where org_id = '04880000-0000-0000-0000-000000000001') s),
  1::bigint,
  'AC-TAX-008 the inclusive and exclusive rows reconstruct to the SAME net/gross pair — the marker '
  'is what makes `amount` interpretable at all');

-- ── §C — bounds. `>= 0` alone does NOT reject NaN (Postgres orders numeric NaN above every ordinary
--    value, so 'NaN' >= 0 is TRUE and PostgREST coerces the JSON string "NaN" straight in) — the
--    upper bound is what closes it. Same hole 0169 closed for contract_value. ────────────────────
select throws_ok(
  $$ insert into sales_invoices (org_id, customer_id, amount, tax_treatment, tax_amount)
       values ('04880000-0000-0000-0000-000000000001','04880000-0000-0000-0000-0000000000f1',1000.00,'exclusive','NaN') $$,
  '23514',
  null,
  'AC-TAX-009 tax_amount = NaN is refused — `>= 0` alone would have let it through (0169''s lesson)');

select throws_ok(
  $$ insert into sales_invoices (org_id, customer_id, amount, tax_treatment, tax_amount)
       values ('04880000-0000-0000-0000-000000000001','04880000-0000-0000-0000-0000000000f1',1000.00,'exclusive',-1) $$,
  '23514',
  null,
  'AC-TAX-010 a negative tax_amount is refused');

select throws_ok(
  $$ insert into sales_invoices (org_id, customer_id, amount, tax_treatment, tax_amount, tax_rate)
       values ('04880000-0000-0000-0000-000000000001','04880000-0000-0000-0000-0000000000f1',1000.00,'exclusive',0,'NaN') $$,
  '23514',
  null,
  'AC-TAX-011 tax_rate = NaN is refused');

select throws_ok(
  $$ insert into sales_invoices (org_id, customer_id, amount, tax_treatment, tax_amount, tax_rate)
       values ('04880000-0000-0000-0000-000000000001','04880000-0000-0000-0000-0000000000f1',1000.00,'exclusive',0,101) $$,
  '23514',
  null,
  'AC-TAX-012 a tax_rate above 100% is refused');

-- ── §D — grants: the four columns are insertable by the native author (sales_invoices INSERT is
--    column-level since 0176, so a new column needs an explicit grant) and updatable by nobody. ──
select is(
  (select bool_and(has_column_privilege('authenticated','public.sales_invoices',c,'INSERT'))
     from unnest(array['tax_treatment','tax_amount','tax_rate','tax_template']) c),
  true,
  'AC-TAX-013 authenticated may INSERT all four tax columns — the native author states its own treatment');
select is(
  (select bool_or(has_column_privilege('authenticated','public.sales_invoices',c,'UPDATE'))
     from unnest(array['tax_treatment','tax_amount','tax_rate','tax_template']) c),
  false,
  'AC-TAX-014 authenticated may UPDATE none of them — 0176 left this table with no client UPDATE '
  'grant and the tax columns are not the exception that re-opens it');

-- ── §E — the tax columns are inside sales_invoices_native_mirror_guard's denial set (0189). A column
--    added AFTER a guard was written is simply absent from its enumerated list and therefore
--    user-writable while the money it describes is owned by ERPNext — exactly how `author_user_id`
--    shipped unpinned (0124 after 0123) and had to be closed by 0125. Run as the table OWNER so the
--    column-grant layer cannot mask the guard; the guard reads the JWT `role` claim, which says
--    `authenticated`, not `service_role`.
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('04880000-0000-0000-0000-000000000001','erpnext','revenue');
set local request.jwt.claims = '{"sub":"04880000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ update sales_invoices set tax_treatment = 'inclusive' where id = '04880000-0000-0000-0000-0000000000e1' $$,
  '42501',
  'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-TAX-015 the mirror guard pins tax_treatment while revenue is externally-owned');
select throws_ok(
  $$ update sales_invoices set tax_amount = 0 where id = '04880000-0000-0000-0000-0000000000e1' $$,
  '42501',
  'sales_invoices native fields are read-only while revenue is externally-owned',
  'AC-TAX-016 the mirror guard pins tax_amount while revenue is externally-owned');
reset request.jwt.claims;

select finish();
rollback;
