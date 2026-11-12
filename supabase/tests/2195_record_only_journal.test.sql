-- Record-only purchases: journal creation is atomic and never changes project actuals.
begin;
select plan(2);
insert into organizations (id, name, default_currency) values
  ('21950000-0000-0000-0000-00000000000a','JEC A','IDR'), ('21950000-0000-0000-0000-00000000000b','JEC B','IDR');
insert into auth.users (id, email) values
  ('21950000-0000-0000-0000-0000000000a1','rrp-fin@example.com'), ('21950000-0000-0000-0000-0000000000a2','rrp-pm@example.com'),
  ('21950000-0000-0000-0000-0000000000a3','rrp-eng@example.com'), ('21950000-0000-0000-0000-0000000000a4','rrp-admin@example.com'),
  ('21950000-0000-0000-0000-0000000000b1','rrp-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21950000-0000-0000-0000-0000000000a1','21950000-0000-0000-0000-00000000000a','Fin','rrp-fin@example.com','Finance','active'),
  ('21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-00000000000a','PM','rrp-pm@example.com','Project Manager','active'),
  ('21950000-0000-0000-0000-0000000000a3','21950000-0000-0000-0000-00000000000a','Eng','rrp-eng@example.com','Engineer','active'),
  ('21950000-0000-0000-0000-0000000000a4','21950000-0000-0000-0000-00000000000a','Admin','rrp-admin@example.com','Admin','active'),
  ('21950000-0000-0000-0000-0000000000b1','21950000-0000-0000-0000-00000000000b','B Fin','rrp-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('21950000-0000-0000-0000-0000000000d1','21950000-0000-0000-0000-00000000000a','JEC A1','Ongoing Project'),
  ('21950000-0000-0000-0000-0000000000d2','21950000-0000-0000-0000-00000000000a','JEC A2','Ongoing Project'),
  ('21950000-0000-0000-0000-0000000000d3','21950000-0000-0000-0000-00000000000b','JEC B1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('21950000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"21950000-0000-0000-0000-0000000000d1":"ERP-A1","21950000-0000-0000-0000-0000000000d2":"ERP-A2"}}'::jsonb, now(), 'active'),
  ('21950000-0000-0000-0000-00000000000b','erpnext','https://erp-b.example.test','test-ref-b',
   '{"company":"Other Co","project_map":{"21950000-0000-0000-0000-0000000000d3":"ERP-B1"}}'::jsonb, now(), 'active');
insert into budget_category_account_map (org_id, category, erp_account) values
  ('21950000-0000-0000-0000-00000000000a','Subcontractors','Project Subcontractors - X'),
  ('21950000-0000-0000-0000-00000000000a','Materials','Cost of Goods - X'),
  ('21950000-0000-0000-0000-00000000000b','Subcontractors','Project Subcontractors - X');

-- Ledger rows. JV-1 splits one bank payment across A1 (60) and A2 (120); JV-2 is two rows on one line (40+10);
-- JV-3 nets to a credit; JV-PMO is a journal PMO posted itself; JV-B is org B's.
insert into erp_gl_entry_mirror (org_id, erp_name, company, account, project, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, remarks, erp_modified) values
  ('21950000-0000-0000-0000-00000000000a','g1a','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-1','2026-03-01',60,0,false,'Vendor Lab inv 7','2026-03-01'),
  ('21950000-0000-0000-0000-00000000000a','g1b','Example Co','Project Subcontractors - X','ERP-A2','Journal Entry','JV-1','2026-03-01',120,0,false,'Vendor Lab inv 7','2026-03-01'),
  ('21950000-0000-0000-0000-00000000000a','g1c','Example Co','Bank - X',null,'Journal Entry','JV-1','2026-03-01',0,180,false,'Vendor Lab inv 7','2026-03-01'),
  ('21950000-0000-0000-0000-00000000000a','g2a','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-2','2026-03-05',40,0,false,null,'2026-03-05'),
  ('21950000-0000-0000-0000-00000000000a','g2b','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-2','2026-03-05',10,0,false,null,'2026-03-05'),
  ('21950000-0000-0000-0000-00000000000a','g3a','Example Co','Cost of Goods - X','ERP-A1','Journal Entry','JV-3','2026-03-09',0,5,false,null,'2026-03-09'),
  ('21950000-0000-0000-0000-00000000000a','gp','Example Co','Project Subcontractors - X','ERP-A1','Journal Entry','JV-PMO','2026-03-10',20,0,false,null,'2026-03-10'),
  ('21950000-0000-0000-0000-00000000000a','gu','Example Co','Cost of Goods - X','ERP-A1','Purchase Invoice','PINV-9','2026-03-11',77,0,false,null,'2026-03-11'),
  ('21950000-0000-0000-0000-00000000000b','gb','Other Co','Project Subcontractors - X','ERP-B1','Journal Entry','JV-B','2026-03-02',30,0,false,null,'2026-03-02');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, title, amount, status, claim_number, approved_by_id, approved_at) values
  ('21950000-0000-0000-0000-000000000501','21950000-0000-0000-0000-00000000000a','claim','21950000-0000-0000-0000-0000000000a3','21950000-0000-0000-0000-0000000000d1','Trip',0,'Approved','EXP-2611050001','21950000-0000-0000-0000-0000000000a2','2026-11-05 02:00:00+00');
insert into expense_posting_erp_mirror (org_id, claim_id, posting, posting_identity, state_stamp, actor_id, erp_name) values
  ('21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-000000000501','approval','21950000-0000-0000-0000-000000000501:approval','2026-11-05 02:00:00+00','21950000-0000-0000-0000-0000000000a2','JV-PMO');
-- The actuals snapshot the project reads (a separate job fills it from the rows above; a fixed value is enough to prove attach never touches it).
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, net, as_of, snapshot_id, created_at) values
  ('21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-0000000000d1','Project Subcontractors - X','2026',110,now(),'21950000-0000-0000-0000-0000000000f1',now()),
  ('21950000-0000-0000-0000-00000000000a','21950000-0000-0000-0000-0000000000d2','Project Subcontractors - X','2026',120,now(),'21950000-0000-0000-0000-0000000000f1',now());

insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('21950000-0000-0000-0000-0000000000e1','21950000-0000-0000-0000-00000000000a','P1','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','IDR',100,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e2','21950000-0000-0000-0000-00000000000a','P2','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','IDR',70,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e3','21950000-0000-0000-0000-00000000000a','PX','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','IDR',10,'Cancelled'),
  ('21950000-0000-0000-0000-0000000000e4','21950000-0000-0000-0000-00000000000a','PU','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d1','USD',10,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e5','21950000-0000-0000-0000-00000000000a','Q1','21950000-0000-0000-0000-0000000000a2','21950000-0000-0000-0000-0000000000d2','IDR',500,'Ordered'),
  ('21950000-0000-0000-0000-0000000000e6','21950000-0000-0000-0000-00000000000b','B purchase','21950000-0000-0000-0000-0000000000b1','21950000-0000-0000-0000-0000000000d3','IDR',90,'Ordered');


set local role authenticated;
set local request.jwt.claims = '{"sub":"21950000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(public.create_record_only_journal_purchase(
  '[{"voucher_no":"JV-1","project_id":"21950000-0000-0000-0000-0000000000d1","account":"Project Subcontractors - X"}]'::jsonb,
  null, 'Reference', false)->>'outcome', 'create', 'AC-RRP-001 Admin creates a purchase from a journal line');
select is((select count(*)::int from project_erp_journal_lines('21950000-0000-0000-0000-0000000000d1') where voucher_no='JV-1' and procurement_id is not null), 1, 'AC-RRP-001 the journal read shows the attached purchase');
reset role;
select * from finish();
rollback;
