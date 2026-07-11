-- external_refs_rls.test.sql
-- AC-EAS-040 [pgTAP]: external_refs is org-isolated on read (org-B member sees nothing of org-A's ref).
-- AC-EAS-041 [pgTAP]: machine-written only — a user JWT INSERT/UPDATE/DELETE is denied; service role upserts.
begin;
select plan(6);

insert into organizations (id, name) values
  ('00860000-0000-0000-0000-000000000001','AC-EAS Refs A'),
  ('00860000-0000-0000-0000-000000000002','AC-EAS Refs B');
insert into auth.users (id, email) values
  ('00860000-0000-0000-0000-0000000000a1','refs-a@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00860000-0000-0000-0000-0000000000a1','00860000-0000-0000-0000-000000000001','A','refs-a@example.com','Admin','active');

-- Seed an org-A ref AS OWNER (the dispatch/sync service-role path; bypasses RLS).
reset role;
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('00860000-0000-0000-0000-000000000001','reference','pmo-1','reference','ext-1');

-- AC-EAS-040: org-A member reads the 1 own-org ref.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00860000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from external_refs), 1,
  'AC-EAS-040 org-A member reads own-org external_ref');
-- Simulate a cross-org caller by switching the profile's org claim target: an org-B member would see 0.
-- (No org-B profile seeded; assert the own-org scoping predicate directly via a second org insert + member.)
reset role;
insert into auth.users (id, email) values ('00860000-0000-0000-0000-0000000000b1','refs-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00860000-0000-0000-0000-0000000000b1','00860000-0000-0000-0000-000000000002','B','refs-b@example.com','Admin','active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00860000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from external_refs), 0,
  'AC-EAS-040 org-B member reads nothing of org-A external_refs (org isolation)');

-- AC-EAS-041: user JWT cannot write.
set local request.jwt.claims = '{"sub":"00860000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values ('00860000-0000-0000-0000-000000000001','reference','pmo-2','reference','ext-2') $$,
  '42501', null,
  'AC-EAS-041 user-JWT INSERT denied (machine-written only)');
select throws_ok(
  $$ update external_refs set external_record_id='ext-1b' $$,
  '42501', null,
  'AC-EAS-041 user-JWT UPDATE denied (machine-written only)');
select throws_ok(
  $$ delete from external_refs $$,
  '42501', null,
  'AC-EAS-041 user-JWT DELETE denied (machine-written only)');

-- Service role (table owner, RLS bypass) upserts — the dispatch path.
reset role;
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('00860000-0000-0000-0000-000000000001','reference','pmo-2','reference','ext-2')
on conflict (org_id, domain, pmo_record_id) do update set external_record_id = excluded.external_record_id;
select is((select count(*)::int from external_refs where pmo_record_id='pmo-2'), 1,
  'AC-EAS-041 service-role upsert succeeds (machine writer)');

select finish();
rollback;
