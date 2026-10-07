-- 0270_native_revenue_erp_path.test.sql — #784: the ERP path only ever acts on ERP-path rows. A PMO-native invoice is
-- never submitted, cleared for submit or re-authored through the ERP-path gates (0133, re-created in 0270 §5b), and a
-- PMO invoice is frozen while an ERP owns revenue — the received-date writer (0244) included, and the mirror guard
-- pins received_date on PMO invoices. ERP-path rows keep every existing behaviour (controls), and the ERP-path submit
-- SoD is the same helper the PMO approve uses (§2).
-- Migration under test: 0270_native_revenue.sql §2, §5b, §6.
begin;
create extension if not exists pgtap;
select plan(24);

insert into organizations (id, name) values ('02700000-0000-0000-0000-000000000001', 'NAR Org');
insert into auth.users (id, email) values
  ('02700000-0000-0000-0000-0000000000a1', 'nar-fin1@example.com'),
  ('02700000-0000-0000-0000-0000000000a2', 'nar-fin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-000000000001', 'NAR Fin One', 'nar-fin1@example.com', 'Finance', 'active'),
  ('02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-000000000001', 'NAR Fin Two', 'nar-fin2@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('02700000-0000-0000-0000-0000000000c1', '02700000-0000-0000-0000-000000000001', 'NAR Client', 'Client');
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
                      tax_base_numerator, tax_base_denominator, subject_to_vat, customer_contract_ref, client_id) values
  ('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-000000000001', 'NAR VAT project', 'Ongoing Project', 'IDR', 10000000, 'exclusive', 0, 12, 11, 12, true, 'CTR-NAR-1', '02700000-0000-0000-0000-0000000000c1');
-- ERP-path rows (mirror shape, written by the service role in production): two authored by Fin One, one with no
-- recorded author.
insert into public.sales_invoices (id, org_id, project_id, customer_id, si_number, invoice_date, amount, tax_treatment, tax_amount, currency, status, erp_docstatus, author_user_id) values
  ('02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 'SI-ERP-1', '2026-07-01', 100, 'exclusive', 0, 'IDR', 'Draft', 0, '02700000-0000-0000-0000-0000000000a1'),
  ('02700000-0000-0000-0000-0000000000e2', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 'SI-ERP-2', '2026-07-01', 100, 'exclusive', 0, 'IDR', 'Draft', 0, '02700000-0000-0000-0000-0000000000a1'),
  ('02700000-0000-0000-0000-0000000000e3', '02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', 'SI-ERP-3', '2026-07-01', 100, 'exclusive', 0, 'IDR', 'Unpaid', 1, null);
insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id) values
  ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000e1', '02700000-0000-0000-0000-0000000000a1'),
  ('02700000-0000-0000-0000-000000000001', '02700000-0000-0000-0000-0000000000e2', '02700000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$ begin
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"ERP path draft","qty":1,"rate":1000}]'::jsonb);
  perform public.create_native_sales_invoice('02700000-0000-0000-0000-0000000000d1', '02700000-0000-0000-0000-0000000000c1', '[{"item_code":"SVC","description":"ERP path unpaid","qty":1,"rate":1000}]'::jsonb);
end $$;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform public.transition_native_sales_invoice((select id from public.sales_invoices where native_lines @> '[{"description":"ERP path unpaid"}]'), 'Unpaid');
end $$;

-- Literal ids for the service-role calls below (a PMO invoice's id is minted by the RPC).
reset role;
create temp table nar_ids on commit drop as
  select native_lines -> 0 ->> 'description' as d, id from public.sales_invoices where pmo_native;
grant select on nar_ids to authenticated, service_role;
set local role authenticated;

-- ── submit_sales_invoice (the caller-callable ERP-path SoD check) ────────────────────────────────────────────
select throws_ok($$ select public.submit_sales_invoice((select id from nar_ids where d = 'ERP path draft')) $$,
  'P0001', 'this invoice was raised in PMO: approve it in PMO',
  '#784 PMO-native invoices are never submitted through the ERP path (submit_sales_invoice)');             -- 1
select lives_ok($$ select public.submit_sales_invoice('02700000-0000-0000-0000-0000000000e1') $$,
  '#784 CONTROL an ERP-path invoice still passes the submit SoD for a second person');                     -- 2
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.submit_sales_invoice('02700000-0000-0000-0000-0000000000e1') $$,
  '42501', 'approver must differ from author (SoD)',
  '#784 CONTROL the ERP-path submit SoD (now the shared helper) still refuses the author');                -- 3

-- ── claim_sales_invoice_author (the pre-ERP body-writer claim) ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.claim_sales_invoice_author((select id from nar_ids where d = 'ERP path draft')) $$,
  'P0001', 'this invoice was raised in PMO: its lines are fixed when it is raised',
  '#784 PMO-native invoices are never re-authored through the ERP path (claim_sales_invoice_author)');     -- 4
select is((select count(*)::int from public.sales_invoice_authors a join nar_ids n on n.id = a.sales_invoice_id
            where n.d = 'ERP path draft' and a.user_id = '02700000-0000-0000-0000-0000000000a2'),
  0, '#784 …and the refused claim adds nobody to the PMO invoice''s author set');                         -- 5
select lives_ok($$ select public.claim_sales_invoice_author('02700000-0000-0000-0000-0000000000e2') $$,
  '#784 CONTROL an ERP-path invoice body is still claimable');                                             -- 6

-- ── grant_sales_invoice_submit_clearance (the dispatch-only gate, service role, explicit actor) ─────────────
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select throws_ok($$ select public.grant_sales_invoice_submit_clearance((select id from nar_ids where d = 'ERP path draft'),
  '02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-00000000c1e1') $$,
  'P0001', 'this invoice was raised in PMO: approve it in PMO',
  '#784 PMO-native invoices are never cleared for an ERP submit (grant_sales_invoice_submit_clearance)'); -- 7
select is((select count(*)::int from public.sales_invoice_submit_authorizations s join nar_ids n on n.id = s.sales_invoice_id),
  0, '#784 …and no submit clearance is ever recorded on a PMO invoice');                                  -- 8
select lives_ok($$ select public.grant_sales_invoice_submit_clearance('02700000-0000-0000-0000-0000000000e1',
  '02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-00000000c1e2') $$,
  '#784 CONTROL an ERP-path invoice is still cleared for a second person');                                -- 9
select throws_ok($$ select public.grant_sales_invoice_submit_clearance('02700000-0000-0000-0000-0000000000e2',
  '02700000-0000-0000-0000-0000000000a1', '02700000-0000-0000-0000-00000000c1e3') $$,
  '42501', 'approver must differ from author (SoD)',
  '#784 CONTROL the dispatch gate''s SoD (now the shared helper) still refuses the author');              -- 10
select throws_ok($$ select public.grant_sales_invoice_submit_clearance('02700000-0000-0000-0000-0000000000e3',
  '02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-00000000c1e4') $$,
  '42501', 'sales invoice has no recorded author — SoD cannot be verified',
  '#784 CONTROL an ERP-path invoice with no recorded author still fails closed');                         -- 11

-- ── the received-date writer and the mirror guard ───────────────────────────────────────────────────────────
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.set_sales_invoice_received_date((select id from nar_ids where d = 'ERP path unpaid'), (select invoice_date from public.sales_invoices where native_lines @> '[{"description":"ERP path unpaid"}]')) $$,
  '#784 CONTROL with no ERP owning revenue, Finance records a PMO invoice''s received date');             -- 12
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select public.transition_native_sales_invoice((select id from nar_ids where d = 'ERP path draft'), 'Cancelled') $$,
  'setup: the open PMO draft is cancelled so the ERP can take revenue over');                              -- 13
reset role;
set local request.jwt.claims = '{}';
insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select public.set_sales_invoice_received_date((select id from nar_ids where d = 'ERP path unpaid'), null) $$,
  '42501', 'customer invoices for this organisation are raised in the connected ERP, not in PMO',
  '#784 a PMO invoice''s received date is frozen while an ERP owns revenue (DD-NAR-11)');                -- 14
select is((select received_date is not null from public.sales_invoices where native_lines @> '[{"description":"ERP path unpaid"}]'),
  true, '#784 …so it keeps the date recorded before the take-over');                                       -- 15
select lives_ok($$ select public.set_sales_invoice_received_date('02700000-0000-0000-0000-0000000000e3', '2026-07-10') $$,
  '#784 CONTROL an ERP invoice''s received date is still recorded while the ERP owns revenue (#767)');    -- 16
-- The guard itself (the second layer): the privilege is granted inside this transaction only, as 0270_revenue_write_roles does.
reset role;
grant update (received_date) on public.sales_invoices to authenticated;
set local role authenticated;
select throws_ok($$ update public.sales_invoices set received_date = null where native_lines @> '[{"description":"ERP path unpaid"}]' $$,
  '42501', 'sales_invoices native fields are read-only while revenue is externally-owned',
  '#784 the mirror guard pins a PMO invoice''s received date while an ERP owns revenue');                 -- 17
select lives_ok($$ update public.sales_invoices set received_date = '2026-07-11' where id = '02700000-0000-0000-0000-0000000000e3' $$,
  '#784 CONTROL …and leaves an ERP invoice''s received date writable');                                    -- 18
reset role;
revoke update (received_date) on public.sales_invoices from authenticated;

-- ── the ERP-path refusals carry a stable detail code the UI can word ───────────────────────────────────────
create function pg_temp.nar_detail(p_sql text) returns text language plpgsql as $f$
declare v_detail text;
begin
  execute p_sql;
  return '<no error>';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end $f$;
set local request.jwt.claims = '{"sub":"02700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
delete from public.external_domain_ownership where org_id = '02700000-0000-0000-0000-000000000001' and domain = 'revenue';
select is(pg_temp.nar_detail($$ select public.submit_sales_invoice((select id from nar_ids where d = 'ERP path unpaid')) $$),
  'pmo-native', '#784 submit_sales_invoice refuses a PMO invoice with detail pmo-native');                -- 19
select is(pg_temp.nar_detail($$ select public.claim_sales_invoice_author((select id from nar_ids where d = 'ERP path unpaid')) $$),
  'pmo-native', '#784 claim_sales_invoice_author refuses a PMO invoice with detail pmo-native');          -- 20
select is(pg_temp.nar_detail($$ select public.grant_sales_invoice_submit_clearance((select id from nar_ids where d = 'ERP path unpaid'),
  '02700000-0000-0000-0000-0000000000a2', '02700000-0000-0000-0000-00000000c1e5') $$),
  'pmo-native', '#784 grant_sales_invoice_submit_clearance refuses a PMO invoice with detail pmo-native'); -- 21
select is(pg_temp.nar_detail($$ select public.submit_sales_invoice('02700000-0000-0000-0000-0000000000e1') $$),
  '<no error>', '#784 CONTROL the detail probe reports a passing call as no error');                       -- 22
insert into public.external_domain_ownership (org_id, external_tier, domain)
  values ('02700000-0000-0000-0000-000000000001', 'erpnext', 'revenue');
select is(pg_temp.nar_detail($$ select public.set_sales_invoice_received_date((select id from nar_ids where d = 'ERP path unpaid'), null) $$),
  'erp-owns-revenue', '#784 the frozen received date refuses with detail erp-owns-revenue');              -- 23

-- ── the SoD helper is internal ─────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated', 'public.assert_sales_invoice_approver(uuid,uuid,uuid)', 'execute')
          and not has_function_privilege('anon', 'public.assert_sales_invoice_approver(uuid,uuid,uuid)', 'execute'),
  '#784 the one approval-SoD helper is not client-executable');                                            -- 24

select * from finish();
rollback;
