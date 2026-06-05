-- 0030_project_loss_path.test.sql
-- AC-1008: loss path — decided_at stamped at loss-transition time, no customer fields.
-- Authorized PM transitions a Tender Submitted project to Loss Tender.
-- Asserts decided_at is not null and customer_contract_ref/contract_date remain null.
-- (FR-PR-006, NFR-PR-ATOM-001)
begin;
select plan(3);

-- Fixtures: one org, one authorized PM, one Tender Submitted project.
insert into organizations (id, name) values
  ('00300000-0000-0000-0000-000000000001','PR Loss Path Org');

insert into auth.users (id, email) values
  ('00300000-0000-0000-0000-0000000000a2','pr-loss-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00300000-0000-0000-0000-0000000000a2','00300000-0000-0000-0000-000000000001','PR Loss PM','pr-loss-pm@example.com','Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00300000-0000-0000-0000-000000000010','00300000-0000-0000-0000-000000000001',
   'PLS-001','PR Loss Project','Tender Submitted','00300000-0000-0000-0000-0000000000a2');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00300000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── Lose the project ──────────────────────────────────────────────────────────
select lives_ok(
  $$ select transition_project('00300000-0000-0000-0000-000000000010','Loss Tender') $$,
  'AC-1008: loss transition succeeds');

select is(
  (select decided_at is not null from projects where id = '00300000-0000-0000-0000-000000000010'),
  true,
  'AC-1008: decided_at stamped at loss-transition time');

select is(
  (select customer_contract_ref is null and contract_date is null from projects where id = '00300000-0000-0000-0000-000000000010'),
  true,
  'AC-1008: no customer fields on loss');

reset role;
select * from finish();
rollback;
