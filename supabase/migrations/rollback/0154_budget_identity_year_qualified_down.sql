-- 0154_budget_identity_year_qualified_down.sql — the STAGED rollback of 0154 (NFR-BFY-REV-001, AC-BFY-021).
--
-- ⚑ STAGED, NOT AUTOMATIC. This file lives in `supabase/migrations/rollback/` — a subdirectory, so
-- `supabase db reset` never applies it. (The plan named it beside the up-migration; it cannot live
-- there: every `*.sql` directly in `supabase/migrations/` is applied in order, and a second file with
-- version `0154` would be applied by every reset — instantly un-doing the migration it accompanies.
-- The behaviour the plan asked for — staged, not run by `supabase db reset` — is what this placement
-- delivers, and `bfy_migration_reversibility.test.sql`'s last assertion proves it stays un-applied.)
--
-- HOW TO RUN IT (deliberately, by an operator, after quiescing budget dispatch + sweep):
--   psql "$DB_URL" -f supabase/migrations/rollback/0154_budget_identity_year_qualified_down.sql
--
-- ⚑ WHAT IT WILL AND WILL NOT DO (NFR-BFY-REV-001, honestly bounded):
--   • a version with ONE year-qualified identity reverts 1:1 to the bare `<budget_version_id>`, ERP
--     pointer and idempotency epoch intact;
--   • a version with TWO (a multi-FY fan-out) is REFUSED BY NAME and the whole transaction aborts.
--     The bare identity is unique per (org, domain, record), so it can carry exactly ONE ERP pointer;
--     collapsing a fan-out would silently drop a year's pointer to a live ERP `Budget` that is still
--     enforcing overspend controls. Once a multi-FY push has happened, the identity is year-qualified
--     for good. That is the feature's own capability, named — not a defect and not a silent loss.
--   • it does NOT touch ERPNext. No ERP document is deleted, cancelled or amended by a rollback.
--   • it does NOT revert 0153 (the `fiscal_year` column, the witness columns, the RPC bodies). 0153 is
--     additive and states its own reverse steps in its header; revert it separately and only if needed.
--
-- Run it in ONE transaction: either the whole rollback lands or none of it does.
begin;

-- The identity revert + its fail-closed refusal (defined by the up-migration so it is testable).
select public.bfy_migration_0154_revert();

-- The fence and the migration helpers exist only to serve the re-key; they go with it.
drop trigger if exists enforce_budget_identity_rekey_fence on public.external_command_outbox;
drop function if exists public.enforce_budget_identity_rekey_fence();
drop function if exists public.bfy_migration_0154_revert();
drop function if exists public.bfy_migration_0154_rekey();

commit;
