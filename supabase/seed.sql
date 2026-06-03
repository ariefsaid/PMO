-- seed.sql — single-tenant, generic professional-services seed (de-O&G'd, baseline §8).
-- The default org ('00000000-...-001') is created by migration 0001; do not re-insert it.
--
-- NOTE (Director decision #2): the auth.users rows below are BARE (id + email only) — no encrypted
-- password and no GoTrue identity, so they are NOT login-able. They exist only so the profiles FK
-- (profiles.id -> auth.users.id) resolves on a fresh `supabase db reset`. The Auth issue will replace
-- these with real credentialed GoTrue users.

-- companies
insert into companies (id, name, type) values
  ('c0000000-0000-0000-0000-000000000001','Acme Consulting Group','Internal'),
  ('c0000000-0000-0000-0000-000000000002','Innovate Corp','Client'),
  ('c0000000-0000-0000-0000-000000000003','Northwind Manufacturing','Client'),
  ('c0000000-0000-0000-0000-000000000004','Apex Supplies Ltd','Vendor'),
  ('c0000000-0000-0000-0000-000000000005','Synergy Logistics','Vendor');

-- auth users (local-dev only; bare rows — see NOTE above)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1','exec@acme.test'),
  ('00000000-0000-0000-0000-0000000000a2','pm@acme.test'),
  ('00000000-0000-0000-0000-0000000000a3','finance@acme.test'),
  ('00000000-0000-0000-0000-0000000000a4','engineer@acme.test'),
  ('00000000-0000-0000-0000-0000000000a5','admin@acme.test')
on conflict (id) do nothing;

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
  ('40000000-0000-0000-0000-000000000003','P010','Regional Services Program','PQ Submitted','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',800000,0,0,null,null);

-- budget versions: exactly one Active per project (satisfies partial unique index)
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,'Initial Budget','Archived'),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',2,'Revised Budget','Active');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000002','Labor','Project team',2000000,1200000),
  ('50000000-0000-0000-0000-000000000002','Materials','Fit-out materials',1700000,900000),
  ('50000000-0000-0000-0000-000000000002','Contingency','Reserve',1000000,0);

-- procurement (Vendor Quoted) + items + quotations (none selected -> no partial-unique conflict) + document
insert into procurements (id, code, title, project_id, requested_by_id, status, total_value, vendor_id) values
  ('60000000-0000-0000-0000-000000000001','PROC-2026-004','Workstations & AV','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Vendor Quoted',150000,null);
insert into procurement_items (procurement_id, name, description, quantity, rate) values
  ('60000000-0000-0000-0000-000000000001','Workstation','Desk + chair',50,1500),
  ('60000000-0000-0000-0000-000000000001','AV unit','Conference AV',5,15000);
insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected) values
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','APX-Q-101',152000,'2026-02-10',false),
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000005','SYN-Q-220',148000,'2026-02-11',false);
insert into procurement_documents (procurement_id, type, reference_number, status, date) values
  ('60000000-0000-0000-0000-000000000001','RFQ','RFQ-2026-004','Issued','2026-02-05');

-- timesheet (Monday week_start) + entries
insert into timesheets (id, user_id, week_start_date, status) values
  ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a4','2026-06-01','Draft');  -- 2026-06-01 is a Monday
insert into timesheet_entries (timesheet_id, project_id, entry_date, hours, notes) values
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-01',8,'Site coordination'),
  ('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','2026-06-02',8,'Drawings review');

-- tasks + one dependency
insert into tasks (id, project_id, name, start_date, end_date, assignee_id, status) values
  ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Demolition','2026-01-06','2026-02-06','00000000-0000-0000-0000-0000000000a4','Done'),
  ('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Fit-out','2026-02-09','2026-06-30','00000000-0000-0000-0000-0000000000a4','In Progress');
insert into task_dependencies (task_id, depends_on_id) values
  ('80000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001');

-- incident report (neutral; schema-only MVP)
insert into incident_reports (incident_date, type, severity, location, description, status, reported_by) values
  ('2026-03-15','Near Miss','Low','Regional Site B','Trip hazard reported and cleared','Closed','00000000-0000-0000-0000-0000000000a4');

-- project document
insert into project_documents (project_id, code, category, title, revision, status, doc_date, author_id) values
  ('40000000-0000-0000-0000-000000000001','DOC-001','Drawing','Floor Plan Rev B','B','Issued','2026-01-20','00000000-0000-0000-0000-0000000000a2');
