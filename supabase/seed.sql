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

-- budget versions: exactly one Active per project (satisfies partial unique index)
insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,'Initial Budget','Archived'),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',2,'Revised Budget','Active');
insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000002','Labor','Project team',2000000,1200000),
  ('50000000-0000-0000-0000-000000000002','Materials','Fit-out materials',1700000,900000),
  ('50000000-0000-0000-0000-000000000002','Contingency','Reserve',1000000,0);

-- procurement rows (header only; no quotation/item children on new rows to avoid partial-unique index work)
insert into procurements (id, code, title, project_id, requested_by_id, status, total_value, vendor_id, created_at) values
  ('60000000-0000-0000-0000-000000000001','PROC-2026-004','Workstations & AV','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Vendor Quoted',150000,null,'2026-02-05T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000002','PROC-2026-001','Network Infrastructure','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Ordered',85000,'c0000000-0000-0000-0000-000000000004','2026-01-10T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000003','PROC-2026-002','Safety Equipment & PPE','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a4','Requested',22500,null,'2026-01-20T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000004','PROC-2026-003','Survey Software Licenses','40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2','Draft',9800,null,'2026-01-25T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000005','PROC-2026-005','Office Fit-Out Furniture','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','Paid',320000,'c0000000-0000-0000-0000-000000000005','2025-12-01T00:00:00Z');
insert into procurement_items (procurement_id, name, description, quantity, rate) values
  ('60000000-0000-0000-0000-000000000001','Workstation','Desk + chair',50,1500),
  ('60000000-0000-0000-0000-000000000001','AV unit','Conference AV',5,15000);
insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected) values
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000004','APX-Q-101',152000,'2026-02-10',false),
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000005','SYN-Q-220',148000,'2026-02-11',false);
insert into procurement_documents (procurement_id, type, reference_number, status, date) values
  ('60000000-0000-0000-0000-000000000001','RFQ','RFQ-2026-004','Issued','2026-02-05');

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

-- incident report (neutral; schema-only MVP)
insert into incident_reports (incident_date, type, severity, location, description, status, reported_by) values
  ('2026-03-15','Near Miss','Low','Regional Site B','Trip hazard reported and cleared','Closed','00000000-0000-0000-0000-0000000000a4');

-- project document
insert into project_documents (project_id, code, category, title, revision, status, doc_date, author_id) values
  ('40000000-0000-0000-0000-000000000001','DOC-001','Drawing','Floor Plan Rev B','B','Issued','2026-01-20','00000000-0000-0000-0000-0000000000a2');
