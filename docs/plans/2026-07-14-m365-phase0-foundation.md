# Implementation plan — Microsoft 365 integration Phase 0 (shared foundation)

- **Spec:** [`docs/specs/m365-phase0-foundation.spec.md`](../specs/m365-phase0-foundation.spec.md)
- **ADRs:** 0058 (architecture), 0059 (Entra topology), **0060 (token custody — the ten controls)**,
  0049 (two-switch entitlement), 0055/0089/0087 (adapter/seam patterns), 0001 (org_id seam),
  0076 (audit_events), 0010 (test pyramid).
- **Date:** 2026-07-14 · **Author:** eng-planner (Opus 4.8).
- **Build order:** TDD red→green throughout. Every behavior task writes the failing test first, then
  the minimum code to green, then `verify`.

---

## ⚑ CRITICAL environment caveat — read before starting

**This remote container has NO Supabase CLI and NO local Postgres.** Therefore:

- **DB tasks (M1–M4: the two migrations + three pgTAP files) are AUTHORED here but CANNOT be verified
  here.** They MUST be verified by the owner/Director on return, from the repo root, with the shared-DB
  lock:
  ```
  scripts/with-db-lock.sh supabase db reset
  scripts/with-db-lock.sh supabase test db
  ```
  Do **not** mark M1–M4 "green" in this environment — mark them **AUTHORED / DB-deferred**.
- **FE tasks (F1–F5) are FULLY verifiable now** from `pmo-portal/` with:
  ```
  npm run verify        # typecheck && lint:ci && test && build (the binding pre-push gate)
  ```
  Inner-loop, a single FE task may run `npx vitest run <file>` — but the phase gate is the full
  `npm run verify` (CLAUDE.md pre-push rule: targeted runs miss cross-component breakage).

**Sequencing is deliberately FE-first and DB-separable.** The FE Integrations surface is testable now
with a **mocked** entitlement (`useFeature`) and needs no DB. The DB slices (store + CHECK-registry
expansion + pgTAP) are self-contained and land after, verified by the owner. The FE registry change
(F1) adds the `m365_integration` key the DB CHECK (M3) will accept — the two agree by construction but
neither blocks the other's authoring.

**Two flagged sub-decisions (spec §6) do NOT block this plan.** D1 (encryption mechanism) and D2
(bootstrap flow) are consumed by the Phase-1 exchange edge function, not by anything built here. The
Phase-0 store is designed to accept either choice (`refresh_token_ciphertext bytea` + `key_id` KEK
reference are mechanism-agnostic).

---

## Slice A — FE (verifiable now via `npm run verify`)

### Task F1 — Register the `m365_integration` entitlement key (RED then GREEN)

**RED.** Create `pmo-portal/src/auth/__tests__/useFeature.m365.test.tsx`:

```tsx
/**
 * AC-M365-011 — the m365_integration entitlement resolves default-OFF, ON when entitled.
 * Default-off (env default false) is what keeps the integration hidden until an Operator entitles it.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { featuresState } = vi.hoisted(() => ({
  featuresState: { value: {} as Record<string, boolean | undefined> },
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: featuresState.value }),
}));

import { useFeature } from '../useFeature';

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

describe('AC-M365-011 — m365_integration entitlement resolution', () => {
  it('AC-M365-011: default-OFF when the org has no org_features row', () => {
    featuresState.value = {};
    const { result } = renderHook(() => useFeature('m365_integration'), { wrapper: makeWrapper() });
    expect(result.current).toBe(false);
  });

  it('AC-M365-011: ON when the org has the m365_integration row enabled', () => {
    featuresState.value = { m365_integration: true };
    const { result } = renderHook(() => useFeature('m365_integration'), { wrapper: makeWrapper() });
    expect(result.current).toBe(true);
  });
});
```

This fails to typecheck (`'m365_integration'` is not an `EntitleableKey` yet).

**GREEN.** Edit `pmo-portal/src/lib/features.ts` — add the key to all four registry structures:

- In `FEATURE_KEYS` (after `'user_views'`): add `'m365_integration'`.
- In `FEATURE_KEYS_TOGGLEABLE` (after `'import_export'`): add `'m365_integration'` (takes immediate
  UI effect via `useFeature` — it gates the Integrations card, not an env-only sub-flag).
- In `FEATURE_ENV_DEFAULT`: add `m365_integration: false,` (default-OFF — hidden until entitled).
- In `FEATURE_LABELS`: add `m365_integration: 'Microsoft 365 integration',`.

**Verify:** `cd pmo-portal && npx vitest run src/auth/__tests__/useFeature.m365.test.tsx`
(green), then the phase gate `npm run verify`.
**Covers:** AC-M365-011 (FR-M365-010). **Note:** this key now auto-appears in Administration →
Features as an Operator switch / org-Admin pill via the existing `AdministrationFeatures` map over
`FEATURE_KEYS_TOGGLEABLE` — **no code change needed there.** `npm run verify` catches any count-based
Administration test that needs its expected label list widened.

---

### Task F2 — M365 connection card component (RED then GREEN)

**RED.** Create `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`:

```tsx
/**
 * AC-M365-012 — the Microsoft 365 activation card obeys the two-switch gate (entitlement + Admin).
 * AC-M365-013 — while live connect is HELD, the card is a disabled "available soon" stub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const { featureState } = vi.hoisted(() => ({ featureState: { value: false } }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => featureState.value }));

import { M365ConnectionCard } from '../M365ConnectionCard';

beforeEach(() => { featureState.value = false; });

describe('AC-M365-012 — activation card visibility (two-switch: entitlement + Admin)', () => {
  it('AC-M365-012: hidden when the org is NOT entitled', () => {
    featureState.value = false;
    const { container } = render(<M365ConnectionCard isAdmin />);
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-M365-012: hidden when entitled but the viewer is NOT Admin', () => {
    featureState.value = true;
    const { container } = render(<M365ConnectionCard isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-M365-012: rendered when entitled AND Admin', () => {
    featureState.value = true;
    render(<M365ConnectionCard isAdmin />);
    expect(screen.getByTestId('m365-connection-card')).toBeInTheDocument();
  });
});

describe('AC-M365-013 — held connect affordance is a disabled available-soon stub', () => {
  it('AC-M365-013: shows Not connected and a disabled connect button', () => {
    featureState.value = true;
    render(<M365ConnectionCard isAdmin />);
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /connect microsoft 365/i });
    expect(btn).toBeDisabled();
  });
});
```

Fails (`M365ConnectionCard` does not exist).

**GREEN.** Create `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`:

```tsx
import React from 'react';
import { Card, Icon } from '@/src/components/ui';
import { useFeature } from '@/src/auth/useFeature';

/**
 * M365ConnectionCard — the org-Admin ACTIVATION surface for the Microsoft 365 integration
 * (m365-phase0-foundation, FR-M365-012/013; ADR-0058 two-switch model, ADR-0060 token custody).
 *
 * Rendered ONLY when the org is ENTITLED (`useFeature('m365_integration')`, the Operator switch)
 * AND the viewer is an Admin (`isAdmin`, the real-JWT-role gate — ADR-0016; RLS is the real
 * authority). Live OAuth connect is HELD in Phase 0 (owner sub-decisions D1/D2 + a security-auditor
 * gate, ADR-0060 Phase-0 follow-ups), so the connect affordance is a DISABLED "available soon" stub
 * that initiates no OAuth flow and no navigation.
 */
export const M365ConnectionCard: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const entitled = useFeature('m365_integration');
  if (!entitled || !isAdmin) return null;
  return (
    <Card className="p-4" data-testid="m365-connection-card">
      <div className="flex items-center gap-2">
        <Icon name="plug" />
        <h3 className="text-[15px] font-semibold text-foreground">Microsoft 365</h3>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Not connected. Link your Microsoft 365 tenant to bring OneDrive documents, Teams, and
        calendar into your projects.
      </p>
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="mt-3 inline-flex h-8 items-center rounded-md border border-border bg-secondary px-3 text-sm font-semibold text-muted-foreground"
      >
        Connect Microsoft 365 — available soon
      </button>
    </Card>
  );
};

export default M365ConnectionCard;
```

**Verify:** `cd pmo-portal && npx vitest run src/components/integrations/__tests__/M365ConnectionCard.test.tsx`
then `npm run verify`.
**Covers:** AC-M365-012, AC-M365-013 (FR-M365-012/013).

---

### Task F3 — Mount the card in the Administration → Integrations section (wiring)

Edit `pmo-portal/pages/AdminUsers.tsx`:

1. Add the import beside the existing `IntegrationsView` import (line ~36):
   ```tsx
   import { M365ConnectionCard } from '@/src/components/integrations/M365ConnectionCard';
   ```
2. Inside the existing Integrations section block (the `<div className="mt-6">` that holds
   `<SectionHeader title="Integrations" />` and `<IntegrationsView />`, line ~467), render the card
   **above** `<IntegrationsView />`, gated on the Admin real-role permission already computed on the
   page (`canManage = may('edit', 'user')`, Admin-only):
   ```tsx
   <M365ConnectionCard isAdmin={canManage} />
   <IntegrationsView />
   ```
   (Add a `className="mb-3.5"` wrapper or leave the card's own spacing — the card returns `null` when
   not entitled/not Admin, so it adds nothing for other viewers.)

**Verify:** `cd pmo-portal && npm run verify` (typecheck + full test + build). No new AC test — this is
wiring; **AC-M365-012 is owned by the F2 component test**. The Administration page's own tests plus
typecheck confirm the mount compiles and renders without regressions.
**Covers:** FR-M365-012 (in-context realization; behavior AC owned by F2).

---

## Slice B — DB (AUTHORED here; **owner verifies on return** — see caveat)

### Task M1 — `ms_graph_connections` migration (token store + lockdown)

Create `supabase/migrations/0096_ms_graph_connections.sql`:

```sql
-- 0096_ms_graph_connections.sql — the Microsoft Graph token store (ADR-0060, FR-M365-001..004).
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
```

**Verify (owner, on return):** `scripts/with-db-lock.sh supabase db reset` (applies clean), then M2's
pgTAP. **AUTHORED / DB-deferred** here.
**Covers:** FR-M365-001/002/003/004, NFR-M365-003/004 (structural).

---

### Task M2 — pgTAP: token-store lockdown (RED proof for AC-M365-001)

Create `supabase/tests/0142_ms_graph_connections_lockdown.test.sql`:

```sql
-- 0142_ms_graph_connections_lockdown.test.sql
-- AC-M365-001 [pgTAP]: ms_graph_connections is server-only — RLS enabled+forced, ZERO policies, and
-- an authenticated (non-service_role) JWT is denied SELECT/INSERT/UPDATE (FR-M365-002, NFR-M365-004).
begin;
select plan(6);

insert into organizations (id, name) values
  ('01420000-0000-0000-0000-000000000001','AC-M365-001 Org');
insert into auth.users (id, email) values
  ('01420000-0000-0000-0000-0000000000a1','m365-lockdown@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01420000-0000-0000-0000-0000000000a1','01420000-0000-0000-0000-000000000001','M365 User','m365-lockdown@example.com','Admin');

-- Seed a connection AS THE TABLE OWNER (the service_role/edge-fn write path bypasses RLS).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id)
values
  ('01420000-0000-0000-0000-000000000001','01420000-0000-0000-0000-0000000000a1',
   'tid-1', array['offline_access','Files.Read'], '\x00'::bytea, 'kek-v1');

select is((select relrowsecurity   from pg_class where oid = 'public.ms_graph_connections'::regclass),
          true, 'AC-M365-001 RLS is enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ms_graph_connections'::regclass),
          true, 'AC-M365-001 RLS is forced');
select is((select count(*)::int from pg_policies
             where schemaname = 'public' and tablename = 'ms_graph_connections'),
          0, 'AC-M365-001 the table has ZERO policies (no client-readable policy)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01420000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select * from public.ms_graph_connections $$,
  '42501', null, 'AC-M365-001 authenticated SELECT denied (no grant, no policy)');
select throws_ok(
  $$ insert into public.ms_graph_connections (org_id,user_id,entra_tenant_id,refresh_token_ciphertext,key_id)
     values ('01420000-0000-0000-0000-000000000001','01420000-0000-0000-0000-0000000000a1','t','\x00'::bytea,'k') $$,
  '42501', null, 'AC-M365-001 authenticated INSERT denied');
select throws_ok(
  $$ update public.ms_graph_connections set status = 'revoked' $$,
  '42501', null, 'AC-M365-001 authenticated UPDATE denied');

reset role;
select * from finish();
rollback;
```

**Verify (owner):** `scripts/with-db-lock.sh supabase test db`. **AUTHORED / DB-deferred.**
**Covers:** AC-M365-001.

---

### Task M3 — pgTAP: token-store schema invariants (AC-M365-002)

Create `supabase/tests/0143_ms_graph_connections_schema.test.sql`:

```sql
-- 0143_ms_graph_connections_schema.test.sql
-- AC-M365-002 [pgTAP]: token columns are ciphertext (bytea), NO plaintext token column exists, the
-- KEK-reference + scopes metadata are present, and the status CHECK rejects a bad value (FR-M365-001/003,
-- NFR-M365-003 structural).
begin;
select plan(6);

select col_type_is('public','ms_graph_connections','refresh_token_ciphertext','bytea',
  'AC-M365-002 refresh token stored as bytea ciphertext');
select col_type_is('public','ms_graph_connections','access_token_ciphertext','bytea',
  'AC-M365-002 access token stored as bytea ciphertext');
select is(
  (select count(*)::int from information_schema.columns
     where table_schema = 'public' and table_name = 'ms_graph_connections'
       and column_name like '%token%' and data_type = 'text'),
  0, 'AC-M365-002 no text-typed *token* column (no plaintext token at rest)');
select has_column('public','ms_graph_connections','key_id',
  'AC-M365-002 key_id (KEK reference) column present');
select has_column('public','ms_graph_connections','scopes',
  'AC-M365-002 scopes column present');

insert into organizations (id, name) values
  ('01430000-0000-0000-0000-000000000001','AC-M365-002 Org');
insert into auth.users (id, email) values
  ('01430000-0000-0000-0000-0000000000a1','m365-schema@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01430000-0000-0000-0000-0000000000a1','01430000-0000-0000-0000-000000000001','S','m365-schema@example.com','Admin');
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id,user_id,entra_tenant_id,refresh_token_ciphertext,key_id,status)
     values ('01430000-0000-0000-0000-000000000001','01430000-0000-0000-0000-0000000000a1',
             't','\x00'::bytea,'k','bogus') $$,
  '23514', null, 'AC-M365-002 status CHECK rejects an unknown value');

select * from finish();
rollback;
```

**Verify (owner):** `scripts/with-db-lock.sh supabase test db`. **AUTHORED / DB-deferred.**
**Covers:** AC-M365-002.

---

### Task M4 — Migration: add `m365_integration` to the `org_features` CHECK registry

Create `supabase/migrations/0097_org_features_add_m365.sql`:

```sql
-- 0097_org_features_add_m365.sql — extend the org_features CHECK registry (0070) with the
-- 'm365_integration' entitlement key (ADR-0058 §Decision 3 two-switch; FR-M365-010). Operator-owned
-- entitlement switch; toggled via the EXISTING operator_toggle_feature RPC (no new RPC). Default-OFF
-- is an FE concern (FEATURE_ENV_DEFAULT.m365_integration=false) — absence of a row + env default false
-- keeps the integration hidden until an Operator entitles it. The inline CHECK from 0070 is auto-named
-- org_features_feature_key_check; drop+recreate to widen it.
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   alter table public.org_features drop constraint org_features_feature_key_check;
--   alter table public.org_features add constraint org_features_feature_key_check
--     check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
--                            'agent_assistant','user_views'));

alter table public.org_features drop constraint org_features_feature_key_check;
alter table public.org_features add constraint org_features_feature_key_check
  check (feature_key in ('incidents','crm','procurement','timesheets','import_export',
                         'agent_assistant','user_views','m365_integration'));
```

> **Owner note on constraint name:** the 0070 inline `check (feature_key in (...))` is auto-named
> `org_features_feature_key_check` by Postgres. Confirm with `\d public.org_features` after
> `supabase db reset`; if the local instance named it differently, adjust the `drop constraint` line
> to the actual name before re-running.

**Verify (owner):** `scripts/with-db-lock.sh supabase db reset` then M5's pgTAP.
**AUTHORED / DB-deferred.**
**Covers:** FR-M365-010, FR-M365-011.

---

### Task M5 — pgTAP: Operator can entitle `m365_integration` (AC-M365-010)

Create `supabase/tests/0144_org_features_m365_key.test.sql`:

```sql
-- 0144_org_features_m365_key.test.sql
-- AC-M365-010 [pgTAP]: the m365_integration entitlement is Operator-togglable via the existing
-- operator_toggle_feature RPC (the CHECK registry accepts it), and a non-Operator is denied
-- (FR-M365-010/011). Mirrors 0127/0122.
begin;
select plan(3);

insert into organizations (id, name) values
  ('01440000-0000-0000-0000-000000000001','AC-M365-010 Org');
insert into auth.users (id, email) values
  ('01440000-0000-0000-0000-0000000000f1','m365-op@example.com'),
  ('01440000-0000-0000-0000-0000000000a1','m365-ad@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01440000-0000-0000-0000-0000000000f1','01440000-0000-0000-0000-000000000001','Op','m365-op@example.com','Admin'),
  ('01440000-0000-0000-0000-0000000000a1','01440000-0000-0000-0000-000000000001','Ad','m365-ad@example.com','Admin');
insert into platform_operators (user_id) values ('01440000-0000-0000-0000-0000000000f1');

-- (a) Operator enables m365_integration → row persists enabled=true (proves the CHECK accepts it).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01440000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_toggle_feature('01440000-0000-0000-0000-000000000001','m365_integration',true) $$,
  'AC-M365-010 Operator enables m365_integration (CHECK registry accepts the key)');
select is(
  (select enabled from public.org_features
     where org_id = '01440000-0000-0000-0000-000000000001' and feature_key = 'm365_integration'),
  true, 'AC-M365-010 the m365_integration entitlement row persisted enabled=true');
reset role;

-- (b) A non-Operator org-Admin calling the same RPC is denied 42501.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01440000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.operator_toggle_feature('01440000-0000-0000-0000-000000000001','m365_integration',true) $$,
  '42501', null, 'AC-M365-010 a non-Operator is denied toggling the entitlement');
reset role;

select * from finish();
rollback;
```

**Verify (owner):** `scripts/with-db-lock.sh supabase test db`. **AUTHORED / DB-deferred.**
**Covers:** AC-M365-010.

---

## Slice C — provisioning regression pin (verifiable now)

### Task P1 — Confirm the not-provisioned graceful state is unchanged (no code)

FR-M365-020 pins the shipped behavior; it adds **no** new test (owning test is the existing
AC-MSAUTH-010/011 in `pmo-portal/src/auth/RequireAuth.test.tsx`). This task is a **verification-only**
checkpoint: run `cd pmo-portal && npx vitest run src/auth/RequireAuth.test.tsx` and confirm the
not-provisioned card + Sign out (no Retry, no auto-provision) still passes. Do **not** edit
`RequireAuth.tsx`. The invite-first-vs-JIT decision (D3) stays open for a later issue.

**Verify:** `cd pmo-portal && npx vitest run src/auth/RequireAuth.test.tsx` (green, unchanged).
**Covers:** FR-M365-020 (regression pin; AC-M365-020 owned by existing AC-MSAUTH-010/011).

---

## Task summary & order

| # | Task | Files | Layer | Verify | AC |
|---|---|---|---|---|---|
| F1 | Register `m365_integration` key | `features.ts` + `useFeature.m365.test.tsx` | unit | `npm run verify` | AC-M365-011 |
| F2 | M365 connection card | `M365ConnectionCard.tsx` + `.test.tsx` | unit | `npm run verify` | AC-M365-012/013 |
| F3 | Mount card in Administration | `pages/AdminUsers.tsx` | wiring | `npm run verify` | FR-M365-012 (AC owned by F2) |
| P1 | Not-provisioned regression pin | (none) | unit (existing) | `vitest run RequireAuth.test.tsx` | AC-M365-020 |
| M1 | `ms_graph_connections` store | `0096_ms_graph_connections.sql` | migration | **owner:** `db reset` | FR-M365-001..004 |
| M2 | Lockdown pgTAP | `0142_..._lockdown.test.sql` | pgTAP | **owner:** `test db` | AC-M365-001 |
| M3 | Schema-invariant pgTAP | `0143_..._schema.test.sql` | pgTAP | **owner:** `test db` | AC-M365-002 |
| M4 | CHECK-registry expansion | `0097_org_features_add_m365.sql` | migration | **owner:** `db reset` | FR-M365-010/011 |
| M5 | Entitlement pgTAP | `0144_org_features_m365_key.test.sql` | pgTAP | **owner:** `test db` | AC-M365-010 |

**Recommended execution order:** F1 → F2 → F3 → P1 (all FE, fully verifiable now), then M1 → M2 →
M3 → M4 → M5 (authored now, **owner verifies on return** with `with-db-lock.sh supabase db reset` +
`supabase test db`). F1 and M4 must agree on the key string `m365_integration` (they do by
construction).

**Phase gate before any PR:** `cd pmo-portal && npm run verify` must be green for the FE slice; the DB
slice's pgTAP must be green on the owner's local stack before the PR that carries the migrations lands.

---

## Open questions for the Director

1. **D1 — encryption mechanism** (spec §6): app-layer AES-256-GCM (recommended) vs Supabase Vault.
   Does not block Phase 0 but is needed before the Phase-1 exchange edge function.
2. **D2 — bootstrap flow** (spec §6): dedicated server-side auth-code + PKCE (recommended) vs one-time
   `provider_refresh_token` capture. Same — Phase-1 blocker, not Phase-0.
3. **D3 — provisioning model** (FR-M365-020): invite-first vs JIT. Left open by design; confirm it
   stays a later-issue decision and that pinning the graceful not-provisioned state is the desired
   Phase-0 posture.
4. **Security-auditor gate timing** (ADR-0060 "Mandatory gate"): confirm the store migration (M1) may
   land in Phase 0 *ahead* of the auditor pass (the auditor gates *exposure* — the exchange/proxy — not
   the inert, client-inaccessible table). Plan assumes yes (the table is unreachable by any client and
   holds no tokens until Phase 1).

---

## Director dispositions (2026-07-14)

Recorded by the Director during AFK autonomous execution. D1/D2 are **Phase-1 blockers, not Phase-0**,
so they do not gate this build; the endorsements below are provisional pending owner confirmation.

1. **D1 (encryption) — CONFIRMED by owner 2026-07-14: app-layer AES-256-GCM in the edge function.**
   (Vault's named-secret model doesn't fit per-connection-row token columns; co-locate the crypto
   boundary where plaintext is unavoidable; DB compromise without the KEK yields only ciphertext.)
   Recorded in ADR-0060 §3. Consumed by the Phase-1 exchange edge function.
2. **D2 (bootstrap) — CONFIRMED by owner 2026-07-14: dedicated server-side auth-code + PKCE.** ADR-0060
   §1's target flow. Recorded in ADR-0060 §1. Consumed by the Phase-1 exchange edge function.
3. **D3 (provisioning) — CONFIRMED open, later issue.** Invite-first-vs-JIT stays undecided; the shipped
   graceful not-provisioned state (AC-MSAUTH-010/011) is the Phase-0 posture. No Phase-0 work.
4. **Security-auditor gate timing — CONFIRMED with a guard.** The inert, client-inaccessible, token-empty
   store table (M1) MAY be **authored and committed to the collector branch** ahead of the auditor pass.
   BUT its **promotion past the collector** (→ `dev`/`main`) is gated on BOTH (a) the owner running the
   M2/M3/M5 pgTAP green on the local stack, AND (b) the `security-auditor` reviewing the store as part of
   the Phase-1 exposure work. The auditor gates *exposure*; committing the locked-down empty table to a
   review branch is not exposure, so this does not violate ADR-0060's mandatory gate.

**Execution note (AFK):** DB slices M1–M5 are authored to the collector branch **flagged
AUTHORED / DB-deferred** (no Supabase CLI in this container); they are NOT verified here and NOT promoted
to `dev`. FE slices F1–F3 + P1 are built and verified now via `npm run verify`.
