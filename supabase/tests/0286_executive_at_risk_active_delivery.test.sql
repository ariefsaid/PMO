-- 0286_executive_at_risk_active_delivery.test.sql — AC-986-001
-- Executive at-risk membership matches the active delivery set used by the Projects filter.
begin;
select plan(3);

insert into organizations (id, name) values
  ('02860000-0000-0000-0000-000000000001', 'Risk parity org');

insert into auth.users (id, email) values
  ('02860000-0000-0000-0000-0000000000a1', 'risk-parity@invalid.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('02860000-0000-0000-0000-0000000000a1', '02860000-0000-0000-0000-000000000001',
   'Risk Parity Executive', 'risk-parity@invalid.example', 'Executive');

insert into companies (id, org_id, name, type) values
  ('02860000-0000-0000-0000-000000000010', '02860000-0000-0000-0000-000000000001', 'Risk Client', 'Client');

-- Four active-delivery statuses are at risk; Close Out has identical financials but is excluded.
insert into projects (id, org_id, code, name, status, client_id, project_manager_id, budget, spent, contract_value, tax_treatment, tax_amount) values
  ('02860000-0000-0000-0000-000000000020', '02860000-0000-0000-0000-000000000001', 'RISK-ONGOING', 'Ongoing delivery', 'Ongoing Project',
   '02860000-0000-0000-0000-000000000010', '02860000-0000-0000-0000-0000000000a1', 100, 95, 150, 'exclusive', 0),
  ('02860000-0000-0000-0000-000000000021', '02860000-0000-0000-0000-000000000001', 'RISK-WON', 'Won delivery', 'Won, Pending KoM',
   '02860000-0000-0000-0000-000000000010', '02860000-0000-0000-0000-0000000000a1', 100, 95, 150, 'exclusive', 0),
  ('02860000-0000-0000-0000-000000000022', '02860000-0000-0000-0000-000000000001', 'RISK-HOLD', 'Paused delivery', 'On Hold',
   '02860000-0000-0000-0000-000000000010', '02860000-0000-0000-0000-0000000000a1', 100, 95, 150, 'exclusive', 0),
  ('02860000-0000-0000-0000-000000000023', '02860000-0000-0000-0000-000000000001', 'RISK-INTERNAL', 'Internal delivery', 'Internal Project',
   '02860000-0000-0000-0000-000000000010', '02860000-0000-0000-0000-0000000000a1', 100, 95, 150, 'exclusive', 0),
  ('02860000-0000-0000-0000-000000000024', '02860000-0000-0000-0000-000000000001', 'RISK-CLOSE', 'Closed delivery', 'Close Out',
   '02860000-0000-0000-0000-000000000010', '02860000-0000-0000-0000-0000000000a1', 100, 95, 150, 'exclusive', 0);

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('02860000-0000-0000-0000-000000000b01', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000020', 1, 'v1', 'Draft'),
  ('02860000-0000-0000-0000-000000000b02', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000021', 1, 'v1', 'Draft'),
  ('02860000-0000-0000-0000-000000000b03', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000022', 1, 'v1', 'Draft'),
  ('02860000-0000-0000-0000-000000000b04', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000023', 1, 'v1', 'Draft'),
  ('02860000-0000-0000-0000-000000000b05', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000024', 1, 'v1', 'Draft');

insert into budget_line_items (id, org_id, budget_version_id, category, budgeted_amount) values
  ('02860000-0000-0000-0000-000000000c01', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000b01', 'Labor', 100),
  ('02860000-0000-0000-0000-000000000c02', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000b02', 'Labor', 100),
  ('02860000-0000-0000-0000-000000000c03', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000b03', 'Labor', 100),
  ('02860000-0000-0000-0000-000000000c04', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000b04', 'Labor', 100),
  ('02860000-0000-0000-0000-000000000c05', '02860000-0000-0000-0000-000000000001', '02860000-0000-0000-0000-000000000b05', 'Labor', 100);

update budget_versions set status = 'Active'
 where id between '02860000-0000-0000-0000-000000000b01' and '02860000-0000-0000-0000-000000000b05';

insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('02860000-0000-0000-0000-000000000110', '02860000-0000-0000-0000-000000000001', 'Ongoing commitment', 'Ordered', 95,
   '02860000-0000-0000-0000-000000000020', '02860000-0000-0000-0000-0000000000a1'),
  ('02860000-0000-0000-0000-000000000111', '02860000-0000-0000-0000-000000000001', 'Won commitment', 'Ordered', 95,
   '02860000-0000-0000-0000-000000000021', '02860000-0000-0000-0000-0000000000a1'),
  ('02860000-0000-0000-0000-000000000112', '02860000-0000-0000-0000-000000000001', 'On-hold commitment', 'Ordered', 95,
   '02860000-0000-0000-0000-000000000022', '02860000-0000-0000-0000-0000000000a1'),
  ('02860000-0000-0000-0000-000000000113', '02860000-0000-0000-0000-000000000001', 'Internal commitment', 'Ordered', 95,
   '02860000-0000-0000-0000-000000000023', '02860000-0000-0000-0000-0000000000a1'),
  ('02860000-0000-0000-0000-000000000114', '02860000-0000-0000-0000-000000000001', 'Closed commitment', 'Ordered', 95,
   '02860000-0000-0000-0000-000000000024', '02860000-0000-0000-0000-0000000000a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"02860000-0000-0000-0000-0000000000a1","role":"authenticated"}';
set local request.jwt.claim.sub = '02860000-0000-0000-0000-0000000000a1';

select is(
  (get_executive_dashboard() ->> 'projects_at_risk')::int,
  4,
  'AC-986-001: Executive RPC counts all four over-threshold active-delivery statuses and excludes Close Out');

select is(
  (get_executive_dashboard() ->> 'projects_at_risk')::int,
  (select count(*)::int
     from projects p
    where p.id between '02860000-0000-0000-0000-000000000020'::uuid and '02860000-0000-0000-0000-000000000024'::uuid
      and p.status::text = any(active_delivery_project_statuses())
      and coalesce((select sum(li.budgeted_amount)
                      from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                     where v.project_id = p.id and v.status = 'Active'), 0) > 0
      and coalesce((select sum(pr.total_value)
                      from procurements pr
                     where pr.project_id = p.id
                       and pr.status::text = any(committed_procurement_statuses())), 0)
          / coalesce((select sum(li.budgeted_amount)
                        from budget_versions v join budget_line_items li on li.budget_version_id = v.id
                       where v.project_id = p.id and v.status = 'Active'), 0) >= 0.9),
  'AC-986-001: RPC count equals the committed-budget at-risk rows selected by the shared SQL status set');

select is(
  (select array(select unnest(active_delivery_project_statuses()) order by 1)),
  array['Internal Project','On Hold','Ongoing Project','Won, Pending KoM']::text[],
  'AC-986-001: Close Out is absent from the active delivery set');

reset role;
select * from finish();
rollback;
