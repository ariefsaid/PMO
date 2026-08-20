-- 0195_budget_import_provenance.sql — budget import provenance + TOCTOU-safe idempotency.
-- Mirrors 0072_import_provenance.sql for the two budget tables. NULL keeps every legacy and
-- non-import write path unchanged; imported rows opt into the unique skip-query shape.
--
-- Rollback: supabase db reset (pre-production, ADR-0006). Manual reverse:
--   drop index if exists budget_versions_import_key_uidx;
--   drop index if exists budget_line_items_import_key_uidx;
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

-- ⚑ DD-BIMP-3 (amended 2026-08-20, pre-`main`, never on prod) — the key EXCLUDES import_batch_id.
--
-- 0072 keys its indexes and its skip query on (import_key, import_batch_id), and the wizard mints a
-- fresh `crypto.randomUUID()` per mount. So under 0072's shape a re-import in a NEW SESSION misses
-- the skip and inserts duplicates; the only cross-batch layer that exists there is a dry-run REPORT
-- (`findCrossBatchCollision`), not a skip. #495's contract is "re-running the same sheet creates
-- nothing new" — which the batch-scoped key cannot deliver, and an importer built on it would pass
-- its own tests and duplicate every budget on the second run.
--
-- Keyed on import_key alone, the DB is the authority for BOTH questions: the re-run (a second import
-- of the same row is rejected whatever batch it claims) and the race (two concurrent inserts of one
-- key, the TOCTOU backstop the application skip query cannot close). Still two layers, not three.
--
-- The procurement path deliberately keeps its batch-scoped key — changing a shipped importer that
-- already has live data is a separate decision, not a drive-by.

-- Header: one imported version per org/key.
create unique index budget_versions_import_key_uidx
  on public.budget_versions (org_id, import_key)
  where import_key is not null;

-- Child: one imported line per parent/key.
create unique index budget_line_items_import_key_uidx
  on public.budget_line_items (budget_version_id, import_key)
  where import_key is not null;

-- budget_versions has a column-level INSERT grant (0176). Keep currency and explicitly add
-- the three provenance columns; budget_line_items retains its table-level INSERT grant (0075).
grant insert (import_batch_id, imported_at, import_key) on public.budget_versions to authenticated;
