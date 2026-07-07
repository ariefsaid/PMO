-- 0078_automation_fire_claim.sql — automation fire dedupe claim table (CRITICAL fix for
-- trigger-automation double-fire bug). Event-triggered automations dispatched by the
-- agent-dispatch edge fn can double-fire if dispatcher ticks overlap or a watermark write
-- fails — the same (automation_id, event_id) pair would fire twice, causing duplicate side-
-- effects. This table enforces at-most-once firing via a durable UNIQUE claim in the DB,
-- not JS timing.
--
-- Infra/bookkeeping table like agent_dispatch_watermarks (0048): NO org_id/owner_id, NO
-- policy — default-deny to every JWT role; only the dispatcher's service_role client
-- (bypasses RLS) touches it.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback (reverse order):
--   drop table if exists public.agent_automation_fires;

create table public.agent_automation_fires (
  automation_id uuid not null references public.agent_automations(id) on delete cascade,
  event_id      uuid not null,
  fired_at      timestamptz not null default now(),
  primary key (automation_id, event_id)
);

alter table public.agent_automation_fires enable row level security;
alter table public.agent_automation_fires force row level security;
-- Infra/bookkeeping table like agent_dispatch_watermarks (0048): intentionally NO policy created
-- — default-deny to every JWT role; only service_role (which bypasses RLS) reaches it.