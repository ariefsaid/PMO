-- seed.sql — single-tenant, generic professional-services seed (de-O&G'd, baseline §8).
-- The default org ('00000000-...-001') is created by migration 0001; do not re-insert it.
--
-- NOTE (Auth issue #3): the auth.users rows below are now REAL credentialed GoTrue users (local dev
-- only). Each can sign in with password 'Passw0rd!dev' (meets config.toml policy: min 10, lower+upper+
-- digit) and via magic link. Email confirmations are OFF for dev (config.toml), so email_confirmed_at
-- is pre-set. Matching auth.identities rows make email/password and magic-link resolve. These dev
-- credentials are documented in pmo-portal/.env.example and must NEVER appear in a production seed.

-- companies
insert into companies (id, name, type) values
  ('c0000000-0000-0000-0000-000000000001','Acme Consulting Group','Internal'),
  ('c0000000-0000-0000-0000-000000000002','Innovate Corp','Client'),
  ('c0000000-0000-0000-0000-000000000003','Northwind Manufacturing','Client'),
  ('c0000000-0000-0000-0000-000000000004','Apex Supplies Ltd','Vendor'),
  ('c0000000-0000-0000-0000-000000000005','Synergy Logistics','Vendor');

-- auth users (local-dev only; credentialed — see NOTE above). Password: 'Passw0rd!dev'.
-- The token text columns (confirmation_token, recovery_token, email_change*, reauthentication_token)
-- are nullable in schema but GoTrue's Go driver scans them as non-null strings, so they MUST be ''
-- (empty string), not NULL — otherwise sign-in fails with "converting NULL to string is unsupported".
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a1',
   'authenticated','authenticated','exec@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a2',
   'authenticated','authenticated','pm@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a3',
   'authenticated','authenticated','finance@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a4',
   'authenticated','authenticated','engineer@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000a5',
   'authenticated','authenticated','admin@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '')
on conflict (id) do nothing;

-- GoTrue identities (email provider) so password + magic-link both resolve.
insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('exec@acme.test','00000000-0000-0000-0000-0000000000a1',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a1','email','exec@acme.test'),
   'email', now(), now(), now()),
  ('pm@acme.test','00000000-0000-0000-0000-0000000000a2',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a2','email','pm@acme.test'),
   'email', now(), now(), now()),
  ('finance@acme.test','00000000-0000-0000-0000-0000000000a3',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a3','email','finance@acme.test'),
   'email', now(), now(), now()),
  ('engineer@acme.test','00000000-0000-0000-0000-0000000000a4',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a4','email','engineer@acme.test'),
   'email', now(), now(), now()),
  ('admin@acme.test','00000000-0000-0000-0000-0000000000a5',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000a5','email','admin@acme.test'),
   'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

-- profiles (5 roles incl. Admin super-user); skills = neutral creds; location = free-text
insert into profiles (id, company_id, full_name, email, role, title, location, skills, utilization) values
  ('00000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-000000000001','Bob Director','exec@acme.test','Executive','Managing Director','HQ','{"PMP"}',60),
  ('00000000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-000000000001','Alice Manager','pm@acme.test','Project Manager','Senior PM','HQ','{"PMP","PMI-SP"}',85),
  ('00000000-0000-0000-0000-0000000000a3','c0000000-0000-0000-0000-000000000001','Carol Finance','finance@acme.test','Finance','Finance Lead','HQ','{"CPA"}',75),
  ('00000000-0000-0000-0000-0000000000a4','c0000000-0000-0000-0000-000000000001','Dave Engineer','engineer@acme.test','Engineer','Project Engineer','Regional Site B','{"PE"}',90),
  ('00000000-0000-0000-0000-0000000000a5','c0000000-0000-0000-0000-000000000001','Erin Admin','admin@acme.test','Admin','System Administrator','HQ','{}',10);

-- projects (neutral names; PM = Alice; client = Innovate Corp)
insert into projects (id, code, name, status, client_id, project_manager_id, contract_value, budget, spent, start_date, end_date) values
  ('40000000-0000-0000-0000-000000000001','P001','Innovate Corp HQ Fit-Out','Ongoing Project','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',5000000,4700000,2100000,'2026-01-06','2026-12-18'),
  ('40000000-0000-0000-0000-000000000002','P002','Northwind ERP Rollout','Tender Submitted','c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',1200000,0,0,null,null),
  ('40000000-0000-0000-0000-000000000003','P010','Regional Services Program','PQ Submitted','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',800000,0,0,null,null),
  ('40000000-0000-0000-0000-000000000004','P003','Acme Internal Platform','Ongoing Project','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',3000000,2000000,1900000,'2026-02-01','2026-11-30');

-- budget versions: exactly one Active per project (satisfies partial unique index).
-- v2 is seeded as Draft so its line-items can be inserted past the 0005 not-Draft trigger
-- (budget_line_items_draft_guard), then promoted to Active below — final state is unchanged.
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,'Initial Budget','Archived'),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',2,'Revised Budget','Draft');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000002','Labor','Project team',2000000,1200000),
  ('50000000-0000-0000-0000-000000000002','Materials','Fit-out materials',1700000,900000),
  ('50000000-0000-0000-0000-000000000002','Contingency','Reserve',1000000,0);
update budget_versions set status = 'Active' where id = '50000000-0000-0000-0000-000000000002';

-- budget versions: P002 (ERP Rollout — Labor + Materials), P003 (Internal Platform — 2,000,000 target),
-- P010 (Regional Services — Labor + Subcontractors). Follow Draft→insert-items→promote-to-Active so the
-- budget_line_items_draft_guard trigger (0005) does not reject the inserts.
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002',1,'Initial Budget','Draft'),
  ('50000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000004',1,'Initial Budget','Draft'),
  ('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000003',1,'Initial Budget','Draft');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  -- P002: ERP Rollout — Labor + Materials (SPD-S1: budget reduced to 1,000,000 for non-trivial projected margin)
  ('50000000-0000-0000-0000-000000000003','Labor','ERP implementation team',700000,0),
  ('50000000-0000-0000-0000-000000000003','Materials','Software licenses & infrastructure',300000,0),
  -- P003: Acme Internal Platform — sums to 2,000,000
  ('50000000-0000-0000-0000-000000000004','Labor','Platform development team',1400000,1200000),
  ('50000000-0000-0000-0000-000000000004','Materials','Infrastructure & tooling',400000,500000),
  ('50000000-0000-0000-0000-000000000004','Contingency','Reserve',200000,200000),
  -- P010: Regional Services Program — Labor + Subcontractors (SPD-S1: budget reduced to 600,000 for non-trivial projected margin)
  ('50000000-0000-0000-0000-000000000005','Labor','Program management',250000,0),
  ('50000000-0000-0000-0000-000000000005','Subcontractors','Field delivery partners',350000,0);
update budget_versions set status = 'Active' where id in (
  '50000000-0000-0000-0000-000000000003',
  '50000000-0000-0000-0000-000000000004',
  '50000000-0000-0000-0000-000000000005');

-- procurement rows (header only; no quotation/item children on new rows to avoid partial-unique index work)
insert into procurements (id, code, title, project_id, requested_by_id, status, total_value, vendor_id, created_at) values
  ('60000000-0000-0000-0000-000000000001','PROC-2026-004','Workstations & AV','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Vendor Quoted',150000,null,'2026-02-05T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000002','PROC-2026-001','Network Infrastructure','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Ordered',85000,'c0000000-0000-0000-0000-000000000004','2026-01-10T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000003','PROC-2026-002','Safety Equipment & PPE','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a4','Requested',22500,null,'2026-01-20T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000004','PROC-2026-003','Survey Software Licenses','40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2','Draft',9800,null,'2026-01-25T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000005','PROC-2026-005','Office Fit-Out Furniture','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Paid',320000,'c0000000-0000-0000-0000-000000000005','2025-12-01T00:00:00Z'),
  -- Dedicated Draft fixture for AC-CONFIRM-001 (confirm-gate cancel test). Kept distinct from
  -- PROC-003 (…004, which AC-816 walks Draft→Paid) so the two specs never collide in a parallel run.
  ('60000000-0000-0000-0000-000000000006','PROC-2026-006','Confirm-Gate Fixture','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Draft',12000,null,'2026-02-20T00:00:00Z');
insert into procurement_items (procurement_id, name, description, quantity, rate) values
  ('60000000-0000-0000-0000-000000000001','Workstation','Desk + chair',50,1500),
  ('60000000-0000-0000-0000-000000000001','AV unit','Conference AV',5,15000);
insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected) values
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','APX-Q-101',152000,'2026-02-10',false),
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000005','SYN-Q-220',148000,'2026-02-11',false);
insert into procurement_documents (procurement_id, type, reference_number, status, date) values
  ('60000000-0000-0000-0000-000000000001','RFQ','RFQ-2026-004','Issued','2026-02-05');

-- F1 — Lifecycle seed backfill (plan Phase F1, AC-804/815/816 data).
-- Backfill three procurements with doc-trail data at varied lifecycle stages.
-- org_id is intentionally omitted on all inserts — column default keeps the
-- client-unspoofable seam consistent (ADR-0011/ADR-0012).
-- NOTE: the {PREFIX}-YYMMDD#### doc numbers below are STATIC dev fixtures, hand-written to look
-- realistic. They are decoupled from the live `procurement_doc_counters` minter — seeding them does
-- NOT advance any counter, so the first runtime mint still starts at 0001 for the seed's org/day.

-- Row 002 (Ordered, mid-flow): PR# + PO# on procurements; selected quotation with VQ#;
-- a Partial goods receipt (GR#). Lands in the Committed set (future spent derivation).
-- requested_by=a2 (pm), approved_by=a3 (finance) — distinct for SoD representability.
update procurements set
  pr_number      = 'PR-2601100001',
  po_number      = 'PO-2601100001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a3'
where id = '60000000-0000-0000-0000-000000000002';

insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected, vq_number) values
  ('60000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000004','APX-NET-55',85000,'2026-01-08',true,'VQ-2601100001');

insert into procurement_receipts (procurement_id, gr_number, receipt_date, status) values
  ('60000000-0000-0000-0000-000000000002','GR-2601100001','2026-01-10','Partial');

-- Row 003 (Requested, early): PR# only — exercises the empty-trail / non-Committed rendering.
-- requested_by=a4 (engineer); no approver yet.
update procurements set
  pr_number = 'PR-2601200001'
where id = '60000000-0000-0000-0000-000000000003';

-- Row 005 (Paid, completed): full PR/VQ/PO trail + a Paid invoice (VI#).
-- requested_by=a2 (pm), approved_by=a3 (finance) — distinct, satisfies SoD representation.
-- YYMMDD = 251201 matches created_at 2025-12-01.
update procurements set
  pr_number      = 'PR-2512010001',
  po_number      = 'PO-2512010001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a3'
where id = '60000000-0000-0000-0000-000000000005';

insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected, vq_number) values
  ('60000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000005','SYN-FURN-01',320000,'2025-11-25',true,'VQ-2512010001');

insert into procurement_invoices (procurement_id, vi_number, invoice_date, status) values
  ('60000000-0000-0000-0000-000000000005','VI-2512010001','2025-12-15','Paid');

-- E1 — Seed enrichment for timesheet approval module (AC-904/911 fixtures, plan Phase E1).
-- Set manager_id so the Dave→Alice→Bob chain exists:
--   Dave (a4, Engineer) reports to Alice (a2, PM); Alice reports to Bob (a1, Executive).
--   Bob's manager_id stays null (top of chain — Exec/Admin fallback fixture).
-- Uses post-insert UPDATE so no row references a not-yet-inserted manager (R2).
-- Both timesheets remain Draft so the e2e (AC-911) performs Draft→Submitted itself.
update profiles set manager_id = '00000000-0000-0000-0000-0000000000a2'
  where id = '00000000-0000-0000-0000-0000000000a4';  -- Dave → Alice
update profiles set manager_id = '00000000-0000-0000-0000-0000000000a1'
  where id = '00000000-0000-0000-0000-0000000000a2';  -- Alice → Bob

-- timesheets (Monday week_start). Engineer = 16h (own rows); PM = 10h (own rows). Finance: none (empty-state AC-604).
insert into timesheets (id, user_id, week_start_date, status) values
  ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a4','2026-06-01','Draft'),  -- Engineer; 2026-06-01 is a Monday
  ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2','2026-06-01','Draft');  -- PM
insert into timesheet_entries (timesheet_id, project_id, entry_date, hours, notes) values
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-01',8,'Site coordination'),
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-02',8,'Drawings review'),
  ('70000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','2026-06-01',6,'Client workshop'),
  ('70000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','2026-06-02',4,'Status report');

-- tasks + one dependency
insert into tasks (id, project_id, name, start_date, end_date, assignee_id, status) values
  ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Demolition','2026-01-06','2026-02-06','00000000-0000-0000-0000-0000000000a4','Done'),
  ('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Fit-out','2026-02-09','2026-06-30','00000000-0000-0000-0000-0000000000a4','In Progress');
insert into task_dependencies (task_id, depends_on_id) values
  ('80000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001');

-- E1/E2 — Seed enrichment for projects revenue/transitions module (plan Phase E, AC-1010 data; supports #5).
-- Backfill won-project decision data on the two Ongoing (won) projects so #5's win-rate numerator
-- + on-hand value have real data. org_id intentionally omitted on all updates — column default seam.
update projects set
  customer_contract_ref = 'CPO-2026-001',
  contract_date         = '2026-01-06',
  decided_at            = '2026-01-06T00:00:00Z'
where id = '40000000-0000-0000-0000-000000000001';  -- P001 Innovate Corp HQ Fit-Out (Ongoing)

update projects set
  customer_contract_ref = 'CPO-2026-003',
  contract_date         = '2026-02-01',
  decided_at            = '2026-02-01T00:00:00Z'
where id = '40000000-0000-0000-0000-000000000004';  -- P003 Acme Internal Platform (Ongoing)

-- E2 — Add a Loss Tender project (win-rate denominator for #5).
-- PM = Alice (a2); client = Northwind (c3). decided_at = a fixed loss-decision date.
-- null customer_contract_ref / contract_date (FR-PR-006: no customer PO on loss).
-- fresh code 'P004' satisfies unique(org_id, code). org_id omitted = column default.
insert into projects (id, code, name, status, client_id, project_manager_id,
                      contract_value, budget, spent, decided_at) values
  ('40000000-0000-0000-0000-000000000005','P004','Coastal Depot Bid','Loss Tender',
   'c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   650000,0,0,'2026-02-20T00:00:00Z');

-- Budget for P004 (AC-733 invariant: every project needs exactly one Active budget_version).
-- Loss Tender project: a minimal tender-prep budget stub (AC-733 invariant requires >=1 line item).
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000005',1,'Tender Budget','Draft');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000006','Labor','Tender preparation',5000,0);
update budget_versions set status = 'Active' where id = '50000000-0000-0000-0000-000000000006';

-- P011 "Highfield Bridge Survey" — a second Tender Submitted project used exclusively by the
-- AC-SP e2e drilldown spec (AC-SP-206/207). Keeping it distinct from P002 prevents ordering-
-- dependent state mutation: AC-SP-207 wins/loses this deal; AC-1117 and AC-1011 act on P002,
-- so the two specs never share a row that gets mutated. code='P011' satisfies unique(org_id,code).
insert into projects (id, code, name, status, client_id, project_manager_id,
                      contract_value, budget, spent) values
  ('40000000-0000-0000-0000-000000000011','P011','Highfield Bridge Survey','Tender Submitted',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   950000,0,0);
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000011',1,'Tender Budget','Draft');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000011','Labor','Survey preparation',950000,0);
update budget_versions set status = 'Active' where id = '50000000-0000-0000-0000-000000000011';

-- incident report (neutral; schema-only MVP)
insert into incident_reports (incident_date, type, severity, location, description, status, reported_by) values
  ('2026-03-15','Near Miss','Low','Regional Site B','Trip hazard reported and cleared','Closed','00000000-0000-0000-0000-0000000000a4');

-- project document
insert into project_documents (project_id, code, category, title, revision, status, doc_date, author_id) values
  ('40000000-0000-0000-0000-000000000001','DOC-001','Drawing','Floor Plan Rev B','B','Issued','2026-01-20','00000000-0000-0000-0000-0000000000a2');
