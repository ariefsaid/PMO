-- 0073_import_provenance_projects.sql — extends 0072's import-provenance columns to `projects`
-- (Deliverable 3 gap fix). 0072 added import_batch_id/imported_at/import_key to `procurements` +
-- the 7 procurement record tables, but the historical-import loader (scripts/import-historical.mjs)
-- also stamps these same three columns on `projects` (FR-HIST-003/007/011/012, AC-HIST-003/006) —
-- 0072 omitted `projects` from its column list, which this migration was discovered to be a real
-- bug by actually RUNNING the loader against a live DB (not just reading the code): the projects
-- insert failed with "Could not find the 'import_batch_id' column of 'projects' in the schema
-- cache" (PostgREST schema-cache error), i.e. a hard runtime failure for Deliverable 3's core path
-- (loading a closed project as part of the historical import).
--
-- Same additive, backward-compatible shape as 0072: three nullable columns, no policy changes, no
-- new write authority — the existing `projects` insert/RLS policies are untouched; this migration
-- only adds columns + one partial unique index.
--
-- Rollback: supabase db reset (pre-production, ADR-0006). Hand-written down-migration:
--   drop index projects_import_key_batch_uidx;
--   alter table projects drop column import_batch_id, drop column imported_at, drop column import_key;

alter table projects
  add column import_batch_id uuid,
  add column imported_at     timestamptz,
  add column import_key      text;

-- Case header: scoped by (org_id, import_key, import_batch_id) — mirrors 0072's
-- procurements_import_key_batch_uidx exactly (same DB-enforced idempotency rationale: a duplicate
-- insert raises 23505, treated as "already imported → skip" by import-historical.mjs).
create unique index projects_import_key_batch_uidx
  on projects (org_id, import_key, import_batch_id)
  where import_key is not null;
