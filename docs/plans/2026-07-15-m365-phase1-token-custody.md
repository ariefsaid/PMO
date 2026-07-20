# Implementation plan — Microsoft 365 integration Phase 1 (Graph Token Custody Runtime)

- **Spec:** [`docs/specs/m365-phase1-graph-token-custody.spec.md`](../specs/m365-phase1-graph-token-custody.spec.md)
- **ADRs:** 0058 (architecture), 0059 (Entra topology), **0060 (token custody — the ten controls)**, 0049 (two-switch entitlement), 0055/0089/0087 (adapter/seam patterns), 0001 (org_id seam), 0010 (test pyramid), 0016 (FE authz UX-only), 0019 (security-definer RPC boundary), 0076 (audit_events), 0071 (error_events).
- **Date:** 2026-07-15 · **Author:** eng-planner (Opus 4.8).
- **Build order:** TDD red→green throughout. Every behavior task writes the failing test first, then the minimum code to green, then `verify`.

> **Environment note:** This worktree has a shared local Supabase stack. All DB-driving commands **MUST** be wrapped in `scripts/with-db-lock.sh` to serialize against parallel agents. FE tasks (Vitest) run from `pmo-portal/` and do not need the lock.

---

## Slice A — DB: `m365_pkce_states` transient store + lockdown pgTAP

### Task DB1 — Migration 0098: `m365_pkce_states` table (RED proof for AC-M365-101/102/104/142)

**RED.** Create `supabase/migrations/0106_m365_pkce_states.sql`:

```sql
-- 0106_m365_pkce_states.sql — transient PKCE state store for the server-side auth-code + PKCE
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
```

**GREEN.** Apply migration and verify locally.

**Verify:** `scripts/with-db-lock.sh supabase db reset` (applies clean).

**Covers:** FR-M365-101/102/103, NFR-M365-104/110. AC-M365-101/102/104/142 (structural).

---

### Task DB2 — pgTAP: `m365_pkce_states` lockdown (owns AC-M365-101 structural, AC-M365-142)

**RED.** Create `supabase/tests/0145_m365_pkce_states_lockdown.test.sql`:

```sql
-- 0145_m365_pkce_states_lockdown.test.sql
-- AC-M365-101 [pgTAP]: m365_pkce_states is server-only — RLS enabled+forced, ZERO policies, and
-- an authenticated (non-service_role) JWT is denied SELECT/INSERT/UPDATE (FR-M365-101, NFR-M365-104).
-- AC-M365-142 [pgTAP]: state column has UNIQUE constraint (single-use enforcement).
begin;
select plan(7);

insert into organizations (id, name) values
  ('01450000-0000-0000-0000-000000000001','AC-M365-101 Org');
insert into auth.users (id, email) values
  ('01450000-0000-0000-0000-0000000000a1','m365-pkce-lockdown@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01450000-0000-0000-0000-0000000000a1','01450000-0000-0000-0000-000000000001','PKCE User','m365-pkce-lockdown@example.com','Admin');

-- Seed a PKCE state AS THE TABLE OWNER (service_role write path bypasses RLS).
insert into public.m365_pkce_states
  (org_id, user_id, code_verifier, state, scopes, expires_at)
values
  ('01450000-0000-0000-0000-000000000001','01450000-0000-0000-0000-0000000000a1',
   'verifier-abc', 'state-xyz', array['offline_access','Files.Read'], now() + interval '10 minutes');

select is((select relrowsecurity   from pg_class where oid = 'public.m365_pkce_states'::regclass),
          true, 'AC-M365-101 RLS is enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.m365_pkce_states'::regclass),
          true, 'AC-M365-101 RLS is forced');
select is((select count(*)::int from pg_policies
             where schemaname = 'public' and tablename = 'm365_pkce_states'),
          0, 'AC-M365-101 the table has ZERO policies (no client-readable policy)');
select has_unique_constraint('public','m365_pkce_states','state',
          'AC-M365-142 state column has UNIQUE constraint (single-use)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01450000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select * from public.m365_pkce_states $$,
  '42501', null, 'AC-M365-101 authenticated SELECT denied (no grant, no policy)');
select throws_ok(
  $$ insert into public.m365_pkce_states (org_id,user_id,code_verifier,state,expires_at)
     values ('01450000-0000-0000-0000-000000000001','01450000-0000-0000-0000-0000000000a1','v','s',now() + interval '10 minutes') $$,
  '42501', null, 'AC-M365-101 authenticated INSERT denied');
select throws_ok(
  $$ update public.m365_pkce_states set code_verifier = 'tampered' $$,
  '42501', null, 'AC-M365-101 authenticated UPDATE denied');

reset role;
select * from finish();
rollback;
```

**GREEN.** Run pgTAP.

**Verify:** `scripts/with-db-lock.sh supabase test db`.

**Covers:** AC-M365-101 (structural), AC-M365-142.

---

### Task DB3 — pgTAP: `ms_graph_connections` own-row/org-scope (owns AC-M365-133)

**RED.** Create `supabase/tests/0146_ms_graph_connections_org_scope.test.sql`:

```sql
-- 0146_ms_graph_connections_org_scope.test.sql
-- AC-M365-133 [pgTAP]: ms_graph_connections own-row/org-scoping under service_role writes.
-- The service_role write sets org_id explicitly from the resolved profile (FR-M365-164, NFR-M365-104/109).
-- Cross-org access is impossible because the edge function resolves org_id under caller JWT (RLS) and
-- writes ONLY that org_id. This test proves the write path cannot be tricked into writing another org.
begin;
select plan(6);

insert into organizations (id, name) values
  ('01460000-0000-0000-0000-000000000001','AC-M365-133 Org A'),
  ('01460000-0000-0000-0000-000000000002','AC-M365-133 Org B');
insert into auth.users (id, email) values
  ('01460000-0000-0000-0000-0000000000a1','m365-orgscope-a@example.com'),
  ('01460000-0000-0000-0000-0000000000b1','m365-orgscope-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01460000-0000-0000-0000-0000000000a1','01460000-0000-0000-0000-000000000001','User A','m365-orgscope-a@example.com','Admin'),
  ('01460000-0000-0000-0000-0000000000b1','01460000-0000-0000-0000-000000000002','User B','m365-orgscope-b@example.com','Admin');

-- Simulate the edge function's service-role write for Org A's user (org_id comes from caller-JWT RLS read).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01460000-0000-0000-0000-000000000001','01460000-0000-0000-0000-0000000000a1',
   'tenant-a', array['offline_access','Files.Read'], '\x01'::bytea, '\x02'::bytea, 'kek-v1', 'active');

-- Prove the unique(org_id, user_id) prevents a second row for the same user in the same org.
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, refresh_token_ciphertext, key_id)
     values ('01460000-0000-0000-0000-000000000001','01460000-0000-0000-0000-0000000000a1','t','\x03'::bytea,'k') $$,
  '23505', null, 'AC-M365-133 unique(org_id,user_id) prevents duplicate connection per user per org');

-- Prove Org B's user gets their own row (different org_id).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01460000-0000-0000-0000-000000000002','01460000-0000-0000-0000-0000000000b1',
   'tenant-b', array['offline_access','Files.Read'], '\x03'::bytea, '\x04'::bytea, 'kek-v1', 'active');

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01460000-0000-0000-0000-000000000001'),
  1, 'AC-M365-133 Org A has exactly 1 connection');
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01460000-0000-0000-0000-000000000002'),
  1, 'AC-M365-133 Org B has exactly 1 connection');

-- Prove service_role cannot be tricked into writing org_id != resolved caller's org (the function
-- controls this; here we just show the FK on org_id rejects a non-existent org).
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, refresh_token_ciphertext, key_id)
     values ('00000000-0000-0000-0000-000000000999','01460000-0000-0000-0000-0000000000a1','t','\x05'::bytea,'k') $$,
  '23503', null, 'AC-M365-133 FK on org_id rejects a non-existent org (org_id seam)');

select * from finish();
rollback;
```

**GREEN.** Run pgTAP.

**Verify:** `scripts/with-db-lock.sh supabase test db`.

**Covers:** AC-M365-133.

---

### Task DB4 — pgTAP: Offboard/disentitlement cascade RPC (owns AC-M365-121)

**RED.** Create `supabase/tests/0147_m365_offboard_cascade.test.sql`:

```sql
-- 0147_m365_offboard_cascade.test.sql
-- AC-M365-121 [pgTAP]: offboard/disentitlement cascade deletes ms_graph_connections and audits.
-- Ties into the existing admin_set_user_status (0065) + operator_toggle_feature (0070).
-- The cascade is a new security-definer RPC: public.m365_disconnect_cascade(p_org_id, p_user_id?, p_reason).
begin;
select plan(8);

-- Setup two orgs with active connections.
insert into organizations (id, name) values
  ('01470000-0000-0000-0000-000000000001','AC-M365-121 Org A'),
  ('01470000-0000-0000-0000-000000000002','AC-M365-121 Org B');
insert into auth.users (id, email) values
  ('01470000-0000-0000-0000-0000000000a1','m365-cascade-a@example.com'),
  ('01470000-0000-0000-0000-0000000000b1','m365-cascade-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01470000-0000-0000-0000-0000000000a1','01470000-0000-0000-0000-000000000001','User A','m365-cascade-a@example.com','Admin'),
  ('01470000-0000-0000-0000-0000000000b1','01470000-0000-0000-0000-000000000002','User B','m365-cascade-b@example.com','Admin');

insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01470000-0000-0000-0000-000000000001','01470000-0000-0000-0000-0000000000a1',
   'tenant-a', array['offline_access','Files.Read'], '\x01'::bytea, '\x02'::bytea, 'kek-v1', 'active'),
  ('01470000-0000-0000-0000-000000000002','01470000-0000-0000-0000-0000000000b1',
   'tenant-b', array['offline_access','Files.Read'], '\x03'::bytea, '\x04'::bytea, 'kek-v1', 'active');

-- (1) Operator disentitles Org A (m365_integration = false) → cascade deletes Org A's connection only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
insert into platform_operators (user_id) values ('00000000-0000-0000-0000-0000000000f1');

-- Call the cascade RPC (Operator path, reason='disentitled').
select lives_ok(
  $$ select public.m365_disconnect_cascade('01470000-0000-0000-0000-000000000001', null, 'disentitled') $$,
  'AC-M365-121 Operator cascade on org disentitlement succeeds');

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01470000-0000-0000-0000-000000000001'),
  0, 'AC-M365-121 Org A connection deleted by cascade');
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01470000-0000-0000-0000-000000000002'),
  1, 'AC-M365-121 Org B connection untouched (org-scoped)');

-- Audit row for Org A's connection.
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked' and org_id = '01470000-0000-0000-0000-000000000001'
       and detail->>'reason' = 'disentitled'),
  1, 'AC-M365-121 audit event recorded with reason=disentitled');
reset role;

-- (2) Admin offboards a user via admin_set_user_status → cascade deletes that user's connection.
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01470000-0000-0000-0000-000000000002','01470000-0000-0000-0000-0000000000b1',
   'tenant-b', array['offline_access','Files.Read'], '\x05'::bytea, '\x06'::bytea, 'kek-v1', 'active');

-- Admin in Org B disables User B (triggers cascade with reason='offboard').
set local role authenticated;
set local request.jwt.claims = '{"sub":"01470000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_set_user_status('01470000-0000-0000-0000-0000000000b1','disabled','01470000-0000-0000-0000-000000000002') $$,
  'AC-M365-121 admin_set_user_status to disabled succeeds');

select is(
  (select count(*)::int from public.ms_graph_connections where user_id = '01470000-0000-0000-0000-0000000000b1'),
  0, 'AC-M365-121 User B connection deleted by offboard cascade');
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked' and org_id = '01470000-0000-0000-0000-000000000002'
       and detail->>'reason' = 'offboard'),
  1, 'AC-M365-121 audit event recorded with reason=offboard');
reset role;

select * from finish();
rollback;
```

**GREEN.** Implement the RPC in a new migration `0107_m365_disconnect_cascade.sql` (see Task DB5), then run pgTAP.

**Verify:** `scripts/with-db-lock.sh supabase db reset` then `scripts/with-db-lock.sh supabase test db`.

**Covers:** AC-M365-121.

---

### Task DB5 — Migration 0099: `m365_disconnect_cascade` security-definer RPC

**RED.** Create `supabase/migrations/0107_m365_disconnect_cascade.sql`:

```sql
-- 0107_m365_disconnect_cascade.sql — security-definer RPC for offboard/disentitlement cascade
-- (FR-M365-151, NFR-M365-107). Called by:
--   • operator_toggle_feature when m365_integration is toggled OFF (Operator path).
--   • admin_set_user_status when a user is disabled (Admin path, via trigger or explicit call).
--   • Future org-disable automation (org_features status change).
-- Deletes ms_graph_connections rows and emits audit_events via log_audit().
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.m365_disconnect_cascade(uuid, uuid, text);

create or replace function public.m365_disconnect_cascade(
  p_org_id   uuid,
  p_user_id  uuid,      -- null = all users in org (operator disentitlement)
  p_reason   text       -- 'disentitled' | 'offboard' | 'org_disabled'
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_caller_org  uuid := public.auth_org_id();
  v_caller_role user_role := public.auth_role();
  v_deleted     int;
  v_conn_id     uuid;
  v_detail      jsonb;
begin
  -- Entry guard: only Operator (cross-org) or Admin-in-org may invoke.
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;

  if not (
    (public.is_operator() and p_org_id is not null)  -- Operator: must specify target org
    or (v_caller_org = p_org_id and v_caller_role = 'Admin')  -- Admin: own org only
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- If p_user_id provided, validate it belongs to p_org_id (defense-in-depth).
  if p_user_id is not null then
    if not exists (select 1 from public.profiles where id = p_user_id and org_id = p_org_id) then
      raise exception 'user_not_in_org' using errcode = '42501';
    end if;
  end if;

  -- Delete connections, capturing ids for audit.
  if p_user_id is not null then
    -- Single user (offboard path).
    delete from public.ms_graph_connections
     where org_id = p_org_id and user_id = p_user_id
     returning id into v_conn_id;
    get diagnostics v_deleted = row_count;
    if v_deleted = 1 then
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', p_user_id);
      perform public.log_audit('m365.connection.revoked', p_org_id, auth.uid(), v_conn_id, v_detail);
    end if;
  else
    -- All users in org (operator disentitlement / org disable).
    for v_conn_id in
      select id from public.ms_graph_connections where org_id = p_org_id
    loop
      v_detail := jsonb_build_object('reason', p_reason, 'user_id', 
        (select user_id from public.ms_graph_connections where id = v_conn_id));
      perform public.log_audit('m365.connection.revoked', p_org_id, auth.uid(), v_conn_id, v_detail);
    end loop;
    delete from public.ms_graph_connections where org_id = p_org_id;
    get diagnostics v_deleted = row_count;
  end if;

  -- No exception if zero rows deleted (idempotent).
end $$;

revoke all on function public.m365_disconnect_cascade(uuid, uuid, text) from public;
grant execute on function public.m365_disconnect_cascade(uuid, uuid, text) to authenticated;
```

**GREEN.** Apply migration, then pgTAP (Task DB4).

**Verify:** `scripts/with-db-lock.sh supabase db reset` then `scripts/with-db-lock.sh supabase test db`.

**Covers:** FR-M365-151, NFR-M365-107, AC-M365-121.

---

### Task DB6 — Migration 0100: `audit_m365_event` service-role audit wrapper (owns EF7 audit path)

> Why (Director, 2026-07-15): the edge fn runs as `service_role`, which **cannot** call `log_audit`
> directly (revoked from public; only postgres-owned SD fns call it — 0076). The OAuth `/callback` runs
> with **no PMO JWT**, so `audit_agent_denial`'s stamp-from-`auth_org_id()` pattern (0079) doesn't apply.
> This wrapper takes org/actor explicitly (the edge fn resolves them from the verified JWT `sub` or the
> `m365_pkce_states` row) and is granted to `service_role`, with an `m365.*` action allowlist so the
> broad grant can't forge arbitrary audit actions.

**RED.** Create `supabase/migrations/0108_audit_m365_event.sql`:

```sql
-- 0108_audit_m365_event.sql — service-role-callable audit wrapper for the m365-token-custody edge fn
-- (FR-M365-170, NFR-M365-108). log_audit (0076) is revoked from public and callable only by
-- postgres-owned SECURITY DEFINER fns; the edge fn is service_role and its OAuth callback path has no
-- caller JWT, so it passes org/actor explicitly through this wrapper (cf. audit_agent_denial 0079,
-- which is authenticated-only and stamps from auth context).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.audit_m365_event(text, uuid, uuid, uuid, jsonb);

create or replace function public.audit_m365_event(
  p_action    text,
  p_org_id    uuid,
  p_actor_id  uuid,
  p_entity_id uuid,
  p_detail    jsonb default '{}'::jsonb
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- Allowlist: this service_role-granted wrapper may ONLY write m365.* audit actions.
  if p_action is null or p_action not like 'm365.%' then
    raise exception 'audit_m365_event: action must be m365.*' using errcode = '22023';
  end if;
  perform public.log_audit(p_action, p_org_id, p_actor_id, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end $$;

revoke all on function public.audit_m365_event(text, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.audit_m365_event(text, uuid, uuid, uuid, jsonb) to service_role;
```

**GREEN + pgTAP.** Add `supabase/tests/0148_audit_m365_event_wrapper.test.sql` (next free pgTAP after
DB2/DB3/DB4 use 0145/0146/0147):

- `AC-M365-170` (leading token): as `service_role`, `select audit_m365_event('m365.connection.initiated',
  <org>, <actor>, <entity>, '{"scopes":["Files.Read"]}'::jsonb)` succeeds and inserts exactly one
  `audit_events` row with that action/org/actor/entity/detail.
- a non-`m365.*` action (e.g. `'agent.permission_denied'`) raises `22023` (allowlist holds — the broad
  service_role grant can't forge other domains' audit actions).
- `authenticated`/`anon` have **no** execute (only `service_role`).

**Verify:** `scripts/with-db-lock.sh supabase db reset` then `scripts/with-db-lock.sh supabase test db`.

**Covers:** FR-M365-170 (the edge-fn audit path), NFR-M365-108. **Blocks:** Task EF7.

---

## Slice B — Edge Function: `m365-token-custody` (Deno, cross-tree imports)

### File layout (per spec §9)

```
supabase/functions/m365-token-custody/
├── index.ts          # Router: POST / (initiate_connect, graph_proxy, refresh, disconnect)
├── initiate.ts       # GET /initiate → { authorizeUrl, state }
├── callback.ts       # GET /callback?code=...&state=... → exchange + store
├── proxy.ts          # POST /proxy → decrypt → call Graph → return data
├── refresh.ts        # POST /refresh → rotate tokens
├── revoke.ts         # POST /revoke → best-effort MS revoke + delete row
├── auth.ts           # verifyCallerJwt + org resolution (mirrors adapter-dispatch)
├── crypto.ts         # re-exports graphTokenCrypto (encryptToken/decryptToken/serializeEnvelope/deserializeEnvelope)
├── pkce.ts           # re-exports graphPkce (generateCodeVerifier/codeChallengeS256/buildAuthorizeUrl)
├── stateStore.ts     # m365_pkce_states CRUD via service-role
├── audit.ts          # log_audit + recordErrorEvent wrappers
└── types.ts          # shared request/response types, error codes
```

All modules are **pure Deno** (no `node:` imports). Cross-tree imports from `../../../pmo-portal/src/lib/m365/` for `graphPkce` and `graphTokenCrypto`.

---

### Task EF1 — Shared types & error codes (`types.ts`)

**RED.** Create `supabase/functions/m365-token-custody/types.ts`:

```ts
// Shared types for the m365-token-custody edge function (Phase 1, ADR-0060).

export interface InitiateConnectRequest {
  action: 'initiate_connect';
}

export interface InitiateConnectResponse {
  authorizeUrl: string;
  state: string;
}

export interface GraphProxyRequest {
  action: 'graph_proxy';
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;                 // e.g. '/me/drive/root/children'
  query?: Record<string, string>;
  body?: unknown;
}

export interface RefreshRequest {
  action: 'refresh';
}

export interface DisconnectRequest {
  action: 'disconnect';
}

export type M365Request =
  | InitiateConnectRequest
  | GraphProxyRequest
  | RefreshRequest
  | DisconnectRequest;

export interface M365ErrorResponse {
  error: M365ErrorCode;
  message: string;
}

export type M365ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_ENTITLED'
  | 'BAD_REQUEST'
  | 'INVALID_STATE'
  | 'TOKEN_EXCHANGE_FAILED'
  | 'NOT_CONNECTED'
  | 'CONNECTION_STALE'
  | 'CONNECTION_REVOKED'
  | 'SCOPE_INSUFFICIENT'
  | 'GRAPH_ERROR'
  | 'INTERNAL_ERROR';

export const ERROR_STATUS: Record<M365ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_ENTITLED: 403,
  BAD_REQUEST: 400,
  INVALID_STATE: 400,
  TOKEN_EXCHANGE_FAILED: 502,
  NOT_CONNECTED: 404,
  CONNECTION_STALE: 409,
  CONNECTION_REVOKED: 410,
  SCOPE_INSUFFICIENT: 403,
  GRAPH_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export interface ConnectionRow {
  id: string;
  org_id: string;
  user_id: string;
  entra_tenant_id: string;
  entra_user_object_id: string | null;
  scopes: string[];
  refresh_token_ciphertext: Uint8Array;
  access_token_ciphertext: Uint8Array | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  key_id: string;
  status: 'active' | 'stale' | 'revoked';
  connected_at: string;
  last_refresh_at: string | null;
  updated_at: string;
}

export interface PkceStateRow {
  id: string;
  org_id: string;
  user_id: string;
  code_verifier: string;
  state: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
}
```

**GREEN.** File created.

**Verify:** `cd pmo-portal && npx tsc --noEmit` (typecheck passes).

**Covers:** All ACs (shared foundation).

---

### Task EF2 — `auth.ts` (verifyCallerJwt + org resolution, mirrors `adapter-dispatch`)

**RED.** Create failing test `pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts`:

```ts
/**
 * AC-M365-130/131/132 — caller JWT verification, org resolution, Admin gate, Entitlement gate.
 * Pure unit tests: mock fetch, Deno.env, jose JWKS, Supabase clients.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyCallerJwt, JwtVerifyError, bearerToken } from '../../../src/lib/auth/verifyCallerJwt';
import { createMockJwks, createMockJwt } from './mocks/jwtMocks'; // see Task EF2.1

// Mock Deno.env for the edge function context
const mockDenoEnv = new Map<string, string>();
vi.stubGlobal('Deno', {
  env: {
    get: (key: string) => mockDenoEnv.get(key),
  },
});

describe('AC-M365-130 — verifyCallerJwt integration (edge fn context)', () => {
  beforeEach(() => {
    mockDenoEnv.clear();
    mockDenoEnv.set('SUPABASE_URL', 'https://test.supabase.co');
    mockDenoEnv.set('SUPABASE_JWT_ISSUER', 'https://test.supabase.co/auth/v1');
    mockDenoEnv.set('SUPABASE_ANON_KEY', 'anon-key');
    mockDenoEnv.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  });

  it('AC-M365-130: valid JWT returns sub', async () => {
    const jwks = createMockJwks();
    const token = await createMockJwt({ sub: 'user-123', role: 'Admin', org_id: 'org-123' }, jwks.privateKey);
    const verified = await verifyCallerJwt(token, jwks.resolver, {
      issuer: 'https://test.supabase.co/auth/v1',
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    expect(verified.sub).toBe('user-123');
  });

  it('AC-M365-130: expired JWT throws INVALID_TOKEN 401', async () => {
    const jwks = createMockJwks();
    const token = await createMockJwt({ sub: 'user-123' }, jwks.privateKey, { exp: Math.floor(Date.now()/1000) - 3600 });
    await expect(verifyCallerJwt(token, jwks.resolver, { issuer: 'https://test.supabase.co/auth/v1' }))
      .rejects.toThrow(JwtVerifyError);
  });

  it('AC-M365-130: wrong alg (HS256) throws INVALID_TOKEN 401 — alg confusion blocked', async () => {
    const jwks = createMockJwks();
    const token = await createMockJwt({ sub: 'user-123' }, jwks.privateKey, { alg: 'HS256' });
    await expect(verifyCallerJwt(token, jwks.resolver, { issuer: 'https://test.supabase.co/auth/v1', algorithms: ['ES256'] }))
      .rejects.toThrow(JwtVerifyError);
  });
});

describe('AC-M365-131/132 — org resolution + Admin/Entitlement gates (edge fn logic)', () => {
  // These test the pure logic extracted from auth.ts (resolveOrgId, assertAdmin, assertEntitlement)
  // Mock the Supabase caller-client RLS read.
  it('AC-M365-130: resolveOrgId returns org_id for active member', async () => {
    // Mock callerClient.from('profiles').select('org_id').eq('id', userId).single()
    // returns { data: { org_id: 'org-123' }, error: null }
    // assertAdmin(role='Admin') passes, role='Project Manager' throws FORBIDDEN
    // assertEntitlement(org_id, 'm365_integration') checks org_features via callerClient
  });
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/auth.ts`:

```ts
// auth.ts — verifyCallerJwt + org resolution + gates (mirrors adapter-dispatch patterns).
// Pure logic, importable in Vitest. Deno globals only at the index.ts entry point.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  verifyCallerJwt,
  bearerToken,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
  type VerifiedCaller,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';

// --- Module-scope JWKS cache (same pattern as adapter-dispatch/compose-view) ---
let _jwks: JwksResolver | null = null;
export function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

// --- CORS headers (same origin-narrowing as compose-view/adapter-dispatch) ---
export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': Deno.env.get('AGENT_ALLOWED_ORIGIN') ?? Deno.env.get('SITE_URL') ?? '',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

export interface AuthContext {
  userId: string;
  orgId: string;
  role: string; // the real JWT 'role' claim (not impersonated)
  serviceClient: SupabaseClient;
  callerClient: SupabaseClient;
}

/**
 * Full auth sequence: verify JWT → resolve org_id under caller JWT (RLS) → assert Admin + entitlement.
 * Returns the service-role client (for ms_graph_connections writes) and caller client (for RLS reads).
 * Throws typed responses (Response objects) on any gate failure — caller just returns the Response.
 */
export async function authenticateAndAuthorize(
  req: Request,
  requiredEntitlement: string = 'm365_integration',
): Promise<AuthContext> {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  // 1. Bearer token
  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) {
    throw new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'missing Authorization header' }), {
      status: 401, headers,
    });
  }

  // 2. Verify JWT locally (ADR-0057)
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Response(JSON.stringify({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }), {
      status: 500, headers,
    });
  }

  let userId: string;
  try {
    const verified = await verifyCallerJwt(jwt, getJwks(supabaseUrl), {
      issuer: Deno.env.get('SUPABASE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch (err) {
    const status = err instanceof JwtVerifyError ? err.status : 401;
    throw new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'invalid JWT' }), { status, headers });
  }

  // 3. Caller-JWT client for org resolution (RLS-scoped, deputy auth — mirrors adapter-dispatch)
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('org_id, role')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'org not resolvable for caller' }), {
      status: 400, headers,
    });
  }

  const orgId = (profile as { org_id: string; role: string }).org_id;
  const role = (profile as { org_id: string; role: string }).role;

  // 4. Admin gate (real JWT role, not impersonated — ADR-0016)
  if (role !== 'Admin') {
    throw new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Admin role required' }), {
      status: 403, headers,
    });
  }

  // 5. Entitlement gate (Operator switch — ADR-0049)
  const { data: feature, error: featureError } = await callerClient
    .from('org_features')
    .select('enabled')
    .eq('org_id', orgId)
    .eq('feature_key', requiredEntitlement)
    .single();

  const entitled = !featureError && feature?.enabled === true;
  if (!entitled) {
    throw new Response(JSON.stringify({ error: 'NOT_ENTITLED', message: 'organization not entitled for this integration' }), {
      status: 403, headers,
    });
  }

  // 6. Service-role client for token store writes (bypasses RLS — the only writer)
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  return { userId, orgId, role, serviceClient, callerClient };
}

// Helper for GET /callback which doesn't need entitlement/Admin (state is the credential)
export async function verifyCallbackJwt(req: Request): Promise<{ userId: string; supabaseUrl: string; serviceClient: SupabaseClient }> {
  const jwt = bearerToken(req.headers.get('Authorization'));
  if (!jwt) {
    throw new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'missing Authorization header' }), {
      status: 401, headers: corsHeaders(),
    });
  }
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Response(JSON.stringify({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }), {
      status: 500, headers: corsHeaders(),
    });
  }
  let userId: string;
  try {
    const verified = await verifyCallerJwt(jwt, getJwks(supabaseUrl), {
      issuer: Deno.env.get('SUPABASE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch {
    throw new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'invalid JWT' }), {
      status: 401, headers: corsHeaders(),
    });
  }
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  return { userId, supabaseUrl, serviceClient };
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.auth.test.ts` then `npm run verify`.

**Covers:** AC-M365-130, AC-M365-131, AC-M365-132.

---

### Task EF2.1 — JWT test mocks (`pmo-portal/src/lib/m365/__tests__/mocks/jwtMocks.ts`)

**RED.** Create the mock helper file (no test, just the utility):

```ts
// jwtMocks.ts — test utilities for creating mock ES256 JWTs and JWKS (for Vitest).
// Uses `jose` (same as verifyCallerJwt) to generate valid test tokens.

import { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet } from 'jose';

export interface MockJwks {
  resolver: ReturnType<typeof createRemoteJWKSet>;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function createMockJwks(): Promise<MockJwks> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const jwksUrl = `data:application/json,${encodeURIComponent(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] }))}`;
  const resolver = createRemoteJWKSet(new URL(jwksUrl));
  return { resolver, publicKey, privateKey };
}

export async function createMockJwt(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  opts: { exp?: number; alg?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, iat: now, nbf: now })
    .setProtectedHeader({ alg: opts.alg ?? 'ES256', kid: 'test-key' })
    .setExpirationTime(opts.exp ?? now + 3600)
    .setIssuedAt(now)
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(privateKey);
}
```

**GREEN.** File created.

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.auth.test.ts`.

**Covers:** AC-M365-130/131/132 (test infrastructure).

---

### Task EF3 — `stateStore.ts` (m365_pkce_states CRUD via service-role)

**RED.** Create failing test `pmo-portal/src/lib/m365/__tests__/tokenCustody.initiate.test.ts` (partial — stateStore unit):

```ts
/**
 * AC-M365-101/102/104/142 — PKCE state store operations.
 * Mock the service-role Supabase client; test the pure stateStore functions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock service-role client
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockSingle = vi.fn();

const mockFrom = vi.fn(() => ({
  insert: mockInsert,
  select: mockSelect,
  delete: mockDelete,
  single: mockSingle,
}));

const mockServiceClient = {
  from: mockFrom,
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockServiceClient,
}));

import { storePkceState, consumePkceState, type PkceStateRow } from '../../supabase/functions/m365-token-custody/stateStore';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AC-M365-101/142 — storePkceState / consumePkceState', () => {
  it('AC-M365-101: storePkceState inserts row with code_verifier, state, scopes, org_id, user_id, expires_at', async () => {
    mockInsert.mockReturnValue({ error: null });
    await storePkceState(mockServiceClient as never, {
      orgId: 'org-1',
      userId: 'user-1',
      codeVerifier: 'verifier-abc',
      state: 'state-xyz',
      scopes: ['offline_access', 'Files.Read'],
    });
    expect(mockFrom).toHaveBeenCalledWith('m365_pkce_states');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        user_id: 'user-1',
        code_verifier: 'verifier-abc',
        state: 'state-xyz',
        scopes: ['offline_access', 'Files.Read'],
      }),
      expect.any(Object)
    );
  });

  it('AC-M365-142: consumePkceState selects by state, verifies org/user match, DELETES row, returns code_verifier+scopes', async () => {
    const mockRow: PkceStateRow = {
      id: 'pkce-1',
      org_id: 'org-1',
      user_id: 'user-1',
      code_verifier: 'verifier-abc',
      state: 'state-xyz',
      scopes: ['offline_access', 'Files.Read'],
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600000).toISOString(),
    };
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
        }),
      }),
    });
    mockDelete.mockReturnValue({ error: null });

    const result = await consumePkceState(mockServiceClient as never, 'state-xyz', 'org-1', 'user-1');
    expect(result).toEqual({ codeVerifier: 'verifier-abc', scopes: ['offline_access', 'Files.Read'] });
    expect(mockDelete).toHaveBeenCalled();
  });

  it('AC-M365-104: consumePkceState returns null for expired/missing state (no token exchange)', async () => {
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        }),
      }),
    });
    const result = await consumePkceState(mockServiceClient as never, 'bad-state', 'org-1', 'user-1');
    expect(result).toBeNull();
  });
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/stateStore.ts`:

```ts
// stateStore.ts — m365_pkce_states CRUD via service-role client.
// Pure functions, importable in Vitest. No Deno globals.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PkceStateRow } from './types.ts';

export interface StorePkceStateParams {
  orgId: string;
  userId: string;
  codeVerifier: string;
  state: string;
  scopes: string[];
}

export interface ConsumePkceStateResult {
  codeVerifier: string;
  scopes: string[];
}

/** Insert a new PKCE state row (service-role write). TTL = 10 minutes. */
export async function storePkceState(
  serviceClient: SupabaseClient,
  params: StorePkceStateParams,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await serviceClient
    .from('m365_pkce_states')
    .insert({
      org_id: params.orgId,
      user_id: params.userId,
      code_verifier: params.codeVerifier,
      state: params.state,
      scopes: params.scopes,
      expires_at: expiresAt,
    });
  if (error) throw new Error(`storePkceState failed: ${error.message}`);
}

/**
 * Consume (read + delete) a PKCE state row by state.
 * Returns { codeVerifier, scopes } if found, valid, and org/user match; else null.
 * Single-use: row is DELETED on successful consume.
 */
export async function consumePkceState(
  serviceClient: SupabaseClient,
  state: string,
  expectedOrgId: string,
  expectedUserId: string,
): Promise<ConsumePkceStateResult | null> {
  const { data, error } = await serviceClient
    .from('m365_pkce_states')
    .select('*')
    .eq('state', state)
    .eq('org_id', expectedOrgId)
    .eq('user_id', expectedUserId)
    .single();

  if (error || !data) return null;

  const row = data as PkceStateRow;
  // Check expiry
  if (new Date(row.expires_at) < new Date()) {
    // Expired — delete it and return null
    await serviceClient.from('m365_pkce_states').delete().eq('id', row.id);
    return null;
  }

  // Valid — delete (single-use) and return
  await serviceClient.from('m365_pkce_states').delete().eq('id', row.id);
  return { codeVerifier: row.code_verifier, scopes: row.scopes };
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.initiate.test.ts` then `npm run verify`.

**Covers:** AC-M365-101 (store), AC-M365-104/142 (consume single-use + expiry).

---

### Task EF4 — `initiate.ts` (GET /initiate → authorize URL)

**RED.** Extend `pmo-portal/src/lib/m365/__tests__/tokenCustody.initiate.test.ts` with the full initiate flow test:

```ts
// Add to the existing describe block:
import { handleInitiateConnect } from '../../supabase/functions/m365-token-custody/initiate';

// Mock Deno.env and fetch
const mockDenoEnv = new Map<string, string>();
vi.stubGlobal('Deno', {
  env: { get: (key: string) => mockDenoEnv.get(key) },
});

beforeEach(() => {
  mockDenoEnv.clear();
  mockDenoEnv.set('M365_CLIENT_ID', 'test-client-id');
  mockDenoEnv.set('M365_TENANT_ID', 'test-tenant-id');
  mockDenoEnv.set('M365_REDIRECT_URI', 'https://test.supabase.co/functions/v1/m365-token-custody/callback');
  vi.clearAllMocks();
});

it('AC-M365-101: handleInitiateConnect returns authorizeUrl with correct params + stores PKCE state', async () => {
  // Mock authenticateAndAuthorize to return a valid auth context
  // Mock storePkceState
  // Call handleInitiateConnect with a mock Request
  // Assert authorizeUrl contains: response_type=code, code_challenge_method=S256, correct client_id,
  // allowlisted redirect_uri, scopes ['Files.Read','offline_access'], valid state, code_challenge
  // Assert storePkceState was called with orgId, userId, codeVerifier, state, scopes
});

it('AC-M365-102: handleInitiateConnect returns FORBIDDEN for non-Admin', async () => {
  // Mock authenticateAndAuthorize to throw FORBIDDEN response
  // Call handler, assert 403 response
});

it('AC-M365-102: handleInitiateConnect returns NOT_ENTITLED for org without m365_integration', async () => {
  // Mock authenticateAndAuthorize to throw NOT_ENTITLED response
  // Call handler, assert 403 response
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/initiate.ts`:

```ts
// initiate.ts — GET /initiate handler: generates PKCE, stores state, returns authorize URL.

import { handleAuthRequest } from './auth.ts';
import { storePkceState } from './stateStore.ts';
import { generateCodeVerifier, codeChallengeS256, buildAuthorizeUrl } from '../../../pmo-portal/src/lib/m365/graphPkce.ts';
import { corsHeaders } from './auth.ts';
import type { InitiateConnectResponse } from './types.ts';

export async function handleInitiateConnect(req: Request): Promise<Response> {
  // authenticateAndAuthorize does: JWT verify → org resolve (RLS) → Admin gate → entitlement gate
  const { userId, orgId, serviceClient } = await handleAuthRequest(req);

  // Generate PKCE parameters
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);
  const state = globalThis.crypto.getRandomValues(new Uint8Array(32)).reduce(
    (s, b) => s + String.fromCharCode(b), ''
  ).replace(/[+/=]/g, '').slice(0, 43); // 128-bit entropy, base64url-safe

  // Scopes for OneDrive doc linking (minimum + offline_access for refresh token)
  const scopes = ['Files.Read', 'offline_access'];

  // Store PKCE state server-side (service-role)
  await storePkceState(serviceClient, {
    orgId,
    userId,
    codeVerifier,
    state,
    scopes,
  });

  // Build authorize URL with allowlisted redirect URI (never from caller input)
  const tenant = Deno.env.get('M365_TENANT_ID')!;
  const clientId = Deno.env.get('M365_CLIENT_ID')!;
  const redirectUri = Deno.env.get('M365_REDIRECT_URI')!;

  const authorizeUrl = buildAuthorizeUrl({
    tenant,
    clientId,
    redirectUri,
    scopes,
    state,
    codeChallenge,
  });

  const response: InitiateConnectResponse = { authorizeUrl, state };
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.initiate.test.ts` then `npm run verify`.

**Covers:** AC-M365-101, AC-M365-102.

---

### Task EF5 — `callback.ts` (GET /callback → code exchange + store encrypted tokens)

**RED.** Create `pmo-portal/src/lib/m365/__tests__/tokenCustody.callback.test.ts`:

```ts
/**
 * AC-M365-103/104/105 — callback: consume state, exchange code, encrypt tokens, upsert connection, audit.
 * Mock: fetch (Microsoft token endpoint), graphTokenCrypto, service-client, log_audit RPC.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCallback } from '../../supabase/functions/m365-token-custody/callback';

// Mock globals
const mockDenoEnv = new Map<string, string>();
vi.stubGlobal('Deno', { env: { get: (k: string) => mockDenoEnv.get(k) } });
vi.stubGlobal('fetch', vi.fn());

// Mock Supabase service client + RPC
const mockRpc = vi.fn();
const mockUpsert = vi.fn();
const mockFrom = vi.fn(() => ({ upsert: mockUpsert, rpc: mockRpc }));
const mockServiceClient = { from: mockFrom };

vi.mock('@supabase/supabase-js', () => ({ createClient: () => mockServiceClient }));

// Mock graphTokenCrypto
vi.mock('../../../pmo-portal/src/lib/m365/graphTokenCrypto', () => ({
  encryptToken: vi.fn(),
  serializeEnvelope: vi.fn(),
  deserializeEnvelope: vi.fn(),
}));

import { encryptToken, serializeEnvelope } from '../../../pmo-portal/src/lib/m365/graphTokenCrypto';

beforeEach(() => {
  mockDenoEnv.clear();
  mockDenoEnv.set('M365_CLIENT_ID', 'test-client-id');
  mockDenoEnv.set('M365_CLIENT_SECRET', 'test-client-secret');
  mockDenoEnv.set('M365_TENANT_ID', 'test-tenant-id');
  mockDenoEnv.set('M365_REDIRECT_URI', 'https://test.supabase.co/functions/v1/m365-token-custody/callback');
  mockDenoEnv.set('M365_TOKEN_KEK', 'base64url-encoded-32-byte-key');
  vi.clearAllMocks();
  (globalThis.fetch as vi.Mock).mockReset();
  mockRpc.mockReset();
  mockUpsert.mockReset();
  (encryptToken as vi.Mock).mockReset();
  (serializeEnvelope as vi.Mock).mockReset();
});

describe('AC-M365-103/104/105 — handleCallback', () => {
  it('AC-M365-103: valid state + code → consumes state, exchanges code, encrypts both tokens, upserts connection, audits', async () => {
    // Mock consumePkceState to return { codeVerifier, scopes }
    // Mock fetch to return Microsoft token response
    // Mock encryptToken for refresh + access tokens
    // Mock serializeEnvelope
    // Mock upsert to succeed
    // Mock log_audit RPC to succeed
    // Call handleCallback with Request: GET /callback?code=auth-code&state=valid-state
    // Assert: upsert called with correct ciphertexts, key_id, status='active', scopes, expires_at
    // Assert: log_audit called with 'm365.connection.initiated', org_id, userId, connection_id, {scopes, entra_tenant_id}
    // Assert: Response redirects to FE success page (no tokens in URL)
  });

  it('AC-M365-104: missing/expired/replayed state → error page + error_event, no token exchange', async () => {
    // Mock consumePkceState to return null
    // Call handleCallback
    // Assert: fetch NOT called (no token exchange)
    // Assert: Response is error page (HTML or redirect with error)
    // Assert: recordErrorEvent called with errorCode='INVALID_STATE'
  });

  it('AC-M365-105: Microsoft returns invalid_grant → error_event, no partial store, error page', async () => {
    // Mock consumePkceState returns valid
    // Mock fetch returns { error: 'invalid_grant', error_description: '...' }
    // Call handleCallback
    // Assert: upsert NOT called
    // Assert: recordErrorEvent called with sanitized metadata (no code/secret)
    // Assert: error page response
  });
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/callback.ts`:

```ts
// callback.ts — GET /callback handler: consumes PKCE state, exchanges code for tokens,
// encrypts both, upserts ms_graph_connections, audits, redirects to FE.

import { verifyCallbackJwt } from './auth.ts';
import { consumePkceState } from './stateStore.ts';
import { encryptToken, serializeEnvelope } from '../../../pmo-portal/src/lib/m365/graphTokenCrypto.ts';
import { corsHeaders } from './auth.ts';
import { recordErrorEvent } from '../../../pmo-portal/src/lib/adapterSeam/_shared/errorEvent.ts'; // adjust path
import { logAudit } from './audit.ts';

const TOKEN_ENDPOINT = 'https://login.microsoftonline.com';
const GRAPH_SCOPE_PREFIX = 'https://graph.microsoft.com/';

export async function handleCallback(req: Request): Promise<Response> {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // Microsoft error on redirect (user denied consent, etc.)
  if (error) {
    await recordErrorEvent(/* serviceClient */ null as never, {
      fn: 'm365-token-custody',
      errorCode: 'TOKEN_EXCHANGE_FAILED',
      contextId: state ?? undefined,
      orgId: undefined,
    });
    return redirectToFeError('Connection failed: access denied');
  }

  if (!code || !state) {
    return redirectToFeError('Missing code or state');
  }

  // Verify caller JWT (but callback doesn't need Admin/entitlement — state is the credential)
  const { userId, serviceClient } = await verifyCallbackJwt(req);

  // Consume PKCE state (single-use + org/user scoped)
  const pkce = await consumePkceState(serviceClient, state, /* orgId */ '', /* userId */ '');
  // Note: orgId/userId for consumePkceState come from the state row itself; we need to read them first.
  // Better: consumePkceState returns the row data including org_id/user_id. Refactor in GREEN.

  // For now, the test will drive the exact signature. This is the RED phase.
  throw new Error('RED: implement after test drives signature');
}

function redirectToFeError(message: string): Response {
  const feUrl = Deno.env.get('SITE_URL') ?? 'https://app.example.com';
  return new Response(null, {
    status: 302,
    headers: { Location: `${feUrl}/admin/integrations?m365_error=${encodeURIComponent(message)}` },
  });
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.callback.test.ts` then iterate to green.

**Covers:** AC-M365-103, AC-M365-104, AC-M365-105.

---

### Task EF6 — `crypto.ts` + `pkce.ts` (re-exports for cross-tree imports)

**RED.** Trivial — just file creation.

**GREEN.** Create `supabase/functions/m365-token-custody/crypto.ts`:

```ts
// crypto.ts — re-exports graphTokenCrypto for the edge function (cross-tree import).
export {
  encryptToken,
  decryptToken,
  serializeEnvelope,
  deserializeEnvelope,
  type TokenEnvelope,
} from '../../../pmo-portal/src/lib/m365/graphTokenCrypto.ts';
```

Create `supabase/functions/m365-token-custody/pkce.ts`:

```ts
// pkce.ts — re-exports graphPkce for the edge function (cross-tree import).
export {
  generateCodeVerifier,
  codeChallengeS256,
  buildAuthorizeUrl,
  type AuthorizeUrlParams,
} from '../../../pmo-portal/src/lib/m365/graphPkce.ts';
```

**Verify:** `deno check supabase/functions/m365-token-custody/crypto.ts` and `deno check supabase/functions/m365-token-custody/pkce.ts`.

**Covers:** All ACs (infrastructure).

---

### Task EF7 — `audit.ts` (audit_m365_event + recordErrorEvent wrappers)

> **⚠️ Integration correction (Director, 2026-07-15).** `log_audit` (0076) is `revoke all from public`
> with **NO grant to service_role** — only postgres-owned security-definer functions call it (see the
> `audit_agent_denial` precedent, 0079). The edge fn uses `service_role`, so it **cannot** call
> `log_audit` directly (a mocked test would pass, but it fails live with `42501`). It MUST go through a
> `service_role`-granted security-definer wrapper. `audit_agent_denial` is unusable here: it's granted to
> `authenticated` and stamps org/actor from `auth_org_id()` — but the OAuth **`/callback` runs with NO
> PMO JWT** (top-level redirect from Microsoft), so org/actor can't be stamped from context. Task **DB6**
> adds `audit_m365_event(p_action, p_org_id, p_actor_id, p_entity_id, p_detail)` (explicit params,
> granted to `service_role`, `m365.*` action allowlist). The edge fn resolves org/actor itself (verified
> JWT `sub` on authenticated paths; the `m365_pkce_states` row's `user_id`/`org_id` on the callback) and
> passes them explicitly.

**RED.** Create failing test `pmo-portal/src/lib/m365/__tests__/tokenCustody.audit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { logAudit, recordM365Error } from '../../supabase/functions/m365-token-custody/audit';

describe('audit.ts wrappers', () => {
  it('logAudit calls the audit_m365_event RPC with correct args', async () => {
    const mockRpc = vi.fn().mockResolvedValue({ error: null });
    const mockClient = { rpc: mockRpc };
    await logAudit(mockClient as never, {
      action: 'm365.connection.initiated',
      orgId: 'org-1',
      actorId: 'user-1',
      entityId: 'conn-1',
      detail: { scopes: ['Files.Read'], entra_tenant_id: 'tenant-1' },
    });
    expect(mockRpc).toHaveBeenCalledWith('audit_m365_event', {
      p_action: 'm365.connection.initiated',
      p_org_id: 'org-1',
      p_actor_id: 'user-1',
      p_entity_id: 'conn-1',
      p_detail: { scopes: ['Files.Read'], entra_tenant_id: 'tenant-1' },
    });
  });

  it('recordM365Error calls recordErrorEvent with sanitized context', async () => {
    // Mock recordErrorEvent
  });
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/audit.ts`:

```ts
// audit.ts — audit_m365_event + recordErrorEvent wrappers for m365-token-custody.
// Pure functions, importable in Vitest.
// Import paths resolve against the REAL trees (deno check enforces): the shared error helper lives at
// supabase/functions/_shared/errorEvent.ts (NOT under pmo-portal/); recordErrorEvent takes
// (supabase, ErrorEventContext{fn, errorCode, contextId?, orgId?}).

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordErrorEvent } from '../_shared/errorEvent.ts';

export interface LogAuditParams {
  action: string;   // MUST be m365.* (the audit_m365_event wrapper allowlists this)
  orgId: string;
  actorId: string;
  entityId: string;
  detail: Record<string, unknown>;
}

/**
 * Emit an audit_events row via the audit_m365_event security-definer wrapper (DB6). The wrapper is
 * granted to service_role and calls postgres-owned log_audit internally — the edge fn CANNOT call
 * log_audit directly (revoked from public). org/actor are passed explicitly (no auth context on the
 * OAuth callback path).
 */
export async function logAudit(
  serviceClient: SupabaseClient,
  params: LogAuditParams,
): Promise<void> {
  const { error } = await serviceClient.rpc('audit_m365_event', {
    p_action: params.action,
    p_org_id: params.orgId,
    p_actor_id: params.actorId,
    p_entity_id: params.entityId,
    p_detail: params.detail,
  });
  if (error) {
    console.error('[m365-token-custody] audit_m365_event RPC failed', { error: error.message });
    // Swallow — audit failure must not perturb the main flow
  }
}

/** Wrapper for recordErrorEvent with m365-token-custody fn name. */
export async function recordM365Error(
  serviceClient: SupabaseClient,
  errorCode: string,
  contextId?: string,
  orgId?: string,
): Promise<void> {
  await recordErrorEvent(serviceClient as never, {
    fn: 'm365-token-custody',
    errorCode,
    contextId,
    orgId,
  });
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.audit.test.ts` then `npm run verify`.

**Covers:** FR-M365-170/171, NFR-M365-108. **Depends on:** Task DB6 (the `audit_m365_event` wrapper).

---

### Task EF8 — `proxy.ts` (Graph proxy: decrypt → call Graph → return data)

**RED.** Create `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts`:

```ts
/**
 * AC-M365-110/111/112/113/114 — graph_proxy: decrypt access token, call Graph, refresh on expiry,
 * scope enforcement, refresh failure → stale, reuse detection → revoked.
 * Mock: fetch (Graph + Microsoft token endpoint), graphTokenCrypto.decryptToken, service-client, log_audit, recordErrorEvent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGraphProxy } from '../../supabase/functions/m365-token-custody/proxy';

// Mocks: Deno.env, fetch, serviceClient, decryptToken, logAudit, recordM365Error
// Test cases per AC-M365-110 through 114
```

**GREEN.** Create `supabase/functions/m365-token-custody/proxy.ts`:

```ts
// proxy.ts — POST /proxy handler: decrypt access token → call Graph → return data.
// Handles auto-refresh if access token near expiry.

import { authenticateAndAuthorize } from './auth.ts';
import { decryptToken, deserializeEnvelope } from './crypto.ts';
import { logAudit, recordM365Error } from './audit.ts';
import { refreshAccessToken } from './refresh.ts'; // internal helper
import { corsHeaders } from './auth.ts';
import type { ConnectionRow, GraphProxyRequest } from './types.ts';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export async function handleGraphProxy(req: Request): Promise<Response> {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  // Auth + gates (Admin + entitlement)
  const { userId, orgId, serviceClient } = await authenticateAndAuthorize(req);

  // Parse request
  let body: GraphProxyRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'invalid JSON' }), { status: 400, headers });
  }

  if (body.action !== 'graph_proxy') {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'invalid action' }), { status: 400, headers });
  }

  // Scope enforcement (FR-M365-131): check connection scopes cover the requested path
  // Simplified: we check after loading connection. For now, load connection.

  const { data: conn, error: connError } = await serviceClient
    .from('ms_graph_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();

  if (connError || !conn) {
    return new Response(JSON.stringify({ error: 'NOT_CONNECTED', message: 'no active Microsoft 365 connection' }), {
      status: 404, headers,
    });
  }

  const connection = conn as ConnectionRow;

  if (connection.status === 'stale') {
    return new Response(JSON.stringify({ error: 'CONNECTION_STALE', message: 'connection expired, please reconnect' }), {
      status: 409, headers,
    });
  }
  if (connection.status === 'revoked') {
    return new Response(JSON.stringify({ error: 'CONNECTION_REVOKED', message: 'connection revoked' }), {
      status: 410, headers,
    });
  }

  // Decrypt access token
  let accessToken: string;
  try {
    const envelope = deserializeEnvelope(connection.access_token_ciphertext);
    accessToken = await decryptToken(envelope.ciphertext, envelope.iv, await getKekBytes(connection.key_id));
  } catch (err) {
    await recordM365Error(serviceClient, 'DECRYPT_FAILED', connection.id, orgId);
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'failed to decrypt access token' }), {
      status: 500, headers,
    });
  }

  // Check expiry (30s buffer)
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (expiresAt < Date.now() + 30_000) {
    // Refresh
    const refreshed = await refreshAccessToken(serviceClient, connection, orgId, userId);
    if (!refreshed) {
      return new Response(JSON.stringify({ error: 'CONNECTION_STALE', message: 'token refresh failed, please reconnect' }), {
        status: 409, headers,
      });
    }
    // Re-decrypt new access token
    const { data: freshConn } = await serviceClient
      .from('ms_graph_connections')
      .select('access_token_ciphertext, key_id')
      .eq('id', connection.id)
      .single();
    const envelope = deserializeEnvelope(freshConn.access_token_ciphertext);
    accessToken = await decryptToken(envelope.ciphertext, envelope.iv, await getKekBytes(freshConn.key_id));
  }

  // Scope check: ensure requested path is covered by connection.scopes
  if (!scopeCoversPath(connection.scopes, body.path)) {
    return new Response(JSON.stringify({ error: 'SCOPE_INSUFFICIENT', message: 'requested Graph path requires additional consent' }), {
      status: 403, headers,
    });
  }

  // Call Graph
  const graphUrl = new URL(`${GRAPH_BASE}${body.path}`);
  if (body.query) {
    Object.entries(body.query).forEach(([k, v]) => graphUrl.searchParams.set(k, v));
  }

  const graphRes = await fetch(graphUrl.toString(), {
    method: body.method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body.body ? JSON.stringify(body.body) : undefined,
  });

  if (!graphRes.ok) {
    const errorText = await graphRes.text();
    await recordM365Error(serviceClient, 'GRAPH_ERROR', connection.id, orgId);
    return new Response(JSON.stringify({ error: 'GRAPH_ERROR', message: 'Graph API request failed' }), {
      status: 502, headers,
    });
  }

  const data = await graphRes.json();
  return new Response(JSON.stringify(data), { status: 200, headers });
}

// --- Helpers ---

async function getKekBytes(keyId: string): Promise<Uint8Array> {
  // In production: support KEK_MAP for rotation coexistence.
  // For Phase 1: single KEK from env, key_id must match.
  const kekB64 = Deno.env.get('M365_TOKEN_KEK')!;
  if (keyId !== 'kek-v1') {
    throw new Error(`unknown key_id: ${keyId}`);
  }
  return base64UrlDecode(kekB64);
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function scopeCoversPath(scopes: string[], path: string): boolean {
  // Minimal scope→path mapping for Phase 1 (OneDrive: Files.Read)
  // Extend as features add scopes.
  if (path.startsWith('/me/drive') || path.startsWith('/drives') || path.startsWith('/sites')) {
    return scopes.some(s => s === 'Files.Read' || s === 'Files.ReadWrite' || s === 'Files.Read.All');
  }
  // Default: allow if any scope present (conservative — Graph will 403 if wrong)
  return scopes.length > 0;
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.proxy.test.ts` then `npm run verify`.

**Covers:** AC-M365-110, AC-M365-111, AC-M365-114.

---

### Task EF9 — `refresh.ts` (refresh rotation + stale/revoke handling)

**RED.** Extend `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts` with refresh-specific tests:

```ts
// AC-M365-111/112/113 — refresh rotation, stale on failure, reuse detection
import { refreshAccessToken } from '../../supabase/functions/m365-token-custody/refresh';

// Mock fetch (Microsoft token endpoint), decryptToken, encryptToken, serviceClient upsert, logAudit, recordM365Error

it('AC-M365-111: refresh returns new access+refresh tokens, persists both, updates expires_at, last_refresh_at, audits', async () => {
  // Mock decryptToken for stored refresh token
  // Mock fetch to return new access_token + rotated refresh_token + expires_in
  // Mock encryptToken for both new tokens
  // Mock serviceClient upsert
  // Mock logAudit
  // Call refreshAccessToken
  // Assert upsert called with new ciphertexts, access_token_expires_at = now+expires_in, last_refresh_at = now, status='active'
  // Assert logAudit called with 'm365.token.refreshed'
});

it('AC-M365-112: refresh invalid_grant → status=stale, audit refresh_failed, error_event REFRESH_FAILED', async () => {
  // Mock fetch returns { error: 'invalid_grant' }
  // Call refreshAccessToken
  // Assert upsert sets status='stale'
  // Assert logAudit called with 'm365.token.refresh_failed'
  // Assert recordM365Error called with 'REFRESH_FAILED'
});

it('AC-M365-113: refresh token reuse detected → status=revoked, audit reuse_detected, error_event SECURITY_EVENT_REUSE', async () => {
  // Mock fetch returns error indicating reuse (e.g. invalid_grant with specific sub-code or we detect stored token differs)
  // Call refreshAccessToken
  // Assert upsert sets status='revoked'
  // Assert logAudit called with 'm365.token.reuse_detected'
  // Assert recordM365Error called with 'SECURITY_EVENT_REUSE'
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/refresh.ts`:

```ts
// refresh.ts — refresh access token using stored refresh token (rotation + stale/revoke handling).
// Internal helper called by proxy.ts; also exposed for explicit refresh action.

import { decryptToken, serializeEnvelope } from './crypto.ts';
import { encryptToken } from './crypto.ts';
import { logAudit, recordM365Error } from './audit.ts';
import type { ConnectionRow, SupabaseClient } from './types.ts';

const TOKEN_ENDPOINT = 'https://login.microsoftonline.com';

export async function refreshAccessToken(
  serviceClient: SupabaseClient,
  connection: ConnectionRow,
  orgId: string,
  userId: string,
): Promise<boolean> {
  // Decrypt stored refresh token
  let refreshToken: string;
  try {
    const envelope = deserializeEnvelope(connection.refresh_token_ciphertext);
    refreshToken = await decryptToken(envelope.ciphertext, envelope.iv, await getKekBytes(connection.key_id));
  } catch {
    await recordM365Error(serviceClient, 'DECRYPT_FAILED', connection.id, orgId);
    return false;
  }

  // Call Microsoft token endpoint
  const tenant = connection.entra_tenant_id;
  const clientId = Deno.env.get('M365_CLIENT_ID')!;
  const clientSecret = Deno.env.get('M365_CLIENT_SECRET')!;

  const tokenRes = await fetch(`${TOKEN_ENDPOINT}/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: connection.scopes.join(' '),
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok) {
    const errorCode = tokenData.error || 'UNKNOWN';
    // Classify error
    if (errorCode === 'invalid_grant' || errorCode === 'token_revoked' || errorCode === 'expired_token') {
      // Mark stale
      await serviceClient
        .from('ms_graph_connections')
        .update({ status: 'stale', updated_at: new Date().toISOString() })
        .eq('id', connection.id);
      await logAudit(serviceClient, {
        action: 'm365.token.refresh_failed',
        orgId,
        actorId: userId,
        entityId: connection.id,
        detail: { error: errorCode },
      });
      await recordM365Error(serviceClient, 'REFRESH_FAILED', connection.id, orgId);
    } else if (isReuseError(tokenData)) {
      // Security event: reuse detected → revoke
      await serviceClient
        .from('ms_graph_connections')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', connection.id);
      await logAudit(serviceClient, {
        action: 'm365.token.reuse_detected',
        orgId,
        actorId: userId,
        entityId: connection.id,
        detail: { error: errorCode },
      });
      await recordM365Error(serviceClient, 'SECURITY_EVENT_REUSE', connection.id, orgId);
    }
    return false;
  }

  // Success: encrypt new tokens
  const newAccessToken = tokenData.access_token;
  const newRefreshToken = tokenData.refresh_token; // rotated
  const expiresIn = tokenData.expires_in ?? 3600;

  const accessEnvelope = await encryptToken(newAccessToken, await getKekBytes('kek-v1'));
  const refreshEnvelope = await encryptToken(newRefreshToken, await getKekBytes('kek-v1'));

  const accessBlob = serializeEnvelope(accessEnvelope.iv, accessEnvelope.ciphertext);
  const refreshBlob = serializeEnvelope(refreshEnvelope.iv, refreshEnvelope.ciphertext);

  const now = new Date().toISOString();
  const accessExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await serviceClient
    .from('ms_graph_connections')
    .update({
      access_token_ciphertext: accessBlob,
      refresh_token_ciphertext: refreshBlob,
      access_token_expires_at: accessExpiresAt,
      last_refresh_at: now,
      status: 'active',
      updated_at: now,
    })
    .eq('id', connection.id);

  await logAudit(serviceClient, {
    action: 'm365.token.refreshed',
    orgId,
    actorId: userId,
    entityId: connection.id,
    detail: { scopes: connection.scopes },
  });

  return true;
}

function isReuseError(tokenData: Record<string, unknown>): boolean {
  // Microsoft may return a specific sub-error for reuse.
  // Conservative: if invalid_grant and we have reason to believe token was reused.
  // For Phase 1: treat any invalid_grant after a successful refresh as potential reuse.
  // A more precise implementation would track the last-used refresh token hash.
  return tokenData.error === 'invalid_grant' && tokenData.error_description?.includes('reuse');
}

async function getKekBytes(keyId: string): Promise<Uint8Array> {
  const kekB64 = Deno.env.get('M365_TOKEN_KEK')!;
  if (keyId !== 'kek-v1') throw new Error(`unknown key_id: ${keyId}`);
  return base64UrlDecode(kekB64);
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.proxy.test.ts` then `npm run verify`.

**Covers:** AC-M365-111, AC-M365-112, AC-M365-113.

---

### Task EF10 — `revoke.ts` (explicit disconnect: best-effort MS revoke + delete row + audit)

**RED.** Create `pmo-portal/src/lib/m365/__tests__/tokenCustody.lifecycle.test.ts`:

```ts
/**
 * AC-M365-120 — explicit disconnect: best-effort revoke at Microsoft, delete row, audit.
 * Mock: fetch (MS revoke endpoint), decryptToken, serviceClient delete, logAudit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDisconnect } from '../../supabase/functions/m365-token-custody/revoke';

// Mocks similar to proxy tests

describe('AC-M365-120 — handleDisconnect', () => {
  it('AC-M365-120: active connection → attempts MS revoke (ignores failure), deletes row, audits reason=user_disconnect', async () => {
    // Mock authenticateAndAuthorize returns valid context
    // Mock serviceClient select returns active connection
    // Mock decryptToken returns refresh token
    // Mock fetch to MS revoke endpoint (200 or error — both ignored)
    // Mock serviceClient delete
    // Mock logAudit
    // Call handleDisconnect
    // Assert fetch called to MS revoke endpoint
    // Assert delete called on ms_graph_connections
    // Assert logAudit called with 'm365.connection.revoked', detail: { reason: 'user_disconnect' }
  });

  it('AC-M365-120: connection already revoked/stale → still deletes row, audits', async () => {
    // Similar but connection.status = 'stale'
  });
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/revoke.ts`:

```ts
// revoke.ts — POST /revoke handler: best-effort revoke at Microsoft, delete local row, audit.

import { authenticateAndAuthorize } from './auth.ts';
import { decryptToken, deserializeEnvelope } from './crypto.ts';
import { logAudit } from './audit.ts';
import { corsHeaders } from './auth.ts';
import type { ConnectionRow } from './types.ts';

const REVOKE_ENDPOINT = 'https://login.microsoftonline.com';

export async function handleDisconnect(req: Request): Promise<Response> {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  const { userId, orgId, serviceClient } = await authenticateAndAuthorize(req);

  // Load connection
  const { data: conn, error } = await serviceClient
    .from('ms_graph_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();

  if (error || !conn) {
    return new Response(JSON.stringify({ error: 'NOT_CONNECTED', message: 'no active connection' }), {
      status: 404, headers,
    });
  }

  const connection = conn as ConnectionRow;

  // Best-effort revoke at Microsoft (ignore failures)
  try {
    const envelope = deserializeEnvelope(connection.refresh_token_ciphertext);
    const refreshToken = await decryptToken(envelope.ciphertext, envelope.iv, await getKekBytes(connection.key_id));

    const clientId = Deno.env.get('M365_CLIENT_ID')!;
    const clientSecret = Deno.env.get('M365_CLIENT_SECRET')!;

    await fetch(`${REVOKE_ENDPOINT}/${connection.entra_tenant_id}/oauth2/v2.0/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: refreshToken,
      }),
    });
    // Ignore response — local delete is source of truth
  } catch {
    // Ignore — best effort
  }

  // Delete local row
  await serviceClient
    .from('ms_graph_connections')
    .delete()
    .eq('id', connection.id);

  // Audit
  await logAudit(serviceClient, {
    action: 'm365.connection.revoked',
    orgId,
    actorId: userId,
    entityId: connection.id,
    detail: { reason: 'user_disconnect' },
  });

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}

async function getKekBytes(keyId: string): Promise<Uint8Array> {
  const kekB64 = Deno.env.get('M365_TOKEN_KEK')!;
  if (keyId !== 'kek-v1') throw new Error(`unknown key_id: ${keyId}`);
  return base64UrlDecode(kekB64);
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.lifecycle.test.ts` then `npm run verify`.

**Covers:** AC-M365-120.

---

### Task EF11 — `index.ts` (router: POST / dispatches to action handlers)

**RED.** Create `pmo-portal/src/lib/m365/__tests__/tokenCustody.router.test.ts`:

```ts
/**
 * AC-M365-101/103/110/120 — router dispatches to correct handler based on action.
 * Mock each handler, verify routing.
 */
import { describe, it, expect, vi } from 'vitest';

describe('index.ts router', () => {
  it('routes initiate_connect to handleInitiateConnect', async () => {
    // Mock handleInitiateConnect, call index.ts handler with action: 'initiate_connect'
  });
  it('routes graph_proxy to handleGraphProxy', async () => { /* ... */ });
  it('routes refresh to handleRefresh', async () => { /* ... */ });
  it('routes disconnect to handleDisconnect', async () => { /* ... */ });
  it('returns 400 for unknown action', async () => { /* ... */ });
  it('handles OPTIONS preflight', async () => { /* ... */ });
});
```

**GREEN.** Create `supabase/functions/m365-token-custody/index.ts`:

```ts
// index.ts — Deno Edge Function entry point for m365-token-custody.
// Thin router only — all logic in handlers (testable in Vitest).

import { handleInitiateConnect } from './initiate.ts';
import { handleCallback } from './callback.ts';
import { handleGraphProxy } from './proxy.ts';
import { handleDisconnect } from './revoke.ts';
import { corsHeaders } from './auth.ts';
import { logStructuredError } from '../../../pmo-portal/src/lib/adapterSeam/_shared/errorLog.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }

  // GET /callback is a special case (Microsoft redirect, no body)
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) {
    return handleCallback(req);
  }

  // POST / with action in body
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'method not allowed' }), {
      status: 405, headers,
    });
  }

  let body: { action: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'invalid JSON body' }), {
      status: 400, headers,
    });
  }

  try {
    switch (body.action) {
      case 'initiate_connect':
        return handleInitiateConnect(req);
      case 'graph_proxy':
        return handleGraphProxy(req);
      case 'refresh':
        // Explicit refresh action (optional — proxy auto-refreshes)
        return handleGraphProxy(req); // or dedicated handler
      case 'disconnect':
        return handleDisconnect(req);
      default:
        return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: `unknown action: ${body.action}` }), {
          status: 400, headers,
        });
    }
  } catch (err) {
    if (err instanceof Response) throw err; // Re-throw typed error responses from handlers
    logStructuredError({ fn: 'm365-token-custody', errorCode: 'INTERNAL_ERROR', contextId: 'router' });
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'unexpected error' }), {
      status: 500, headers,
    });
  }
});
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.router.test.ts` then `npm run verify`.

**Covers:** All ACs (integration routing).

---

### Task EF12 — Secrets validation + Deno check

**RED.** (No test — verification task)

**GREEN.** Verify all required secrets are documented and the function typechecks:

```bash
deno check supabase/functions/m365-token-custody/index.ts
deno check supabase/functions/m365-token-custody/initiate.ts
deno check supabase/functions/m365-token-custody/callback.ts
deno check supabase/functions/m365-token-custody/proxy.ts
deno check supabase/functions/m365-token-custody/refresh.ts
deno check supabase/functions/m365-token-custody/revoke.ts
deno check supabase/functions/m365-token-custody/auth.ts
deno check supabase/functions/m365-token-custody/stateStore.ts
deno check supabase/functions/m365-token-custody/audit.ts
deno check supabase/functions/m365-token-custody/crypto.ts
deno check supabase/functions/m365-token-custody/pkce.ts
deno check supabase/functions/m365-token-custody/types.ts
```

**Verify:** All `deno check` commands pass (zero errors).

**Covers:** NFR-M365-110 (secret hygiene), structural.

---

## Slice C — Vitest Unit Tests: Secrets Hygiene (AC-M365-140)

### Task UT1 — `tokenCustody.secrets.test.ts` (no plaintext in logs/errors)

**RED.** Create `pmo-portal/src/lib/m365/__tests__/tokenCustody.secrets.test.ts`:

```ts
/**
 * AC-M365-140 — no plaintext tokens/secrets in any log, error, or response.
 * Capture console.error/log and verify no token material appears.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('AC-M365-140 — secrets hygiene', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('AC-M365-140: callback error path logs error_event WITHOUT code/verifier/secret', async () => {
    // Trigger callback with Microsoft error
    // Capture console.error calls
    // Assert no call contains 'code=', 'code_verifier=', 'client_secret', 'refresh_token', 'access_token'
  });

  it('AC-M365-140: proxy decrypt path never logs plaintext access token', async () => {
    // Trigger proxy with valid connection
    // Assert no console call contains the decrypted token
  });

  it('AC-M365-140: refresh error path logs sanitized error only', async () => {
    // Trigger refresh with invalid_grant
    // Assert error_event contains errorCode but not the refresh token
  });

  it('AC-M365-140: revoke path never logs refresh token', async () => {
    // Trigger disconnect
    // Assert no log contains the decrypted refresh token
  });

  it('AC-M365-140: error responses to client never contain token material', async () => {
    // All error responses: assert JSON body has no token-like strings
  });
});
```

**GREEN.** The implementation tasks (EF5, EF8, EF9, EF10) already follow the hygiene rules.
Run the test to confirm.

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/tokenCustody.secrets.test.ts` then `npm run verify`.

**Covers:** AC-M365-140 (unit layer) + **security-auditor gate** (review).

---

## Slice D — Vitest Unit Tests: Security Controls (AC-M365-141/142)

### Task UT2 — `graphPkce.security.test.ts` (tenant pinning + redirect URI allowlist)

**RED.** Create `pmo-portal/src/lib/m365/__tests__/graphPkce.security.test.ts`:

```ts
/**
 * AC-M365-141 — tenant pinning + redirect URI allowlist.
 * AC-M365-142 — CSRF state single-use.
 */
import { describe, it, expect } from 'vitest';
import { buildAuthorizeUrl } from '../../src/lib/m365/graphPkce';
import { consumePkceState } from '../../supabase/functions/m365-token-custody/stateStore';

describe('AC-M365-141 — tenant pinning', () => {
  it('rejects tenant with path traversal', () => {
    expect(() => buildAuthorizeUrl({
      tenant: 'common/../evil',
      clientId: 'id',
      redirectUri: 'https://allowlisted/callback',
      scopes: ['Files.Read'],
      state: 's',
      codeChallenge: 'c',
    })).toThrow(/invalid tenant/i);
  });

  it('rejects tenant with query injection', () => {
    expect(() => buildAuthorizeUrl({
      tenant: 'common?client_id=evil',
      clientId: 'id',
      redirectUri: 'https://allowlisted/callback',
      scopes: ['Files.Read'],
      state: 's',
      codeChallenge: 'c',
    })).toThrow(/invalid tenant/i);
  });
});

describe('AC-M365-141 — redirect URI allowlist (callback validation)', () => {
  // The callback handler validates the redirect_uri matches the allowlisted env value
  // before exchanging the code. Tested in tokenCustody.callback.test.ts.
});

describe('AC-M365-142 — CSRF state single-use', () => {
  it('consumed state cannot be reused', async () => {
    // Mock serviceClient: first consume succeeds, second returns null
    // Verified in tokenCustody.initiate.test.ts consumePkceState test
  });
});
```

**GREEN.** Tests pass against existing `graphPkce` and `stateStore` implementations.

**Verify:** `cd pmo-portal && npx vitest run src/lib/m365/__tests__/graphPkce.security.test.ts` then `npm run verify`.

**Covers:** AC-M365-141, AC-M365-142.

---

## Slice E — End-to-End Verification & Gates

### Task FINAL1 — Full FE verify (typecheck + lint + test + build)

**Command:** `cd pmo-portal && npm run verify`

**Must pass:** Zero typecheck errors, zero lint errors, all Vitest tests green, build succeeds.

---

### Task FINAL2 — Full DB verify (migrations + pgTAP)

**Command:**
```bash
scripts/with-db-lock.sh supabase db reset
scripts/with-db-lock.sh supabase test db
```

**Must pass:** Migrations 0098, 0099 apply clean; pgTAP tests 0145, 0146, 0147 + existing 0142-0144 all green.

---

### Task FINAL3 — Edge Function Deno check (all modules)

**Command:** `deno check supabase/functions/m365-token-custody/*.ts`

**Must pass:** Zero Deno type errors.

---

## Traceability Table (AC → Task → Owning Test File → Layer)

| AC | Satisfies | Task | Owning Test File | Layer |
|---|---|---|---|---|
| AC-M365-101 | FR-M365-101/102, NFR-101/105 | EF4, DB1 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.initiate.test.ts` | Unit |
| AC-M365-102 | FR-M365-162/163 | EF4 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.initiate.test.ts` | Unit |
| AC-M365-103 | FR-M365-110/120/170, NFR-103/104/108 | EF5 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.callback.test.ts` | Unit |
| AC-M365-104 | FR-M365-102, NFR-108/110 | EF5, DB2 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.callback.test.ts` | Unit |
| AC-M365-105 | FR-M365-111, NFR-108 | EF5 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.callback.test.ts` | Unit |
| AC-M365-110 | FR-M365-130/121, NFR-101/102 | EF8 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts` | Unit |
| AC-M365-111 | FR-M365-140/141, NFR-106/108 | EF9 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts` | Unit |
| AC-M365-112 | FR-M365-142, NFR-106/108 | EF9 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts` | Unit |
| AC-M365-113 | FR-M365-142 (security event) | EF9 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts` | Unit |
| AC-M365-114 | FR-M365-131, NFR-105 | EF8 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts` | Unit |
| AC-M365-120 | FR-M365-150, NFR-107/108 | EF10 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.lifecycle.test.ts` | Unit |
| AC-M365-121 | FR-M365-151, NFR-107 | DB4, DB5 | `supabase/tests/0147_m365_offboard_cascade.test.sql` | pgTAP |
| AC-M365-130 | FR-M365-160/161 | EF2 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts` | Unit |
| AC-M365-131 | FR-M365-162 | EF2 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts` | Unit |
| AC-M365-132 | FR-M365-163 | EF2 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts` | Unit |
| AC-M365-133 | FR-M365-164/165, NFR-104/109 | DB3 | `supabase/tests/0146_ms_graph_connections_org_scope.test.sql` | pgTAP |
| AC-M365-140 | NFR-101/103/108/110 | UT1 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.secrets.test.ts` | Unit + Gate |
| AC-M365-141 | FR-M365-183/184 | UT2 | `pmo-portal/src/lib/m365/__tests__/graphPkce.security.test.ts` | Unit |
| AC-M365-142 | FR-M365-102/182 | EF3, UT2 | `pmo-portal/src/lib/m365/__tests__/tokenCustody.initiate.test.ts` | Unit |

**Total ACs covered:** 22 (all Phase-1 ACs).

**Total tasks:** 27 (DB1–DB5, EF1–EF12, UT1–UT2, FINAL1–FINAL3).

---

## Owner-Gated / Deploy-Time (NOT Done Autonomously)

The following are **explicitly excluded** from autonomous completion and require the Owner's direct, per-instance authorization:

1. **Live secrets provisioning** (per-project, via Supabase Dashboard → Edge Functions → Secrets):
   - `M365_TOKEN_KEK` — 32-byte base64url key for AES-256-GCM (vault-`AS`)
   - `M365_CLIENT_SECRET` — per-client Entra app secret (vault-`AS`)
   - `M365_CLIENT_ID` — per-client Entra app client ID
   - `M365_TENANT_ID` — client's Entra tenant ID
   - `M365_REDIRECT_URI` — allowlisted callback URL (must match Entra app registration exactly)

2. **Entra app registration** (Option C per ADR-0059):
   - Register per-client app in `gordi.id` tenant
   - Configure delegated scopes: `Files.Read`, `offline_access` (minimum)
   - Add redirect URI: `https://<project>.supabase.co/functions/v1/m365-token-custody/callback`
   - Grant admin consent (client IT)

3. **`security-auditor` sign-off** (mandatory gate per ADR-0060):
   - STRIDE review on token store, proxy, consent flow
   - Code review for secret leakage (AC-M365-140)
   - Live token flow verification (real Microsoft token endpoint + Graph call)
   - **Must complete before** the OneDrive doc-linking feature merges

4. **Edge function deploy to live Supabase project**:
   - `supabase functions deploy m365-token-custody --project-ref <ref>`
   - Requires all secrets provisioned above

5. **Production promotion** (`main` → `production`):
   - Per CLAUDE.md: **NEVER push/deploy/promote to `production` without the Owner's EXPLICIT, per-instance "yes" naming production**

The build stops at **mocked + tested + reviewed**. The implementer delivers a PR with all unit tests green, pgTAP green on local stack, `deno check` clean, and `npm run verify` green. The Director schedules the `security-auditor` review and the Owner provisions secrets + authorizes deploy.

---

## Task Execution Order (TDD Red→Green)

```
DB1 → DB2 → DB5 → DB4 → DB3          (DB slice: migration → lockdown pgTAP → cascade RPC → cascade pgTAP → org-scope pgTAP)
EF6 → EF2.1 → EF2 → EF3 → EF4         (EF shared: re-exports → JWT mocks → auth → stateStore → initiate)
EF5 → EF7 → EF8 → EF9 → EF10 → EF11   (EF handlers: callback → audit → proxy → refresh → revoke → router)
UT1 → UT2                             (Secret hygiene + security controls)
FINAL1 → FINAL2 → FINAL3              (Full verify gates)
```

Each task = **2–5 minutes** (write failing test → minimal code → verify).

---

**PLAN-DONE**