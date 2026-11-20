-- 1116_sales_invoice_retention_held.test.sql — #2625 (ADR-0105 §4; docs/specs/billing-stages.spec.md FR-RET-021).
-- Migration under test: 1116_sales_invoice_retention_held.sql.
-- AC-RET-005 a claim invoice's receivable read carries the retention still held (retention less recorded releases), so the
-- amount due now is its outstanding balance less that figure; an invoice with no claim holds none; the read is RLS-scoped.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency) values
  ('26250000-0000-0000-0000-00000000000a', 'Due Now Org',   'IDR'),
  ('26250000-0000-0000-0000-00000000000b', 'Due Now Other', 'IDR');
insert into auth.users (id, email) values
  ('26250000-0000-0000-0000-0000000000a1', 'due-fin@example.com'),
  ('26250000-0000-0000-0000-0000000000b1', 'due-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26250000-0000-0000-0000-0000000000a1', '26250000-0000-0000-0000-00000000000a', 'Due Fin',  'due-fin@example.com',  'Finance',  'active'),
  ('26250000-0000-0000-0000-0000000000b1', '26250000-0000-0000-0000-00000000000b', 'Due XOrg', 'due-xorg@example.com', 'Finance',  'active');
insert into projects (id, org_id, name, status, currency) values
  ('26250000-0000-0000-0000-0000000000d1', '26250000-0000-0000-0000-00000000000a', 'Due Site', 'Ongoing Project', 'IDR');

-- Rows written with triggers off: this file proves the read, not the claim/invoice/release write paths (0961 owns those).
set local session_replication_role = replica;
insert into progress_claims (id, org_id, project_id, kind, currency, gross_amount, dp_recovery_amount, retention_pct, retention_amount, created_by) values
  ('26250000-0000-0000-0000-000000000c01', '26250000-0000-0000-0000-00000000000a', '26250000-0000-0000-0000-0000000000d1',
   'progress', 'IDR', 1000000, 0, 5, 50000.05, '26250000-0000-0000-0000-0000000000a1');
insert into sales_invoices (id, org_id, project_id, si_number, invoice_date, status, amount, currency, tax_treatment, tax_amount, erp_outstanding_amount) values
  -- the claim's invoice (id = claim id), paid net of retention plus a little: 60,000.05 still outstanding
  ('26250000-0000-0000-0000-000000000c01', '26250000-0000-0000-0000-00000000000a', '26250000-0000-0000-0000-0000000000d1',
   'SI-DUE-1', '2026-09-01', 'Unpaid', 1000000, 'IDR', 'exclusive', 0, 60000.05),
  -- an invoice with no claim
  ('26250000-0000-0000-0000-000000000c02', '26250000-0000-0000-0000-00000000000a', '26250000-0000-0000-0000-0000000000d1',
   'SI-DUE-2', '2026-09-01', 'Unpaid', 500, 'IDR', 'exclusive', 0, 500);
insert into retention_releases (id, org_id, claim_id, project_id, amount, due_on, released_on, created_by, released_by) values
  -- scheduled, not released: still held
  ('26250000-0000-0000-0000-000000000e01', '26250000-0000-0000-0000-00000000000a', '26250000-0000-0000-0000-000000000c01',
   '26250000-0000-0000-0000-0000000000d1', 20000, '2027-01-01', null, '26250000-0000-0000-0000-0000000000a1', null);
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.held(p_id uuid) returns numeric language sql as $$
  select public.retention_held(s) from public.sales_invoices s where s.id = p_id $$;

set local role authenticated;
select pg_temp.act_as('26250000-0000-0000-0000-0000000000a1');
select is(pg_temp.held('26250000-0000-0000-0000-000000000c01'), 50000.05::numeric,
  'AC-RET-005 a claim invoice carries the retention still held (a scheduled release is still held), exact to the cent');
select is((select s.erp_outstanding_amount - public.retention_held(s) from public.sales_invoices s where s.id = '26250000-0000-0000-0000-000000000c01'),
  10000.00::numeric, 'AC-RET-005 due now = outstanding 60,000.05 less retention held 50,000.05');
select is(pg_temp.held('26250000-0000-0000-0000-000000000c02'), 0.00::numeric, 'AC-RET-005 an invoice with no claim holds no retention');

-- A recorded release reduces what is held (written as the table owner, as release_retention would leave it).
reset role;
set local session_replication_role = replica;
update retention_releases set released_on = '2026-10-01', released_by = '26250000-0000-0000-0000-0000000000a1'
 where id = '26250000-0000-0000-0000-000000000e01';
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('26250000-0000-0000-0000-0000000000a1');
select is(pg_temp.held('26250000-0000-0000-0000-000000000c01'), 30000.05::numeric,
  'AC-RET-005 a recorded release of 20,000 leaves 30,000.05 held');

-- The PostgREST computed-field form the app selects.
select is((select (to_jsonb(s) || jsonb_build_object('retention_held', public.retention_held(s)))->>'retention_held'
             from public.sales_invoices s where s.id = '26250000-0000-0000-0000-000000000c01'), '30000.05',
  'the read is exact decimal text in the row');

-- Tenancy: a hand-built row naming another org's claim reads nothing.
select pg_temp.act_as('26250000-0000-0000-0000-0000000000b1');
select is(public.retention_held(jsonb_populate_record(null::public.sales_invoices,
  jsonb_build_object('id', '26250000-0000-0000-0000-000000000c01', 'org_id', '26250000-0000-0000-0000-00000000000a'))),
  0.00::numeric, 'SECURITY: another org''s caller reads no retention, even with a hand-built row');
select is((select count(*)::int from public.sales_invoices s where s.id = '26250000-0000-0000-0000-000000000c01'), 0,
  'SECURITY: and cannot read the invoice row itself');
select ok(not has_function_privilege('anon', 'public.retention_held(public.sales_invoices)', 'execute'), 'anon cannot call the read');

select * from finish();
rollback;
