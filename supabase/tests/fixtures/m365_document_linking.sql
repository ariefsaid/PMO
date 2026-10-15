-- Synthetic shared fixtures for the M365 document-linking pgTAP tests.
insert into public.organizations (id, name) values
  ('10200000-0000-0000-0000-000000000001', 'M365 Link Test Org A'),
  ('10200000-0000-0000-0000-000000000002', 'M365 Link Test Org B');

insert into auth.users (id, email) values
  ('10200000-0000-0000-0000-000000000101', 'm365-admin@example.invalid'),
  ('10200000-0000-0000-0000-000000000102', 'm365-pm@example.invalid'),
  ('10200000-0000-0000-0000-000000000103', 'm365-finance@example.invalid'),
  ('10200000-0000-0000-0000-000000000104', 'm365-executive@example.invalid'),
  ('10200000-0000-0000-0000-000000000105', 'm365-engineer@example.invalid'),
  ('10200000-0000-0000-0000-000000000106', 'm365-inactive@example.invalid'),
  ('10200000-0000-0000-0000-000000000107', 'm365-admin-b@example.invalid'),
  ('10200000-0000-0000-0000-000000000108', 'm365-pm-b@example.invalid');

insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('10200000-0000-0000-0000-000000000101', '10200000-0000-0000-0000-000000000001', 'M365 Admin', 'm365-admin@example.invalid', 'Admin', 'active'),
  ('10200000-0000-0000-0000-000000000102', '10200000-0000-0000-0000-000000000001', 'M365 PM', 'm365-pm@example.invalid', 'Project Manager', 'active'),
  ('10200000-0000-0000-0000-000000000103', '10200000-0000-0000-0000-000000000001', 'M365 Finance', 'm365-finance@example.invalid', 'Finance', 'active'),
  ('10200000-0000-0000-0000-000000000104', '10200000-0000-0000-0000-000000000001', 'M365 Executive', 'm365-executive@example.invalid', 'Executive', 'active'),
  ('10200000-0000-0000-0000-000000000105', '10200000-0000-0000-0000-000000000001', 'M365 Engineer', 'm365-engineer@example.invalid', 'Engineer', 'active'),
  ('10200000-0000-0000-0000-000000000106', '10200000-0000-0000-0000-000000000001', 'M365 Inactive', 'm365-inactive@example.invalid', 'Project Manager', 'disabled'),
  ('10200000-0000-0000-0000-000000000107', '10200000-0000-0000-0000-000000000002', 'M365 Admin B', 'm365-admin-b@example.invalid', 'Admin', 'active'),
  ('10200000-0000-0000-0000-000000000108', '10200000-0000-0000-0000-000000000002', 'M365 PM B', 'm365-pm-b@example.invalid', 'Project Manager', 'active');

insert into public.projects (id, org_id, code, name, status, project_manager_id) values
  ('10200000-0000-0000-0000-000000000201', '10200000-0000-0000-0000-000000000001', 'M365-A', 'M365 Fixture Project A', 'Ongoing Project', '10200000-0000-0000-0000-000000000102'),
  ('10200000-0000-0000-0000-000000000202', '10200000-0000-0000-0000-000000000002', 'M365-B', 'M365 Fixture Project B', 'Ongoing Project', '10200000-0000-0000-0000-000000000108');

insert into public.project_documents (id, org_id, project_id, category, title, status, author_id, file_path)
values
  ('10200000-0000-0000-0000-000000000301', '10200000-0000-0000-0000-000000000001', '10200000-0000-0000-0000-000000000201', 'Specification', 'M365 fixture upload', 'Draft', '10200000-0000-0000-0000-000000000102', 'documents/m365-fixture.pdf'),
  ('10200000-0000-0000-0000-000000000302', '10200000-0000-0000-0000-000000000001', '10200000-0000-0000-0000-000000000201', 'Specification', 'M365 fixture metadata', 'Draft', '10200000-0000-0000-0000-000000000102', null);
