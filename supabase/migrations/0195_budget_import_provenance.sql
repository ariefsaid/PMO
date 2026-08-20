-- 0195_budget_import_provenance.sql — budget import provenance + TOCTOU-safe idempotency.
-- Mirrors 0072_import_provenance.sql for the two budget tables. NULL keeps every legacy and
-- non-import write path unchanged; imported rows opt into the unique skip-query shape.
--
-- Rollback: supabase db reset (pre-production, ADR-0006). Manual reverse:
--   drop index if exists budget_versions_import_key_batch_uidx;
--   drop index if exists budget_line_items_import_key_batch_uidx;
--   alter table public.budget_versions drop column if exists import_batch_id, drop column if exists imported_at, drop column if exists import_key;
--   alter table public.budget_line_items drop column if exists import_batch_id, drop column if exists imported_at, drop column if exists import_key;

alter table public.budget_versions
  add column import_batch_id uuid,
  add column imported_at timestamptz,
  add column import_key text;

alter table public.budget_line_items
  add column import_batch_id uuid,
  add column imported_at timestamptz,
  add column import_key text;

-- Header skip query: one imported row per org/key/batch.
create unique index budget_versions_import_key_batch_uidx
  on public.budget_versions (org_id, import_key, import_batch_id)
  where import_key is not null;

-- Child skip query: one imported line per parent/key/batch.
create unique index budget_line_items_import_key_batch_uidx
  on public.budget_line_items (budget_version_id, import_key, import_batch_id)
  where import_key is not null;

-- budget_versions has a column-level INSERT grant (0176). Keep currency and explicitly add
-- the three provenance columns; budget_line_items retains its table-level INSERT grant (0075).
grant insert (import_batch_id, imported_at, import_key) on public.budget_versions to authenticated;
