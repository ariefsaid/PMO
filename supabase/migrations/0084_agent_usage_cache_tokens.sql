-- 0084_agent_usage_cache_tokens.sql — agent_usage gains cached_tokens + reasoning_tokens
-- (telemetry hardening; observability for the prompt-caching cost lever).
--
-- Why. The per-request spend ledger records prompt_tokens/completion_tokens/cost but discards two
-- fields OpenRouter already returns on every response (usage.prompt_tokens_details.cached_tokens and
-- usage.completion_tokens_details.reasoning_tokens). Without them we cannot measure prompt-cache hit
-- rate (the 3-50× input-cost lever for PMO's ~94%-input agent workload) or separate reasoning tokens
-- from answer tokens in the completion split — both are needed to reason about model cost empirically.
--
-- Shape. Two additive, non-null-default-0 int columns; mirrors 0068's additive-column pattern. No RLS
-- change (agent_usage's existing policies cover all columns), no index change (these are reporting
-- measures, not filter/group keys), no CHECK (any non-negative int is valid; the edge fn clamps).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   alter table public.agent_usage drop column if exists reasoning_tokens;
--   alter table public.agent_usage drop column if exists cached_tokens;

alter table public.agent_usage
  add column cached_tokens    integer not null default 0,
  add column reasoning_tokens integer not null default 0;

comment on column public.agent_usage.cached_tokens is
  'Prompt tokens served from the provider prefix cache (OpenRouter usage.prompt_tokens_details.cached_tokens). Subset of prompt_tokens; 0 when no cache hit or provider does not report it.';
comment on column public.agent_usage.reasoning_tokens is
  'Reasoning/thinking tokens in the output (OpenRouter usage.completion_tokens_details.reasoning_tokens). Subset of completion_tokens; 0 when the model emits none or provider does not report it.';
