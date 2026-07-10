-- external_reference_items_rls.test.sql
-- AC-EAS-035 [pgTAP]: while 'reference' is externally-owned for org A, a user-JWT write to the
-- read-model is DENIED (42501) and the dispatch/sync service role writes succeed (FR-EAS-037, OD-4).
begin;
select plan(5);

insert into organizations (id, name) values
  ('00880000-0000-0000-0000-000000000001','AC-EAS RefItems A (flipped)'),
  ('00880000-0000-0000-0000-000000000002','AC-EAS RefItems B (PMO-owned)');
insert into auth.users (id, email) values ('00880000-0000-0000-0000-0000000000a1','ri-a@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00880000-0000-0000-0000-0000000000a1','00880000-0000-0000-0000-000000000001','A','ri-a@example.com','Admin','active');

-- Flip 'reference' to externally-owned for org A (the FR-EAS-037 trigger).
reset role;
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00880000-0000-0000-0000-000000000001','reference','reference');

-- AC-EAS-035: org-A member (user JWT) write DENIED on the flipped read-model.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00880000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into external_reference_items (org_id, pmo_record_id, payload) values ('00880000-0000-0000-0000-000000000001','pmo-1','{"id":"pmo-1"}') $$,
  '42501', null,
  'AC-EAS-035 user-JWT INSERT denied while reference externally-owned (RLS flip)');
with u as (update external_reference_items set payload='{}' returning 1)
select is((select count(*)::int from u), 0, 'AC-EAS-035 user-JWT UPDATE denied (flip)');
with d as (delete from external_reference_items returning 1)
select is((select count(*)::int from d), 0, 'AC-EAS-035 user-JWT DELETE denied while externally-owned');
select lives_ok(
  $$ select count(*) from external_reference_items $$,
  'AC-EAS-035 read-model stays readable while externally-owned');

-- AC-EAS-035: dispatch/sync service role writes succeed (RLS bypass).
reset role;
insert into external_reference_items (org_id, pmo_record_id, payload)
values ('00880000-0000-0000-0000-000000000001','pmo-1','{"id":"pmo-1","external_id":"ext-1"}');
select is((select count(*)::int from external_reference_items where pmo_record_id='pmo-1'), 1,
  'AC-EAS-035 service-role write to read-model succeeds');

select finish();
rollback;
