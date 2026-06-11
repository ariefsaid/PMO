-- 0039_dashboard_margin_tenancy.test.sql — margin tenancy isolation (org B cannot bleed into default-org KPIs)
-- AC-1105 / NFR-SPD-TENANCY-001
begin;
select plan(2);

-- Insert org B with a large on-hand project that should NOT affect default-org results
insert into organizations (id, name) values
  ('00390000-0000-0000-0000-000000000001', 'Tenancy Test Org B');

insert into auth.users (id, email) values
  ('00390000-0000-0000-0000-0000000000b1', 'orgb-exec@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00390000-0000-0000-0000-0000000000b1', '00390000-0000-0000-0000-000000000001',
   'Org B Exec', 'orgb-exec@example.com', 'Executive');

-- Org B has one enormous Ongoing Project — if tenancy leaks, default-org KPIs would blow up
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  ('39000000-0000-0000-0000-000000000001', '00390000-0000-0000-0000-000000000001',
   'B001', 'Org B Mega Project', 'Ongoing Project',
   '00390000-0000-0000-0000-0000000000b1',
   99000000, 50000000, 0);

-- Authenticate as the DEFAULT-ORG Executive (not org B)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1105: default-org on_hand_value must still be 10,000,000 (P001+P003+P013; excludes org B's 99M project)
-- P013 "Seabridge Terminal Delivery" (Ongoing Project, contract_value=2M) added for AC-DEL-022 e2e isolation.
select is(
  (get_executive_dashboard() ->> 'on_hand_value')::numeric,
  10000000::numeric,
  'AC-1105: on_hand_value excludes org B (NFR-SPD-TENANCY-001)'
);

-- AC-1105: default-org margin must still reflect only its own projects (> 0.9)
select ok(
  (get_executive_dashboard() ->> 'on_hand_margin')::numeric > 0.9,
  'AC-1105: margin reflects default org only, not org B (NFR-SPD-TENANCY-001)'
);

reset role;
select * from finish();
rollback;
