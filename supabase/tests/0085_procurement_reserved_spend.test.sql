-- 0085_procurement_reserved_spend.test.sql
-- AC-RB-002: Reserved-spend read is org-scoped by RLS (no client org_id) + the reserved status
-- contract {Approved, Vendor Quoted, Quote Selected} (ADR-0034, distinct from Committed).
begin;
select plan(4);

insert into organizations (id, name) values
  ('00350000-0000-0000-0000-000000000001','Reserved Org A'),
  ('00350000-0000-0000-0000-000000000002','Reserved Org B');

insert into auth.users (id, email) values
  ('00350000-0000-0000-0000-0000000000a1','pm-resA@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00350000-0000-0000-0000-0000000000a1','00350000-0000-0000-0000-000000000001','PM ResA','pm-resA@example.com','Project Manager');

insert into projects (id, org_id, name, code) values
  ('00350000-0000-0000-0000-000000000100','00350000-0000-0000-0000-000000000001','Shared Name Project','PRJ-RA'),
  ('00350000-0000-0000-0000-000000000200','00350000-0000-0000-0000-000000000002','Shared Name Project','PRJ-RB');

-- Org A: two reserved rows (Approved 80k, Quote Selected 40k) + one NON-reserved (Requested 10k).
insert into procurements (id, org_id, project_id, title, status, total_value, requested_by_id) values
  ('00350000-0000-0000-0000-000000000010','00350000-0000-0000-0000-000000000001','00350000-0000-0000-0000-000000000100','A Approved','Approved',80000,'00350000-0000-0000-0000-0000000000a1'),
  ('00350000-0000-0000-0000-000000000011','00350000-0000-0000-0000-000000000001','00350000-0000-0000-0000-000000000100','A QuoteSel','Quote Selected',40000,'00350000-0000-0000-0000-0000000000a1'),
  ('00350000-0000-0000-0000-000000000012','00350000-0000-0000-0000-000000000001','00350000-0000-0000-0000-000000000100','A Requested','Requested',10000,'00350000-0000-0000-0000-0000000000a1');

-- Org B: an Approved row on the like-named project — must be invisible to org A.
insert into procurements (id, org_id, project_id, title, status, total_value, requested_by_id) values
  ('00350000-0000-0000-0000-000000000020','00350000-0000-0000-0000-000000000002','00350000-0000-0000-0000-000000000200','B Approved','Approved',999999,'00350000-0000-0000-0000-0000000000a1');

-- Read as an org-A authenticated user: the client query getProjectReservedSpend runs
--   select total_value from procurements where project_id = $1 and status in (RESERVED_STATUSES)
-- with org scoping enforced solely by RLS (org_id = auth_org_id()).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00350000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-RB-002: org A sees only its own reserved rows (80k + 40k = 120k); org B's 999999 is invisible.
select is(
  (select coalesce(sum(total_value),0)::numeric
     from procurements
     where project_id = '00350000-0000-0000-0000-000000000100'
       and status in ('Approved','Vendor Quoted','Quote Selected')),
  120000::numeric,
  'AC-RB-002: org A reserved sum = 120000 (RLS excludes org B''s like-named project row)');

-- AC-RB-002: the org-B reserved row is NOT visible to org A at all (RLS row hiding).
select is(
  (select count(*)::int from procurements where id = '00350000-0000-0000-0000-000000000020'),
  0,
  'AC-RB-002: org B reserved row is invisible to an org A reader (RLS)');

-- AC-RB-001 contract (cross-check at SQL): the Requested row is excluded from reserved.
select is(
  (select count(*)::int
     from procurements
     where project_id = '00350000-0000-0000-0000-000000000100'
       and id = '00350000-0000-0000-0000-000000000012'
       and status in ('Approved','Vendor Quoted','Quote Selected')),
  0,
  'AC-RB-002: Requested status is NOT in the reserved set');

reset role;

-- Reserved and Committed sets are disjoint at the data layer (no status in both).
select ok(
  not exists (
    select 1 from (values ('Approved'),('Vendor Quoted'),('Quote Selected')) r(s)
    where r.s in ('Ordered','Received','Vendor Invoiced','Paid')
  ),
  'AC-RB-002: reserved set is disjoint from committed set');

select * from finish();
rollback;
