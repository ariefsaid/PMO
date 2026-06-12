-- 0066_projects_delivery_summary.test.sql — extended delivery summary RPC proof (AC-DEL-017).
-- Verifies weighted delivery %, committed procurement spend basis, budget passthrough, and org scoping.
begin;
select plan(4);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into organizations (id, name) values
  ('00660000-0000-0000-0000-000000000002','Summary Org B');

insert into auth.users (id, email) values
  ('00660000-0000-0000-0000-0000000000a1','summary-pm-a@example.com'),
  ('00660000-0000-0000-0000-0000000000b1','summary-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00660000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'Summary PM A','summary-pm-a@example.com','Project Manager'),
  ('00660000-0000-0000-0000-0000000000b1','00660000-0000-0000-0000-000000000002',
   'Summary PM B','summary-pm-b@example.com','Project Manager');

insert into companies (id, org_id, name, type) values
  ('00660000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Summary Client A','Client'),
  ('00660000-0000-0000-0000-000000000011','00660000-0000-0000-0000-000000000002','Summary Client B','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, budget, contract_value) values
  ('00660000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'SUM-001','Summary Project A','Ongoing Project',
   '00660000-0000-0000-0000-000000000010','00660000-0000-0000-0000-0000000000a1',900000,1200000),
  ('00660000-0000-0000-0000-000000000021','00660000-0000-0000-0000-000000000002',
   'SUM-002','Summary Project B','Ongoing Project',
   '00660000-0000-0000-0000-000000000011','00660000-0000-0000-0000-0000000000b1',700000,900000);

insert into project_milestones (id, org_id, project_id, name, weight, sort_order, input_pct) values
  ('00660000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','Engineering',50,0,100),
  ('00660000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','Procurement',50,1,null),
  ('00660000-0000-0000-0000-000000000041','00660000-0000-0000-0000-000000000002',
   '00660000-0000-0000-0000-000000000021','Other Org Phase',100,0,80);

insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('00660000-0000-0001-0001-000000000001','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','00660000-0000-0000-0000-000000000032','P-T1','Done'),
  ('00660000-0000-0001-0001-000000000002','00000000-0000-0000-0000-000000000001',
   '00660000-0000-0000-0000-000000000020','00660000-0000-0000-0000-000000000032','P-T2','To Do');

insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('00660000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','Ordered PO','Ordered',100000,'00660000-0000-0000-0000-000000000020','00660000-0000-0000-0000-0000000000a1'),
  ('00660000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','Received PO','Received',120000,'00660000-0000-0000-0000-000000000020','00660000-0000-0000-0000-0000000000a1'),
  ('00660000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000001','Invoiced PO','Vendor Invoiced',130000,'00660000-0000-0000-0000-000000000020','00660000-0000-0000-0000-0000000000a1'),
  ('00660000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000001','Paid PO','Paid',150000,'00660000-0000-0000-0000-000000000020','00660000-0000-0000-0000-0000000000a1'),
  ('00660000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001','Draft PO','Draft',999999,'00660000-0000-0000-0000-000000000020','00660000-0000-0000-0000-0000000000a1'),
  ('00660000-0000-0000-0000-000000000106','00660000-0000-0000-0000-000000000002','Other Org Ordered','Ordered',333333,'00660000-0000-0000-0000-000000000021','00660000-0000-0000-0000-0000000000b1');

-- ── Tests (as the org-A PM, so RLS scopes results to org A). ───────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00660000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local request.jwt.claim.sub = '00660000-0000-0000-0000-0000000000a1';

select is(
  (select delivery_pct::numeric(10,0)
     from get_projects_delivery(array['00660000-0000-0000-0000-000000000020'::uuid])),
  75::numeric,
  'AC-DEL-017: get_projects_delivery returns the weighted delivery_pct for the caller org project');

select is(
  (select committed_spend::numeric(10,0)
     from get_projects_delivery(array['00660000-0000-0000-0000-000000000020'::uuid])),
  500000::numeric,
  'AC-DEL-017: get_projects_delivery returns committed_spend from committed procurement statuses only');

select is(
  (select budget::numeric(10,0)
     from get_projects_delivery(array['00660000-0000-0000-0000-000000000020'::uuid])),
  900000::numeric,
  'AC-DEL-017: get_projects_delivery returns the project budget alongside delivery');

select is(
  (select count(*)::int
     from get_projects_delivery(array[
       '00660000-0000-0000-0000-000000000020'::uuid,
       '00660000-0000-0000-0000-000000000021'::uuid
     ])),
  1,
  'AC-DEL-017: get_projects_delivery returns delivery + committed spend scoped to the caller org');

reset role;

select * from finish();
rollback;
