-- 0195_budget_import_provenance.test.sql — budget import provenance columns + the idempotency key.
-- Migration under test: 0195_budget_import_provenance.sql · Spec: docs/specs/budget-import.spec.md
--
-- AC-BIMP-006  a second insert of the same import_key is rejected by the DB — INCLUDING under a
--              DIFFERENT import_batch_id. That last clause is the whole point of DD-BIMP-3: the
--              0072-shaped key (org, key, batch) admits the re-run, and the importer built on it
--              would pass its own tests while duplicating every budget on the second run.
-- AC-BIMP-008  0187's stamp_currency fills currency on a provenance-carrying insert — the import
--              supplies no currency (DD-BIMP-2) and must still never land 'XXX'.
-- (additive)   pre-existing rows keep NULL provenance; NULL import_key is exempt from the index,
--              so ordinary non-import writes are unaffected.
begin;
select plan(11);

insert into organizations (id, name, default_currency) values
  ('01950000-0000-0000-0000-000000000001', 'Budget Import Org', 'IDR');
insert into projects (id, org_id, code, name, status) values
  ('01950000-0000-0000-0000-000000000010','01950000-0000-0000-0000-000000000001',
   'PRJ-BIMP','Budget Import Project','Ongoing Project');

-- ── Pre-existing, non-import version: no provenance supplied. ────────────────────────────────
insert into budget_versions (id, org_id, project_id, version, name) values
  ('01950000-0000-0000-0000-000000000100','01950000-0000-0000-0000-000000000001',
   '01950000-0000-0000-0000-000000000010', 1, 'Legacy v1');

select has_column('public','budget_versions','import_batch_id','budget_versions has import_batch_id');
select has_column('public','budget_versions','imported_at','budget_versions has imported_at');
select has_column('public','budget_versions','import_key','budget_versions has import_key');
select has_column('public','budget_line_items','import_batch_id','budget_line_items has import_batch_id');
select has_column('public','budget_line_items','imported_at','budget_line_items has imported_at');
select has_column('public','budget_line_items','import_key','budget_line_items has import_key');

select is(
  (select import_key from budget_versions where id = '01950000-0000-0000-0000-000000000100'),
  null,
  'additive: a non-import budget version carries NULL import_key');

-- A SECOND non-import version — proves the partial index exempts NULL keys, i.e. the ordinary
-- create-a-new-version path is untouched by the idempotency constraint.
insert into budget_versions (id, org_id, project_id, version, name) values
  ('01950000-0000-0000-0000-000000000101','01950000-0000-0000-0000-000000000001',
   '01950000-0000-0000-0000-000000000010', 2, 'Legacy v2');
select is(
  (select count(*)::int from budget_versions where project_id = '01950000-0000-0000-0000-000000000010'),
  2,
  'additive: two NULL-key versions coexist — the partial index does not touch non-import writes');

-- ── The imported version. ────────────────────────────────────────────────────────────────────
insert into budget_versions (id, org_id, project_id, version, name, import_key, import_batch_id, imported_at)
values
  ('01950000-0000-0000-0000-000000000110','01950000-0000-0000-0000-000000000001',
   '01950000-0000-0000-0000-000000000010', 3, 'Imported FY2026',
   'BIMP-KEY-001','01950000-0000-0000-0000-0000000000b1', now());

-- AC-BIMP-008: the import supplies no currency; the trigger resolves the org's.
select is(
  (select currency from budget_versions where id = '01950000-0000-0000-0000-000000000110'),
  'IDR',
  'AC-BIMP-008: stamp_currency fills the org currency on an imported version, never XXX');

-- AC-BIMP-006, the race: same key, SAME batch → rejected.
select throws_ok(
  $$insert into budget_versions (org_id, project_id, version, name, import_key, import_batch_id, imported_at)
    values ('01950000-0000-0000-0000-000000000001','01950000-0000-0000-0000-000000000010',
            4,'Dup same batch','BIMP-KEY-001','01950000-0000-0000-0000-0000000000b1', now())$$,
  '23505',
  null,
  'AC-BIMP-006: a duplicate import_key in the same batch is rejected (the TOCTOU backstop)');

-- AC-BIMP-006, the re-run — THE DD-BIMP-3 ORACLE. A different batch id must NOT get through.
-- Restore import_batch_id to the key and this assertion goes green-when-it-should-be-red.
select throws_ok(
  $$insert into budget_versions (org_id, project_id, version, name, import_key, import_batch_id, imported_at)
    values ('01950000-0000-0000-0000-000000000001','01950000-0000-0000-0000-000000000010',
            5,'Re-run new batch','BIMP-KEY-001','01950000-0000-0000-0000-0000000000b2', now())$$,
  '23505',
  null,
  'AC-BIMP-006: the same import_key under a NEW batch id is rejected too (DD-BIMP-3)');

select * from finish();
rollback;
