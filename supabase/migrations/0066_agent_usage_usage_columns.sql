-- 0066_agent_usage_usage_columns.sql — agent_usage gains provider_cost_usd + action (FR-USE-001,
-- ops-admin-surface S5). `cost` stays the CREDIT charge (unchanged, org-pool metering); the new
-- `provider_cost_usd` is the same underlying ModelResponse.usage.total_cost captured alongside it
-- (today equal — they diverge only once a pricing rate is introduced, a pricing-issue change, not
-- this one). `action` records which call-site produced the row (chat/compose/automation).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   alter table public.agent_usage drop constraint if exists agent_usage_action_chk;
--   drop index if exists public.agent_usage_org_created_idx;
--   alter table public.agent_usage drop column if exists action;
--   alter table public.agent_usage drop column if exists provider_cost_usd;

alter table public.agent_usage
  add column provider_cost_usd numeric not null default 0,
  add column action          text     not null default 'chat';

-- NFR-PERF-001: the usage RPCs filter/group on (org_id, owner_id, action, date_trunc('month', created_at)).
-- The existing (owner_id, created_at) index from 0047 is RETAINED for the per-user path.
create index if not exists agent_usage_org_created_idx on public.agent_usage (org_id, created_at);

-- constrain action to the call-site kinds (FR-USE-001).
alter table public.agent_usage add constraint agent_usage_action_chk
  check (action in ('chat','compose','automation'));
