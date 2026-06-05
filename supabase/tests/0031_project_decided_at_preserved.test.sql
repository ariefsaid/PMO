-- 0031_project_decided_at_preserved.test.sql
-- AC-1009: decided_at and customer fields untouched on non-decision moves (OD-PR-C).
-- (i)  Won project moved to Ongoing Project → decided_at unchanged (value preserved).
-- (ii) Leads project moved to PQ Submitted → decided_at stays null.
-- (FR-PR-007)
begin;
select plan(2);

-- Fixtures: one org, one authorized PM.
insert into organizations (id, name) values
  ('00310000-0000-0000-0000-000000000001','PR Preserved Org');

insert into auth.users (id, email) values
  ('00310000-0000-0000-0000-0000000000a2','pr-pres-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00310000-0000-0000-0000-0000000000a2','00310000-0000-0000-0000-000000000001','PR Pres PM','pr-pres-pm@example.com','Project Manager');

-- (i) Won project with known decided_at + customer fields set.
insert into projects (id, org_id, code, name, status, project_manager_id,
                      customer_contract_ref, contract_date, decided_at) values
  ('00310000-0000-0000-0000-000000000010','00310000-0000-0000-0000-000000000001',
   'PP-001','PR Won Project','Won, Pending KoM','00310000-0000-0000-0000-0000000000a2',
   'CPO-PRESERVED','2026-03-15','2026-03-15T00:00:00Z');

-- (ii) Leads project with null decided_at.
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00310000-0000-0000-0000-000000000011','00310000-0000-0000-0000-000000000001',
   'PP-002','PR Leads Project','Leads','00310000-0000-0000-0000-0000000000a2');

-- Perform the two transitions as the authorized PM.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00310000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- Transition (i): Won, Pending KoM → Ongoing Project (status-only, decided_at must be preserved).
do $$ begin perform transition_project('00310000-0000-0000-0000-000000000010','Ongoing Project'); end $$;

-- Transition (ii): Leads → PQ Submitted (decided_at was null, must stay null).
do $$ begin perform transition_project('00310000-0000-0000-0000-000000000011','PQ Submitted'); end $$;

reset role;

-- ── Assertions (read as table owner — definer search_path = public, so select is fine) ──

select is(
  (select decided_at from projects where id = '00310000-0000-0000-0000-000000000010'),
  '2026-03-15'::timestamptz,
  'AC-1009: decided_at unchanged on on-hand move (OD-PR-C)');

select is(
  (select decided_at is null from projects where id = '00310000-0000-0000-0000-000000000011'),
  true,
  'AC-1009: decided_at stays null on pipeline move');

select * from finish();
rollback;
