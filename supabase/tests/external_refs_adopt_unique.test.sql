-- external_refs_adopt_unique.test.sql
-- AC-CUA-024 [pgTAP]: adopt mode may not map the same external record to two PMO records.
-- AC-ENA-054 [pgTAP]: the same reused `unique(org_id,domain,external_record_id)` constraint (0093)
-- already covers the ERPNext P2 domains ('procurement'/'companies') — this is the proof for those
-- domains, not new enforcement (task 1.9: goes green immediately on the existing constraint).
begin;
select plan(6);

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

-- AC-ENA-054 'procurement': (org, 'procurement', 'MAT-REQ-001') → pmoA; a second insert mapping the
-- SAME (org,'procurement','MAT-REQ-001') to pmoB is rejected.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('00920000-0000-0000-0000-000000000001','procurement','pmoA','erpnext','MAT-REQ-001');
select throws_ok(
  $$ insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
       values ('00920000-0000-0000-0000-000000000001','procurement','pmoB','erpnext','MAT-REQ-001') $$,
  '23505', null,
  'AC-ENA-054 duplicate (org,''procurement'',''MAT-REQ-001'') mapping to a second pmo record is rejected');
select is(
  (select count(*)::int from external_refs where org_id = '00920000-0000-0000-0000-000000000001' and domain = 'procurement' and external_record_id = 'MAT-REQ-001'),
  1,
  'AC-ENA-054 the original procurement mapping remains singular after the rejected adopt');

-- AC-ENA-054 'companies': (org, 'companies', 'Supplier:X') → pmoA; same rejection for a second pmo record.
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
values ('00920000-0000-0000-0000-000000000001','companies','pmoA','erpnext','Supplier:X');
select throws_ok(
  $$ insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id)
       values ('00920000-0000-0000-0000-000000000001','companies','pmoB','erpnext','Supplier:X') $$,
  '23505', null,
  'AC-ENA-054 duplicate (org,''companies'',''Supplier:X'') mapping to a second pmo record is rejected');
select is(
  (select count(*)::int from external_refs where org_id = '00920000-0000-0000-0000-000000000001' and domain = 'companies' and external_record_id = 'Supplier:X'),
  1,
  'AC-ENA-054 the original companies mapping remains singular after the rejected adopt');

select finish();
rollback;
