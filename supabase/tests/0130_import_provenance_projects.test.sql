-- 0130_import_provenance_projects.test.sql — provenance columns + skip-query proof on `projects`.
-- Migration under test: 0073_import_provenance_projects.sql
--
-- AC-HIST-003  import_batch_id/imported_at stamped and non-NULL when supplied (projects)
-- AC-HIST-006  re-run safety: skip-query returns the existing row for (org_id, import_key, batch);
--              nothing for a new key; a duplicate insert is DB-rejected (23505), mirroring 0072's
--              procurements proof (0129) — discovered missing by actually RUNNING
--              scripts/import-historical.mjs against a live DB (schema-cache error on the
--              projects insert), not just reading the code.
begin;
select plan(6);

insert into organizations (id, name) values
  ('01300000-0000-0000-0000-000000000001', 'Hist Import Org A');

-- Pre-existing (pre-migration-shaped) row: no provenance columns supplied.
insert into projects (id, org_id, code, name, status, contract_value) values
  ('01300000-0000-0000-0000-000000000010','01300000-0000-0000-0000-000000000001',
   'PRJ-LEGACY','Legacy Project (no import)','Ongoing Project', 1000);

-- AC-IDEM-007-equivalent: pre-existing row has NULL provenance columns (additive migration).
select is(
  (select import_batch_id from projects where id = '01300000-0000-0000-0000-000000000010'),
  null,
  'pre-existing project row has NULL import_batch_id (additive migration)');
select is(
  (select import_key from projects where id = '01300000-0000-0000-0000-000000000010'),
  null,
  'pre-existing project row has NULL import_key (additive migration)');

-- Imported row: provenance columns supplied directly (as import-historical.mjs would).
insert into projects
  (id, org_id, code, name, status, contract_value, import_key, import_batch_id, imported_at)
values
  ('01300000-0000-0000-0000-000000000011','01300000-0000-0000-0000-000000000001',
   'PRJ-B5','Imported Project','Close Out', 120000,
   'PRJ-B5','01300000-0000-0000-0000-00000000ba01', now());

-- AC-HIST-003: stamped and non-NULL.
select isnt(
  (select import_batch_id from projects where id = '01300000-0000-0000-0000-000000000011'),
  null,
  'AC-HIST-003: import_batch_id is stamped and non-NULL on an imported project row');
select isnt(
  (select imported_at from projects where id = '01300000-0000-0000-0000-000000000011'),
  null,
  'AC-HIST-003: imported_at is stamped and non-NULL on an imported project row');

-- AC-HIST-006: the skip-query (org_id, import_key, import_batch_id) returns the existing row.
select is(
  (select id from projects
     where org_id = '01300000-0000-0000-0000-000000000001'
       and import_key = 'PRJ-B5'
       and import_batch_id = '01300000-0000-0000-0000-00000000ba01')::text,
  '01300000-0000-0000-0000-000000000011',
  'AC-HIST-006: skip-query returns the existing row for (org_id, import_key, batch)');

-- AC-HIST-006 / DB-enforced idempotency: the partial unique index rejects a duplicate
-- (org_id, import_key, import_batch_id) on projects (mirrors 0072/0129's procurements proof).
select throws_ok(
  $$insert into projects
      (org_id, code, name, status, contract_value, import_key, import_batch_id, imported_at)
    values
      ('01300000-0000-0000-0000-000000000001','PRJ-B5-DUP','Dup Imported Project','Close Out', 120000,
       'PRJ-B5','01300000-0000-0000-0000-00000000ba01', now())$$,
  '23505',
  null,
  'unique index rejects a duplicate (org_id, import_key, import_batch_id) on projects');

select * from finish();
rollback;
