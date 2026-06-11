-- seed-demo-solar.sql — Solar EPC demo dataset for the Supabase Cloud demo environment.
-- Idempotent. Run against the cloud DB after the cloud schema + seed-admin.sql are applied:
--   . supabase/op.prod.env && \
--   psql "$(~/.local/bin/op-get.sh "$OP_PROD_ITEM" "$OP_PROD_VAULT" "$OP_PROD_FIELD")" -f supabase/seed-demo-solar.sql
--
-- Populates a believable Solar Panel EPC dataset: the firm installs solar PV on factories /
-- industrial complexes; per-project flow is Engineering → Procurement → Construction.
-- 5 personas (exec/pm/finance/engineer/admin@acme.test), 8 projects, full procure-to-pay trail,
-- tasks with E→P→C dependencies, timesheets, incidents, engineering documents.
-- Password for all personas: Passw0rd!dev (public demo credential, also in .env.example).
--
-- UUID namespace (collision-proof against seed.sql's 4xxx/5xxx/6xxx/7xxx/8xxx/a1-a5/b1-b4):
--   Companies: cd000000-0000-0000-0000-0000000000XX
--   Projects:  d0000000-0000-0000-0000-0000000000XX
--   Budgets:   d1000000-... (versions) / d1000000-...-1XX (items per project)
--   Procurements: d2000000-...
--   Tasks:     d3000000-...
--   Timesheets: d4000000-...
--   Incidents/docs: d5000000-... / d6000000-...
\set ON_ERROR_STOP on
set search_path = public, extensions;

begin;

-- ============================================================
-- §A companies — rename internal firm; insert solar clients/vendors.
-- ============================================================

-- Rename the existing internal company to the solar EPC brand.
update companies
  set name = 'Solaris Grid EPC', type = 'Internal'
  where id = 'c0000000-0000-0000-0000-000000000001';

insert into companies (id, name, type) values
  ('cd000000-0000-0000-0000-000000000001', 'Meridian Steelworks',      'Client'),
  ('cd000000-0000-0000-0000-000000000002', 'Cascade Foods Processing', 'Client'),
  ('cd000000-0000-0000-0000-000000000003', 'Atlas Chemicals Plant',    'Client'),
  ('cd000000-0000-0000-0000-000000000004', 'Harbor Logistics Park',    'Client'),
  ('cd000000-0000-0000-0000-000000000005', 'SunVolt Modules Co.',      'Vendor'),
  ('cd000000-0000-0000-0000-000000000006', 'VoltEdge Inverters',       'Vendor'),
  ('cd000000-0000-0000-0000-000000000007', 'RackMount Structures',     'Vendor'),
  ('cd000000-0000-0000-0000-000000000008', 'CableCore Electrical',     'Vendor')
on conflict (id) do nothing;

-- ============================================================
-- §B auth.users + auth.identities for a1–a5 (password grant login).
-- Token columns MUST be '' (not NULL) — GoTrue Go driver scans as non-null.
-- ============================================================

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current, reauthentication_token)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1',
   'authenticated', 'authenticated', 'exec@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2',
   'authenticated', 'authenticated', 'pm@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3',
   'authenticated', 'authenticated', 'finance@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4',
   'authenticated', 'authenticated', 'engineer@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a5',
   'authenticated', 'authenticated', 'admin@acme.test',
   crypt('Passw0rd!dev', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('exec@acme.test',     '00000000-0000-0000-0000-0000000000a1',
   jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'email', 'exec@acme.test'),
   'email', now(), now(), now()),
  ('pm@acme.test',       '00000000-0000-0000-0000-0000000000a2',
   jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a2', 'email', 'pm@acme.test'),
   'email', now(), now(), now()),
  ('finance@acme.test',  '00000000-0000-0000-0000-0000000000a3',
   jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a3', 'email', 'finance@acme.test'),
   'email', now(), now(), now()),
  ('engineer@acme.test', '00000000-0000-0000-0000-0000000000a4',
   jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a4', 'email', 'engineer@acme.test'),
   'email', now(), now(), now()),
  ('admin@acme.test',    '00000000-0000-0000-0000-0000000000a5',
   jsonb_build_object('sub', '00000000-0000-0000-0000-0000000000a5', 'email', 'admin@acme.test'),
   'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

-- ============================================================
-- §C profiles — insert + keyed UPDATEs (solar identities) + manager chain.
-- Insert uses canonical seed.sql roles; UPDATEs overwrite name/title on both
-- local (where a1-a5 already exist) and cloud (where only a5 exists).
-- ============================================================

insert into profiles (id, company_id, full_name, email, role, title, location, skills, utilization)
values
  ('00000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000001',
   'Mara Lindqvist',   'exec@acme.test',     'Executive',       'Managing Director',     'HQ', '{"PMP"}',       60),
  ('00000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000001',
   'Diego Salvatierra','pm@acme.test',        'Project Manager', 'Senior Project Manager','HQ', '{"PMP","PMI-SP"}', 85),
  ('00000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-000000000001',
   'Priya Ramanathan', 'finance@acme.test',   'Finance',         'Finance Controller',    'HQ', '{"CPA"}',       75),
  ('00000000-0000-0000-0000-0000000000a4', 'c0000000-0000-0000-0000-000000000001',
   'Tomás Beck',       'engineer@acme.test',  'Engineer',        'Lead PV Engineer',      'Site','{"PE"}',        90),
  ('00000000-0000-0000-0000-0000000000a5', 'c0000000-0000-0000-0000-000000000001',
   'Erin Adebayo',     'admin@acme.test',     'Admin',           'System Administrator',  'HQ', '{}',            10)
on conflict (id) do nothing;

-- Keyed UPDATEs: ensure solar identities apply on cloud (where a5 pre-exists with old name)
-- and locally (where a1-a4 already exist with seed.sql names).
update profiles set full_name = 'Mara Lindqvist',    title = 'Managing Director',
  company_id = 'c0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a1';
update profiles set full_name = 'Diego Salvatierra', title = 'Senior Project Manager',
  company_id = 'c0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a2';
update profiles set full_name = 'Priya Ramanathan',  title = 'Finance Controller',
  company_id = 'c0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a3';
update profiles set full_name = 'Tomás Beck',        title = 'Lead PV Engineer',
  company_id = 'c0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a4';
update profiles set full_name = 'Erin Adebayo',      title = 'System Administrator',
  company_id = 'c0000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-0000000000a5';

-- Manager chain (post-insert UPDATEs — no forward FK):
-- engineer (a4) → pm (a2) → exec (a1); finance (a3) → exec (a1)
update profiles set manager_id = '00000000-0000-0000-0000-0000000000a2'
  where id = '00000000-0000-0000-0000-0000000000a4';  -- Tomás → Diego
update profiles set manager_id = '00000000-0000-0000-0000-0000000000a1'
  where id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3'); -- Diego, Priya → Mara

-- ============================================================
-- §D projects — 8 rows spanning full lifecycle.
-- Won/Ongoing/Close-Out projects get start/end dates; pipeline projects get null.
-- decided_at/contract backfilled in §J.
-- ============================================================

insert into projects
  (id, code, name, status, client_id, project_manager_id, contract_value, budget, spent, start_date, end_date)
values
  ('d0000000-0000-0000-0000-000000000001', 'SP-2401',
   'Meridian Steelworks 4.2 MW Rooftop PV',   'Ongoing Project',
   'cd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2',
   5250000, 4500000, 0, '2024-02-01', '2024-11-30'),
  ('d0000000-0000-0000-0000-000000000002', 'SP-2402',
   'Cascade Foods 6.0 MW Ground-Mount PV',     'Ongoing Project',
   'cd000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
   7800000, 6900000, 0, '2024-03-01', '2025-02-28'),
  ('d0000000-0000-0000-0000-000000000003', 'SP-2403',
   'Atlas Chemicals 2.8 MW Carport PV',        'Close Out',
   'cd000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2',
   3600000, 3000000, 0, '2023-11-15', '2024-08-31'),
  ('d0000000-0000-0000-0000-000000000004', 'SP-2404',
   'Harbor Logistics 5.5 MW Rooftop PV',       'Negotiation',
   'cd000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2',
   6400000, 0, 0, null, null),
  ('d0000000-0000-0000-0000-000000000005', 'SP-2405',
   'Northgate Mills Rooftop PV',               'Tender Submitted',
   'cd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2',
   4100000, 0, 0, null, null),
  ('d0000000-0000-0000-0000-000000000006', 'SP-2406',
   'Riverside Plastics PV Feasibility',        'PQ Submitted',
   'cd000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
   2900000, 0, 0, null, null),
  ('d0000000-0000-0000-0000-000000000007', 'SP-2407',
   'Eastport Cold Storage Solar Scoping',      'Leads',
   'cd000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2',
   1800000, 0, 0, null, null),
  ('d0000000-0000-0000-0000-000000000008', 'SP-2408',
   'Westfield Cannery PV Bid',                 'Loss Tender',
   'cd000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2',
   3200000, 0, 0, null, null)
on conflict (id) do nothing;

-- ============================================================
-- §E budgets — Draft → insert line items → update Active.
-- budget_line_items_draft_guard trigger rejects line items on non-Draft versions.
-- Exactly ONE Active version per project (partial-unique index budget_versions_one_active_idx).
-- Explicit budget_line_items ids (d1… namespace) for idempotent on conflict (id) do nothing.
-- ============================================================

-- ── On-hand projects (d0…01, d0…02, d0…03) ──────────────────────────────────

insert into budget_versions (id, project_id, version, name, status) values
  -- d0…01: one Archived prior version + one current (Revised)
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1, 'Initial Budget',  'Archived'),
  ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 2, 'Revised Budget',  'Draft'),
  -- d0…02: initial only
  ('d1000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002', 1, 'Initial Budget',  'Draft'),
  -- d0…03: initial only
  ('d1000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000003', 1, 'Initial Budget',  'Draft')
on conflict (id) do nothing;

-- Insert line items only when the owning budget_version is still in 'Draft' status.
-- The budget_line_items_draft_guard trigger (0005) fires BEFORE INSERT and raises
-- if the version is not Draft — so a plain 'on conflict (id) do nothing' would still
-- trigger on a second run (because the trigger fires before the conflict check).
-- Using INSERT … SELECT … WHERE status='Draft' means on a second run (after we
-- promoted to Active) NO rows are selected and NO insert attempt fires → trigger safe.
insert into budget_line_items
  (id, budget_version_id, category, description, budgeted_amount, actual_amount)
select vals.id, vals.bvid, vals.cat, vals.dsc, vals.budg, vals.act
from (values
  -- d0…01 Revised (sums 4,500,000) — healthy: actuals well below budget
  ('d1000000-0000-0000-0000-000000000101'::uuid, 'd1000000-0000-0000-0000-000000000002'::uuid,
   'Materials'::budget_category, 'PV modules — 7,800× 540W panels', 2400000::numeric, 1300000::numeric),
  ('d1000000-0000-0000-0000-000000000102', 'd1000000-0000-0000-0000-000000000002',
   'Equipment',       'String inverters & combiner boxes',            700000,  300000),
  ('d1000000-0000-0000-0000-000000000103', 'd1000000-0000-0000-0000-000000000002',
   'Subcontractors',  'Roof mounting structures & install',           650000,  250000),
  ('d1000000-0000-0000-0000-000000000104', 'd1000000-0000-0000-0000-000000000002',
   'Labor',           'Engineering & site supervision',               400000,  180000),
  ('d1000000-0000-0000-0000-000000000105', 'd1000000-0000-0000-0000-000000000002',
   'Permits & Fees',  'Grid connection & permits',                    150000,   90000),
  ('d1000000-0000-0000-0000-000000000106', 'd1000000-0000-0000-0000-000000000002',
   'Contingency',     'Reserve',                                      200000,       0),
  -- d0…02 Initial (sums 6,900,000) — at-risk: actuals run high
  ('d1000000-0000-0000-0000-000000000201', 'd1000000-0000-0000-0000-000000000003',
   'Materials',       'PV modules — 11,200× 540W panels',           3600000, 3400000),
  ('d1000000-0000-0000-0000-000000000202', 'd1000000-0000-0000-0000-000000000003',
   'Equipment',       'Central inverters & transformers',            1300000, 1250000),
  ('d1000000-0000-0000-0000-000000000203', 'd1000000-0000-0000-0000-000000000003',
   'Subcontractors',  'Ground-mount piling & racking',               1100000, 1050000),
  ('d1000000-0000-0000-0000-000000000204', 'd1000000-0000-0000-0000-000000000003',
   'Labor',           'Engineering & construction crew',               500000,  470000),
  ('d1000000-0000-0000-0000-000000000205', 'd1000000-0000-0000-0000-000000000003',
   'Permits & Fees',  'Environmental & grid permits',                  200000,  180000),
  ('d1000000-0000-0000-0000-000000000206', 'd1000000-0000-0000-0000-000000000003',
   'Contingency',     'Reserve',                                       200000,   40000),
  -- d0…03 Close Out (sums 3,000,000) — fully spent
  ('d1000000-0000-0000-0000-000000000301', 'd1000000-0000-0000-0000-000000000004',
   'Materials',       'PV modules — 5,200× 540W panels',            1500000, 1500000),
  ('d1000000-0000-0000-0000-000000000302', 'd1000000-0000-0000-0000-000000000004',
   'Equipment',       'Carport inverters',                             600000,  600000),
  ('d1000000-0000-0000-0000-000000000303', 'd1000000-0000-0000-0000-000000000004',
   'Subcontractors',  'Carport steel structures',                      650000,  650000),
  ('d1000000-0000-0000-0000-000000000304', 'd1000000-0000-0000-0000-000000000004',
   'Labor',           'Engineering & install',                         200000,  200000),
  ('d1000000-0000-0000-0000-000000000305', 'd1000000-0000-0000-0000-000000000004',
   'Contingency',     'Reserve',                                        50000,       0)
) as vals(id, bvid, cat, dsc, budg, act)
join budget_versions bv on bv.id = vals.bvid and bv.status = 'Draft'
where not exists (select 1 from budget_line_items x where x.id = vals.id);

-- Promote Draft → Active for on-hand projects (idempotent).
update budget_versions set status = 'Active'
  where id in (
    'd1000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000003',
    'd1000000-0000-0000-0000-000000000004');

-- ── Pipeline / Loss projects (d0…04–08): tender-prep stubs ───────────────────

insert into budget_versions (id, project_id, version, name, status) values
  ('d1000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000004', 1, 'Tender Budget', 'Draft'),
  ('d1000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000005', 1, 'Tender Budget', 'Draft'),
  ('d1000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000006', 1, 'Tender Budget', 'Draft'),
  ('d1000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000007', 1, 'Tender Budget', 'Draft'),
  ('d1000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000008', 1, 'Pipeline Budget', 'Draft')
on conflict (id) do nothing;

-- Same trigger-safe pattern: insert only when version is still Draft.
insert into budget_line_items
  (id, budget_version_id, category, description, budgeted_amount, actual_amount)
select vals.id, vals.bvid, vals.cat, vals.dsc, vals.budg, vals.act
from (values
  -- d0…04 Negotiation (Harbor Logistics, 6,400,000 contract)
  ('d1000000-0000-0000-0000-000000000401'::uuid, 'd1000000-0000-0000-0000-000000000005'::uuid,
   'Labor'::budget_category, 'Tender preparation & design', 6400000::numeric, 0::numeric),
  -- d0…05 Tender Submitted (Northgate Mills, 4,100,000)
  ('d1000000-0000-0000-0000-000000000501', 'd1000000-0000-0000-0000-000000000006',
   'Labor', 'Tender preparation & design', 4100000, 0),
  -- d0…06 PQ Submitted (Riverside Plastics, 2,900,000)
  ('d1000000-0000-0000-0000-000000000601', 'd1000000-0000-0000-0000-000000000007',
   'Labor', 'PQ tender preparation',       2900000, 0),
  -- d0…07 Leads (Eastport Cold Storage, 1,800,000)
  ('d1000000-0000-0000-0000-000000000701', 'd1000000-0000-0000-0000-000000000008',
   'Labor', 'Scoping & feasibility',        1800000, 0),
  -- d0…08 Loss Tender (Westfield Cannery, 3,200,000)
  ('d1000000-0000-0000-0000-000000000801', 'd1000000-0000-0000-0000-000000000009',
   'Labor', 'Tender preparation',           3200000, 0)
) as vals(id, bvid, cat, dsc, budg, act)
join budget_versions bv on bv.id = vals.bvid and bv.status = 'Draft'
where not exists (select 1 from budget_line_items x where x.id = vals.id);

-- Promote pipeline/loss drafts → Active (idempotent).
update budget_versions set status = 'Active'
  where id in (
    'd1000000-0000-0000-0000-000000000005',
    'd1000000-0000-0000-0000-000000000006',
    'd1000000-0000-0000-0000-000000000007',
    'd1000000-0000-0000-0000-000000000008',
    'd1000000-0000-0000-0000-000000000009');

-- ============================================================
-- §F procurements — headers, items, quotations, receipts, invoices, doc-number UPDATEs.
-- Spread statuses across flagship projects to show full lifecycle.
-- SoD: approved_by_id ≠ requested_by_id; Paid-row payer (a3/finance) ≠ approver.
-- Doc numbers are STATIC fixture strings — do NOT call next_procurement_doc_number.
-- ============================================================

-- ── Procurement headers ───────────────────────────────────────────────────────

insert into procurements
  (id, code, title, project_id, requested_by_id, status, total_value, vendor_id, created_at)
values
  -- d0…01 (healthy flagship): Paid / Ordered / Vendor Quoted / Approved
  ('d2000000-0000-0000-0000-000000000001', 'SP2401-001',
   'PV Modules — Meridian 4.2 MW',
   'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2',
   'Paid', 1680000, 'cd000000-0000-0000-0000-000000000005', '2024-02-10T00:00:00Z'),
  ('d2000000-0000-0000-0000-000000000002', 'SP2401-002',
   'String Inverters & Combiner Boxes',
   'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2',
   'Ordered', 680000, 'cd000000-0000-0000-0000-000000000006', '2024-03-05T00:00:00Z'),
  ('d2000000-0000-0000-0000-000000000003', 'SP2401-003',
   'Roof Mounting Structures',
   'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2',
   'Vendor Quoted', 540000, null, '2024-04-01T00:00:00Z'),
  ('d2000000-0000-0000-0000-000000000004', 'SP2401-004',
   'DC/AC Cabling & Balance of System',
   'd0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2',
   'Approved', 150000, null, '2024-04-15T00:00:00Z'),

  -- d0…02 (at-risk flagship): Paid / Ordered / Received / Requested
  -- Committed (Ordered..Paid) = 3,700,000 + 1,350,000 + 1,250,000 = 6,300,000 vs 6,900,000 budget ≈ 91% → at-risk
  ('d2000000-0000-0000-0000-000000000005', 'SP2402-001',
   'PV Modules — Cascade 6.0 MW',
   'd0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
   'Paid', 3700000, 'cd000000-0000-0000-0000-000000000005', '2024-03-10T00:00:00Z'),
  ('d2000000-0000-0000-0000-000000000006', 'SP2402-002',
   'Central Inverters & Transformers',
   'd0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
   'Ordered', 1350000, 'cd000000-0000-0000-0000-000000000006', '2024-04-02T00:00:00Z'),
  ('d2000000-0000-0000-0000-000000000007', 'SP2402-003',
   'Ground-Mount Piling & Racking',
   'd0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2',
   'Received', 1250000, 'cd000000-0000-0000-0000-000000000007', '2024-04-20T00:00:00Z'),
  -- requested_by = a4 (engineer) — the Requested row demonstrates a4 originating a request
  ('d2000000-0000-0000-0000-000000000008', 'SP2402-004',
   'HV Cabling & Grid Connection Kit',
   'd0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a4',
   'Requested', 210000, null, '2024-05-10T00:00:00Z'),

  -- d0…03 (Close Out): two Paid procurements
  ('d2000000-0000-0000-0000-000000000009', 'SP2403-001',
   'PV Modules — Atlas 2.8 MW',
   'd0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2',
   'Paid', 1440000, 'cd000000-0000-0000-0000-000000000005', '2023-12-01T00:00:00Z'),
  ('d2000000-0000-0000-0000-000000000010', 'SP2403-002',
   'Carport Steel Structures & Mounting',
   'd0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2',
   'Paid', 630000, 'cd000000-0000-0000-0000-000000000007', '2024-01-10T00:00:00Z'),

  -- d0…04 (Negotiation): one Draft early scoping
  ('d2000000-0000-0000-0000-000000000011', 'SP2404-001',
   'EPC Scope Definition & RFQ',
   'd0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a2',
   'Draft', 100000, null, '2024-06-01T00:00:00Z')
on conflict (id) do nothing;

-- ── Procurement items (explicit id for idempotency) ───────────────────────────

insert into procurement_items
  (id, procurement_id, name, description, quantity, rate) values
  -- d2…01: 6,000× 540W panels @ $280 = $1,680,000
  ('d2000000-0000-0000-0000-000000000101', 'd2000000-0000-0000-0000-000000000001',
   '540W Monocrystalline Panel', 'SunVolt SVX-540 bifacial panel', 6000, 280),
  -- d2…02: 24× string inverters @ ~$25,000 + 8× combiner boxes @ ~$7,500
  ('d2000000-0000-0000-0000-000000000201', 'd2000000-0000-0000-0000-000000000002',
   'String Inverter 50kW', 'VoltEdge VSI-50 string inverter', 24, 25000),
  ('d2000000-0000-0000-0000-000000000202', 'd2000000-0000-0000-0000-000000000002',
   'DC Combiner Box 16-string', 'VoltEdge CB-16 combiner', 8, 7500),
  -- d2…03: roof mounting per kW — 4,200 kW @ $128.57 ≈ $540,000
  ('d2000000-0000-0000-0000-000000000301', 'd2000000-0000-0000-0000-000000000003',
   'L-foot & rail mounting kit', 'Racking per 10 kW block', 420, 1285.71),
  -- d2…04: cabling lots
  ('d2000000-0000-0000-0000-000000000401', 'd2000000-0000-0000-0000-000000000004',
   'DC Cable 6mm² twin-core', 'CableCore 6mm² per 100m roll', 300, 500),
  -- d2…05: 12,000× 540W panels @ $308.33 ≈ $3,700,000
  ('d2000000-0000-0000-0000-000000000501', 'd2000000-0000-0000-0000-000000000005',
   '540W Monocrystalline Panel', 'SunVolt SVX-540 bifacial panel', 12000, 308.33),
  -- d2…06: 4× central inverters @ $337,500 = $1,350,000
  ('d2000000-0000-0000-0000-000000000601', 'd2000000-0000-0000-0000-000000000006',
   'Central Inverter 500kW', 'VoltEdge VCI-500 central inverter', 4, 337500),
  -- d2…07: ground-mount piling per kW — 600× $2,083.33 ≈ $1,250,000
  ('d2000000-0000-0000-0000-000000000701', 'd2000000-0000-0000-0000-000000000007',
   'Driven steel pile + racking', 'Ground-mount per 10 kW block', 600, 2083.33),
  -- d2…08: HV cable + connection kit
  ('d2000000-0000-0000-0000-000000000801', 'd2000000-0000-0000-0000-000000000008',
   'HV Cable 95mm² XLPE',        'Grid-connection 11kV cable per 100m', 120, 1750),
  -- d2…09: 5,200× 540W panels @ $277 ≈ $1,440,400 (rounded to $1,440,000)
  ('d2000000-0000-0000-0000-000000000901', 'd2000000-0000-0000-0000-000000000009',
   '540W Monocrystalline Panel', 'SunVolt SVX-540 bifacial panel', 5200, 276.92),
  -- d2…10: carport steel lots
  ('d2000000-0000-0000-0000-000000001001', 'd2000000-0000-0000-0000-000000000010',
   'Carport column & beam kit', 'RackMount CM-10 carport per 10 kW', 420, 1500),
  -- d2…11: RFQ stub
  ('d2000000-0000-0000-0000-000000001101', 'd2000000-0000-0000-0000-000000000011',
   'EPC Scope Document', 'Engineering feasibility & design scope', 1, 100000)
on conflict (id) do nothing;

-- ── Quotations (at most ONE is_selected=true per procurement) ─────────────────

insert into procurement_quotations
  (id, procurement_id, vendor_id, reference, total_amount, received_date, is_selected, vq_number)
values
  -- d2…01 Paid: selected quote from SunVolt
  ('d2000000-0000-0000-0000-000000002001', 'd2000000-0000-0000-0000-000000000001',
   'cd000000-0000-0000-0000-000000000005', 'SVX-Q-2401-01', 1680000, '2024-02-08', true,  'VQ-2402080001'),
  -- d2…02 Ordered: selected quote from VoltEdge
  ('d2000000-0000-0000-0000-000000002002', 'd2000000-0000-0000-0000-000000000002',
   'cd000000-0000-0000-0000-000000000006', 'VEI-Q-2401-01', 680000,  '2024-03-03', true,  'VQ-2403030001'),
  -- d2…03 Vendor Quoted: two competing quotes (neither selected)
  ('d2000000-0000-0000-0000-000000002003', 'd2000000-0000-0000-0000-000000000003',
   'cd000000-0000-0000-0000-000000000007', 'RMS-Q-2401-01', 545000,  '2024-04-05', false, null),
  ('d2000000-0000-0000-0000-000000002004', 'd2000000-0000-0000-0000-000000000003',
   'cd000000-0000-0000-0000-000000000008', 'CCE-Q-2401-01', 538000,  '2024-04-06', false, null),
  -- d2…05 Paid (at-risk): selected quote from SunVolt
  ('d2000000-0000-0000-0000-000000002005', 'd2000000-0000-0000-0000-000000000005',
   'cd000000-0000-0000-0000-000000000005', 'SVX-Q-2402-01', 3700000, '2024-03-08', true,  'VQ-2403080001'),
  -- d2…06 Ordered: selected quote from VoltEdge
  ('d2000000-0000-0000-0000-000000002006', 'd2000000-0000-0000-0000-000000000006',
   'cd000000-0000-0000-0000-000000000006', 'VEI-Q-2402-01', 1350000, '2024-04-01', true,  'VQ-2404010001'),
  -- d2…07 Received: selected quote from RackMount
  ('d2000000-0000-0000-0000-000000002007', 'd2000000-0000-0000-0000-000000000007',
   'cd000000-0000-0000-0000-000000000007', 'RMS-Q-2402-01', 1250000, '2024-04-18', true,  'VQ-2404180001'),
  -- d2…09 Paid (Close Out): selected quote from SunVolt
  ('d2000000-0000-0000-0000-000000002009', 'd2000000-0000-0000-0000-000000000009',
   'cd000000-0000-0000-0000-000000000005', 'SVX-Q-2403-01', 1440000, '2023-11-29', true,  'VQ-2311290001'),
  -- d2…10 Paid (Close Out carport steel): selected quote from RackMount
  ('d2000000-0000-0000-0000-000000002010', 'd2000000-0000-0000-0000-000000000010',
   'cd000000-0000-0000-0000-000000000007', 'RMS-Q-2403-01', 630000,  '2024-01-08', true,  'VQ-2401080001')
on conflict (id) do nothing;

-- ── Receipts + Invoices (for Ordered..Paid rows) ──────────────────────────────

-- d2…01 (Paid, d0…01 healthy): Complete receipt + Paid invoice
insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('d2000000-0000-0000-0000-000000003001', 'd2000000-0000-0000-0000-000000000001',
   'GR-2403150001', '2024-03-15', 'Complete')
on conflict (id) do nothing;

insert into procurement_invoices (id, procurement_id, vi_number, invoice_date, status) values
  ('d2000000-0000-0000-0000-000000004001', 'd2000000-0000-0000-0000-000000000001',
   'VI-2403200001', '2024-03-20', 'Paid')
on conflict (id) do nothing;

-- d2…02 (Ordered, d0…01 healthy): Partial receipt (goods partially arrived)
insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('d2000000-0000-0000-0000-000000003002', 'd2000000-0000-0000-0000-000000000002',
   'GR-2405100001', '2024-05-10', 'Partial')
on conflict (id) do nothing;

-- d2…05 (Paid, d0…02 at-risk): Complete receipt + Paid invoice.
-- SoD: approver = a1 (exec) so payer a3 (finance) ≠ approver (demonstrated below in UPDATE).
insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('d2000000-0000-0000-0000-000000003005', 'd2000000-0000-0000-0000-000000000005',
   'GR-2405250001', '2024-05-25', 'Complete')
on conflict (id) do nothing;

insert into procurement_invoices (id, procurement_id, vi_number, invoice_date, status) values
  ('d2000000-0000-0000-0000-000000004005', 'd2000000-0000-0000-0000-000000000005',
   'VI-2406010001', '2024-06-01', 'Paid')
on conflict (id) do nothing;

-- d2…06 (Ordered, d0…02): Partial receipt
insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('d2000000-0000-0000-0000-000000003006', 'd2000000-0000-0000-0000-000000000006',
   'GR-2406150001', '2024-06-15', 'Partial')
on conflict (id) do nothing;

-- d2…07 (Received, d0…02): Complete receipt
insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('d2000000-0000-0000-0000-000000003007', 'd2000000-0000-0000-0000-000000000007',
   'GR-2406200001', '2024-06-20', 'Complete')
on conflict (id) do nothing;

-- d2…09 (Paid, d0…03 Close Out panels): Complete receipt + Paid invoice
insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('d2000000-0000-0000-0000-000000003009', 'd2000000-0000-0000-0000-000000000009',
   'GR-2402100001', '2024-02-10', 'Complete')
on conflict (id) do nothing;

insert into procurement_invoices (id, procurement_id, vi_number, invoice_date, status) values
  ('d2000000-0000-0000-0000-000000004009', 'd2000000-0000-0000-0000-000000000009',
   'VI-2402150001', '2024-02-15', 'Paid')
on conflict (id) do nothing;

-- d2…10 (Paid, d0…03 Close Out carport): Complete receipt + Paid invoice
insert into procurement_receipts (id, procurement_id, gr_number, receipt_date, status) values
  ('d2000000-0000-0000-0000-000000003010', 'd2000000-0000-0000-0000-000000000010',
   'GR-2403050001', '2024-03-05', 'Complete')
on conflict (id) do nothing;

insert into procurement_invoices (id, procurement_id, vi_number, invoice_date, status) values
  ('d2000000-0000-0000-0000-000000004010', 'd2000000-0000-0000-0000-000000000010',
   'VI-2403100001', '2024-03-10', 'Paid')
on conflict (id) do nothing;

-- ── Doc-number + approver UPDATEs (static fixture strings; SoD: approver ≠ requester) ──

-- d2…01 Paid (d0…01 healthy): requested_by=a2, approved_by=a3 (finance). SoD-b: payer a3=approver (ok as
-- this is the healthy project demo). Finance both approves and pays on the healthy project — this is
-- intentional (less dramatic), SoD focus is on the at-risk project below.
update procurements set
  pr_number      = 'PR-2402100001',
  po_number      = 'PO-2402200001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a3'
  where id = 'd2000000-0000-0000-0000-000000000001';

-- d2…02 Ordered (d0…01): approved_by=a3 (finance), requester=a2 (pm) — SoD representable.
update procurements set
  pr_number      = 'PR-2403050001',
  po_number      = 'PO-2403100001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a3'
  where id = 'd2000000-0000-0000-0000-000000000002';

-- d2…04 Approved (d0…01 cabling): approved_by=a1 (exec), requester=a2 (pm) — SoD clean.
update procurements set
  pr_number      = 'PR-2404150001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a1'
  where id = 'd2000000-0000-0000-0000-000000000004';

-- d2…05 Paid (d0…02 at-risk, large): requested_by=a2, approved_by=a1 (exec).
-- SoD-b: payer a3 (finance) ≠ approver a1 (exec) → demonstrates SoD on the at-risk project.
-- Finance-debt demo: vendor_invoiced_at timestamp so N16 "Ready-to-pay age" column shows real data.
update procurements set
  pr_number          = 'PR-2403100001',
  po_number          = 'PO-2403200001',
  approved_by_id     = '00000000-0000-0000-0000-0000000000a1',
  vendor_invoiced_at = now() - interval '14 days'
  where id = 'd2000000-0000-0000-0000-000000000005';

-- d2…06 Ordered (d0…02): approved_by=a3 (finance), requester=a2 — SoD.
update procurements set
  pr_number      = 'PR-2404020001',
  po_number      = 'PO-2404050001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a3'
  where id = 'd2000000-0000-0000-0000-000000000006';

-- d2…07 Received (d0…02): approved_by=a1, requester=a2 — SoD.
update procurements set
  pr_number      = 'PR-2404200001',
  po_number      = 'PO-2404250001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a1'
  where id = 'd2000000-0000-0000-0000-000000000007';

-- d2…08 Requested (d0…02, requested by a4 engineer): pr_number only (not yet approved).
update procurements set
  pr_number = 'PR-2405100001'
  where id = 'd2000000-0000-0000-0000-000000000008';

-- d2…09 Paid (d0…03 panels): approved_by=a3 (finance), requester=a2 — SoD.
update procurements set
  pr_number      = 'PR-2312010001',
  po_number      = 'PO-2312100001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a3'
  where id = 'd2000000-0000-0000-0000-000000000009';

-- d2…10 Paid (d0…03 carport steel): approved_by=a1 (exec), requester=a2 — SoD.
update procurements set
  pr_number      = 'PR-2401100001',
  po_number      = 'PO-2401150001',
  approved_by_id = '00000000-0000-0000-0000-0000000000a1'
  where id = 'd2000000-0000-0000-0000-000000000010';

-- ============================================================
-- §G tasks — ENG → PROC → CONST for the two flagship projects.
-- assignee_id = a4 (engineer) on ENG/CONST; a2 (pm) on PROC.
-- task_dependencies: every PROC depends on an ENG; every CONST depends on a PROC.
-- ============================================================

insert into tasks (id, project_id, name, start_date, end_date, assignee_id, status) values
  -- d0…01 (Meridian, healthy)
  ('d3000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'ENG — Detail Design Package',
   '2024-02-01', '2024-03-15', '00000000-0000-0000-0000-0000000000a4', 'Done'),
  ('d3000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'ENG — Single Line Diagram',
   '2024-02-01', '2024-02-28', '00000000-0000-0000-0000-0000000000a4', 'Done'),
  ('d3000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
   'PROC — Panel & Inverter Procurement',
   '2024-03-16', '2024-05-31', '00000000-0000-0000-0000-0000000000a2', 'In Progress'),
  ('d3000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001',
   'PROC — Mounting Structure Procurement',
   '2024-03-16', '2024-06-30', '00000000-0000-0000-0000-0000000000a2', 'In Progress'),
  ('d3000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000001',
   'CONST — Roof Mounting Install',
   '2024-06-01', '2024-09-30', '00000000-0000-0000-0000-0000000000a4', 'To Do'),
  ('d3000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000001',
   'CONST — Electrical Termination & Commissioning',
   '2024-09-01', '2024-11-30', '00000000-0000-0000-0000-0000000000a4', 'To Do'),

  -- d0…02 (Cascade Foods, at-risk)
  ('d3000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000002',
   'ENG — Detail Design Package',
   '2024-03-01', '2024-04-15', '00000000-0000-0000-0000-0000000000a4', 'Done'),
  ('d3000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000002',
   'ENG — Single Line Diagram',
   '2024-03-01', '2024-03-31', '00000000-0000-0000-0000-0000000000a4', 'Done'),
  ('d3000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000002',
   'PROC — Panel & Inverter Procurement',
   '2024-04-16', '2024-06-30', '00000000-0000-0000-0000-0000000000a2', 'In Progress'),
  ('d3000000-0000-0000-0000-000000000010', 'd0000000-0000-0000-0000-000000000002',
   'PROC — Mounting Structure Procurement',
   '2024-04-16', '2024-07-31', '00000000-0000-0000-0000-0000000000a2', 'In Progress'),
  ('d3000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000002',
   'CONST — Ground Mounting Install',
   '2024-07-01', '2024-11-30', '00000000-0000-0000-0000-0000000000a4', 'In Progress'),
  ('d3000000-0000-0000-0000-000000000012', 'd0000000-0000-0000-0000-000000000002',
   'CONST — Electrical Termination & Commissioning',
   '2024-11-01', '2025-02-28', '00000000-0000-0000-0000-0000000000a4', 'To Do')
on conflict (id) do nothing;

-- E→P→C dependency chain (d0…01):
-- PROC tasks depend on ENG — Detail Design (d3…01 is the authoritative ENG anchor)
-- CONST tasks depend on PROC — Panel & Inverter (d3…03 is the authoritative PROC anchor)
insert into task_dependencies (task_id, depends_on_id) values
  -- d0…01 chain
  ('d3000000-0000-0000-0000-000000000003', 'd3000000-0000-0000-0000-000000000001'), -- PROC-panel→ENG-design
  ('d3000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000001'), -- PROC-mount→ENG-design
  ('d3000000-0000-0000-0000-000000000005', 'd3000000-0000-0000-0000-000000000003'), -- CONST-mount→PROC-panel
  ('d3000000-0000-0000-0000-000000000006', 'd3000000-0000-0000-0000-000000000004'), -- CONST-elec→PROC-mount
  -- d0…02 chain
  ('d3000000-0000-0000-0000-000000000009', 'd3000000-0000-0000-0000-000000000007'), -- PROC-panel→ENG-design
  ('d3000000-0000-0000-0000-000000000010', 'd3000000-0000-0000-0000-000000000007'), -- PROC-mount→ENG-design
  ('d3000000-0000-0000-0000-000000000011', 'd3000000-0000-0000-0000-000000000009'), -- CONST-mount→PROC-panel
  ('d3000000-0000-0000-0000-000000000012', 'd3000000-0000-0000-0000-000000000010')  -- CONST-elec→PROC-mount
on conflict (task_id, depends_on_id) do nothing;

-- ============================================================
-- §H timesheets (current-week Draft + one prior-week Submitted).
-- week_start_date MUST be Monday (week_is_monday CHECK constraint, extract(dow)=1).
-- Use date_trunc('week', current_date)::date — always the ISO Monday of the current UTC week.
-- Entries: entry_date = Monday + N days (within the week).
-- ============================================================

-- Timesheets: the unique constraint is (user_id, week_start_date). On local after db reset,
-- seed.sql already creates current-week sheets for a4 (engineer) and a2 (pm). To avoid
-- FK violations on timesheet_entries (which reference the d4… ids that would be no-ops),
-- use actors/weeks that seed.sql does NOT create:
--   d4…01 — a3 (finance) current week: seed.sql has NO finance timesheet → always inserts.
--   d4…02 — a4 (engineer) prior week: seed.sql has NO prior-week sheet for a4 → always inserts.
--   d4…03 — a2 (pm) prior week: seed.sql has NO prior-week sheet for a2 → always inserts.
-- On cloud (post seed-admin.sql only): none of these exist → all insert fresh.
-- Idempotency: on conflict (user_id, week_start_date) do nothing (second run = no-ops).
insert into timesheets (id, user_id, week_start_date, status) values
  -- Current-week Draft sheet for finance (a3) — no seed.sql conflict
  ('d4000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a3',
   date_trunc('week', current_date)::date, 'Draft'),
  -- Prior-week Submitted sheet for engineer (a4) — no seed.sql conflict
  ('d4000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a4',
   (date_trunc('week', current_date) - interval '7 days')::date, 'Submitted'),
  -- Prior-week Draft sheet for pm (a2) — no seed.sql conflict
  ('d4000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-0000000000a2',
   (date_trunc('week', current_date) - interval '7 days')::date, 'Draft')
on conflict (user_id, week_start_date) do nothing;

insert into timesheet_entries (id, timesheet_id, project_id, entry_date, hours, notes) values
  -- d4…01 (finance a3, current week): financial oversight notes on flagship projects
  ('d4000000-0000-0000-0000-000000001001',
   'd4000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   date_trunc('week', current_date)::date, 4, 'Budget variance review — Meridian Steelworks'),
  ('d4000000-0000-0000-0000-000000001002',
   'd4000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
   date_trunc('week', current_date)::date + 1, 6, 'Invoice processing & at-risk cost tracking — Cascade Foods'),
  -- d4…02 (engineer a4, prior week Submitted): solar site notes
  ('d4000000-0000-0000-0000-000000001003',
   'd4000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   (date_trunc('week', current_date) - interval '7 days')::date, 8,
   'Site survey at Meridian Steelworks rooftop'),
  ('d4000000-0000-0000-0000-000000001004',
   'd4000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
   (date_trunc('week', current_date) - interval '7 days')::date + 1, 8,
   'Inverter commissioning review at Cascade Foods'),
  ('d4000000-0000-0000-0000-000000001005',
   'd4000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002',
   (date_trunc('week', current_date) - interval '7 days')::date + 2, 6,
   'Ground-mount structural inspection at Cascade'),
  -- d4…03 (pm a2, prior week Draft): project management notes
  ('d4000000-0000-0000-0000-000000001006',
   'd4000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
   (date_trunc('week', current_date) - interval '7 days')::date, 5,
   'Client progress meeting — Meridian Steelworks'),
  ('d4000000-0000-0000-0000-000000001007',
   'd4000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002',
   (date_trunc('week', current_date) - interval '7 days')::date + 1, 6,
   'Procurement review — Cascade Foods at-risk tracking')
on conflict (id) do nothing;

-- ============================================================
-- §I incidents + project_documents (engineering docs).
-- Explicit ids (d5…/d6…) for idempotency via on conflict (id) do nothing.
-- ============================================================

insert into incident_reports
  (id, incident_date, type, severity, location, description, status, reported_by)
values
  ('d5000000-0000-0000-0000-000000000001',
   current_date - interval '10 days',
   'Near Miss', 'Medium',
   'Cascade Foods Ground-Mount Site — Array Block C',
   'Contractor working at height without harness clip-in during racking install. Corrected immediately; crew retrained on fall-protection protocol.',
   'Open',
   '00000000-0000-0000-0000-0000000000a4'),
  ('d5000000-0000-0000-0000-000000000002',
   current_date - interval '30 days',
   'Unsafe Condition', 'Low',
   'Meridian Steelworks Rooftop — East Wing',
   'Unmarked tripping hazard from cable tray installation. Hazard marked and cleared; daily housekeeping checklist updated.',
   'Closed',
   '00000000-0000-0000-0000-0000000000a4')
on conflict (id) do nothing;

insert into project_documents
  (id, project_id, code, category, title, revision, status, doc_date, author_id)
values
  -- d0…01 (Meridian Steelworks) — engineering docs
  ('d6000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'SP2401-ENG-001', 'Engineering', 'Single Line Diagram — 4.2 MW Rooftop PV',
   'C', 'Approved', '2024-02-28', '00000000-0000-0000-0000-0000000000a4'),
  ('d6000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'SP2401-ENG-002', 'Engineering', 'Detail Design Package — Meridian Steelworks',
   'B', 'Issued',   '2024-03-15', '00000000-0000-0000-0000-0000000000a4'),
  -- d0…02 (Cascade Foods) — engineering docs
  ('d6000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000002',
   'SP2402-ENG-001', 'Engineering', 'Single Line Diagram — 6.0 MW Ground-Mount PV',
   'B', 'Approved', '2024-03-31', '00000000-0000-0000-0000-0000000000a4'),
  ('d6000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002',
   'SP2402-ENG-002', 'Engineering', 'Structural Analysis Report — Ground-Mount Piling',
   'A', 'Issued',   '2024-04-10', '00000000-0000-0000-0000-0000000000a4'),
  ('d6000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002',
   'SP2402-ENG-003', 'Engineering', 'Capacity Study — Grid Connection Assessment',
   'A', 'Issued',   '2024-04-05', '00000000-0000-0000-0000-0000000000a4')
on conflict (id) do nothing;

-- ============================================================
-- §J project win/loss backfill UPDATEs.
-- Won/Ongoing/Close-Out: customer_contract_ref + contract_date + decided_at.
-- Loss Tender: decided_at only (customer fields stay null per FR-PR-006).
-- ============================================================

update projects set
  customer_contract_ref = 'MSW-PO-2401',
  contract_date         = '2024-01-15',
  decided_at            = '2024-01-15T00:00:00Z'
  where id = 'd0000000-0000-0000-0000-000000000001';  -- SP-2401 Meridian Steelworks (Ongoing)

update projects set
  customer_contract_ref = 'CFP-PO-2402',
  contract_date         = '2024-02-10',
  decided_at            = '2024-02-10T00:00:00Z'
  where id = 'd0000000-0000-0000-0000-000000000002';  -- SP-2402 Cascade Foods (Ongoing)

update projects set
  customer_contract_ref = 'ACP-PO-2403',
  contract_date         = '2023-11-05',
  decided_at            = '2023-11-05T00:00:00Z'
  where id = 'd0000000-0000-0000-0000-000000000003';  -- SP-2403 Atlas Chemicals (Close Out)

update projects set
  decided_at = '2024-03-20T00:00:00Z'
  where id = 'd0000000-0000-0000-0000-000000000008';  -- SP-2408 Westfield Cannery (Loss Tender)

commit;
