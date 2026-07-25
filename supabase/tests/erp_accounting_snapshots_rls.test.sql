-- erp_accounting_snapshots_rls.test.sql
-- AC-ENA-060/061 [pgTAP]: the slice-7 read-only accounting read-model — the two ledger-mirror tables
-- (erp_gl_entry_mirror / erp_payment_ledger_mirror — FR-ENA-150/162's mirrored-rows basis, fed by the
-- slice-8 sweep) + the three snapshot tables (erp_actuals_snapshot / erp_ap_aging_snapshot /
-- erp_ar_aging_snapshot, spec §4.4). Mirrors the external_command_outbox_rls.test.sql idiom:
--
--  • all five tables are org-isolated SELECT + service-role-only WRITE (machine-written, read-only to
--    every user JWT — ADR-0048: these are ERP-ledger truth, never PMO-authored);
--  • the two ledger mirrors' `unique (org_id, erp_name)` makes the sweep feed an idempotent upsert
--    (a re-fed row is a no-op, not a duplicate);
--  • a refresh REPLACES the prior snapshot for a scope (single snapshot_id / single as_of per scope) —
--    the prior rows are deleted in the SAME service-role tx as the new rows are inserted (spec §4.4).
begin;
select plan(19);

insert into organizations (id, name) values
  ('a1000000-0000-0000-0000-000000000001','AC-ENA Snapshots A'),
  ('a1000000-0000-0000-0000-000000000002','AC-ENA Snapshots B');
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-0000000000a1','snap-a@example.com'),
  ('a1000000-0000-0000-0000-0000000000b1','snap-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1000000-0000-0000-0000-0000000000a1','a1000000-0000-0000-0000-000000000001','A','snap-a@example.com','Admin','active'),
  ('a1000000-0000-0000-0000-0000000000b1','a1000000-0000-0000-0000-000000000002','B','snap-b@example.com','Admin','active');

-- Seed as OWNER (the sweep service-role path; bypasses RLS).
reset role;

-- §1 — erp_gl_entry_mirror: org isolation + machine-only write + unique(org_id, erp_name) idempotency.
insert into erp_gl_entry_mirror (org_id, erp_name, account, cost_center, fiscal_year, project, party_type, party,
  voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified)
values
  ('a1000000-0000-0000-0000-000000000001','ACC-GLE-001','Creditors - PSC','Main - PSC','2026',null,'Supplier','Spike Supplier',
   'Purchase Invoice','ACC-PINV-2026-00018','2026-07-12',0,50000,false,1,'2026-07-12 12:00:00'),
  ('a1000000-0000-0000-0000-000000000001','ACC-GLE-002','Stock Received But Not Billed - PSC','Main - PSC','2026',null,null,null,
   'Purchase Receipt','ACC-PR-2026-00001','2026-07-12',50000,0,false,1,'2026-07-12 12:00:00');

-- unique(org_id, erp_name): a re-feed of the SAME ERP name for the SAME org is rejected (the feed is an
-- upsert-by-name, never a duplicate row).
select throws_ok(
  $$ insert into erp_gl_entry_mirror (org_id, erp_name, account, erp_modified)
       values ('a1000000-0000-0000-0000-000000000001','ACC-GLE-001','Creditors - PSC','2026-07-12 12:00:00') $$,
  '23505', null,
  'AC-ENA-060 erp_gl_entry_mirror unique(org_id,erp_name) rejects a re-fed duplicate row');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from erp_gl_entry_mirror), 2,
  'AC-ENA-060 org-A member reads own-org GL-mirror rows');
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from erp_gl_entry_mirror), 0,
  'AC-ENA-060 org-B member reads nothing of org-A GL-mirror rows (org isolation)');
select throws_ok(
  $$ insert into erp_gl_entry_mirror (org_id, erp_name, account, erp_modified)
       values ('a1000000-0000-0000-0000-000000000002','ACC-GLE-X','Acct','2026-07-12') $$,
  '42501', null,
  'AC-ENA-060 user-JET INSERT into erp_gl_entry_mirror denied (machine-written only)');

-- §2 — erp_payment_ledger_mirror: same invariants (the aging fallback's second source).
reset role;
insert into erp_payment_ledger_mirror (org_id, erp_name, account, party_type, party, against_voucher_type,
  against_voucher_no, amount, posting_date, due_date, erp_docstatus, erp_modified)
values ('a1000000-0000-0000-0000-000000000001','ACC-PLE-001','Creditors - PSC','Supplier','Spike Supplier',
  'Payment Entry','ACC-PAY-2026-00006',-75000,'2026-07-12',null,1,'2026-07-12 11:36:00');
select throws_ok(
  $$ insert into erp_payment_ledger_mirror (org_id, erp_name, account, erp_modified)
       values ('a1000000-0000-0000-0000-000000000001','ACC-PLE-001','Creditors - PSC','2026-07-12') $$,
  '23505', null,
  'AC-ENA-061 erp_payment_ledger_mirror unique(org_id,erp_name) rejects a re-fed duplicate row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from erp_payment_ledger_mirror), 0,
  'AC-ENA-061 org-B member reads nothing of org-A payment-ledger-mirror rows (org isolation)');
select throws_ok(
  $$ update erp_payment_ledger_mirror set amount = 0 $$,
  '42501', null,
  'AC-ENA-061 user-JWT UPDATE on erp_payment_ledger_mirror denied (machine-written only)');

-- §3 — erp_actuals_snapshot: machine-only write + snapshot-replace-per-scope (single snapshot_id).
reset role;
insert into erp_actuals_snapshot (org_id, cost_center, account, fiscal_year, debit, credit, net, source_report, snapshot_id)
values
  ('a1000000-0000-0000-0000-000000000001','Main - PSC','Creditors - PSC','2026',0,50000,-50000,'GL Entry','11111111-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000001','Main - PSC','Stock Received But Not Billed - PSC','2026',50000,0,50000,'GL Entry','11111111-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from erp_actuals_snapshot), 2,
  'AC-ENA-060 org-A member reads own-org actuals snapshot rows');
select throws_ok(
  $$ delete from erp_actuals_snapshot $$,
  '42501', null,
  'AC-ENA-060 user-JWT DELETE on erp_actuals_snapshot denied (machine-written only)');
-- A refresh: the sweep service role deletes the prior scope (org-A) rows and inserts new ones in the
-- SAME tx (snapshot replacement, not append) — after the refresh, exactly ONE snapshot_id remains.
-- NB: no explicit BEGIN/COMMIT here — `supabase test db` wraps the whole file in one tx (rolled back at
-- the end). An inner COMMIT would escape that wrapper and make every later `SET LOCAL role/jwt.claims`
-- a no-op (SET LOCAL is tx-scoped), silently un-enforcing RLS for the trailing write-denial assertions.
reset role;
delete from erp_actuals_snapshot where org_id = 'a1000000-0000-0000-0000-000000000001';
insert into erp_actuals_snapshot (org_id, cost_center, account, fiscal_year, debit, credit, net, source_report, snapshot_id)
values ('a1000000-0000-0000-0000-000000000001','Main - PSC','Creditors - PSC','2026',0,75000,-75000,'GL Entry','22222222-0000-0000-0000-000000000002');
select is((select count(*)::int from erp_actuals_snapshot where org_id = 'a1000000-0000-0000-0000-000000000001'), 1,
  'AC-ENA-060 a refresh replaces the prior scope (single snapshot_id / single row after refresh, not append)');
select is((select count(distinct snapshot_id)::int from erp_actuals_snapshot where org_id = 'a1000000-0000-0000-0000-000000000001'), 1,
  'AC-ENA-060 exactly one snapshot_id per scope after a refresh');

-- §4 — erp_ap_aging_snapshot: provenance cols present + snapshot-replace-per-scope + machine-only write.
insert into erp_ap_aging_snapshot (org_id, party, party_type, currency, total_outstanding, current, b_0_30,
  b_31_60, b_61_90, b_90_plus, range_labels, report_date, ageing_based_on, source_report, report_version, snapshot_id)
values ('a1000000-0000-0000-0000-000000000001','Spike Supplier','Supplier','IDR',75000,0,75000,0,0,0,
  '{"range1":"0-30","range2":"31-60","range3":"61-90","range4":"91-120"}'::jsonb,'2026-07-12','Due Date',
  'Accounts Payable','erpnext-15.94.3/frappe-15.96.0','33333333-0000-0000-0000-000000000003');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select source_report::text from erp_ap_aging_snapshot limit 1), 'Accounts Payable',
  'AC-ENA-061 AP aging snapshot carries source_report provenance');
select is((select report_version from erp_ap_aging_snapshot limit 1), 'erpnext-15.94.3/frappe-15.96.0',
  'AC-ENA-061 AP aging snapshot carries report_version provenance');
select is((select ageing_based_on from erp_ap_aging_snapshot limit 1), 'Due Date',
  'AC-ENA-061 AP aging snapshot carries ageing_based_on provenance');
select throws_ok(
  $$ insert into erp_ap_aging_snapshot (org_id, party, party_type, snapshot_id)
       values ('a1000000-0000-0000-0000-000000000002','X','Supplier', gen_random_uuid()) $$,
  '42501', null,
  'AC-ENA-061 user-JWT INSERT into erp_ap_aging_snapshot denied (machine-written only)');
-- Same refresh-replace proof for AP aging; same harness-tx discipline (no inner COMMIT — see §3 note).
reset role;
delete from erp_ap_aging_snapshot where org_id = 'a1000000-0000-0000-0000-000000000001';
insert into erp_ap_aging_snapshot (org_id, party, party_type, currency, total_outstanding, current, b_0_30,
  b_31_60, b_61_90, b_90_plus, range_labels, report_date, ageing_based_on, source_report, report_version, snapshot_id)
values ('a1000000-0000-0000-0000-000000000001','Spike Supplier','Supplier','IDR',60000,0,60000,0,0,0,
  '{"range1":"0-30","range2":"31-60","range3":"61-90","range4":"91-120"}'::jsonb,'2026-07-12','Due Date',
  'Accounts Payable','erpnext-15.94.3/frappe-15.96.0','44444444-0000-0000-0000-000000000004');
select is((select count(distinct snapshot_id)::int from erp_ap_aging_snapshot where org_id = 'a1000000-0000-0000-0000-000000000001'), 1,
  'AC-ENA-061 a refresh replaces the AP aging scope (single snapshot_id)');

-- §5 — erp_ar_aging_snapshot: mirror of §4 for the AR side (same provenance + replace + write-guard).
insert into erp_ar_aging_snapshot (org_id, party, party_type, currency, total_outstanding, current, b_0_30,
  b_31_60, b_61_90, b_90_plus, range_labels, report_date, ageing_based_on, source_report, report_version, snapshot_id)
values ('a1000000-0000-0000-0000-000000000002','Cust A','Customer','IDR',0,0,0,0,0,0,
  '{"range1":"0-30","range2":"31-60","range3":"61-90","range4":"91-120"}'::jsonb,'2026-07-12','Due Date',
  'Accounts Receivable','erpnext-15.94.3/frappe-15.96.0','55555555-0000-0000-0000-000000000005');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from erp_ar_aging_snapshot), 0,
  'AC-ENA-061 org-A member reads nothing of org-B AR aging rows (org isolation)');
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from erp_ar_aging_snapshot), 1,
  'AC-ENA-061 org-B member reads own-org AR aging row');
select throws_ok(
  $$ delete from erp_ar_aging_snapshot $$,
  '42501', null,
  'AC-ENA-061 user-JWT DELETE on erp_ar_aging_snapshot denied (machine-written only)');

select finish();
rollback;
