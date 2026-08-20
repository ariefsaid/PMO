-- vendor_invoice_tax_treatment.test.sql — 0196_vendor_invoice_tax_treatment.sql (#505).
-- Owns AC-VTAX-001..025; `grep -r AC-VTAX-` finds exactly this file.
--
-- The migration under test exists so a vendor invoice can no longer be recorded in a state from
-- which an input-PPN treatment cannot be reconstructed. The irrecoverable fact is `tax_treatment` —
-- whether this row's `amount` already includes `tax_amount` — so the assertions that matter are the
-- ones proving it CANNOT be absent, CANNOT be a third value, and CANNOT be silently defaulted.
--
-- ⚑ Where this file DIVERGES from its sales-invoice twin (`sales_invoice_tax_treatment.test.sql`):
-- 0188 had to grant the four columns because `sales_invoices` still holds a column-level INSERT
-- grant. `procurement_invoices` has none — 0174 revoked INSERT and 0175 revoked UPDATE with no
-- re-grant — so §D asserts the opposite: the door those two migrations closed is STILL closed, and
-- the treatment enters through the definer RPC. §F is therefore the real front door, and it is
-- tested as such.
begin;
select plan(25);

insert into organizations (id, name, default_currency) values
  ('05050000-0000-0000-0000-000000000001','#505 VI Tax Org','IDR');
insert into auth.users (id, email) values
  ('05050000-0000-0000-0000-0000000000a1','vtax-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('05050000-0000-0000-0000-0000000000a1','05050000-0000-0000-0000-000000000001',
   'VTax Finance','vtax-fin@example.com','Finance','active');
insert into companies (id, org_id, name, type) values
  ('05050000-0000-0000-0000-0000000000c2','05050000-0000-0000-0000-000000000001','#505 Vendor','Vendor');
insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('05050000-0000-0000-0000-0000000000d1','05050000-0000-0000-0000-000000000001','#505 case','Vendor Quoted',
   '05050000-0000-0000-0000-0000000000a1','05050000-0000-0000-0000-0000000000c2'),
  ('05050000-0000-0000-0000-0000000000d2','05050000-0000-0000-0000-000000000001','#505 capture case','Received',
   '05050000-0000-0000-0000-0000000000a1', null);

-- ── §A — shape: NOT NULL and NO DEFAULT. A DEFAULT is exactly the "silent value that could be wrong
--    in either direction" this slice exists to forbid. ─────────────────────────────────────────────
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'procurement_invoices'
      and column_name in ('tax_treatment','tax_amount') and is_nullable = 'NO'),
  2::bigint,
  'AC-VTAX-001 procurement_invoices.tax_treatment and .tax_amount are both NOT NULL');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'procurement_invoices'
      and column_name in ('tax_treatment','tax_amount','tax_rate','tax_template')
      and column_default is not null),
  0::bigint,
  'AC-VTAX-002 none of the four tax columns carries a DEFAULT — an omitted treatment must FAIL, '
  'never quietly become one of the two answers');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'procurement_invoices'
      and column_name in ('tax_rate','tax_template') and is_nullable = 'YES'),
  2::bigint,
  'AC-VTAX-003 tax_rate and tax_template are NULLABLE by decision — a mirrored ERP invoice keeps its '
  'rate on the taxes child table and a standalone org has no ERPNext template');

-- ── §B — the marker cannot be absent, and cannot be anything but the two answers. ────────────────
select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_amount)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 0) $$,
  '23502',
  null,
  'AC-VTAX-004 an invoice with NO tax_treatment is refused (not-null violation) — the ambiguous row '
  'cannot be written at all');

select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 'unknown', 0) $$,
  '23514',
  null,
  'AC-VTAX-005 tax_treatment outside {inclusive, exclusive} is refused — no third "we do not know" state');

select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 'exclusive') $$,
  '23502',
  null,
  'AC-VTAX-006 an invoice with no tax_amount is refused — the split is never inferred from the total');

-- Both markers store and round-trip, and they describe DIFFERENT arithmetic on the same figures.
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, tax_rate)
values
  ('05050000-0000-0000-0000-00000000e001','05050000-0000-0000-0000-000000000001',
   '05050000-0000-0000-0000-0000000000d1','Received','2026-03-02', 1110, 'inclusive', 110, 11.000),
  ('05050000-0000-0000-0000-00000000e002','05050000-0000-0000-0000-000000000001',
   '05050000-0000-0000-0000-0000000000d1','Received','2026-03-02', 1000, 'exclusive', 110, 11.000);

select is(
  (select string_agg(tax_treatment, '/' order by tax_treatment)
     from procurement_invoices where id in
     ('05050000-0000-0000-0000-00000000e001','05050000-0000-0000-0000-00000000e002')),
  'exclusive/inclusive',
  'AC-VTAX-007 both markers are storable and round-trip verbatim');

select is(
  (select string_agg(
       (case when tax_treatment = 'inclusive' then amount - tax_amount else amount end)::text
       || ':' ||
       (case when tax_treatment = 'inclusive' then amount else amount + tax_amount end)::text,
       ' ' order by id)
     from procurement_invoices where id in
     ('05050000-0000-0000-0000-00000000e001','05050000-0000-0000-0000-00000000e002')),
  '1000.00:1110.00 1000.00:1110.00',
  'AC-VTAX-008 the inclusive and exclusive rows reconstruct to the SAME net/gross pair — the marker '
  'is the only thing that makes two different stored totals mean the same money');

-- ── §C — bounds. `>= 0` alone does NOT reject NaN (Postgres orders numeric NaN above every ordinary
--    value), so the upper bound is what actually rejects it. 0169's lesson, 0188's construction. ──
select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 'exclusive', 'NaN'::numeric) $$,
  '23514',
  null,
  'AC-VTAX-009 tax_amount = NaN is refused — `>= 0` alone would have let it through (0169''s lesson)');

select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 'exclusive', -1) $$,
  '23514', null, 'AC-VTAX-010 a negative tax_amount is refused');

select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, tax_rate)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 'exclusive', 0, 'NaN'::numeric) $$,
  '23514', null, 'AC-VTAX-011 tax_rate = NaN is refused');

select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, tax_rate)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 'exclusive', 0, 101) $$,
  '23514', null, 'AC-VTAX-012 a tax_rate above 100% is refused');

-- ── §D — grants. THE DIVERGENCE FROM 0188: this table has no client write grant at all, and the new
--    columns must not become the exception that re-opens the door 0174/0175 shut. ─────────────────
-- ⚑ `has_*_privilege`, NOT information_schema. Those views only expose grants where the current role
-- is grantor or grantee, so on hosted Supabase a grant made by `supabase_admin` is INVISIBLE to
-- `postgres` and the assertion would pass while the door stood open. That is not hypothetical: it is
-- exactly how 0173's completeness sweep was green in CI and false in production. `has_*_privilege`
-- is grantor-independent and answers the question actually being asked.
select is(
  (select bool_or(has_column_privilege('authenticated', 'public.procurement_invoices', column_name, 'INSERT')
                  or has_column_privilege('authenticated', 'public.procurement_invoices', column_name, 'UPDATE'))
     from information_schema.columns
    where table_schema = 'public' and table_name = 'procurement_invoices'),
  false,
  'AC-VTAX-013 authenticated may INSERT or UPDATE NO column of procurement_invoices — the four tax '
  'columns did not re-open the door 0174/0175 closed');

select is(
  (select has_table_privilege('authenticated', 'public.procurement_invoices', 'INSERT')
       or has_table_privilege('authenticated', 'public.procurement_invoices', 'UPDATE')
       or has_table_privilege('authenticated', 'public.procurement_invoices', 'DELETE')),
  false,
  'AC-VTAX-014 authenticated holds no table-level INSERT/UPDATE/DELETE either — the definer RPC is '
  'the sole client write path, which is why the RPC carries the tax gate (§F)');

-- ── §F — the RPC is the front door, so the gate lives there. ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"05050000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select create_procurement_invoice('05050000-0000-0000-0000-0000000000d1'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, 'VI-NO-TAX', 1000::numeric) $$,
  'P0001',
  'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards',
  'AC-VTAX-015 the RPC refuses an invoice with no stated treatment, and the message NAMES the '
  'omission — not a bare 23502 from the column, which is the wrong error (0176 §6''s class)');

-- ⚑ THE EMPTY STRING. PostgREST turns an absent json field into NULL but an empty FORM field into
-- '', which is not null — so a gate written as `is null` alone lets it through to die on the domain
-- CHECK with a 23514 naming a constraint instead of the field. Drop the `btrim(...) = ''` clause
-- from 0196 §2 and this one assertion goes red while AC-VTAX-015 stays green.
select throws_ok(
  $$ select create_procurement_invoice('05050000-0000-0000-0000-0000000000d1'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, 'VI-EMPTY-TAX', 1000::numeric,
       p_tax_treatment => '', p_tax_amount => 0) $$,
  'P0001',
  'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards',
  'AC-VTAX-021 an EMPTY treatment is refused by the same gate, not by the domain CHECK — the caller '
  'is told what to fix, not which constraint they hit');

-- ⚑ ORDERING. A bad status must still report the STATUS problem: the tax gate is deliberately the
-- LAST gate, so a caller fixing one error at a time is never sent to the wrong field. Restore the
-- tax gate above the status gate and this assertion goes red.
select throws_ok(
  $$ select create_procurement_invoice('05050000-0000-0000-0000-0000000000d1'::uuid,
       'Paid'::procurement_invoice_status, '2026-03-02'::date, 'VI-BAD-STATUS', 1000::numeric) $$,
  'P0001',
  'procurement_invoices.status "Paid" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
  'AC-VTAX-016 a bad status still reports the STATUS rule — the tax gate fires last, so an error '
  'always names the field the caller must actually fix');

select lives_ok(
  $$ select create_procurement_invoice('05050000-0000-0000-0000-0000000000d1'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, 'VI-WITH-TAX', 1000::numeric,
       p_tax_treatment => 'exclusive', p_tax_amount => 110, p_tax_rate => 11.000) $$,
  'AC-VTAX-017 CONTROL a stated treatment goes through the RPC end to end');

select lives_ok(
  $$ select capture_vendor_invoice('05050000-0000-0000-0000-0000000000d2'::uuid,
       'Received'::procurement_invoice_status, '2026-03-02'::date, 'CAP-WITH-TAX', 700::numeric, null,
       p_tax_treatment => 'inclusive', p_tax_amount => 70) $$,
  'AC-VTAX-018 CONTROL capture_vendor_invoice forwards the treatment — the second VI-creating path '
  'is not a hole in the rule');

reset role;

-- ── §E — the mirror guard. `procurement_invoices_native_mirror_guard` ENUMERATES its denial set, so
--    a column added later is user-writable while procurement is externally-owned unless it is named
--    there. This is the paired edit 0189 made mandatory for enumerating guards; remove either line
--    from 0196 §4 and exactly one of these two goes red.
--
--    ⚑ Run as the TABLE OWNER with an `authenticated` JWT claim, NOT `set local role authenticated`.
--    This table grants the client no UPDATE at all, so a role-switched UPDATE would fail on
--    privileges — a 42501 for the wrong reason, masking whether the guard fires. 0188 §E does the
--    same thing for the same reason.
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('05050000-0000-0000-0000-000000000001','erpnext','procurement');
set local request.jwt.claims =
  '{"sub":"05050000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update procurement_invoices set tax_treatment = 'inclusive'
      where id = '05050000-0000-0000-0000-00000000e002' $$,
  '42501',
  'procurement_invoices native fields are read-only while procurement is externally-owned',
  'AC-VTAX-019 the mirror guard pins tax_treatment while procurement is externally-owned');

select throws_ok(
  $$ update procurement_invoices set tax_amount = 999
      where id = '05050000-0000-0000-0000-00000000e002' $$,
  '42501',
  'procurement_invoices native fields are read-only while procurement is externally-owned',
  'AC-VTAX-020 the mirror guard pins tax_amount too');

select throws_ok(
  $$ update procurement_invoices set tax_rate = 5
      where id = '05050000-0000-0000-0000-00000000e002' $$,
  '42501',
  'procurement_invoices native fields are read-only while procurement is externally-owned',
  'AC-VTAX-022 the mirror guard pins tax_rate');

select throws_ok(
  $$ update procurement_invoices set tax_template = 'PPN 11%'
      where id = '05050000-0000-0000-0000-00000000e002' $$,
  '42501',
  'procurement_invoices native fields are read-only while procurement is externally-owned',
  'AC-VTAX-023 the mirror guard pins tax_template — all FOUR added lines have an oracle, so the '
  'comment above is true of the whole paired edit and not just half of it');

reset request.jwt.claims;

-- ── §G — the ERP RETURN case. A purchase RETURN / debit note carries a NEGATIVE
--    total_taxes_and_charges, and the sweep mirrors every Purchase Invoice. A flat `tax_amount >= 0`
--    would make each such document die on 23514 inside the mirror writer and silently stop being
--    tracked — a constraint added for honesty, quietly deleting records. Sign parity is the rule.
select lives_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', -1110, 'inclusive', -110) $$,
  'AC-VTAX-024 a RETURN mirrors: negative tax is legal on a negative-amount document');

select throws_ok(
  $$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
     values ('05050000-0000-0000-0000-000000000001','05050000-0000-0000-0000-0000000000d1',
             'Received','2026-03-02', 1000, 'exclusive', -110) $$,
  '23514',
  null,
  'AC-VTAX-025 but negative tax on a POSITIVE invoice is still refused — the return case widened the '
  'bound by exactly one shape, not into a hole');

select * from finish();
rollback;
