-- external_refs_adopt_unique.test.sql
-- AC-CUA-024 [pgTAP]: adopt mode may not map the same external record to two PMO records.
begin;
select plan(2);

insert into organizations (id, name) values
  ('00920000-0000-0000-0000-000000000001','AC-CUA Refs Adopt Org A');

reset role;
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('00920000-0000-0000-0000-000000000001','tasks','pmo-1','clickup','cu-1');

select throws_ok(
  $$ insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
       values ('00920000-0000-0000-0000-000000000001','tasks','pmo-2','clickup','cu-1') $$,
  '23505', null,
  'AC-CUA-024 duplicate (org, domain, external_record_id) mapping is rejected');
select is(
  (select count(*)::int from external_refs where org_id = '00920000-0000-0000-0000-000000000001' and domain = 'tasks' and external_record_id = 'cu-1'),
  1,
  'AC-CUA-024 the original mapping remains singular after the rejected adopt');

select finish();
rollback;
