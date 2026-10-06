-- spend_approval_notify.test.sql — #803 × #788: the "awaits approval" notification follows the route.
-- Recipients come from spend_approval_route (the same rule transition_procurement enforces) when routing
-- is configured, and from 0237's flat approver-role list when it is not.
-- Orgs: A (configured: PM A approves for P, senior set = Fin X), C (no config → flat), D (senior set
-- configured, its only member disabled → only an Admin may decide, DD-APR-4).
-- Migration: 0243_spend_approval_routing.sql §9.
begin;
select plan(8);

insert into organizations (id, name, default_currency) values
  ('02346000-0000-0000-0000-00000000000a','APR Notify Org A','IDR'),
  ('02346000-0000-0000-0000-00000000000c','APR Notify Org C','IDR'),
  ('02346000-0000-0000-0000-00000000000d','APR Notify Org D','IDR');
insert into auth.users (id, email) values
  ('02346000-0000-0000-0000-0000000000a0','apr-ntf-admin@example.com'),
  ('02346000-0000-0000-0000-0000000000a1','apr-ntf-pm-a@example.com'),
  ('02346000-0000-0000-0000-0000000000a2','apr-ntf-pm-b@example.com'),
  ('02346000-0000-0000-0000-0000000000a3','apr-ntf-fin-x@example.com'),
  ('02346000-0000-0000-0000-0000000000a4','apr-ntf-exec-y@example.com'),
  ('02346000-0000-0000-0000-0000000000a6','apr-ntf-eng-r@example.com'),
  ('02346000-0000-0000-0000-0000000000c0','apr-ntf-admin-c@example.com'),
  ('02346000-0000-0000-0000-0000000000c1','apr-ntf-pm-c@example.com'),
  ('02346000-0000-0000-0000-0000000000c2','apr-ntf-eng-c@example.com'),
  ('02346000-0000-0000-0000-0000000000d0','apr-ntf-admin-d@example.com'),
  ('02346000-0000-0000-0000-0000000000d1','apr-ntf-pm-d@example.com'),
  ('02346000-0000-0000-0000-0000000000d2','apr-ntf-fin-d@example.com'),
  ('02346000-0000-0000-0000-0000000000d3','apr-ntf-eng-d@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02346000-0000-0000-0000-0000000000a0','02346000-0000-0000-0000-00000000000a','Ntf Admin','apr-ntf-admin@example.com','Admin','active'),
  ('02346000-0000-0000-0000-0000000000a1','02346000-0000-0000-0000-00000000000a','Ntf PM A','apr-ntf-pm-a@example.com','Project Manager','active'),
  ('02346000-0000-0000-0000-0000000000a2','02346000-0000-0000-0000-00000000000a','Ntf PM B','apr-ntf-pm-b@example.com','Project Manager','active'),
  ('02346000-0000-0000-0000-0000000000a3','02346000-0000-0000-0000-00000000000a','Ntf Fin X','apr-ntf-fin-x@example.com','Finance','active'),
  ('02346000-0000-0000-0000-0000000000a4','02346000-0000-0000-0000-00000000000a','Ntf Exec Y','apr-ntf-exec-y@example.com','Executive','active'),
  ('02346000-0000-0000-0000-0000000000a6','02346000-0000-0000-0000-00000000000a','Ntf Eng R','apr-ntf-eng-r@example.com','Engineer','active'),
  ('02346000-0000-0000-0000-0000000000c0','02346000-0000-0000-0000-00000000000c','Ntf Admin C','apr-ntf-admin-c@example.com','Admin','active'),
  ('02346000-0000-0000-0000-0000000000c1','02346000-0000-0000-0000-00000000000c','Ntf PM C','apr-ntf-pm-c@example.com','Project Manager','active'),
  ('02346000-0000-0000-0000-0000000000c2','02346000-0000-0000-0000-00000000000c','Ntf Eng C','apr-ntf-eng-c@example.com','Engineer','active'),
  ('02346000-0000-0000-0000-0000000000d0','02346000-0000-0000-0000-00000000000d','Ntf Admin D','apr-ntf-admin-d@example.com','Admin','active'),
  ('02346000-0000-0000-0000-0000000000d1','02346000-0000-0000-0000-00000000000d','Ntf PM D','apr-ntf-pm-d@example.com','Project Manager','active'),
  ('02346000-0000-0000-0000-0000000000d2','02346000-0000-0000-0000-00000000000d','Ntf Fin D','apr-ntf-fin-d@example.com','Finance','disabled'),
  ('02346000-0000-0000-0000-0000000000d3','02346000-0000-0000-0000-00000000000d','Ntf Eng D','apr-ntf-eng-d@example.com','Engineer','active');

insert into projects (id, org_id, name, status) values
  ('02346000-0000-0000-0000-000000000101','02346000-0000-0000-0000-00000000000a','Ntf Project P','Ongoing Project'),
  ('02346000-0000-0000-0000-000000000103','02346000-0000-0000-0000-00000000000c','Ntf Project C','Ongoing Project');
-- budget_line_items_draft_guard: lines only land on a Draft version, so seed Draft → lines → Active.
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('02346000-0000-0000-0000-000000000201','02346000-0000-0000-0000-00000000000a','02346000-0000-0000-0000-000000000101','v1',1,'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('02346000-0000-0000-0000-00000000000a','02346000-0000-0000-0000-000000000201','Materials',1000);
update budget_versions set status = 'Active' where id = '02346000-0000-0000-0000-000000000201';

insert into spend_approvers (org_id, project_id, profile_id) values
  ('02346000-0000-0000-0000-00000000000a','02346000-0000-0000-0000-000000000101','02346000-0000-0000-0000-0000000000a1'),
  ('02346000-0000-0000-0000-00000000000a',null,'02346000-0000-0000-0000-0000000000a3'),
  ('02346000-0000-0000-0000-00000000000d',null,'02346000-0000-0000-0000-0000000000d2');

-- N1 within the Materials line on P · N2 overhead (no project) · NC1 in the unconfigured org.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02346000-0000-0000-0000-000000000401','02346000-0000-0000-0000-00000000000a','N1 fits',    '02346000-0000-0000-0000-000000000101','02346000-0000-0000-0000-0000000000a6','Draft',400,'Materials'),
  ('02346000-0000-0000-0000-000000000402','02346000-0000-0000-0000-00000000000a','N2 overhead',null,                                  '02346000-0000-0000-0000-0000000000a6','Draft', 50,null),
  ('02346000-0000-0000-0000-000000000403','02346000-0000-0000-0000-00000000000c','NC1 flat',   '02346000-0000-0000-0000-000000000103','02346000-0000-0000-0000-0000000000c2','Draft', 10,'Materials'),
  ('02346000-0000-0000-0000-000000000404','02346000-0000-0000-0000-00000000000d','ND1 overhead',null,                                  '02346000-0000-0000-0000-0000000000d3','Draft',  5,null);

-- Owners told a procurement awaits them, as a sorted array of the last two id chars.
create function pg_temp.who(p_entity uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(right(owner_id::text, 2) order by owner_id::text), array[]::text[])
    from notifications where metadata->'entity'->>'id' = p_entity::text and title like '%awaiting%' $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02346000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select transition_procurement('02346000-0000-0000-0000-000000000401','Requested');
select transition_procurement('02346000-0000-0000-0000-000000000402','Requested');
set local request.jwt.claims = '{"sub":"02346000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select transition_procurement('02346000-0000-0000-0000-000000000403','Requested');
set local request.jwt.claims = '{"sub":"02346000-0000-0000-0000-0000000000d3","role":"authenticated"}';
select transition_procurement('02346000-0000-0000-0000-000000000404','Requested');
reset role;

-- Routed, within budget → the named project approver only.
select is(pg_temp.who('02346000-0000-0000-0000-000000000401'), array['a1'],
  'FR-APR-040: a within-budget request notifies only the named project approver');
select is((select count(*)::int from notifications where owner_id = '02346000-0000-0000-0000-0000000000a2'
            and metadata->'entity'->>'id' = '02346000-0000-0000-0000-000000000401'), 0,
  'FR-APR-040: an approver-rank PM who is not named gets no "awaits approval" notification');
select is((select count(*)::int from notifications where owner_id = '02346000-0000-0000-0000-0000000000a1'
            and metadata->'entity'->>'id' = '02346000-0000-0000-0000-000000000401'
            and title = 'Procurement awaiting your approval'), 1,
  'FR-APR-040: the named approver gets exactly one "awaits approval" notification');

-- Routed to the senior set → its members only.
select is(pg_temp.who('02346000-0000-0000-0000-000000000402'), array['a3'],
  'FR-APR-040: an overhead request notifies only the senior set');

-- Unconfigured org → 0237's flat list (approver roles, never the requester).
select is(pg_temp.who('02346000-0000-0000-0000-000000000403'), array['c0','c1'],
  'FR-APR-040: with no routing configured the flat approver-role list is notified');

-- A configured senior set nobody can act on → the Admins, who alone may decide it (DD-APR-4).
select is(pg_temp.who('02346000-0000-0000-0000-000000000404'), array['d0'],
  'FR-APR-040: when only an Admin may decide, only the Admins are told it awaits them');

-- The route the notification used is the route the decision enforces: the named approver may decide,
-- the un-notified PM may not.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02346000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('02346000-0000-0000-0000-000000000401','Approved') $$,
  '42501', 'approval routing: within_budget requires a named approver',
  'FR-APR-040: the PM who was not notified also cannot approve');
set local request.jwt.claims = '{"sub":"02346000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_procurement('02346000-0000-0000-0000-000000000401','Approved') $$,
  'FR-APR-040: the notified approver can approve');
reset role;

select * from finish();
rollback;
