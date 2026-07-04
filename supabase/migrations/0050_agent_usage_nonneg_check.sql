-- 0050_agent_usage_nonneg_check.sql — RED-1 remediation (gpt-5.5 red-team audit, CRITICAL):
-- credit forgery via a direct, RLS-permitted, owner-JWT INSERT of a negative agent_usage.cost
-- (or negative prompt_tokens/completion_tokens). The clamp previously lived ONLY in the edge
-- fn (_shared/usage.ts insertUsageRow) — agent_usage itself had no CHECK constraint, so a
-- client could POST `{owner_id: self, cost: -1000000}` directly via PostgREST (the
-- agent_usage_insert RLS policy only verifies owner_id/org_id/run_id ownership, never sign),
-- inflating balance = sum(credits.amount) - sum(agent_usage.cost) without bound.
--
-- This CHECK constraint is a database-level backstop, independent of the edge fn's clamp
-- (defense in depth — an application-layer clamp can be bypassed by any direct-insert path;
-- a CHECK constraint cannot). See docs note below ("client-insert finding") for why the INSERT
-- policy itself is left unchanged rather than tightened to a server-only path.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback:
--   alter table agent_usage drop constraint if exists agent_usage_nonneg_check;

alter table agent_usage
  add constraint agent_usage_nonneg_check
  check (prompt_tokens >= 0 and completion_tokens >= 0 and cost >= 0);
