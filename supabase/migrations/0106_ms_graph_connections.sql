-- 0104_ms_graph_connections.sql — the Microsoft Graph token store (ADR-0060, FR-M365-001..004).
-- Server-only custody: RLS enabled+FORCED with NO policy of any kind and NO client grant → a client
-- JWT can neither read nor write (append-only-by-omission, the platform_operators pattern, 0064).
-- Only service_role / a future security-definer edge function reaches it. Tokens are stored ONLY as
-- ciphertext (bytea) — envelope encryption, KEK referenced by key_id but held OUTSIDE the DB (Supabase
-- secrets / vault-AS / KMS; mechanism = Phase-0 decision D1). NO plaintext token column exists.
-- org_id: forward-compat coalesce default (ADR-0089/0087); the service_role writer sets org_id
-- explicitly (auth_org_id() is null under service_role), so — like credits/org_features (0074) — NO
-- blanket stamp trigger is attached (there is no authenticated INSERT path to stamp).
-- The live token exchange / proxy / rotation / revoke RUNTIME is Phase 1 under the security-auditor
-- gate; this migration ships the store + lockdown only.
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop table if exists public.ms_graph_connections;

create table public.ms_graph_connections (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                              references public.organizations(id) on delete cascade,
  user_id                   uuid not null references public.profiles(id) on delete cascade,
  entra_tenant_id           text not null,
  entra_user_object_id      text,
  scopes                    text[] not null default '{}',
  refresh_token_ciphertext  bytea not null,          -- envelope-encrypted; NEVER plaintext
  access_token_ciphertext   bytea,                   -- optional short-lived cache; encrypted
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  key_id                    text not null,           -- KEK *reference* (secret name), NOT the key
  status                    text not null default 'active'
                              check (status in ('active','stale','revoked')),
  connected_at              timestamptz not null default now(),
  last_refresh_at           timestamptz,
  updated_at                timestamptz not null default now(),
  unique (org_id, user_id)
);
comment on table public.ms_graph_connections is
  'Microsoft Graph refresh/access tokens, server-only custody (ADR-0060). RLS forced, NO policy, NO '
  'client grant — service_role / security-definer edge function only. Tokens stored ONLY as ciphertext.';
create index ms_graph_connections_org_idx on public.ms_graph_connections (org_id);

alter table public.ms_graph_connections enable row level security;
alter table public.ms_graph_connections force  row level security;

-- DELIBERATELY NO policy of any kind (no SELECT/INSERT/UPDATE/DELETE) → every authenticated/anon
-- access is denied. Mirrors the platform_operators lockdown but STRICTER (not even a self-select).
-- Explicit grants withheld (auto_expose_new_tables=false, 0075): revoke everything from client roles.
revoke all on public.ms_graph_connections from authenticated;
revoke all on public.ms_graph_connections from anon;
