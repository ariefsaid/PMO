-- seed.sql — single-tenant solar-EPC demo seed (canonical, local-only).
-- "today" anchor ≈ 2026-06-15. Covers every app feature.
-- PRESERVE all auth/profile fixtures (a1-a5, b1-b4) for e2e isolation.
-- Do NOT apply to prod. Run via: supabase db reset (from repo root).

-- ============================================================
-- §A  auth.users  (local-dev only; password = Passw0rd!dev)
--     Token columns MUST be '' not NULL (GoTrue Go driver scans as non-null).
-- ============================================================

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
   '', '', '', '', '', ''),
  -- AC-911 ISOLATION: b1 dedicated engineer, b2 dedicated PM
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b1',
   'authenticated','authenticated','ts-approve-eng@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b2',
   'authenticated','authenticated','ts-approve-mgr@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  -- AC-IXD-TS-001 ISOLATION: b3 dedicated engineer (no seeded timesheet)
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b3',
   'authenticated','authenticated','ts-colocated-eng@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  -- AC-IXD-TS-W5-3 ISOLATION: b4 pure seed actor (no identity row — can never sign in)
  ('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-0000000000b4',
   'authenticated','authenticated','wave5-bulkeng@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '')
on conflict (id) do nothing;

-- ============================================================
-- §B  auth.identities
-- ============================================================

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
   'email', now(), now(), now()),
  ('ts-approve-eng@acme.test','00000000-0000-0000-0000-0000000000b1',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000b1','email','ts-approve-eng@acme.test'),
   'email', now(), now(), now()),
  ('ts-approve-mgr@acme.test','00000000-0000-0000-0000-0000000000b2',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000b2','email','ts-approve-mgr@acme.test'),
   'email', now(), now(), now()),
  ('ts-colocated-eng@acme.test','00000000-0000-0000-0000-0000000000b3',
   jsonb_build_object('sub','00000000-0000-0000-0000-0000000000b3','email','ts-colocated-eng@acme.test'),
   'email', now(), now(), now())
  -- b4 intentionally has NO identity row (pure seed actor, never logs in)
on conflict (provider_id, provider) do nothing;

-- ============================================================
-- §C  companies — Solaris Grid EPC (Internal) + clients + vendors
-- ============================================================

insert into companies (id, name, type) values
  -- Internal firm
  ('c0000000-0000-0000-0000-000000000001', 'Solaris Grid EPC',          'Internal'),
  -- Clients
  ('c0000000-0000-0000-0000-000000000002', 'Meridian Steelworks',       'Client'),
  ('c0000000-0000-0000-0000-000000000003', 'Cascade Foods Processing',  'Client'),
  ('c0000000-0000-0000-0000-000000000004', 'Atlas Chemicals Plant',     'Client'),
  ('c0000000-0000-0000-0000-000000000005', 'Harbor Logistics Park',     'Client'),
  ('c0000000-0000-0000-0000-000000000006', 'Northgate Mills Ltd',       'Client'),
  ('c0000000-0000-0000-0000-000000000007', 'Riverside Plastics Co.',    'Client'),
  -- Vendors
  ('c0000000-0000-0000-0000-000000000008', 'SunVolt Modules Co.',       'Vendor'),
  ('c0000000-0000-0000-0000-000000000009', 'VoltEdge Inverters',        'Vendor'),
  ('c0000000-0000-0000-0000-000000000010', 'RackMount Structures',      'Vendor'),
  ('c0000000-0000-0000-0000-000000000011', 'CableCore Electrical',      'Vendor')
on conflict (id) do nothing;

-- ============================================================
-- §D  profiles (solar personas + isolation actors)
-- ============================================================

insert into profiles (id, company_id, full_name, email, role, title, location, skills, utilization) values
  ('00000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-000000000001',
   'Mara Lindqvist',    'exec@acme.test',    'Executive',       'Managing Director',       'HQ',           '{"PMP"}',          60),
  ('00000000-0000-0000-0000-0000000000a2','c0000000-0000-0000-0000-000000000001',
   'Diego Salvatierra', 'pm@acme.test',      'Project Manager', 'Senior Project Manager',  'HQ',           '{"PMP","PMI-SP"}', 85),
  ('00000000-0000-0000-0000-0000000000a3','c0000000-0000-0000-0000-000000000001',
   'Priya Ramanathan',  'finance@acme.test', 'Finance',         'Finance Controller',      'HQ',           '{"CPA"}',          75),
  ('00000000-0000-0000-0000-0000000000a4','c0000000-0000-0000-0000-000000000001',
   'Tomas Beck',        'engineer@acme.test','Engineer',        'Lead PV Engineer',        'Site A',       '{"PE"}',           90),
  ('00000000-0000-0000-0000-0000000000a5','c0000000-0000-0000-0000-000000000001',
   'Erin Adebayo',      'admin@acme.test',   'Admin',           'System Administrator',    'HQ',           '{}',               10),
  -- AC-911 isolation
  ('00000000-0000-0000-0000-0000000000b1','c0000000-0000-0000-0000-000000000001',
   'Grace TSApprove',   'ts-approve-eng@acme.test','Engineer',  'Project Engineer',        'Site B',       '{"PE"}',           90),
  ('00000000-0000-0000-0000-0000000000b2','c0000000-0000-0000-0000-000000000001',
   'Heidi TSManager',   'ts-approve-mgr@acme.test','Project Manager','Senior PM',          'HQ',           '{"PMP"}',          80),
  -- AC-IXD-TS-001 isolation (no seeded timesheet)
  ('00000000-0000-0000-0000-0000000000b3','c0000000-0000-0000-0000-000000000001',
   'Ivan TSColocated',  'ts-colocated-eng@acme.test','Engineer','Project Engineer',        'Site B',       '{"PE"}',           88),
  -- AC-IXD-TS-W5-3 isolation (pure seed actor — already-submitted prior-week sheet)
  ('00000000-0000-0000-0000-0000000000b4','c0000000-0000-0000-0000-000000000001',
   'Wave5 BulkEng',     'wave5-bulkeng@acme.test','Engineer',   'Project Engineer',        'Site B',       '{"PE"}',           90)
on conflict (id) do nothing;

-- Manager chain (post-insert UPDATEs to avoid forward-FK issues)
update profiles set manager_id = '00000000-0000-0000-0000-0000000000a2'
  where id = '00000000-0000-0000-0000-0000000000a4';   -- Tomas → Diego
update profiles set manager_id = '00000000-0000-0000-0000-0000000000a1'
  where id in ('00000000-0000-0000-0000-0000000000a2',
               '00000000-0000-0000-0000-0000000000a3'); -- Diego, Priya → Mara
update profiles set manager_id = '00000000-0000-0000-0000-0000000000b2'
  where id = '00000000-0000-0000-0000-0000000000b1';   -- Grace → Heidi
update profiles set manager_id = '00000000-0000-0000-0000-0000000000a2'
  where id = '00000000-0000-0000-0000-0000000000b4';   -- Wave5 BulkEng → Diego (pm@)


-- ============================================================
-- §E  projects — full lifecycle (pipeline + delivery + won/lost)
-- ============================================================
-- UUID prefix 40000000-... (existing e2e fixtures preserved: P001-P004, P011-P013)
-- SV-2310 replaces the old P010 code; New solar projects use 41000000-... namespace

insert into projects
  (id, code, name, status, client_id, project_manager_id,
   contract_value, budget, spent, start_date, end_date)
values
  -- ── Delivery (on-hand) projects ──────────────────────────────────────────────
  -- SP-2401: healthy, ~50% delivery
  ('41000000-0000-0000-0000-000000000001','SP-2401',
   'Meridian Steelworks 4.2 MW Rooftop PV',   'Ongoing Project',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   5250000,4500000,0,'2025-09-01','2026-06-30'),
  -- SP-2402: at-risk (committed spend > budget), ~80% delivery but behind schedule
  --   original end was 2026-04-30; overrunning — extended to 2026-07-31
  ('41000000-0000-0000-0000-000000000002','SP-2402',
   'Cascade Foods 6.0 MW Ground-Mount PV',    'Ongoing Project',
   'c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   7800000,6900000,0,'2025-06-01','2026-07-31'),
  -- SP-2403: Close Out — 100% complete
  ('41000000-0000-0000-0000-000000000003','SP-2403',
   'Atlas Chemicals 2.8 MW Carport PV',       'Close Out',
   'c0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a2',
   3600000,3000000,0,'2025-03-01','2025-12-15'),
  -- SP-2404: Won, Pending KoM — recently won, ~20% delivery
  ('41000000-0000-0000-0000-000000000004','SP-2404',
   'Harbor Logistics 5.5 MW Rooftop PV',      'Won, Pending KoM',
   'c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a2',
   6400000,5800000,0,'2026-05-01','2027-02-28'),
  -- ── Pipeline projects ─────────────────────────────────────────────────────────
  -- SP-2405: Negotiation stage
  ('41000000-0000-0000-0000-000000000005','SP-2405',
   'Northgate Mills 3.5 MW Rooftop PV',       'Negotiation',
   'c0000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-0000000000a2',
   4100000,0,0,null,null),
  -- SP-2406: Tender Submitted
  ('41000000-0000-0000-0000-000000000006','SP-2406',
   'Riverside Plastics 2.1 MW Carport PV',    'Tender Submitted',
   'c0000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-0000000000a2',
   2900000,0,0,null,null),
  -- SP-2407: PQ Submitted
  ('41000000-0000-0000-0000-000000000007','SP-2407',
   'Cascade Foods Phase 2 — 4.0 MW Extension','PQ Submitted',
   'c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   4800000,0,0,null,null),
  -- SP-2408: Leads
  ('41000000-0000-0000-0000-000000000008','SP-2408',
   'Meridian East Wing Solar Scoping',        'Leads',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   1800000,0,0,null,null),
  -- SP-2409: Loss Tender (win-rate denominator)
  ('41000000-0000-0000-0000-000000000009','SP-2409',
   'Harbor Cold Store Bid — Lost',            'Loss Tender',
   'c0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a2',
   3200000,0,0,null,null),
  -- ── e2e isolation fixtures (UNCHANGED — only budgets added below) ─────────────
  -- P011 used exclusively by AC-SP drilldown spec
  ('40000000-0000-0000-0000-000000000011','P011','Highfield Bridge Survey','Tender Submitted',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   950000,0,0,null,null),
  -- P012 used exclusively by AC-1011 win-a-deal e2e
  ('40000000-0000-0000-0000-000000000012','P012','Eastgate Depot Upgrade','Tender Submitted',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   1000000,0,0,null,null),
  -- P013 used exclusively by AC-DEL-022 delivery-milestones e2e (zero milestones intentional)
  ('40000000-0000-0000-0000-000000000013','P013','Seabridge Terminal Delivery','Ongoing Project',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   2000000,2000000,0,null,null),
  -- P002 Tender Submitted (stale last_update for AC-1117 / pipeline attention)
  ('40000000-0000-0000-0000-000000000002','P002','Northwind ERP Rollout','Tender Submitted',
   'c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   1200000,0,0,null,null),
  -- SV-2310 PQ Submitted (pipeline fixture for AC-IXD-WP-001/002 procurement specs)
  ('40000000-0000-0000-0000-000000000003','SV-2310','Riverside Plastics Phase 2 Scoping','PQ Submitted',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   800000,0,0,null,null),
  -- P001 Ongoing (timesheet / task fixture for e2e)
  ('40000000-0000-0000-0000-000000000001','P001','Innovate Corp HQ Fit-Out','Ongoing Project',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   5000000,4700000,2100000,'2026-01-06','2026-12-18'),
  -- P003 Ongoing (additional on-hand fixture for margin)
  ('40000000-0000-0000-0000-000000000004','P003','Acme Internal Platform','Ongoing Project',
   'c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   3000000,2000000,1900000,'2026-02-01','2026-11-30'),
  -- P004 Loss Tender (win-rate denominator)
  ('40000000-0000-0000-0000-000000000005','P004','Coastal Depot Bid','Loss Tender',
   'c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   650000,0,0,null,null)
on conflict (id) do nothing;

-- Win/loss backfill: contract refs + decided_at
update projects set
  customer_contract_ref = 'MSW-PO-2501', contract_date = '2025-08-15',
  decided_at = '2025-08-15T00:00:00Z'
  where id = '41000000-0000-0000-0000-000000000001'; -- SP-2401

update projects set
  customer_contract_ref = 'CFP-PO-2506', contract_date = '2025-05-20',
  decided_at = '2025-05-20T00:00:00Z'
  where id = '41000000-0000-0000-0000-000000000002'; -- SP-2402

update projects set
  customer_contract_ref = 'ACP-PO-2502', contract_date = '2025-02-10',
  decided_at = '2025-02-10T00:00:00Z'
  where id = '41000000-0000-0000-0000-000000000003'; -- SP-2403

update projects set
  customer_contract_ref = 'HLP-PO-2605', contract_date = '2026-05-01',
  decided_at = '2026-05-01T00:00:00Z'
  where id = '41000000-0000-0000-0000-000000000004'; -- SP-2404 Won, Pending KoM

update projects set
  decided_at = '2026-03-10T00:00:00Z'
  where id = '41000000-0000-0000-0000-000000000009'; -- SP-2409 Loss

-- Stale pipeline last_update (attention flag, mirrors AC-1117 / pgTAP 0057 pattern)
update projects set last_update = now() - interval '45 days'
  where id = '40000000-0000-0000-0000-000000000002'; -- P002 Northwind

-- e2e fixture win/loss backfill
update projects set
  customer_contract_ref = 'CPO-2026-001', contract_date = '2026-01-06',
  decided_at = '2026-01-06T00:00:00Z'
  where id = '40000000-0000-0000-0000-000000000001'; -- P001

update projects set
  customer_contract_ref = 'CPO-2026-003', contract_date = '2026-02-01',
  decided_at = '2026-02-01T00:00:00Z'
  where id = '40000000-0000-0000-0000-000000000004'; -- P003

update projects set
  decided_at = '2026-02-20T00:00:00Z'
  where id = '40000000-0000-0000-0000-000000000005'; -- P004 Loss


-- ============================================================
-- §F  budget_versions + budget_line_items
--     Pattern: insert Draft → insert line items → promote Active
--     Trigger enforce_draft_line_item rejects inserts on non-Draft versions.
-- ============================================================

-- ── Solar delivery projects ───────────────────────────────────────────────────

insert into budget_versions (id, project_id, version, name, status) values
  ('51000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',1,'Initial Budget','Archived'),
  ('51000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',2,'Revised Budget','Draft'),
  ('51000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000002',1,'Initial Budget','Draft'),
  ('51000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000003',1,'Initial Budget','Draft'),
  ('51000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000004',1,'Initial Budget','Draft')
on conflict (id) do nothing;

insert into budget_line_items
  (id, budget_version_id, category, description, budgeted_amount, actual_amount)
select vals.id, vals.bvid, vals.cat, vals.dsc, vals.budg, vals.act
from (values
  -- SP-2401 Revised (4,500,000 total — healthy)
  ('51000000-0000-0000-0000-000000001001'::uuid,'51000000-0000-0000-0000-000000000002'::uuid,
   'Materials'::budget_category,'PV modules — 7,800x 540W panels',2400000::numeric,1300000::numeric),
  ('51000000-0000-0000-0000-000000001002','51000000-0000-0000-0000-000000000002',
   'Equipment','String inverters & combiner boxes',700000,300000),
  ('51000000-0000-0000-0000-000000001003','51000000-0000-0000-0000-000000000002',
   'Subcontractors','Roof mounting structures & install',650000,250000),
  ('51000000-0000-0000-0000-000000001004','51000000-0000-0000-0000-000000000002',
   'Labor','Engineering & site supervision',400000,180000),
  ('51000000-0000-0000-0000-000000001005','51000000-0000-0000-0000-000000000002',
   'Permits & Fees','Grid connection & permits',150000,90000),
  ('51000000-0000-0000-0000-000000001006','51000000-0000-0000-0000-000000000002',
   'Contingency','Reserve',200000,0),
  -- SP-2402 Initial (6,900,000 total — at-risk: actuals run high)
  ('51000000-0000-0000-0000-000000002001','51000000-0000-0000-0000-000000000003',
   'Materials','PV modules — 11,200x 540W panels',3600000,3400000),
  ('51000000-0000-0000-0000-000000002002','51000000-0000-0000-0000-000000000003',
   'Equipment','Central inverters & transformers',1300000,1250000),
  ('51000000-0000-0000-0000-000000002003','51000000-0000-0000-0000-000000000003',
   'Subcontractors','Ground-mount piling & racking',1100000,1050000),
  ('51000000-0000-0000-0000-000000002004','51000000-0000-0000-0000-000000000003',
   'Labor','Engineering & construction crew',500000,470000),
  ('51000000-0000-0000-0000-000000002005','51000000-0000-0000-0000-000000000003',
   'Permits & Fees','Environmental & grid permits',200000,180000),
  ('51000000-0000-0000-0000-000000002006','51000000-0000-0000-0000-000000000003',
   'Contingency','Reserve',200000,40000),
  -- SP-2403 Close Out (3,000,000 — fully spent)
  ('51000000-0000-0000-0000-000000003001','51000000-0000-0000-0000-000000000004',
   'Materials','PV modules — 5,200x 540W panels',1500000,1500000),
  ('51000000-0000-0000-0000-000000003002','51000000-0000-0000-0000-000000000004',
   'Equipment','Carport inverters',600000,600000),
  ('51000000-0000-0000-0000-000000003003','51000000-0000-0000-0000-000000000004',
   'Subcontractors','Carport steel structures',650000,650000),
  ('51000000-0000-0000-0000-000000003004','51000000-0000-0000-0000-000000000004',
   'Labor','Engineering & install',200000,200000),
  ('51000000-0000-0000-0000-000000003005','51000000-0000-0000-0000-000000000004',
   'Contingency','Reserve',50000,0),
  -- SP-2404 Won, Pending KoM (5,800,000 — early spend)
  ('51000000-0000-0000-0000-000000004001','51000000-0000-0000-0000-000000000005',
   'Materials','PV modules — 10,200x 540W panels',3200000,180000),
  ('51000000-0000-0000-0000-000000004002','51000000-0000-0000-0000-000000000005',
   'Equipment','Central inverters & SCADA',1200000,0),
  ('51000000-0000-0000-0000-000000004003','51000000-0000-0000-0000-000000000005',
   'Subcontractors','Rooftop mounting & civil works',900000,0),
  ('51000000-0000-0000-0000-000000004004','51000000-0000-0000-0000-000000000005',
   'Labor','Engineering & commissioning',400000,80000),
  ('51000000-0000-0000-0000-000000004005','51000000-0000-0000-0000-000000000005',
   'Contingency','Reserve',100000,0)
) as vals(id,bvid,cat,dsc,budg,act)
join budget_versions bv on bv.id = vals.bvid and bv.status = 'Draft'
where not exists (select 1 from budget_line_items x where x.id = vals.id);

update budget_versions set status = 'Active'
  where id in (
    '51000000-0000-0000-0000-000000000002',
    '51000000-0000-0000-0000-000000000003',
    '51000000-0000-0000-0000-000000000004',
    '51000000-0000-0000-0000-000000000005');

-- ── Pipeline/Loss budget stubs ────────────────────────────────────────────────

insert into budget_versions (id, project_id, version, name, status) values
  ('51000000-0000-0000-0000-000000000011','41000000-0000-0000-0000-000000000005',1,'Tender Budget','Draft'),
  ('51000000-0000-0000-0000-000000000012','41000000-0000-0000-0000-000000000006',1,'Tender Budget','Draft'),
  ('51000000-0000-0000-0000-000000000013','41000000-0000-0000-0000-000000000007',1,'Tender Budget','Draft'),
  ('51000000-0000-0000-0000-000000000014','41000000-0000-0000-0000-000000000008',1,'Scoping Budget','Draft'),
  ('51000000-0000-0000-0000-000000000015','41000000-0000-0000-0000-000000000009',1,'Pipeline Budget','Draft')
on conflict (id) do nothing;

insert into budget_line_items
  (id, budget_version_id, category, description, budgeted_amount, actual_amount)
select vals.id, vals.bvid, vals.cat, vals.dsc, vals.budg, vals.act
from (values
  ('51000000-0000-0000-0000-000000001101'::uuid,'51000000-0000-0000-0000-000000000011'::uuid,
   'Labor'::budget_category,'Tender preparation & design',4100000::numeric,0::numeric),
  ('51000000-0000-0000-0000-000000001201','51000000-0000-0000-0000-000000000012',
   'Labor','Tender preparation & design',2900000,0),
  ('51000000-0000-0000-0000-000000001301','51000000-0000-0000-0000-000000000013',
   'Labor','PQ tender preparation',4800000,0),
  ('51000000-0000-0000-0000-000000001401','51000000-0000-0000-0000-000000000014',
   'Labor','Scoping & feasibility',1800000,0),
  ('51000000-0000-0000-0000-000000001501','51000000-0000-0000-0000-000000000015',
   'Labor','Tender preparation',3200000,0)
) as vals(id,bvid,cat,dsc,budg,act)
join budget_versions bv on bv.id = vals.bvid and bv.status = 'Draft'
where not exists (select 1 from budget_line_items x where x.id = vals.id);

update budget_versions set status = 'Active'
  where id in (
    '51000000-0000-0000-0000-000000000011',
    '51000000-0000-0000-0000-000000000012',
    '51000000-0000-0000-0000-000000000013',
    '51000000-0000-0000-0000-000000000014',
    '51000000-0000-0000-0000-000000000015');

-- ── e2e isolation project budgets (P001, P002/SV-2310, P003, P004, P011, P012, P013) ──

insert into budget_versions (id, project_id, version, name, status) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',1,'Initial Budget','Archived'),
  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',2,'Revised Budget','Draft'),
  ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002',1,'Initial Budget','Draft'),
  ('50000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000004',1,'Initial Budget','Draft'),
  ('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000003',1,'Initial Budget','Draft'),
  ('50000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000005',1,'Tender Budget','Draft'),
  ('50000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000011',1,'Tender Budget','Draft'),
  ('50000000-0000-0000-0000-000000000012','40000000-0000-0000-0000-000000000012',1,'Tender Budget','Draft'),
  ('50000000-0000-0000-0000-000000000013','40000000-0000-0000-0000-000000000013',1,'Delivery Budget','Draft')
on conflict (id) do nothing;

insert into budget_line_items (budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('50000000-0000-0000-0000-000000000002','Labor','Project team',2000000,1200000),
  ('50000000-0000-0000-0000-000000000002','Materials','Fit-out materials',1700000,900000),
  ('50000000-0000-0000-0000-000000000002','Contingency','Reserve',1000000,0),
  ('50000000-0000-0000-0000-000000000003','Labor','ERP implementation team',700000,0),
  ('50000000-0000-0000-0000-000000000003','Materials','Software licenses & infrastructure',300000,0),
  ('50000000-0000-0000-0000-000000000004','Labor','Platform development team',1400000,1200000),
  ('50000000-0000-0000-0000-000000000004','Materials','Infrastructure & tooling',400000,500000),
  ('50000000-0000-0000-0000-000000000004','Contingency','Reserve',200000,200000),
  ('50000000-0000-0000-0000-000000000005','Labor','Program management',250000,0),
  ('50000000-0000-0000-0000-000000000005','Subcontractors','Field delivery partners',350000,0),
  ('50000000-0000-0000-0000-000000000006','Labor','Tender preparation',5000,0),
  ('50000000-0000-0000-0000-000000000011','Labor','Survey preparation',950000,0),
  ('50000000-0000-0000-0000-000000000012','Labor','Tender preparation',1000000,0),
  ('50000000-0000-0000-0000-000000000013','Labor','Delivery works',2000000,0);

update budget_versions set status = 'Active'
  where id in (
    '50000000-0000-0000-0000-000000000002',
    '50000000-0000-0000-0000-000000000003',
    '50000000-0000-0000-0000-000000000004',
    '50000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000006',
    '50000000-0000-0000-0000-000000000011',
    '50000000-0000-0000-0000-000000000012',
    '50000000-0000-0000-0000-000000000013');


-- ============================================================
-- §G  project_milestones — 4-phase EPC model per delivery project
--     Weights: Engineering 15 / Procurement 35 / Construction 40 / Commissioning 10
-- ============================================================

insert into project_milestones
  (id, project_id, name, sort_order, target_date, weight, input_pct)
values
  -- ── SP-2401 (Meridian Steelworks — healthy, ~50% delivery) ──────────────────
  -- Engineering 100% (2/2 Done tasks), Procurement ~71% (5/7 Done), Construction 25% (1/4), Comm 0%
  ('71000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
   'Engineering Design', 1,'2025-10-15',15,null),
  ('71000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',
   'Procurement',        2,'2026-01-31',35,null),
  ('71000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000001',
   'Construction',       3,'2026-04-30',40,null),
  ('71000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001',
   'Commissioning & Grid Connection',4,'2026-06-30',10,null),

  -- ── SP-2402 (Cascade Foods — at-risk, behind schedule) ──────────────────────
  -- Engineering 100%, Procurement 100%, Construction: input_pct=70 (PM) vs 40% calc (2/5 Done) DIVERGE
  -- target_dates PAST-DUE to show schedule pressure; project overran to 2026-07-31
  ('71000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000002',
   'Engineering Design', 1,'2025-08-15',15,null),
  ('71000000-0000-0000-0000-000000000006','41000000-0000-0000-0000-000000000002',
   'Procurement',        2,'2025-11-30',35,null),
  ('71000000-0000-0000-0000-000000000007','41000000-0000-0000-0000-000000000002',
   'Construction',       3,'2026-04-16',40,70),
  ('71000000-0000-0000-0000-000000000008','41000000-0000-0000-0000-000000000002',
   'Commissioning & Grid Connection',4,'2026-07-15',10,null),

  -- ── SP-2403 (Atlas Chemicals — Close Out, 100%) ───────────────────────────────
  ('71000000-0000-0000-0000-000000000009','41000000-0000-0000-0000-000000000003',
   'Engineering Design', 1,'2025-04-15',15,null),
  ('71000000-0000-0000-0000-000000000010','41000000-0000-0000-0000-000000000003',
   'Procurement',        2,'2025-06-30',35,null),
  ('71000000-0000-0000-0000-000000000011','41000000-0000-0000-0000-000000000003',
   'Construction',       3,'2025-10-31',40,null),
  ('71000000-0000-0000-0000-000000000012','41000000-0000-0000-0000-000000000003',
   'Commissioning & Grid Connection',4,'2025-12-15',10,null),

  -- ── SP-2404 (Harbor Logistics — Won, ~20% delivery) ──────────────────────────
  ('71000000-0000-0000-0000-000000000013','41000000-0000-0000-0000-000000000004',
   'Engineering Design', 1,'2026-07-31',15,null),
  ('71000000-0000-0000-0000-000000000014','41000000-0000-0000-0000-000000000004',
   'Procurement',        2,'2026-10-31',35,null),
  ('71000000-0000-0000-0000-000000000015','41000000-0000-0000-0000-000000000004',
   'Construction',       3,'2026-12-31',40,null),
  ('71000000-0000-0000-0000-000000000016','41000000-0000-0000-0000-000000000004',
   'Commissioning & Grid Connection',4,'2027-02-28',10,null)

on conflict (id) do update set
  name=excluded.name, sort_order=excluded.sort_order,
  target_date=excluded.target_date, weight=excluded.weight, input_pct=excluded.input_pct;


-- ============================================================
-- §H  tasks — EPC phases for all 4 delivery projects
--     SP-2401: ~50% — ENG done, PROC 5/7, CONST 1/4, COMM 0
--     SP-2402: at-risk — ENG done, PROC done, CONST 2/5+In Progress, COMM not started
--     SP-2403: Close Out — all Done
--     SP-2404: Won — ENG 1/2 In Progress, rest To Do
--     Plus undated tasks (Gantt undated footer) and e2e fixture tasks
-- ============================================================

insert into tasks (id, project_id, name, start_date, end_date, assignee_id, status) values

  -- ── SP-2401 Engineering Design (2 Done) ─────────────────────────────────────
  ('81000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
   'ENG — Detail Design Package','2025-09-01','2025-10-10','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',
   'ENG — Single Line Diagram','2025-09-01','2025-09-25','00000000-0000-0000-0000-0000000000a4','Done'),

  -- ── SP-2401 Procurement (5 Done + 2 In Progress = 5/7) ──────────────────────
  ('81000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000001',
   'PROC — Issue RFQ for Panels & Inverters','2025-10-11','2025-10-25','00000000-0000-0000-0000-0000000000a2','Done'),
  ('81000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001',
   'PROC — Evaluate Panel Vendor Quotations','2025-10-15','2025-10-31','00000000-0000-0000-0000-0000000000a2','Done'),
  ('81000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000001',
   'PROC — Place PV Module Purchase Order','2025-11-01','2025-11-10','00000000-0000-0000-0000-0000000000a2','Done'),
  ('81000000-0000-0000-0000-000000000006','41000000-0000-0000-0000-000000000001',
   'PROC — Confirm Inverter Delivery Schedule','2025-11-05','2025-11-15','00000000-0000-0000-0000-0000000000a2','Done'),
  ('81000000-0000-0000-0000-000000000007','41000000-0000-0000-0000-000000000001',
   'PROC — Receive & Inspect PV Modules at Site','2025-12-15','2025-12-30','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000008','41000000-0000-0000-0000-000000000001',
   'PROC — Panel & Inverter Procurement','2025-10-11','2026-01-31','00000000-0000-0000-0000-0000000000a2','In Progress'),
  ('81000000-0000-0000-0000-000000000009','41000000-0000-0000-0000-000000000001',
   'PROC — Mounting Structure Procurement','2025-10-11','2026-01-31','00000000-0000-0000-0000-0000000000a2','In Progress'),

  -- ── SP-2401 Construction (1 Done + 3 To Do = 1/4) ───────────────────────────
  ('81000000-0000-0000-0000-000000000010','41000000-0000-0000-0000-000000000001',
   'CONST — Site Survey & Geotech Rooftop','2026-01-05','2026-01-25','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000011','41000000-0000-0000-0000-000000000001',
   'CONST — Structural Load Calc & Racking Design','2026-01-26','2026-02-20','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000012','41000000-0000-0000-0000-000000000001',
   'CONST — Roof Mounting Install','2026-02-21','2026-04-15','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000013','41000000-0000-0000-0000-000000000001',
   'CONST — Electrical Termination','2026-04-16','2026-04-30','00000000-0000-0000-0000-0000000000a4','To Do'),

  -- ── SP-2401 Commissioning (3 To Do = 0/3) ───────────────────────────────────
  ('81000000-0000-0000-0000-000000000014','41000000-0000-0000-0000-000000000001',
   'COMM — Inverter Energization & String Testing','2026-05-01','2026-05-31','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000015','41000000-0000-0000-0000-000000000001',
   'COMM — Grid Interconnection Witness Test','2026-06-01','2026-06-15','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000016','41000000-0000-0000-0000-000000000001',
   'COMM — Performance Ratio Test & Handover','2026-06-16','2026-06-30','00000000-0000-0000-0000-0000000000a4','To Do'),

  -- ── SP-2401 undated tasks (Gantt footer) ────────────────────────────────────
  ('81000000-0000-0000-0000-000000000017','41000000-0000-0000-0000-000000000001',
   'Risk register update',null,null,'00000000-0000-0000-0000-0000000000a2','To Do'),
  ('81000000-0000-0000-0000-000000000018','41000000-0000-0000-0000-000000000001',
   'Stakeholder communication plan',null,null,'00000000-0000-0000-0000-0000000000a2','To Do'),

  -- ── SP-2402 Engineering Design (2 Done) ─────────────────────────────────────
  ('81000000-0000-0000-0000-000000000021','41000000-0000-0000-0000-000000000002',
   'ENG — Detail Design Package','2025-06-01','2025-07-15','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000022','41000000-0000-0000-0000-000000000002',
   'ENG — Single Line Diagram','2025-06-01','2025-06-30','00000000-0000-0000-0000-0000000000a4','Done'),

  -- ── SP-2402 Procurement (4 Done = 4/4) ──────────────────────────────────────
  ('81000000-0000-0000-0000-000000000023','41000000-0000-0000-0000-000000000002',
   'PROC — Panel & Inverter Procurement','2025-07-16','2025-09-30','00000000-0000-0000-0000-0000000000a2','Done'),
  ('81000000-0000-0000-0000-000000000024','41000000-0000-0000-0000-000000000002',
   'PROC — Mounting Structure Procurement','2025-07-16','2025-10-31','00000000-0000-0000-0000-0000000000a2','Done'),
  ('81000000-0000-0000-0000-000000000025','41000000-0000-0000-0000-000000000002',
   'PROC — Receive & Inspect Central Inverters','2025-09-15','2025-09-30','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000026','41000000-0000-0000-0000-000000000002',
   'PROC — Confirm HV Cable & Grid-Kit Delivery','2025-10-01','2025-10-15','00000000-0000-0000-0000-0000000000a2','Done'),

  -- ── SP-2402 Construction (2 Done + 1 In Progress + 2 To Do = 2/5 calc, input=70%) ──
  ('81000000-0000-0000-0000-000000000027','41000000-0000-0000-0000-000000000002',
   'CONST — Site Survey & Geotech Field Block A','2025-10-16','2025-11-10','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000028','41000000-0000-0000-0000-000000000002',
   'CONST — Drive Steel Piles Block A (600 piles)','2025-11-11','2026-01-15','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000029','41000000-0000-0000-0000-000000000002',
   'CONST — Mount PV Array Block B Racking','2026-01-16','2026-03-31','00000000-0000-0000-0000-0000000000a4','In Progress'),
  ('81000000-0000-0000-0000-000000000030','41000000-0000-0000-0000-000000000002',
   'CONST — Ground Mounting Install','2025-11-01','2026-03-31','00000000-0000-0000-0000-0000000000a4','In Progress'),
  ('81000000-0000-0000-0000-000000000031','41000000-0000-0000-0000-000000000002',
   'CONST — Electrical Termination & HV Connection','2026-03-01','2026-04-30','00000000-0000-0000-0000-0000000000a4','To Do'),

  -- ── SP-2402 Commissioning (3 To Do — overrunning, revised to Jun-Jul 2026) ──
  ('81000000-0000-0000-0000-000000000032','41000000-0000-0000-0000-000000000002',
   'COMM — Install DC String Cabling All Blocks','2026-05-16','2026-06-15','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000033','41000000-0000-0000-0000-000000000002',
   'COMM — Inverter Energization & Relay Test','2026-06-16','2026-06-30','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000034','41000000-0000-0000-0000-000000000002',
   'COMM — Grid Interconnection Witness Test','2026-07-01','2026-07-15','00000000-0000-0000-0000-0000000000a4','To Do'),

  -- ── SP-2402 undated tasks ────────────────────────────────────────────────────
  ('81000000-0000-0000-0000-000000000035','41000000-0000-0000-0000-000000000002',
   'Subcontractor performance review',null,null,'00000000-0000-0000-0000-0000000000a2','To Do'),

  -- ── SP-2403 Close Out — All Done ─────────────────────────────────────────────
  ('81000000-0000-0000-0000-000000000041','41000000-0000-0000-0000-000000000003',
   'ENG — Site Survey & Geotech Assessment','2025-03-01','2025-03-20','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000042','41000000-0000-0000-0000-000000000003',
   'ENG — Detail Design Package Carport 2.8 MW','2025-03-01','2025-04-15','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000043','41000000-0000-0000-0000-000000000003',
   'PROC — Place PV Module & Inverter Purchase Orders','2025-04-16','2025-04-30','00000000-0000-0000-0000-0000000000a2','Done'),
  ('81000000-0000-0000-0000-000000000044','41000000-0000-0000-0000-000000000003',
   'PROC — Receive Carport Steel Structures on Site','2025-05-01','2025-05-31','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000045','41000000-0000-0000-0000-000000000003',
   'CONST — Erect Carport Steel Columns & Beams','2025-06-01','2025-08-15','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000046','41000000-0000-0000-0000-000000000003',
   'CONST — Mount PV Panels on Carport Structure','2025-08-16','2025-10-10','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000047','41000000-0000-0000-0000-000000000003',
   'CONST — Install DC String Cabling & Combiner Boxes','2025-09-01','2025-10-31','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000048','41000000-0000-0000-0000-000000000003',
   'COMM — Inverter Energization & String Testing','2025-11-01','2025-11-25','00000000-0000-0000-0000-0000000000a4','Done'),
  ('81000000-0000-0000-0000-000000000049','41000000-0000-0000-0000-000000000003',
   'COMM — Grid Interconnection Witness Test & Handover','2025-11-26','2025-12-15','00000000-0000-0000-0000-0000000000a4','Done'),

  -- ── SP-2404 Won, Pending KoM (1 In Progress + rest To Do = ~20%) ─────────────
  ('81000000-0000-0000-0000-000000000051','41000000-0000-0000-0000-000000000004',
   'ENG — Site Survey & Geotech Rooftop','2026-05-01','2026-05-31','00000000-0000-0000-0000-0000000000a4','In Progress'),
  ('81000000-0000-0000-0000-000000000052','41000000-0000-0000-0000-000000000004',
   'ENG — Detail Design Package 5.5 MW','2026-05-15','2026-07-31','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000053','41000000-0000-0000-0000-000000000004',
   'PROC — Issue RFQ Panels & Inverters','2026-07-01','2026-08-15','00000000-0000-0000-0000-0000000000a2','To Do'),
  ('81000000-0000-0000-0000-000000000054','41000000-0000-0000-0000-000000000004',
   'PROC — Panel & Inverter Procurement','2026-08-01','2026-10-31','00000000-0000-0000-0000-0000000000a2','To Do'),
  ('81000000-0000-0000-0000-000000000055','41000000-0000-0000-0000-000000000004',
   'CONST — Roof Mounting Install','2026-11-01','2026-12-31','00000000-0000-0000-0000-0000000000a4','To Do'),
  ('81000000-0000-0000-0000-000000000056','41000000-0000-0000-0000-000000000004',
   'COMM — Commissioning & Grid Connection','2027-01-01','2027-02-28','00000000-0000-0000-0000-0000000000a4','To Do'),
  -- Undated
  ('81000000-0000-0000-0000-000000000057','41000000-0000-0000-0000-000000000004',
   'KoM preparation & internal kick-off',null,null,'00000000-0000-0000-0000-0000000000a2','To Do'),

  -- ── e2e fixture tasks (P001, preserved from original seed) ───────────────────
  ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',
   'Demolition','2026-01-06','2026-02-06','00000000-0000-0000-0000-0000000000a4','Done'),
  ('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',
   'Fit-out','2026-02-09','2026-06-30','00000000-0000-0000-0000-0000000000a4','In Progress')

on conflict (id) do nothing;

-- ── completion dates for the S-curve actual line (ADR-0032 / migration 0034) ──
-- The `stamp_task_completed_at` trigger stamps `now()` on every INSERT-as-Done, so the
-- Done tasks above would all complete "today" → the S-curve actual line collapses to a
-- single dot. For a believable demo, give each Done task a historical completion date =
-- its scheduled finish (`end_date`), exactly as the migration-0034 backfill does for real
-- pre-existing prod data. Trigger disabled so it doesn't overwrite with now(); re-enabled
-- after. (Local/demo seed only — never prod business data; see docs/environments.md.)
alter table tasks disable trigger trg_stamp_task_completed_at;
update tasks set completed_at = task_completion_proxy(end_date, created_at) where status = 'Done';
alter table tasks enable trigger trg_stamp_task_completed_at;

-- ── task_dependencies ────────────────────────────────────────────────────────

insert into task_dependencies (task_id, depends_on_id) values
  -- SP-2401: PROC depends on ENG-Detail, CONST depends on PROC-Panel, COMM depends on CONST-Mount
  ('81000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000008','81000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000009','81000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000010','81000000-0000-0000-0000-000000000008'),
  ('81000000-0000-0000-0000-000000000012','81000000-0000-0000-0000-000000000010'),
  ('81000000-0000-0000-0000-000000000014','81000000-0000-0000-0000-000000000012'),
  -- SP-2402: chain
  ('81000000-0000-0000-0000-000000000023','81000000-0000-0000-0000-000000000021'),
  ('81000000-0000-0000-0000-000000000024','81000000-0000-0000-0000-000000000021'),
  ('81000000-0000-0000-0000-000000000027','81000000-0000-0000-0000-000000000023'),
  ('81000000-0000-0000-0000-000000000030','81000000-0000-0000-0000-000000000024'),
  ('81000000-0000-0000-0000-000000000032','81000000-0000-0000-0000-000000000029'),
  -- SP-2404: ENG→PROC→CONST→COMM
  ('81000000-0000-0000-0000-000000000053','81000000-0000-0000-0000-000000000051'),
  ('81000000-0000-0000-0000-000000000055','81000000-0000-0000-0000-000000000054'),
  ('81000000-0000-0000-0000-000000000056','81000000-0000-0000-0000-000000000055'),
  -- e2e P001 fixture
  ('80000000-0000-0000-0000-000000000002','80000000-0000-0000-0000-000000000001')
on conflict (task_id, depends_on_id) do nothing;

-- ── Wire tasks to milestones ──────────────────────────────────────────────────

-- SP-2401
update tasks set milestone_id = '71000000-0000-0000-0000-000000000001'
  where id in ('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000002'
  where id in ('81000000-0000-0000-0000-000000000003','81000000-0000-0000-0000-000000000004',
               '81000000-0000-0000-0000-000000000005','81000000-0000-0000-0000-000000000006',
               '81000000-0000-0000-0000-000000000007','81000000-0000-0000-0000-000000000008',
               '81000000-0000-0000-0000-000000000009');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000003'
  where id in ('81000000-0000-0000-0000-000000000010','81000000-0000-0000-0000-000000000011',
               '81000000-0000-0000-0000-000000000012','81000000-0000-0000-0000-000000000013');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000004'
  where id in ('81000000-0000-0000-0000-000000000014','81000000-0000-0000-0000-000000000015',
               '81000000-0000-0000-0000-000000000016');
-- SP-2402
update tasks set milestone_id = '71000000-0000-0000-0000-000000000005'
  where id in ('81000000-0000-0000-0000-000000000021','81000000-0000-0000-0000-000000000022');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000006'
  where id in ('81000000-0000-0000-0000-000000000023','81000000-0000-0000-0000-000000000024',
               '81000000-0000-0000-0000-000000000025','81000000-0000-0000-0000-000000000026');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000007'
  where id in ('81000000-0000-0000-0000-000000000027','81000000-0000-0000-0000-000000000028',
               '81000000-0000-0000-0000-000000000029','81000000-0000-0000-0000-000000000030',
               '81000000-0000-0000-0000-000000000031');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000008'
  where id in ('81000000-0000-0000-0000-000000000032','81000000-0000-0000-0000-000000000033',
               '81000000-0000-0000-0000-000000000034');
-- SP-2403
update tasks set milestone_id = '71000000-0000-0000-0000-000000000009'
  where id in ('81000000-0000-0000-0000-000000000041','81000000-0000-0000-0000-000000000042');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000010'
  where id in ('81000000-0000-0000-0000-000000000043','81000000-0000-0000-0000-000000000044');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000011'
  where id in ('81000000-0000-0000-0000-000000000045','81000000-0000-0000-0000-000000000046',
               '81000000-0000-0000-0000-000000000047');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000012'
  where id in ('81000000-0000-0000-0000-000000000048','81000000-0000-0000-0000-000000000049');
-- SP-2404
update tasks set milestone_id = '71000000-0000-0000-0000-000000000013'
  where id in ('81000000-0000-0000-0000-000000000051','81000000-0000-0000-0000-000000000052');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000014'
  where id in ('81000000-0000-0000-0000-000000000053','81000000-0000-0000-0000-000000000054');
update tasks set milestone_id = '71000000-0000-0000-0000-000000000015'
  where id = '81000000-0000-0000-0000-000000000055';
update tasks set milestone_id = '71000000-0000-0000-0000-000000000016'
  where id = '81000000-0000-0000-0000-000000000056';


-- ============================================================
-- §I  procurements — solar P2P lifecycle across delivery projects
--     Plus all original e2e isolation fixtures (PROC-2026-001..008) PRESERVED
-- ============================================================

-- ── Solar procurement headers ─────────────────────────────────────────────────

insert into procurements
  (id, code, title, project_id, requested_by_id, status, total_value, vendor_id, created_at)
values
  -- SP-2401 healthy flagship: Paid / Ordered / Vendor Quoted / Approved
  ('61000000-0000-0000-0000-000000000001','SP2401-001',
   'PV Modules — Meridian 4.2 MW',
   '41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Paid',1680000,'c0000000-0000-0000-0000-000000000008','2025-09-10T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000002','SP2401-002',
   'String Inverters & Combiner Boxes',
   '41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Ordered',680000,'c0000000-0000-0000-0000-000000000009','2025-10-05T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000003','SP2401-003',
   'Roof Mounting Structures',
   '41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Vendor Quoted',540000,null,'2025-11-01T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000004','SP2401-004',
   'DC/AC Cabling & Balance of System',
   '41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Approved',150000,null,'2026-01-10T00:00:00Z'),

  -- SP-2402 at-risk: Paid / Ordered / Received / Requested
  -- committed (Ordered+Received+Paid) = 3,700,000+1,350,000+1,250,000 = 6,300,000 vs 6,900,000 budget
  ('61000000-0000-0000-0000-000000000005','SP2402-001',
   'PV Modules — Cascade 6.0 MW',
   '41000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   'Paid',3700000,'c0000000-0000-0000-0000-000000000008','2025-06-10T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000006','SP2402-002',
   'Central Inverters & Transformers',
   '41000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   'Ordered',1350000,'c0000000-0000-0000-0000-000000000009','2025-08-02T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000007','SP2402-003',
   'Ground-Mount Piling & Racking',
   '41000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   'Received',1250000,'c0000000-0000-0000-0000-000000000010','2025-08-20T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000008','SP2402-004',
   'HV Cabling & Grid Connection Kit',
   '41000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a4',
   'Requested',210000,null,'2025-11-10T00:00:00Z'),

  -- SP-2403 Close Out: two Paid
  ('61000000-0000-0000-0000-000000000009','SP2403-001',
   'PV Modules — Atlas 2.8 MW',
   '41000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   'Paid',1440000,'c0000000-0000-0000-0000-000000000008','2025-04-01T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000010','SP2403-002',
   'Carport Steel Structures & Mounting',
   '41000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   'Paid',630000,'c0000000-0000-0000-0000-000000000010','2025-05-05T00:00:00Z'),

  -- SP-2404 Won: one early Draft + one Requested awaiting approval
  ('61000000-0000-0000-0000-000000000011','SP2404-001',
   'EPC Scope Definition & Initial RFQ',
   '41000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a2',
   'Draft',100000,null,'2026-05-10T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000012','SP2404-002',
   'Preliminary PV Module Order — 200 panels',
   '41000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a4',
   'Requested',56000,null,'2026-06-01T00:00:00Z')
on conflict (id) do nothing;

-- ── procurement_items (solar-themed line items) ───────────────────────────────

insert into procurement_items
  (id, procurement_id, name, description, quantity, rate) values
  -- SP2401-001 Paid: 6,000x panels @ $280
  ('61000000-0000-0000-0000-000000001001','61000000-0000-0000-0000-000000000001',
   '540W Monocrystalline Panel','SunVolt SVX-540 bifacial panel',6000,280),
  -- SP2401-002 Ordered: 24x inverters + 8x combiners
  ('61000000-0000-0000-0000-000000001002','61000000-0000-0000-0000-000000000002',
   'String Inverter 50kW','VoltEdge VSI-50 string inverter',24,25000),
  ('61000000-0000-0000-0000-000000001003','61000000-0000-0000-0000-000000000002',
   'DC Combiner Box 16-string','VoltEdge CB-16 combiner',8,10000),
  -- SP2401-003 Vendor Quoted: mounting lots
  ('61000000-0000-0000-0000-000000001004','61000000-0000-0000-0000-000000000003',
   'L-foot & Rail Mounting Kit','Racking per 10 kW block',420,1285.71),
  -- SP2401-004 Approved: cabling
  ('61000000-0000-0000-0000-000000001005','61000000-0000-0000-0000-000000000004',
   'DC Cable 6mm twin-core','CableCore 6mm per 100m roll',300,500),
  -- SP2402-001 Paid: 12,000x panels
  ('61000000-0000-0000-0000-000000001006','61000000-0000-0000-0000-000000000005',
   '540W Monocrystalline Panel','SunVolt SVX-540 bifacial panel',12000,308.33),
  -- SP2402-002 Ordered: 4x central inverters
  ('61000000-0000-0000-0000-000000001007','61000000-0000-0000-0000-000000000006',
   'Central Inverter 500kW','VoltEdge VCI-500',4,337500),
  -- SP2402-003 Received: ground-mount piling
  ('61000000-0000-0000-0000-000000001008','61000000-0000-0000-0000-000000000007',
   'Driven Steel Pile + Racking','Ground-mount per 10 kW block',600,2083.33),
  -- SP2402-004 Requested: HV cable
  ('61000000-0000-0000-0000-000000001009','61000000-0000-0000-0000-000000000008',
   'HV Cable 95mm XLPE','Grid-connection 11kV cable per 100m',120,1750),
  -- SP2403-001 Paid: 5,200x panels
  ('61000000-0000-0000-0000-000000001010','61000000-0000-0000-0000-000000000009',
   '540W Monocrystalline Panel','SunVolt SVX-540 bifacial panel',5200,276.92),
  -- SP2403-002 Paid: carport steel
  ('61000000-0000-0000-0000-000000001011','61000000-0000-0000-0000-000000000010',
   'Carport Column & Beam Kit','RackMount CM-10 carport per 10 kW',420,1500),
  -- SP2404-001 Draft: scope doc
  ('61000000-0000-0000-0000-000000001012','61000000-0000-0000-0000-000000000011',
   'EPC Scope Document','Engineering feasibility & design scope',1,100000),
  -- SP2404-002 Requested: 200 preliminary panels
  ('61000000-0000-0000-0000-000000001013','61000000-0000-0000-0000-000000000012',
   '540W Monocrystalline Panel','SunVolt SVX-540 — preliminary order',200,280)
on conflict (id) do nothing;

-- ── quotations ────────────────────────────────────────────────────────────────

insert into procurement_quotations
  (id, procurement_id, vendor_id, reference, total_amount, received_date, is_selected, vq_number)
values
  -- SP2401-001 Paid: selected from SunVolt (received 2 days after procurement created 2025-09-10)
  ('61000000-0000-0000-0000-000000002001','61000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000008','SVX-Q-2501-01',1680000,'2025-09-12',true,'VQ-2509120001'),
  -- SP2401-002 Ordered: selected from VoltEdge (received 2 days after procurement created 2025-10-05)
  ('61000000-0000-0000-0000-000000002002','61000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000009','VEI-Q-2501-01',680000,'2025-10-07',true,'VQ-2510070001'),
  -- SP2401-003 Vendor Quoted: two competing (neither selected)
  ('61000000-0000-0000-0000-000000002003','61000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000010','RMS-Q-2501-01',545000,'2025-11-05',false,null),
  ('61000000-0000-0000-0000-000000002004','61000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000011','CCE-Q-2501-01',538000,'2025-11-06',false,null),
  -- SP2402-001 Paid: selected from SunVolt (received 3 days after procurement created 2025-06-10)
  ('61000000-0000-0000-0000-000000002005','61000000-0000-0000-0000-000000000005',
   'c0000000-0000-0000-0000-000000000008','SVX-Q-2502-01',3700000,'2025-06-13',true,'VQ-2506130001'),
  -- SP2402-002 Ordered: selected from VoltEdge (received 3 days after procurement created 2025-08-02)
  ('61000000-0000-0000-0000-000000002006','61000000-0000-0000-0000-000000000006',
   'c0000000-0000-0000-0000-000000000009','VEI-Q-2502-01',1350000,'2025-08-05',true,'VQ-2508050001'),
  -- SP2402-003 Received: selected from RackMount (received 2 days after procurement created 2025-08-20)
  ('61000000-0000-0000-0000-000000002007','61000000-0000-0000-0000-000000000007',
   'c0000000-0000-0000-0000-000000000010','RMS-Q-2502-01',1250000,'2025-08-22',true,'VQ-2508220001'),
  -- SP2403-001 Paid: selected from SunVolt (received 3 days after procurement created 2025-04-01)
  ('61000000-0000-0000-0000-000000002009','61000000-0000-0000-0000-000000000009',
   'c0000000-0000-0000-0000-000000000008','SVX-Q-2503-01',1440000,'2025-04-04',true,'VQ-2504040001'),
  -- SP2403-002 Paid: selected from RackMount (received 3 days after procurement created 2025-05-05)
  ('61000000-0000-0000-0000-000000002010','61000000-0000-0000-0000-000000000010',
   'c0000000-0000-0000-0000-000000000010','RMS-Q-2503-01',630000,'2025-05-08',true,'VQ-2505080001')
on conflict (id) do nothing;

-- ── receipts + invoices ───────────────────────────────────────────────────────

insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('61000000-0000-0000-0000-000000003001','61000000-0000-0000-0000-000000000001','GR-2511150001','2025-11-15','Complete'),
  ('61000000-0000-0000-0000-000000003002','61000000-0000-0000-0000-000000000002','GR-2601100001','2026-01-10','Partial'),
  ('61000000-0000-0000-0000-000000003005','61000000-0000-0000-0000-000000000005','GR-2511250001','2025-11-25','Complete'),
  ('61000000-0000-0000-0000-000000003006','61000000-0000-0000-0000-000000000006','GR-2602150001','2026-02-15','Partial'),
  ('61000000-0000-0000-0000-000000003007','61000000-0000-0000-0000-000000000007','GR-2602200001','2026-02-20','Complete'),
  ('61000000-0000-0000-0000-000000003009','61000000-0000-0000-0000-000000000009','GR-2506100001','2025-06-10','Complete'),
  ('61000000-0000-0000-0000-000000003010','61000000-0000-0000-0000-000000000010','GR-2507050001','2025-07-05','Complete')
on conflict (id) do nothing;

insert into procurement_invoices (id, procurement_id, vi_number, invoice_date, status) values
  ('61000000-0000-0000-0000-000000004001','61000000-0000-0000-0000-000000000001','VI-2511200001','2025-11-20','Paid'),
  ('61000000-0000-0000-0000-000000004005','61000000-0000-0000-0000-000000000005','VI-2512010001','2025-12-01','Paid'),
  ('61000000-0000-0000-0000-000000004009','61000000-0000-0000-0000-000000000009','VI-2506150001','2025-06-15','Paid'),
  ('61000000-0000-0000-0000-000000004010','61000000-0000-0000-0000-000000000010','VI-2507100001','2025-07-10','Paid')
on conflict (id) do nothing;

-- ── doc-numbers + approvers (static fixture strings) ─────────────────────────

update procurements set pr_number='PR-2509100001', po_number='PO-2509200001',
  approved_by_id='00000000-0000-0000-0000-0000000000a3'
  where id='61000000-0000-0000-0000-000000000001'; -- SP2401-001 Paid

update procurements set pr_number='PR-2510050001', po_number='PO-2510100001',
  approved_by_id='00000000-0000-0000-0000-0000000000a3'
  where id='61000000-0000-0000-0000-000000000002'; -- SP2401-002 Ordered

update procurements set pr_number='PR-2601100001',
  approved_by_id='00000000-0000-0000-0000-0000000000a1'
  where id='61000000-0000-0000-0000-000000000004'; -- SP2401-004 Approved

update procurements set pr_number='PR-2506100001', po_number='PO-2506200001',
  approved_by_id='00000000-0000-0000-0000-0000000000a1',
  vendor_invoiced_at = '2025-11-28T00:00:00Z'
  where id='61000000-0000-0000-0000-000000000005'; -- SP2402-001 Paid (at-risk SoD demo)

update procurements set pr_number='PR-2508020001', po_number='PO-2508050001',
  approved_by_id='00000000-0000-0000-0000-0000000000a3'
  where id='61000000-0000-0000-0000-000000000006'; -- SP2402-002 Ordered

update procurements set pr_number='PR-2508200001', po_number='PO-2508250001',
  approved_by_id='00000000-0000-0000-0000-0000000000a1'
  where id='61000000-0000-0000-0000-000000000007'; -- SP2402-003 Received

update procurements set pr_number='PR-2511100001'
  where id='61000000-0000-0000-0000-000000000008'; -- SP2402-004 Requested (no approver yet)

update procurements set pr_number='PR-2504010001', po_number='PO-2504100001',
  approved_by_id='00000000-0000-0000-0000-0000000000a3'
  where id='61000000-0000-0000-0000-000000000009'; -- SP2403-001

update procurements set pr_number='PR-2505050001', po_number='PO-2505100001',
  approved_by_id='00000000-0000-0000-0000-0000000000a1'
  where id='61000000-0000-0000-0000-000000000010'; -- SP2403-002

update procurements set pr_number='PR-2606010001'
  where id='61000000-0000-0000-0000-000000000012'; -- SP2404-002 Requested

-- ============================================================
-- §J  e2e isolation procurement fixtures (UNCHANGED from original seed.sql)
--     These rows are referenced by specific AC-xxx e2e tests; preserve exactly.
-- ============================================================

insert into procurements (id, code, title, project_id, requested_by_id, status, total_value, vendor_id, created_at) values
  ('60000000-0000-0000-0000-000000000001','PROC-2026-004','Site CCTV & Access Control Systems',
   '40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Vendor Quoted',150000,null,'2026-02-05T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000002','PROC-2026-001','HV Switchgear & Protection Relays',
   '40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Ordered',85000,'c0000000-0000-0000-0000-000000000010','2026-01-10T00:00:00Z'),
  -- PROC-2026-002: dedicated for AC-IXD-WP-002 (Requested → Approved confirm)
  ('60000000-0000-0000-0000-000000000003','PROC-2026-002','Safety Equipment & PPE',
   '40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a4',
   'Requested',22500,null,'2026-01-20T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000004','PROC-2026-003','PV Monitoring & SCADA Software',
   '40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   'Draft',9800,null,'2026-01-25T00:00:00Z'),
  ('60000000-0000-0000-0000-000000000005','PROC-2026-005','Earthing & Lightning Protection Kit',
   '40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Paid',320000,'c0000000-0000-0000-0000-000000000011','2025-12-01T00:00:00Z'),
  -- PROC-2026-006: dedicated for AC-CONFIRM-001
  ('60000000-0000-0000-0000-000000000006','PROC-2026-006','AC Distribution Board & Metering',
   '40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2',
   'Draft',12000,null,'2026-02-20T00:00:00Z'),
  -- PROC-2026-007: dedicated for AC-IXD-WP-001 (Approved→Vendor Quoted routine step)
  ('60000000-0000-0000-0000-000000000007','PROC-2026-007','Cable Tray & Conduit Supply',
   '40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   'Approved',45000,null,'2026-02-22T00:00:00Z'),
  -- PROC-2026-008: dedicated for AC-IXD-WP-002 (Vendor Invoiced → Paid confirm)
  ('60000000-0000-0000-0000-000000000008','PROC-2026-008','Surge Protection Devices & Fusing',
   '40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a2',
   'Vendor Invoiced',30000,null,'2026-02-24T00:00:00Z')
on conflict (id) do nothing;

insert into procurement_items (procurement_id, name, description, quantity, rate) values
  ('60000000-0000-0000-0000-000000000001','IP Camera Dome Unit','4K IP dome camera for site perimeter',50,1500),
  ('60000000-0000-0000-0000-000000000001','Access Control Panel','8-door access control panel',5,15000),
  ('60000000-0000-0000-0000-000000000004','SCADA Software License','Annual per-site monitoring licence',1,9800),
  ('60000000-0000-0000-0000-000000000006','AC Distribution Board 630A','Main LV distribution board with metering',1,12000),
  ('60000000-0000-0000-0000-000000000003','Safety helmets','Hard hat PPE',30,250),
  ('60000000-0000-0000-0000-000000000003','Hi-vis vests','Class 3 reflective vests',60,175),
  ('60000000-0000-0000-0000-000000000003','Safety boots','Steel-toe boots',15,300);

insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected) values
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000010','RMS-Q-101',152000,'2026-02-10',false),
  ('60000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000011','CCE-Q-220',148000,'2026-02-11',false);

insert into procurement_documents (procurement_id, type, reference_number, status, date) values
  ('60000000-0000-0000-0000-000000000001','RFQ','RFQ-2026-004','Issued','2026-02-05');

-- doc-number + approver UPDATEs for e2e fixtures
update procurements set pr_number='PR-2601100001', po_number='PO-2601100001',
  approved_by_id='00000000-0000-0000-0000-0000000000a3'
  where id='60000000-0000-0000-0000-000000000002';

insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected, vq_number) values
  ('60000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000010','RMS-NET-55',85000,'2026-01-08',true,'VQ-2601100001');
insert into procurement_receipts (procurement_id, gr_number, receipt_date, status) values
  ('60000000-0000-0000-0000-000000000002','GR-2601100001','2026-01-10','Partial');

update procurements set pr_number='PR-2601200001'
  where id='60000000-0000-0000-0000-000000000003';

update procurements set pr_number='PR-2602220001', approved_by_id='00000000-0000-0000-0000-0000000000a1'
  where id='60000000-0000-0000-0000-000000000007';

update procurements set pr_number='PR-2602240001', po_number='PO-2602240001',
  approved_by_id='00000000-0000-0000-0000-0000000000a1',
  vendor_invoiced_at = now() - interval '12 days'
  where id='60000000-0000-0000-0000-000000000008';

insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected, vq_number) values
  ('60000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000010','RMS-PAY-08',30000,'2026-02-23',true,'VQ-2602240001');
insert into procurement_receipts (procurement_id, gr_number, receipt_date, status) values
  ('60000000-0000-0000-0000-000000000008','GR-2602240001','2026-02-24','Complete');
insert into procurement_invoices (procurement_id, vi_number, invoice_date, status) values
  ('60000000-0000-0000-0000-000000000008','VI-2602240001','2026-02-24','Received');

update procurements set pr_number='PR-2512010001', po_number='PO-2512010001',
  approved_by_id='00000000-0000-0000-0000-0000000000a3'
  where id='60000000-0000-0000-0000-000000000005';

insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, received_date, is_selected, vq_number) values
  ('60000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000011','CCE-FURN-01',320000,'2025-11-25',true,'VQ-2512010001');
insert into procurement_invoices (procurement_id, vi_number, invoice_date, status) values
  ('60000000-0000-0000-0000-000000000005','VI-2512010001','2025-12-15','Paid');


-- ============================================================
-- §K  timesheets + entries
--     DATE-DRIFT FIX: week_start RELATIVE to current_date (always UTC Monday).
--     TIMEZONE CONTRACT: browser pinned to UTC in playwright.config.ts.
-- ============================================================

insert into timesheets (id, user_id, week_start_date, status) values
  -- Current-week Draft: engineer (a4) + PM (a2)
  ('70000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a4',
   date_trunc('week', current_date)::date,'Draft'),
  ('70000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2',
   date_trunc('week', current_date)::date,'Draft'),
  -- Finance (a3) current-week Draft (additional coverage — no seed conflict)
  ('70000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000a3',
   date_trunc('week', current_date)::date,'Draft'),
  -- Engineer (a4) prior-week Submitted
  ('70000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a4',
   (date_trunc('week', current_date) - interval '7 days')::date,'Submitted'),
  -- PM (a2) prior-week Approved
  ('70000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a2',
   (date_trunc('week', current_date) - interval '7 days')::date,'Approved'),
  -- AC-911 ISOLATION: Grace (b1) current-week Draft — sole sheet mutated by AC-911 submit→approve e2e
  ('70000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1',
   date_trunc('week', current_date)::date,'Draft'),
  -- AC-IXD-TS-W5-3 ISOLATION: Wave5 BulkEng (b4) prior-week ALREADY-SUBMITTED sheet
  ('70000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000b4',
   (date_trunc('week', current_date) - interval '7 days')::date,'Submitted')
on conflict (user_id, week_start_date) do nothing;

insert into timesheet_entries (timesheet_id, project_id, entry_date, hours, notes) values
  -- Engineer current-week entries (on SP-2401 + SP-2402 solar projects)
  ('70000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
   date_trunc('week', current_date)::date,8,'Site survey at Meridian Steelworks rooftop'),
  ('70000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002',
   date_trunc('week', current_date)::date+1,8,'Inverter commissioning review at Cascade Foods'),
  -- PM current-week entries
  ('70000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',
   date_trunc('week', current_date)::date,6,'Client progress meeting — Meridian Steelworks'),
  ('70000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000002',
   date_trunc('week', current_date)::date+1,4,'Procurement review — Cascade Foods at-risk tracking'),
  -- Finance current-week entries
  ('70000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000001',
   date_trunc('week', current_date)::date,4,'Budget variance review — Meridian Steelworks'),
  ('70000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000002',
   date_trunc('week', current_date)::date+1,6,'Invoice processing — Cascade Foods at-risk cost tracking'),
  -- Engineer prior-week Submitted entries
  ('70000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000001',
   (date_trunc('week', current_date)-interval '7 days')::date,8,'Structural load calc review'),
  ('70000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000002',
   (date_trunc('week', current_date)-interval '7 days')::date+1,8,'Ground-mount structural inspection at Cascade'),
  ('70000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000002',
   (date_trunc('week', current_date)-interval '7 days')::date+2,6,'HV cable routing survey'),
  -- PM prior-week Approved entries
  ('70000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000001',
   (date_trunc('week', current_date)-interval '7 days')::date,5,'PV module delivery coordination'),
  ('70000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000003',
   (date_trunc('week', current_date)-interval '7 days')::date+1,6,'Close-out documentation — Atlas Chemicals'),
  -- Grace (b1) AC-911 isolation entries (8h + 8h submittable Draft)
  ('70000000-0000-0000-0000-0000000000b1','41000000-0000-0000-0000-000000000001',
   date_trunc('week', current_date)::date,8,'Site survey'),
  ('70000000-0000-0000-0000-0000000000b1','41000000-0000-0000-0000-000000000001',
   date_trunc('week', current_date)::date+1,8,'Report drafting'),
  -- Wave5 BulkEng (b4) prior-week Submitted entries
  ('70000000-0000-0000-0000-0000000000b4','41000000-0000-0000-0000-000000000001',
   (date_trunc('week', current_date)-interval '7 days')::date,6,'Safety audit'),
  ('70000000-0000-0000-0000-0000000000b4','41000000-0000-0000-0000-000000000001',
   (date_trunc('week', current_date)-interval '7 days')::date+1,8,'Site walkthrough');

-- Set approved_by on the Approved timesheet (PM prior-week approved by exec)
update timesheets set
  approved_by = '00000000-0000-0000-0000-0000000000a1',
  approved_at = now() - interval '3 days'
where id = '70000000-0000-0000-0000-000000000005';

-- ============================================================
-- §L  CRM contacts
-- ============================================================

insert into contacts (id, company_id, full_name, title, email, phone) values
  -- Meridian Steelworks (Client)
  ('ce000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',
   'Priya Mehta','Head of Engineering','priya.mehta@meridian-steel.example','+44 7700 900001'),
  ('ce000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002',
   'James Harlow','Procurement Director','j.harlow@meridian-steel.example','+44 7700 900002'),
  ('ce000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002',
   'Sandra Reyes','Plant Manager','s.reyes@meridian-steel.example','+44 7700 900003'),
  -- Cascade Foods (Client)
  ('ce000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000003',
   'Lucas van den Berg','Project Director','lucas.vdb@cascadefoods.example','+31 20 900004'),
  ('ce000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000003',
   'Amara Osei','Sustainability Lead','a.osei@cascadefoods.example','+31 20 900005'),
  -- Atlas Chemicals (Client)
  ('ce000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-000000000004',
   'Kenji Tanaka','EHS Manager','k.tanaka@atlas-chem.example','+81 3 900006'),
  ('ce000000-0000-0000-0000-000000000007','c0000000-0000-0000-0000-000000000004',
   'Fatima Al-Amin','Procurement Lead','f.alamin@atlas-chem.example','+81 3 900007'),
  -- Harbor Logistics (Client)
  ('ce000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000005',
   'Raj Patel','Development Director','r.patel@harborlogistics.example','+65 6900 0008'),
  ('ce000000-0000-0000-0000-000000000009','c0000000-0000-0000-0000-000000000005',
   'Nicole Dubois','Contracts Manager','n.dubois@harborlogistics.example','+65 6900 0009'),
  -- SunVolt Modules (Vendor)
  ('ce000000-0000-0000-0000-000000000010','c0000000-0000-0000-0000-000000000008',
   'Lena Bauer','Key Account Manager','lena.bauer@sunvolt.example','+49 30 900010'),
  ('ce000000-0000-0000-0000-000000000011','c0000000-0000-0000-0000-000000000008',
   'Tariq Al-Rashid','Technical Sales Engineer','tariq@sunvolt.example','+49 30 900011'),
  -- VoltEdge Inverters (Vendor)
  ('ce000000-0000-0000-0000-000000000012','c0000000-0000-0000-0000-000000000009',
   'Ingrid Sorensen','Regional Sales Manager','i.sorensen@voltedge.example','+47 21 900012'),
  ('ce000000-0000-0000-0000-000000000013','c0000000-0000-0000-0000-000000000009',
   'Marco Bertoli','Application Engineer','m.bertoli@voltedge.example','+47 21 900013'),
  -- Northgate Mills (Client)
  ('ce000000-0000-0000-0000-000000000014','c0000000-0000-0000-0000-000000000006',
   'Chen Wei','Operations Director','c.wei@northgatemills.example','+86 10 900014'),
  ('ce000000-0000-0000-0000-000000000015','c0000000-0000-0000-0000-000000000006',
   'Hannah Fischer','Capex Manager','h.fischer@northgatemills.example','+86 10 900015')
on conflict (id) do nothing;

-- ============================================================
-- §M  crm_activities (24+ entries spanning Feb–Jun 2026)
-- ============================================================

insert into crm_activities (id, contact_id, company_id, project_id, kind, subject, body, occurred_at, logged_by_id) values
  -- Meridian Steelworks — Priya Mehta (contacts SP-2401 delivery)
  ('ca000000-0000-0000-0000-000000000001',
   'ce000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',
   '41000000-0000-0000-0000-000000000001','Meeting',
   'Kick-off alignment — PV layout approval',
   'Reviewed the single-line diagram and agreed panel orientation. Priya confirmed procurement schedule aligns with civil works.',
   now()-interval '110 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000002',
   'ce000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',
   '41000000-0000-0000-0000-000000000001','Email',
   'RE: IEC 61215 compliance certificates',
   'Priya requested documentary proof for the panels before milestone sign-off. Forwarded SunVolt IEC certs.',
   now()-interval '60 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000003',
   'ce000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000002',
   '41000000-0000-0000-0000-000000000001','Call',
   'Mounting structure delivery window confirmed',
   'Priya confirmed Q1 2026 delivery slot. Structural consultant to visit site 15 Jan.',
   now()-interval '30 days','00000000-0000-0000-0000-0000000000a2'),

  -- Meridian Steelworks — James Harlow
  ('ca000000-0000-0000-0000-000000000004',
   'ce000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002',
   '41000000-0000-0000-0000-000000000001','Call',
   'Change order discussion — roof access scaffold',
   'James raised a site-access restriction that may require a scaffold variation. Agreed to submit CO by Friday.',
   now()-interval '75 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000005',
   'ce000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002',
   '41000000-0000-0000-0000-000000000001','Note',
   'ATTN: budget approval gate Q1',
   'James confirmed capex committee meets 15 Jan. All POs must land before that date to secure FY budget.',
   now()-interval '10 days','00000000-0000-0000-0000-0000000000a2'),

  -- Meridian Steelworks — Sandra Reyes (operations)
  ('ca000000-0000-0000-0000-000000000006',
   'ce000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002',
   '41000000-0000-0000-0000-000000000001','Meeting',
   'Site access & safety induction',
   'Sandra walked us through plant safety rules. All contractors require full PPE on rooftop. Fire permit required for hot-works.',
   now()-interval '90 days','00000000-0000-0000-0000-0000000000a4'),

  -- Cascade Foods — Lucas van den Berg (at-risk project)
  ('ca000000-0000-0000-0000-000000000007',
   'ce000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000003',
   '41000000-0000-0000-0000-000000000002','Meeting',
   'At-risk review — construction delay',
   'Lucas expressed concern about the piling schedule slipping. Agreed to weekly site progress calls and a revised S-curve.',
   now()-interval '45 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000008',
   'ce000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000003',
   '41000000-0000-0000-0000-000000000002','Email',
   'Revised programme submitted',
   'Sent updated EPC programme to Lucas. New commissioning date pushed to end of April subject to grid connection approval.',
   now()-interval '20 days','00000000-0000-0000-0000-0000000000a2'),

  -- Cascade Foods — Amara Osei (sustainability angle)
  ('ca000000-0000-0000-0000-000000000009',
   'ce000000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000003',
   '41000000-0000-0000-0000-000000000002','Call',
   'Carbon reporting data request',
   'Amara needs embodied carbon figures for the PV modules for their ESG report. Requested data sheet from SunVolt.',
   now()-interval '15 days','00000000-0000-0000-0000-0000000000a2'),

  -- Atlas Chemicals — Kenji Tanaka (close-out project)
  ('ca000000-0000-0000-0000-000000000010',
   'ce000000-0000-0000-0000-000000000006','c0000000-0000-0000-0000-000000000004',
   '41000000-0000-0000-0000-000000000003','Meeting',
   'Final handover meeting — SP-2403 Close Out',
   'Grid export confirmed at 2.8 MW. Kenji signed off the performance ratio report. Asset transferred to facilities team.',
   now()-interval '180 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000011',
   'ce000000-0000-0000-0000-000000000007','c0000000-0000-0000-0000-000000000004',
   '41000000-0000-0000-0000-000000000003','Email',
   'O&M contract scope for discussion',
   'Fatima asked for a 5-year O&M proposal post-handover. Forwarded to our service team.',
   now()-interval '120 days','00000000-0000-0000-0000-0000000000a2'),

  -- Harbor Logistics — Raj Patel (Won, Pending KoM)
  ('ca000000-0000-0000-0000-000000000012',
   'ce000000-0000-0000-0000-000000000008','c0000000-0000-0000-0000-000000000005',
   '41000000-0000-0000-0000-000000000004','Meeting',
   'Contract award meeting & KoM preparation',
   'Raj confirmed board approval for 5.5 MW award. KoM planned for 15 June. Full NTP by 1 July.',
   now()-interval '25 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000013',
   'ce000000-0000-0000-0000-000000000009','c0000000-0000-0000-0000-000000000005',
   '41000000-0000-0000-0000-000000000004','Call',
   'Insurance & performance bond discussion',
   'Nicole confirmed the bond requirement is 10% of contract value. Mara to arrange by NTP.',
   now()-interval '12 days','00000000-0000-0000-0000-0000000000a2'),

  -- SunVolt Modules — Lena Bauer (vendor relationship)
  ('ca000000-0000-0000-0000-000000000014',
   'ce000000-0000-0000-0000-000000000010','c0000000-0000-0000-0000-000000000008',
   '41000000-0000-0000-0000-000000000001','Call',
   'Lead time confirmation — Q1 2026 module delivery',
   'Lena confirmed 10-week lead time from PO placement. Agreed Incoterms DAP and IEC insurance certificate.',
   now()-interval '120 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000015',
   'ce000000-0000-0000-0000-000000000010','c0000000-0000-0000-0000-000000000008',
   null,'Email',
   'Revised datasheet — SV-540M bifacial module',
   'Lena sent updated datasheet for SV-540M with higher bifacial gain. Forwarded to Priya for spec sign-off.',
   now()-interval '85 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000016',
   'ce000000-0000-0000-0000-000000000010','c0000000-0000-0000-0000-000000000008',
   '41000000-0000-0000-0000-000000000004','Email',
   'Harbor Logistics preliminary order — feasibility',
   'Lena quoted 12-week lead for 10,200 panels. Price locked until end of June. PO required by 15 July.',
   now()-interval '8 days','00000000-0000-0000-0000-0000000000a2'),

  -- SunVolt — Tariq Al-Rashid (technical)
  ('ca000000-0000-0000-0000-000000000017',
   'ce000000-0000-0000-0000-000000000011','c0000000-0000-0000-0000-000000000008',
   '41000000-0000-0000-0000-000000000001','Meeting',
   'String inverter sizing review — Meridian',
   'Tariq walked through string configuration for the 4.2 MW array. Recommended SVX-50k upgrade for peak irradiance.',
   now()-interval '65 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000018',
   'ce000000-0000-0000-0000-000000000011','c0000000-0000-0000-0000-000000000008',
   null,'Note',
   'Follow-up: MPPT warranty terms',
   'Tariq to provide 10-year extended warranty terms by end of week for attachment to the PO.',
   now()-interval '40 days','00000000-0000-0000-0000-0000000000a2'),

  -- VoltEdge — Ingrid Sorensen
  ('ca000000-0000-0000-0000-000000000019',
   'ce000000-0000-0000-0000-000000000012','c0000000-0000-0000-0000-000000000009',
   '41000000-0000-0000-0000-000000000002','Call',
   'Central inverter delivery date — Cascade at-risk',
   'Ingrid flagged 3-week delay on VCI-500 due to semiconductor shortage. Partial shipment of 2 units by March.',
   now()-interval '35 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000020',
   'ce000000-0000-0000-0000-000000000013','c0000000-0000-0000-0000-000000000009',
   '41000000-0000-0000-0000-000000000002','Meeting',
   'Commissioning support plan — Cascade 6 MW',
   'Marco outlined the VCI-500 commissioning requirements: 3 days per inverter station, power analyser required on site.',
   now()-interval '22 days','00000000-0000-0000-0000-0000000000a4'),

  -- Northgate Mills — pipeline CRM
  ('ca000000-0000-0000-0000-000000000021',
   'ce000000-0000-0000-0000-000000000014','c0000000-0000-0000-0000-000000000006',
   '41000000-0000-0000-0000-000000000005','Meeting',
   'Negotiation kick-off — Northgate 3.5 MW',
   'Chen Wei confirmed Northgate board is aligning on the EPC contract. Final negotiation on EPC fee in 2 weeks.',
   now()-interval '18 days','00000000-0000-0000-0000-0000000000a2'),
  ('ca000000-0000-0000-0000-000000000022',
   'ce000000-0000-0000-0000-000000000015','c0000000-0000-0000-0000-000000000006',
   '41000000-0000-0000-0000-000000000005','Email',
   'Capex approval timeline',
   'Hannah confirmed capex approval requires executive sign-off by 30 June for FY2026 budget cycle.',
   now()-interval '5 days','00000000-0000-0000-0000-0000000000a2'),

  -- Harbor Logistics — Nicole Dubois (pipeline→won)
  ('ca000000-0000-0000-0000-000000000023',
   'ce000000-0000-0000-0000-000000000009','c0000000-0000-0000-0000-000000000005',
   '41000000-0000-0000-0000-000000000004','Email',
   'Contract execution schedule',
   'Nicole sent the signed EPC contract. Instructed to begin mobilisation upon receipt of 10% advance payment.',
   now()-interval '20 days','00000000-0000-0000-0000-0000000000a3'),

  -- Atlas Chemicals — Fatima Al-Amin (post close-out follow-up)
  ('ca000000-0000-0000-0000-000000000024',
   'ce000000-0000-0000-0000-000000000007','c0000000-0000-0000-0000-000000000004',
   null,'Call',
   'O&M contract finalisation',
   'Fatima approved the 3-year O&M scope. Contract to be signed next week. First monitoring report due in 30 days.',
   now()-interval '7 days','00000000-0000-0000-0000-0000000000a2')
on conflict (id) do nothing;

-- ============================================================
-- §N  incident_reports
-- ============================================================

insert into incident_reports (id, incident_date, type, severity, location, description, status, reported_by) values
  ('d5000000-0000-0000-0000-000000000001',
   current_date-interval '10 days',
   'Near Miss','Medium',
   'Cascade Foods Ground-Mount Site — Array Block C',
   'Contractor working at height without harness clip-in during racking install. Corrected immediately; crew retrained on fall-protection protocol.',
   'Open','00000000-0000-0000-0000-0000000000a4'),
  ('d5000000-0000-0000-0000-000000000002',
   current_date-interval '45 days',
   'Unsafe Condition','Low',
   'Meridian Steelworks Rooftop — East Wing',
   'Unmarked tripping hazard from cable tray installation. Hazard marked and cleared; daily housekeeping checklist updated.',
   'Closed','00000000-0000-0000-0000-0000000000a4'),
  ('d5000000-0000-0000-0000-000000000003',
   current_date-interval '3 days',
   'Incident','High',
   'Cascade Foods Ground-Mount — Block B',
   'Panel dropped during installation due to inadequate panel gripper. No injuries. Equipment replaced; incident report submitted to HSE.',
   'Investigating','00000000-0000-0000-0000-0000000000a4'),
  ('d5000000-0000-0000-0000-000000000004',
   current_date-interval '90 days',
   'Near Miss','Low',
   'Atlas Chemicals Carport — Column Line 5',
   'Forklift path crossed with pedestrian zone without warning. Exclusion zones now clearly marked and enforced.',
   'Closed','00000000-0000-0000-0000-0000000000a4')
on conflict (id) do nothing;

-- ============================================================
-- §O  project_documents
-- ============================================================

insert into project_documents (id, project_id, code, category, title, revision, status, doc_date, author_id) values
  ('d6000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001',
   'SP2401-ENG-001','Engineering','Single Line Diagram — 4.2 MW Rooftop PV','C','Approved','2025-10-10','00000000-0000-0000-0000-0000000000a4'),
  ('d6000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001',
   'SP2401-ENG-002','Engineering','Detail Design Package — Meridian Steelworks','B','Issued','2025-10-15','00000000-0000-0000-0000-0000000000a4'),
  ('d6000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000002',
   'SP2402-ENG-001','Engineering','Single Line Diagram — 6.0 MW Ground-Mount PV','B','Approved','2025-07-15','00000000-0000-0000-0000-0000000000a4'),
  ('d6000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000002',
   'SP2402-ENG-002','Engineering','Structural Analysis Report — Ground-Mount Piling','A','Issued','2025-08-01','00000000-0000-0000-0000-0000000000a4'),
  ('d6000000-0000-0000-0000-000000000005','41000000-0000-0000-0000-000000000003',
   'SP2403-ENG-001','Engineering','As-Built — Atlas Chemicals 2.8 MW Carport PV','D','Approved','2025-12-10','00000000-0000-0000-0000-0000000000a4'),
  -- e2e P001 fixture doc (preserved from original seed)
  ('d6000000-0000-0000-0000-000000000099','40000000-0000-0000-0000-000000000001',
   'DOC-001','Drawing','Floor Plan Rev B','B','Issued','2026-01-20','00000000-0000-0000-0000-0000000000a2')
on conflict (id) do nothing;

-- ============================================================
-- §P  Sales pipeline attention (P002 stale — already done above via last_update backdate)
-- ============================================================

-- ============================================================
-- §Q  pipeline_stage_config already seeded by migration 0008_project_revenue.sql
--     (default win-probabilities for the default org). Nothing to do here.
-- ============================================================

-- ============================================================
-- §R  Procurement record enrichment — purchase_requests / rfqs / purchase_orders /
--     payments / procurement_status_events
--
--     Migration 0038 backfill already created bare purchase_requests + purchase_orders
--     rows (pr_number, Submitted/Issued, created_at date) for every procurement that has
--     a pr_number/po_number. Here we:
--       (a) UPDATE those backfilled rows with reference_number + amount;
--       (b) INSERT rfqs rows (not created by any backfill);
--       (c) UPDATE procurement_quotations.rfq_id (same-case — trigger enforces it);
--       (d) UPDATE procurement_receipts.po_id  (same-case);
--       (e) UPDATE procurement_invoices.po_id  (same-case);
--       (f) INSERT payments for Paid procurements;
--       (g) INSERT procurement_status_events for one showcase case (full transition history).
--
--     Same-case invariant (0039 triggers): every FK we set here must reference a record
--     whose procurement_id matches the child row's own procurement_id.
--
--     Showcase cases enriched:
--       SP2401-001 (id 61000000-...-001): Paid, 1,680,000 — full timeline + status events
--       SP2402-001 (id 61000000-...-005): Paid, 3,700,000
--       SP2403-001 (id 61000000-...-009): Paid, 1,440,000
--       SP2401-002 (id 61000000-...-002): Ordered, 680,000
--       SP2402-003 (id 61000000-...-007): Received, 1,250,000
-- ============================================================

-- ── (a) Insert purchase_requests for the 5 showcase cases ────────────────────────
-- The migration-0038 backfill runs against zero rows (migrations execute before
-- seed.sql); we must insert these records directly. org_id is filled by the BEFORE
-- INSERT trigger from the parent procurement row; seed runs as superuser (RLS off).

insert into purchase_requests
  (procurement_id, pr_number, reference_number, status, date, amount)
values
  -- SP2401-001 Paid
  ('61000000-0000-0000-0000-000000000001',
   'PR-2509100001', 'REQ-2025-0142', 'Approved', '2025-09-10', 1680000),
  -- SP2402-001 Paid
  ('61000000-0000-0000-0000-000000000005',
   'PR-2506100001', 'REQ-2025-0209', 'Approved', '2025-06-10', 3700000),
  -- SP2403-001 Paid
  ('61000000-0000-0000-0000-000000000009',
   'PR-2504010001', 'REQ-2025-0078', 'Approved', '2025-04-01', 1440000),
  -- SP2401-002 Ordered
  ('61000000-0000-0000-0000-000000000002',
   'PR-2510050001', 'REQ-2025-0156', 'Approved', '2025-10-05', 680000),
  -- SP2402-003 Received
  ('61000000-0000-0000-0000-000000000007',
   'PR-2508200001', 'REQ-2025-0221', 'Approved', '2025-08-20', 1250000)
on conflict do nothing;

-- ── (a2) Insert purchase_orders for the 5 showcase cases ─────────────────────────
-- Same rationale: no rows exist at seed time; insert rather than update.

insert into purchase_orders
  (procurement_id, po_number, reference_number, status, date, amount)
values
  -- SP2401-001 Paid
  ('61000000-0000-0000-0000-000000000001',
   'PO-2509200001', 'PO-SV-2509-0142', 'Issued', '2025-09-20', 1680000),
  -- SP2402-001 Paid
  ('61000000-0000-0000-0000-000000000005',
   'PO-2506200001', 'PO-SV-2506-0209', 'Issued', '2025-06-20', 3700000),
  -- SP2403-001 Paid
  ('61000000-0000-0000-0000-000000000009',
   'PO-2504100001', 'PO-SV-2504-0078', 'Issued', '2025-04-10', 1440000),
  -- SP2401-002 Ordered
  ('61000000-0000-0000-0000-000000000002',
   'PO-2510100001', 'PO-VE-2510-0156', 'Issued', '2025-10-10', 680000),
  -- SP2402-003 Received
  ('61000000-0000-0000-0000-000000000007',
   'PO-2508250001', 'PO-RM-2508-0221', 'Issued', '2025-08-25', 1250000)
on conflict do nothing;

-- ── (b) Insert rfqs (one per showcase case that sourced quotations) ───────────────
-- Each rfq gets a stable id so we can set rfq_id on quotations in step (c).

insert into rfqs
  (id, procurement_id, rfq_number, reference_number, status, date, amount)
values
  -- SP2401-001 Paid — RFQ to SunVolt for PV modules
  ('62000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000000001',
   'RFQ-2509110001', 'SVX-RFQ-2501', 'Closed', '2025-09-11', 1680000),
  -- SP2402-001 Paid — RFQ to SunVolt for 6 MW modules
  ('62000000-0000-0000-0000-000000000005',
   '61000000-0000-0000-0000-000000000005',
   'RFQ-2506110001', 'SVX-RFQ-2502', 'Closed', '2025-06-11', 3700000),
  -- SP2403-001 Paid — RFQ to SunVolt for Atlas carport modules
  ('62000000-0000-0000-0000-000000000009',
   '61000000-0000-0000-0000-000000000009',
   'RFQ-2504020001', 'SVX-RFQ-2503', 'Closed', '2025-04-02', 1440000),
  -- SP2401-002 Ordered — RFQ to VoltEdge for inverters
  ('62000000-0000-0000-0000-000000000002',
   '61000000-0000-0000-0000-000000000002',
   'RFQ-2510060001', 'VEI-RFQ-2501', 'Closed', '2025-10-06', 680000),
  -- SP2402-003 Received — RFQ to RackMount for ground-mount piling
  ('62000000-0000-0000-0000-000000000007',
   '61000000-0000-0000-0000-000000000007',
   'RFQ-2508210001', 'RMS-RFQ-2502', 'Closed', '2025-08-21', 1250000)
on conflict (id) do nothing;

-- ── (c) Link procurement_quotations.rfq_id (same-case; 0039 trigger guards) ─────
-- Each update sets rfq_id to the rfqs row for the same procurement_id.

update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000001'
  where id = '61000000-0000-0000-0000-000000002001';  -- SVX-Q-2501-01 (SP2401-001)

update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000005'
  where id = '61000000-0000-0000-0000-000000002005';  -- SVX-Q-2502-01 (SP2402-001)

update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000009'
  where id = '61000000-0000-0000-0000-000000002009';  -- SVX-Q-2503-01 (SP2403-001)

update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000002'
  where id = '61000000-0000-0000-0000-000000002002';  -- VEI-Q-2501-01 (SP2401-002)

update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000007'
  where id = '61000000-0000-0000-0000-000000002007';  -- RMS-Q-2502-01 (SP2402-003)

-- ── (d) Link procurement_receipts.po_id (same-case; 0039 trigger guards) ─────────
-- GR row → its own procurement's PO row.

update procurement_receipts set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000001'
              and po_number = 'PO-2509200001')
where id = '61000000-0000-0000-0000-000000003001';  -- GR for SP2401-001

update procurement_receipts set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000005'
              and po_number = 'PO-2506200001')
where id = '61000000-0000-0000-0000-000000003005';  -- GR for SP2402-001

update procurement_receipts set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000007'
              and po_number = 'PO-2508250001')
where id = '61000000-0000-0000-0000-000000003007';  -- GR for SP2402-003

update procurement_receipts set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000009'
              and po_number = 'PO-2504100001')
where id = '61000000-0000-0000-0000-000000003009';  -- GR for SP2403-001

-- ── (e) Link procurement_invoices.po_id (same-case; 0039 trigger guards) ─────────

update procurement_invoices set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000001'
              and po_number = 'PO-2509200001')
where id = '61000000-0000-0000-0000-000000004001';  -- VI for SP2401-001

update procurement_invoices set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000005'
              and po_number = 'PO-2506200001')
where id = '61000000-0000-0000-0000-000000004005';  -- VI for SP2402-001

update procurement_invoices set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000009'
              and po_number = 'PO-2504100001')
where id = '61000000-0000-0000-0000-000000004009';  -- VI for SP2403-001

-- ── (f) Insert payments for Paid procurements ─────────────────────────────────────
-- pay_number mirrors the PAY-prefix convention from next_procurement_doc_number.
-- invoice_id FK must point at same-case invoice (create_payment RPC guard — same rule for direct insert).

insert into payments
  (id, procurement_id, invoice_id, pay_number, reference_number, status, date, amount)
values
  -- SP2401-001 Paid — settled VI-2511200001
  ('63000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000004001',
   'PAY-2511250001', 'TT-SV-2025-0142', 'Paid', '2025-11-25', 1680000),
  -- SP2402-001 Paid — settled VI-2512010001
  ('63000000-0000-0000-0000-000000000005',
   '61000000-0000-0000-0000-000000000005',
   '61000000-0000-0000-0000-000000004005',
   'PAY-2512080001', 'TT-SV-2025-0209', 'Paid', '2025-12-08', 3700000),
  -- SP2403-001 Paid — settled VI-2506150001
  ('63000000-0000-0000-0000-000000000009',
   '61000000-0000-0000-0000-000000000009',
   '61000000-0000-0000-0000-000000004009',
   'PAY-2506200001', 'TT-SV-2025-0078', 'Paid', '2025-06-20', 1440000)
on conflict (id) do nothing;

-- ── (g) procurement_status_events — full transition history for SP2401-001 ────────
-- Direct seed insert (superuser bypasses force-RLS; no write policy on this table anyway).
-- Actors: PM (a2) submits/orders/receives; Finance (a3) approves/invoices/pays; Exec (a1) approves.
-- Timestamps ascend from the procurement's created_at (2025-09-10).

insert into procurement_status_events
  (id, procurement_id, from_status, to_status, actor_id, notes, created_at)
values
  ('64000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000000001',
   'Draft', 'Requested',
   '00000000-0000-0000-0000-0000000000a2',
   'Initial request for 6,000 PV modules — Meridian Steelworks 4.2 MW rooftop.',
   '2025-09-10T09:00:00Z'),
  ('64000000-0000-0000-0000-000000000002',
   '61000000-0000-0000-0000-000000000001',
   'Requested', 'Approved',
   '00000000-0000-0000-0000-0000000000a3',
   'Budget verified against SP-2401 active budget version. Approved.',
   '2025-09-11T14:30:00Z'),
  ('64000000-0000-0000-0000-000000000003',
   '61000000-0000-0000-0000-000000000001',
   'Approved', 'Vendor Quoted',
   '00000000-0000-0000-0000-0000000000a2',
   'RFQ issued to SunVolt; quote SVX-Q-2501-01 received at 1,680,000.',
   '2025-09-12T10:15:00Z'),
  ('64000000-0000-0000-0000-000000000004',
   '61000000-0000-0000-0000-000000000001',
   'Vendor Quoted', 'Quote Selected',
   '00000000-0000-0000-0000-0000000000a2',
   'SunVolt quote selected — best price and certified IEC 61215.',
   '2025-09-15T11:00:00Z'),
  ('64000000-0000-0000-0000-000000000005',
   '61000000-0000-0000-0000-000000000001',
   'Quote Selected', 'Ordered',
   '00000000-0000-0000-0000-0000000000a2',
   'PO-2509200001 raised and sent to SunVolt. Delivery expected Dec 2025.',
   '2025-09-20T09:45:00Z'),
  ('64000000-0000-0000-0000-000000000006',
   '61000000-0000-0000-0000-000000000001',
   'Ordered', 'Received',
   '00000000-0000-0000-0000-0000000000a4',
   'GR-2511150001 — all 6,000 panels received and inspected at site. No damage observed.',
   '2025-11-15T16:00:00Z'),
  ('64000000-0000-0000-0000-000000000007',
   '61000000-0000-0000-0000-000000000001',
   'Received', 'Vendor Invoiced',
   '00000000-0000-0000-0000-0000000000a3',
   'VI-2511200001 received from SunVolt. 30-day payment terms.',
   '2025-11-20T10:00:00Z'),
  ('64000000-0000-0000-0000-000000000008',
   '61000000-0000-0000-0000-000000000001',
   'Vendor Invoiced', 'Paid',
   '00000000-0000-0000-0000-0000000000a3',
   'TT-SV-2025-0142 — bank transfer 1,680,000 executed. Case closed.',
   '2025-11-25T13:30:00Z')
on conflict (id) do nothing;

-- ============================================================
-- §S  GR reference_number + VI reference_number / amount enrichment (migration 0040).
--     Populates the new columns for the showcase showcase cases so the ledger File
--     column and External ref column show real data on db reset.
--     These are plain UPDATEs — no RLS concern (seed runs as superuser).
-- ============================================================

-- ── GR delivery-note numbers ─────────────────────────────────────────────────
update procurement_receipts set reference_number = 'DN-SVX-2025-1115'
  where id = '61000000-0000-0000-0000-000000003001';  -- SP2401-001 GR (Complete)

update procurement_receipts set reference_number = 'DN-SVX-2025-1125'
  where id = '61000000-0000-0000-0000-000000003005';  -- SP2402-001 GR (Complete)

update procurement_receipts set reference_number = 'DN-SVX-2025-0610'
  where id = '61000000-0000-0000-0000-000000003009';  -- SP2403-001 GR (Complete)

-- ── VI reference_number + amount ─────────────────────────────────────────────
update procurement_invoices set reference_number = 'INV-SVX-2025-4201', amount = 1680000
  where id = '61000000-0000-0000-0000-000000004001';  -- SP2401-001 VI (1,680,000)

update procurement_invoices set reference_number = 'INV-SVX-2025-5092', amount = 3700000
  where id = '61000000-0000-0000-0000-000000004005';  -- SP2402-001 VI (3,700,000)

update procurement_invoices set reference_number = 'INV-SVX-2025-0781', amount = 1440000
  where id = '61000000-0000-0000-0000-000000004009';  -- SP2403-001 VI (1,440,000)

-- ── File rows for showcase case SP2401-001 ───────────────────────────────────
-- One file per record type for the full-lifecycle SP2401-001 case so the File
-- column renders "View" links when the Director renders the ledger. File paths
-- use the 5-segment convention: {org_id}/{procurement_id}/{phase}/{file_id}/{filename}.
-- org_id for the default org = '00000000-0000-0000-0000-000000000001'.

-- GR file (procurement_receipt_files)
insert into procurement_receipt_files
  (id, org_id, receipt_id, file_path, title)
values
  ('65000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000003001',
   '00000000-0000-0000-0000-000000000001/61000000-0000-0000-0000-000000000001/receipt/65000000-0000-0000-0000-000000000001/delivery-note.pdf',
   'Delivery Note DN-SVX-2025-1115')
on conflict (id) do nothing;

-- VI file (procurement_invoice_files)
insert into procurement_invoice_files
  (id, org_id, invoice_id, file_path, title)
values
  ('65000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   '61000000-0000-0000-0000-000000004001',
   '00000000-0000-0000-0000-000000000001/61000000-0000-0000-0000-000000000001/invoice/65000000-0000-0000-0000-000000000002/invoice.pdf',
   'Invoice INV-SVX-2025-4201')
on conflict (id) do nothing;

-- ============================================================
-- §T  Full-record-set enrichment for advanced showcase cases
--
--     Covers cases that were missing PR/PO/RFQ records, payments,
--     or status_events so that Ordered/Received/Paid cases show
--     a complete ledger and a real timeline progression.
--
--     Cases enriched:
--       SP2402-002 (id 61000000-...-006): Ordered, 1,350,000 — PR+PO+RFQ
--       SP2403-002 (id 61000000-...-010): Paid, 630,000 — PR+PO+RFQ+Payment
--       PROC-2026-005 (id 60000000-...-005): Paid, 320,000 — PR+PO+RFQ+GR+Payment
--       SP2402-001 (id 61000000-...-005): Paid — condensed status_events
--       SP2403-001 (id 61000000-...-009): Paid — condensed status_events
--
--     Same-case FK invariant: every FK points within the same procurement_id.
--     Trigger 0039 will raise 42501 on any cross-case FK — supabase db reset
--     proves correctness. Seed runs as superuser (RLS off).
-- ============================================================

-- ── (t1) SP2402-002 Ordered (61000000-...-006): add PR + PO + RFQ ────────────
-- Dates: PR 2025-08-02, RFQ 2025-08-03, PO 2025-08-05 (matches header po_number)

insert into purchase_requests
  (procurement_id, pr_number, reference_number, status, date, amount)
values
  ('61000000-0000-0000-0000-000000000006',
   'PR-2508020001', 'REQ-2025-0198', 'Approved', '2025-08-02', 1350000)
on conflict do nothing;

insert into purchase_orders
  (procurement_id, po_number, reference_number, status, date, amount)
values
  ('61000000-0000-0000-0000-000000000006',
   'PO-2508050001', 'PO-VE-2508-0198', 'Issued', '2025-08-05', 1350000)
on conflict do nothing;

insert into rfqs
  (id, procurement_id, rfq_number, reference_number, status, date, amount)
values
  ('62000000-0000-0000-0000-000000000006',
   '61000000-0000-0000-0000-000000000006',
   'RFQ-2508030001', 'VEI-RFQ-2502', 'Closed', '2025-08-03', 1350000)
on conflict (id) do nothing;

-- Link the existing VQ for SP2402-002 to its new RFQ (same-case guard)
update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000006'
  where id = '61000000-0000-0000-0000-000000002006';  -- VEI-Q-2502-01 (SP2402-002)

-- Link the existing GR for SP2402-002 to its new PO (same-case guard)
update procurement_receipts set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000006'
              and po_number = 'PO-2508050001')
where id = '61000000-0000-0000-0000-000000003006';  -- GR for SP2402-002

-- ── (t2) SP2403-002 Paid (61000000-...-010): add PR + PO + RFQ + Payment ─────
-- Dates: PR 2025-05-05, RFQ 2025-05-06, PO 2025-05-10 (matches header po_number)
-- VI exists (61000000-0000-0000-0000-000000004010), GR exists (61000000-0000-0000-0000-000000003010)

insert into purchase_requests
  (procurement_id, pr_number, reference_number, status, date, amount)
values
  ('61000000-0000-0000-0000-000000000010',
   'PR-2505050001', 'REQ-2025-0094', 'Approved', '2025-05-05', 630000)
on conflict do nothing;

insert into purchase_orders
  (procurement_id, po_number, reference_number, status, date, amount)
values
  ('61000000-0000-0000-0000-000000000010',
   'PO-2505100001', 'PO-RM-2505-0094', 'Closed', '2025-05-10', 630000)
on conflict do nothing;

insert into rfqs
  (id, procurement_id, rfq_number, reference_number, status, date, amount)
values
  ('62000000-0000-0000-0000-000000000010',
   '61000000-0000-0000-0000-000000000010',
   'RFQ-2505060001', 'RMS-RFQ-2503', 'Closed', '2025-05-06', 630000)
on conflict (id) do nothing;

-- Link VQ for SP2403-002 to its RFQ
update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000010'
  where id = '61000000-0000-0000-0000-000000002010';  -- RMS-Q-2503-01 (SP2403-002)

-- Link GR + VI for SP2403-002 to the new PO
update procurement_receipts set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000010'
              and po_number = 'PO-2505100001')
where id = '61000000-0000-0000-0000-000000003010';  -- GR for SP2403-002

update procurement_invoices set
  po_id = (select id from purchase_orders
            where procurement_id = '61000000-0000-0000-0000-000000000010'
              and po_number = 'PO-2505100001')
where id = '61000000-0000-0000-0000-000000004010';  -- VI for SP2403-002

-- Enrich VI reference_number + amount for SP2403-002
update procurement_invoices
  set reference_number = 'INV-RM-2025-0630', amount = 630000
  where id = '61000000-0000-0000-0000-000000004010';

-- Payment for SP2403-002 (PAY-2507150001 = ~7 days after VI 2025-07-10)
insert into payments
  (id, procurement_id, invoice_id, pay_number, reference_number, status, date, amount)
values
  ('63000000-0000-0000-0000-000000000010',
   '61000000-0000-0000-0000-000000000010',
   '61000000-0000-0000-0000-000000004010',
   'PAY-2507150001', 'TT-RM-2025-0094', 'Paid', '2025-07-15', 630000)
on conflict (id) do nothing;

-- ── (t3) PROC-2026-005 Paid (60000000-...-005): add PR + PO + RFQ + GR + Payment ─
-- Dates: PR 2025-12-01, RFQ 2025-11-25 (VQ is 2025-11-25), PO 2025-12-01
-- VI exists (auto-id, VI-2512010001, paid). Need to use subquery for invoice_id.

insert into purchase_requests
  (procurement_id, pr_number, reference_number, status, date, amount)
values
  ('60000000-0000-0000-0000-000000000005',
   'PR-2512010001', 'REQ-2025-1130', 'Approved', '2025-12-01', 320000)
on conflict do nothing;

insert into purchase_orders
  (procurement_id, po_number, reference_number, status, date, amount)
values
  ('60000000-0000-0000-0000-000000000005',
   'PO-2512010001', 'PO-CE-2512-1130', 'Closed', '2025-12-01', 320000)
on conflict do nothing;

insert into rfqs
  (id, procurement_id, rfq_number, reference_number, status, date, amount)
values
  ('62000000-0000-0000-0000-000000000011',
   '60000000-0000-0000-0000-000000000005',
   'RFQ-2511260001', 'CCE-RFQ-2511', 'Closed', '2025-11-26', 320000)
on conflict (id) do nothing;

-- Link VQ for PROC-2026-005 to its RFQ
update procurement_quotations set rfq_id = '62000000-0000-0000-0000-000000000011'
  where procurement_id = '60000000-0000-0000-0000-000000000005' and is_selected = true;

-- PROC-2026-005 had only a VI but no GR — add GR so the stepper reads complete
insert into procurement_receipts
  (id, procurement_id, gr_number, receipt_date, status, reference_number)
values
  ('61000000-0000-0000-0000-000000003015',
   '60000000-0000-0000-0000-000000000005',
   'GR-2512101001', '2025-12-10', 'Complete', 'DN-CE-2025-1210')
on conflict (id) do nothing;

-- Link new GR to the PO
update procurement_receipts set
  po_id = (select id from purchase_orders
            where procurement_id = '60000000-0000-0000-0000-000000000005'
              and po_number = 'PO-2512010001')
where id = '61000000-0000-0000-0000-000000003015';

-- Link the existing VI for PROC-2026-005 to the PO
update procurement_invoices set
  po_id = (select id from purchase_orders
            where procurement_id = '60000000-0000-0000-0000-000000000005'
              and po_number = 'PO-2512010001')
where procurement_id = '60000000-0000-0000-0000-000000000005';

-- Enrich VI reference_number + amount for PROC-2026-005
update procurement_invoices
  set reference_number = 'INV-CE-2025-3200', amount = 320000
  where procurement_id = '60000000-0000-0000-0000-000000000005';

-- Payment for PROC-2026-005 — reference invoice by procurement_id (auto-id)
insert into payments
  (id, procurement_id, invoice_id, pay_number, reference_number, status, date, amount)
values
  ('63000000-0000-0000-0000-000000000015',
   '60000000-0000-0000-0000-000000000005',
   (select id from procurement_invoices
     where procurement_id = '60000000-0000-0000-0000-000000000005' limit 1),
   'PAY-2512221001', 'TT-CE-2025-1130', 'Paid', '2025-12-22', 320000)
on conflict (id) do nothing;

-- ── (t4) procurement_status_events — condensed history for SP2402-001 ────────
-- Actors: PM (a2) submits/sources/orders; Exec (a1) approves; Finance (a3) invoices/pays.
-- Timestamps from procurement created_at 2025-06-10.

insert into procurement_status_events
  (id, procurement_id, from_status, to_status, actor_id, notes, created_at)
values
  ('64000000-0000-0000-0000-000000000010',
   '61000000-0000-0000-0000-000000000005',
   'Draft', 'Requested',
   '00000000-0000-0000-0000-0000000000a2',
   'Initial request for 12,000 PV modules — Cascade Foods 6.0 MW ground-mount.',
   '2025-06-10T08:30:00Z'),
  ('64000000-0000-0000-0000-000000000011',
   '61000000-0000-0000-0000-000000000005',
   'Requested', 'Approved',
   '00000000-0000-0000-0000-0000000000a1',
   'Approved against Cascade Foods active budget. Large module order — priority delivery.',
   '2025-06-11T11:00:00Z'),
  ('64000000-0000-0000-0000-000000000012',
   '61000000-0000-0000-0000-000000000005',
   'Approved', 'Vendor Quoted',
   '00000000-0000-0000-0000-0000000000a2',
   'RFQ issued to SunVolt. Quote SVX-Q-2502-01 received at 3,700,000.',
   '2025-06-13T09:45:00Z'),
  ('64000000-0000-0000-0000-000000000013',
   '61000000-0000-0000-0000-000000000005',
   'Vendor Quoted', 'Quote Selected',
   '00000000-0000-0000-0000-0000000000a2',
   'SunVolt selected — volume pricing and IEC 61215 certified.',
   '2025-06-13T14:00:00Z'),
  ('64000000-0000-0000-0000-000000000014',
   '61000000-0000-0000-0000-000000000005',
   'Quote Selected', 'Ordered',
   '00000000-0000-0000-0000-0000000000a2',
   'PO-2506200001 raised. Delivery window Nov 2025 — DAP Incoterms agreed.',
   '2025-06-20T10:00:00Z'),
  ('64000000-0000-0000-0000-000000000015',
   '61000000-0000-0000-0000-000000000005',
   'Ordered', 'Received',
   '00000000-0000-0000-0000-0000000000a4',
   'GR-2511250001 — all 12,000 panels received at Cascade Foods site. Inspection passed.',
   '2025-11-25T15:30:00Z'),
  ('64000000-0000-0000-0000-000000000016',
   '61000000-0000-0000-0000-000000000005',
   'Received', 'Vendor Invoiced',
   '00000000-0000-0000-0000-0000000000a3',
   'VI-2512010001 received from SunVolt. 30-day payment terms.',
   '2025-12-01T09:00:00Z'),
  ('64000000-0000-0000-0000-000000000017',
   '61000000-0000-0000-0000-000000000005',
   'Vendor Invoiced', 'Paid',
   '00000000-0000-0000-0000-0000000000a3',
   'TT-SV-2025-0209 — 3,700,000 settled by bank transfer. Case closed.',
   '2025-12-08T13:00:00Z')
on conflict (id) do nothing;

-- ── (t5) procurement_status_events — condensed history for SP2403-001 ────────
-- SP2403-001 Paid — Atlas Chemicals 2.8 MW carport.
-- Timestamps from procurement created_at 2025-04-01.

insert into procurement_status_events
  (id, procurement_id, from_status, to_status, actor_id, notes, created_at)
values
  ('64000000-0000-0000-0000-000000000020',
   '61000000-0000-0000-0000-000000000009',
   'Draft', 'Requested',
   '00000000-0000-0000-0000-0000000000a2',
   'Initial request for 5,200 PV modules — Atlas Chemicals 2.8 MW carport.',
   '2025-04-01T09:00:00Z'),
  ('64000000-0000-0000-0000-000000000021',
   '61000000-0000-0000-0000-000000000009',
   'Requested', 'Approved',
   '00000000-0000-0000-0000-0000000000a3',
   'Approved. Budget confirmed for Atlas Chemicals close-out project.',
   '2025-04-02T10:00:00Z'),
  ('64000000-0000-0000-0000-000000000022',
   '61000000-0000-0000-0000-000000000009',
   'Approved', 'Vendor Quoted',
   '00000000-0000-0000-0000-0000000000a2',
   'RFQ issued to SunVolt. Quote SVX-Q-2503-01 received at 1,440,000.',
   '2025-04-04T11:30:00Z'),
  ('64000000-0000-0000-0000-000000000023',
   '61000000-0000-0000-0000-000000000009',
   'Vendor Quoted', 'Quote Selected',
   '00000000-0000-0000-0000-0000000000a2',
   'SunVolt selected.',
   '2025-04-04T14:00:00Z'),
  ('64000000-0000-0000-0000-000000000024',
   '61000000-0000-0000-0000-000000000009',
   'Quote Selected', 'Ordered',
   '00000000-0000-0000-0000-0000000000a2',
   'PO-2504100001 issued to SunVolt.',
   '2025-04-10T09:00:00Z'),
  ('64000000-0000-0000-0000-000000000025',
   '61000000-0000-0000-0000-000000000009',
   'Ordered', 'Received',
   '00000000-0000-0000-0000-0000000000a4',
   'GR-2506100001 — all panels received at Atlas Chemicals carport site.',
   '2025-06-10T16:00:00Z'),
  ('64000000-0000-0000-0000-000000000026',
   '61000000-0000-0000-0000-000000000009',
   'Received', 'Vendor Invoiced',
   '00000000-0000-0000-0000-0000000000a3',
   'VI-2506150001 received. 10-day net terms.',
   '2025-06-15T10:00:00Z'),
  ('64000000-0000-0000-0000-000000000027',
   '61000000-0000-0000-0000-000000000009',
   'Vendor Invoiced', 'Paid',
   '00000000-0000-0000-0000-0000000000a3',
   'TT-SV-2025-0078 — 1,440,000 settled. Case closed.',
   '2025-06-20T11:00:00Z')
on conflict (id) do nothing;

