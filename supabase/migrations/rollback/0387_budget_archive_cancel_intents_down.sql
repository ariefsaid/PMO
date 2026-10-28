-- Rolls back 0387: remove the archive cancellation queue and restore the prior status-column grant.
drop function if exists public.archive_budget_version_with_cancel_intent(uuid, boolean, uuid);
drop table if exists public.budget_archive_cancel_intents;
drop table if exists public.budget_archive_requests;
grant update (status) on public.budget_versions to authenticated;
