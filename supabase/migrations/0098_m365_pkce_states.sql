-- 0098_m365_pkce_states.sql — transient PKCE state store for the server-side auth-code + PKCE
-- bootstrap (ADR-0060 §1 D2, FR-M365-101/102/103). Single-use, short-TTL (10 min), service_role-only.
-- Mirrors the ms_graph_connections lockdown pattern (0096): RLS enabled+forced, ZERO policies,
-- revoke all from authenticated/anon. The edge function writes/reads via service_role client.
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop table if exists public.m365_pkce_states;

create table public.m365_pkce_states (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  code_verifier   text not null,
  state           text not null unique,
  scopes          text[] not null default '{}',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);
comment on table public.m365_pkce_states is
  'Transient PKCE state for Microsoft auth-code + PKCE bootstrap (ADR-0060). Service_role only. '
  'Single-use (state is unique + row deleted on consume). TTL via expires_at (10 min).';
create index m365_pkce_states_org_user_idx on public.m365_pkce_states (org_id, user_id);

alter table public.m365_pkce_states enable row level security;
alter table public.m365_pkce_states force  row level security;

-- DELIBERATELY NO policy of any kind → every authenticated/anon access is denied.
revoke all on public.m365_pkce_states from authenticated;
revoke all on public.m365_pkce_states from anon;