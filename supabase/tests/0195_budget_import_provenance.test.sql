-- 0195_budget_import_provenance.test.sql — budget import provenance columns + the idempotency key.
-- Migration under test: 0195_budget_import_provenance.sql · Spec: docs/specs/budget-import.spec.md
--
-- AC-BIMP-006  a second insert of the same line-item import_key INTO THE SAME VERSION is rejected —
--              including under a DIFFERENT import_batch_id. The second clause is the whole point of
--              DD-BIMP-3: the 0072-shaped key (…, import_batch_id) admits the re-run, and an
--              importer built on it passes its own tests while duplicating every budget on run two.
-- AC-BIMP-007  the SAME key in a DIFFERENT version is permitted — the child index is scoped to
--              budget_version_id, which is what lets a re-import after activation land its lines in
--              a fresh Draft instead of silently producing an empty one (DD-BIMP-5).
-- AC-BIMP-008  0187's stamp_currency fills currency on a provenance-carrying version insert — the
--              import supplies no currency (DD-BIMP-2) and must still never land 'XXX'.
-- (additive)   NULL import_key is exempt from both indexes, so every non-import write path — and
--              the descriptor's own versions, which carry provenance but no key — is unconstrained.
begin;
select plan(11);

insert into organizations (id, name, default_currency) values
  ('01950000-0000-0000-0000-000000000001', 'Budget Import Org', 'IDR');
insert into projects (id, org_id, code, name, status) values
  ('01950000-0000-0000-0000-000000000010','01950000-0000-0000-0000-000000000001',
   'PRJ-BIMP','Budget Import Project','Ongoing Project');

select has_column('public','budget_versions','import_batch_id','budget_versions has import_batch_id');
select has_column('public','budget_versions','imported_at','budget_versions has imported_at');
select has_column('public','budget_versions','import_key','budget_versions has import_key');
select has_column('public','budget_line_items','import_batch_id','budget_line_items has import_batch_id');
select has_column('public','budget_line_items','imported_at','budget_line_items has imported_at');
select has_column('public','budget_line_items','import_key','budget_line_items has import_key');

-- ── The imported Draft version: provenance stamped, import_key deliberately NULL (DD-BIMP-5). ──
insert into budget_versions (id, org_id, project_id, version, name, import_batch_id, imported_at)
values
  ('01950000-0000-0000-0000-000000000110','01950000-0000-0000-0000-000000000001',
   '01950000-0000-0000-0000-000000000010', 1, 'Imported',
   '01950000-0000-0000-0000-0000000000b1', now());

-- AC-BIMP-008: the import supplies no currency; the trigger resolves the org's.
select is(
  (select currency from budget_versions where id = '01950000-0000-0000-0000-000000000110'),
  'IDR',
  'AC-BIMP-008: stamp_currency fills the org currency on an imported version, never XXX');

-- A SECOND key-less version coexists — the partial index does not touch the ordinary
-- create-a-new-version path, nor the descriptor's own versions.
insert into budget_versions (id, org_id, project_id, version, name, import_batch_id, imported_at)
values
  ('01950000-0000-0000-0000-000000000111','01950000-0000-0000-0000-000000000001',
   '01950000-0000-0000-0000-000000000010', 2, 'Imported (after activation)',
   '01950000-0000-0000-0000-0000000000b2', now());
select is(
  (select count(*)::int from budget_versions where project_id = '01950000-0000-0000-0000-000000000010'),
  2,
  'additive: two NULL-key versions coexist — the partial index exempts them');

-- ── The imported line item. ─────────────────────────────────────────────────────────────────────
insert into budget_line_items
  (id, org_id, budget_version_id, category, description, budgeted_amount,
   import_key, import_batch_id, imported_at)
values
  ('01950000-0000-0000-0000-000000000200','01950000-0000-0000-0000-000000000001',
   '01950000-0000-0000-0000-000000000110','Labor','Site crew', 1000,
   'BIMP-LINE-001','01950000-0000-0000-0000-0000000000b1', now());

-- AC-BIMP-006, the race: same key, same version, SAME batch → rejected.
select throws_ok(
  $$insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount,
                                   import_key, import_batch_id, imported_at)
    values ('01950000-0000-0000-0000-000000000001','01950000-0000-0000-0000-000000000110',
            'Labor','Site crew', 1000,
            'BIMP-LINE-001','01950000-0000-0000-0000-0000000000b1', now())$$,
  '23505',
  null,
  'AC-BIMP-006: a duplicate line import_key in the same batch is rejected (the TOCTOU backstop)');

-- AC-BIMP-006, the re-run — THE DD-BIMP-3 ORACLE. Restore import_batch_id to the child index and
-- this assertion alone goes red; nothing else in the suite notices.
select throws_ok(
  $$insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount,
                                   import_key, import_batch_id, imported_at)
    values ('01950000-0000-0000-0000-000000000001','01950000-0000-0000-0000-000000000110',
            'Labor','Site crew', 1000,
            'BIMP-LINE-001','01950000-0000-0000-0000-0000000000b2', now())$$,
  '23505',
  null,
  'AC-BIMP-006: the same line key under a NEW batch id is rejected too (DD-BIMP-3)');

-- AC-BIMP-007: the SAME key in a DIFFERENT version is fine — per-parent scoping is what lets the
-- lines land in a fresh Draft after the previous one was activated.
insert into budget_line_items
  (org_id, budget_version_id, category, description, budgeted_amount,
   import_key, import_batch_id, imported_at)
values
  ('01950000-0000-0000-0000-000000000001','01950000-0000-0000-0000-000000000111',
   'Labor','Site crew', 1000,
   'BIMP-LINE-001','01950000-0000-0000-0000-0000000000b2', now());
select is(
  (select count(*)::int from budget_line_items where import_key = 'BIMP-LINE-001'),
  2,
  'AC-BIMP-007: one key, two versions — the child index is scoped to budget_version_id');

select * from finish();
rollback;
