-- 0274_ledger_mirror_cancelled_state.sql — #901: a cancel in ERPNext must reach the ledger mirrors.
--
-- On cancel ERPNext keeps the original ledger rows (docstatus 1) and flips their state, bumping
-- `modified`: GL Entry → `is_cancelled = 1`; Payment Ledger Entry → `delinked = 1` (also set by an
-- unreconcile). It then adds reversal rows carrying the same flag. The sweep feed now fetches every row
-- modified since its cursor WITHOUT a cancellation filter and upserts the flag onto the mirror copy;
-- the readers (actuals, the aging fallback) exclude flagged rows.
--
--   erp_payment_ledger_mirror.delinked — the PLE flag (the GL mirror already has `is_cancelled`, 0101).
--
-- History already mirrored — no automatic re-scan. Until this fix every incremental tick after an
-- org's first feed failed (the upsert re-sent the cursor's boundary row without naming the
-- `(org_id, erp_name)` key → 23505), so each org's cursor is still at its first-feed high-water mark and
-- the fixed feed re-reads everything modified since — which covers every cancel made after that first
-- feed (a cancel bumps `modified`). Rows cancelled BEFORE the first feed were never mirrored (the old
-- fetch filtered them), except PLE rows already delinked then: they read `delinked = false` here, but
-- their delinked reversal was mirrored with them, so the aging-fallback sums still net to zero. A full
-- re-scan is not run at deploy because it costs one first-activation feed per org inside a single sweep
-- tick (CPU-bounded). If exact PLE state is wanted, the operator clears the cursors and the next tick
-- re-fetches and re-stamps every row (idempotent — the feed upserts by `(org_id, erp_name)`):
--   delete from public.external_sync_watermarks
--    where external_tier = 'erpnext' and domain in ('ledger::GL Entry', 'ledger::Payment Ledger Entry')
--      and org_id = '<org uuid>';
--
-- Grants: a new column on an existing table inherits its table-level grants (service-role write,
-- org-member SELECT under RLS — 0101); no function, table, or policy is added.
-- Reversal: supabase/migrations/rollback/0274_ledger_mirror_cancelled_state_down.sql.

alter table public.erp_payment_ledger_mirror
  add column delinked boolean not null default false;

comment on column public.erp_payment_ledger_mirror.delinked is
  'ERPNext Payment Ledger Entry.delinked (cancel / unreconcile; docstatus 2 is folded in). Readers count only delinked = false.';
comment on column public.erp_gl_entry_mirror.is_cancelled is
  'ERPNext GL Entry.is_cancelled (cancelled originals AND their reversals; docstatus 2 is folded in). Readers count only is_cancelled = false.';
