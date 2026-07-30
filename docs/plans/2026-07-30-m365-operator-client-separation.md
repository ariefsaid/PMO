# Plan — M365 three-step connection model (operator · client admin · individual user) — 2026-07-30

- **Spec:** [`docs/specs/m365-operator-client-separation.spec.md`](../specs/m365-operator-client-separation.spec.md)
- **Decision:** [ADR-0063 §3, second amendment](../adr/0063-microsoft-365-integration-architecture.md);
  step 2 reuses [ADR-0065](../adr/0065-external-admin-connect.md)
- **Branch:** `feat/m365-doc-linking` (cut from `dev`; rename to `feat/m365-connection-model` if this ships
  ahead of document linking — it will)
- **Blocks:** backlog TBD-3 (the proof reconnect) and TBD-4 (document linking)

Strict TDD: write the failing test, **watch it fail for the right reason**, then make it pass. Tasks are
2–5 minutes. Fast loop from `pmo-portal/`: `npx vitest run src/lib/m365 src/components/integrations`.
Full gate in Phase G.

**Phase order matters.** Phase A fixes the shipped redirect defect first, because it must be true before any
live connect is attempted and it gives the later surfaces a real route to target.

---

## Phase A — fix the callback redirect defect (spec §1.3)

Do this first and independently. It is a live bug: **every completed connect lands on Not Found.**

### A1. Prove the defect — RED
New `pmo-portal/src/lib/m365/__tests__/tokenCustody.redirect.test.ts`.

**AC-M365SEP-018.** Per NFR-M365SEP-008 the test may **not** invent the route. Import the app's real route
table and assert each callback target resolves to a concrete route:

```ts
/** AC-M365SEP-018 — every callback redirect target resolves to a real application route. */
import { describe, it, expect } from 'vitest';
import { matchRoutes } from 'react-router';
```

`App.tsx` exports `AppRoutes` (added previously so the router is testable — see the note in
`docs/backlog.md` operational lessons). Derive the target paths from `callback.ts`'s redirect helpers rather
than hard-coding them, so the test tracks the source. Assert the matched route is **not** the `path="*"`
catch-all (`App.tsx:165`). Expect RED: today's target is `/admin/integrations`.

> If `AppRoutes` is not exported in a testable form, export it before writing this test. Asserting against a
> hand-written list of paths would reproduce exactly the defect this test exists to catch.

### A2. GREEN — point the redirects at a real route
`supabase/functions/m365-token-custody/callback.ts:348` and `:355`: change `/admin/integrations` to the route
chosen in D2 (`/integrations`). Also fix the stale comment at `M365ConnectionCard.tsx:25`.

### A3. Stop the card's tests inventing the route
`pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`: `initialEntry` at line 83
(and lines 235, 254, 271, 295, 320) currently reads `/admin/integrations`. Repoint to the real route. These
tests stay useful for card behaviour; A1 is what proves the route exists.

Run `npx vitest run src/lib/m365 src/components/integrations`.

---

## Phase B — the error codes

### B1. `DISABLED_MEMBER` + `ORG_APPROVAL_REQUIRED` — RED
`pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts`, new block:

```ts
import { ERROR_STATUS } from '../../../../../supabase/functions/m365-token-custody/types';

describe('AC-M365SEP-003/015 — membership and org-approval are their own wire codes', () => {
  it('AC-M365SEP-003: DISABLED_MEMBER is 403 and distinct from NOT_ENTITLED', () => {
    expect(ERROR_STATUS.DISABLED_MEMBER).toBe(403);
  });
  it('AC-M365SEP-015: ORG_APPROVAL_REQUIRED is 403 and distinct from FORBIDDEN', () => {
    expect(ERROR_STATUS.ORG_APPROVAL_REQUIRED).toBe(403);
  });
});
```
Expect **type errors** — that is the red.

### B2. GREEN
`types.ts`: add `| 'DISABLED_MEMBER' | 'ORG_APPROVAL_REQUIRED'` to `M365ErrorCode` (after `'NOT_ENTITLED'`,
line 124) and both keys `: 403` to `ERROR_STATUS` (after line 138). Adding a union member makes the
`Record<M365ErrorCode, number>` incomplete, so `tsc` forces the second edit. Run `npm run typecheck:edge`.

---

## Phase C — the data-access gate (step 3's authorization)

### C1. The gate does not exist — RED
Same test file; follow the mock shape already used at line 54. `mockClient` is in `./m365MockDeps`.

```ts
import { authorizeMemberEntitled } from '../../../../../supabase/functions/m365-token-custody/auth';
```
Cases: **AC-001** (active PM authorized) · **AC-005** (non-entitled → `NOT_ENTITLED`) · **AC-003** (inactive
→ `DISABLED_MEMBER`, explicitly *not* `NOT_ENTITLED`) · **AC-011** (no profile → `BAD_REQUEST`) ·
**AC-006** (`platform_operators` never queried).

For **AC-006**, record the table names the mock is asked for and assert `platform_operators` is **absent**.
An assertion on the *absence of a query* is what makes the de-gate provable rather than incidental.

### C2. GREEN — write the gate
`supabase/functions/m365-token-custody/auth.ts`:

```ts
export async function authorizeMemberEntitled(deps: {
  callerClient: M365SupabaseLike;
  userId: string;
  requiredEntitlement?: string;
}): Promise<{ orgId: string; role: string }> {
  const entitlement = deps.requiredEntitlement ?? 'm365_integration';
  const { callerClient, userId } = deps;

  const { data: profile, error: profileError } = await callerClient
    .from('profiles').select('org_id, role, status').eq('id', userId).single();
  if (profileError || !profile) throw new M365HandlerError('BAD_REQUEST', 'org not resolvable for caller');
  const { org_id: orgId, role, status } = profile as { org_id: string; role: string; status: string };

  // EXPLICIT active-member assertion (NFR-M365SEP-002). NOT inherited from org_features' RLS:
  // profiles_select (0002_rls.sql:32) carries no status predicate, so a disabled caller reads this
  // row fine. banned_until is covered at the DB layer (AC-M365SEP-004, pgTAP).
  if (status !== 'active') throw new M365HandlerError('DISABLED_MEMBER', 'account access has been disabled');

  const { data: feature, error: featureError } = await callerClient
    .from('org_features').select('enabled').eq('org_id', orgId).eq('feature_key', entitlement).single();
  if (featureError || (feature as { enabled?: boolean } | null)?.enabled !== true) {
    throw new M365HandlerError('NOT_ENTITLED', 'organization not entitled for this integration');
  }
  return { orgId, role };
}
```

It takes **no `serviceClient`** — the absence of that parameter is itself a structural guarantee it cannot
consult `platform_operators`.

### C3. Repoint the shared resolver
`auth.ts:89` `resolveOrgOrResult` → `authorizeMemberEntitled({ callerClient, userId })`. Update its doc
comment to say the four handlers share **the data-access decision**, and record NFR-M365SEP-001: an
activation gate and a data-access gate may share code, never one decision. All four actions inherit this
with **no handler edits**.

### C4. Delete the operator gate (FR-M365SEP-003)
Remove `authorizeOperatorEntitled`. `grep -rn authorizeOperatorEntitled supabase pmo-portal` must return
nothing outside the tests rewritten in C5.

### C5. Re-specify `AC-M365-131` (FR-M365SEP-020)
Replace the two cases at lines 76 and 93 with **AC-M365SEP-012** (a non-member is forbidden). Fix the stale
header comment at line 4 (*"Admin gate"*). Add **AC-M365SEP-007**: an active entitled Operator still passes.

### C6. Own-row scoping — AC-M365SEP-009
`tokenCustody.proxy.test.ts`: two connections in one org; assert `graph_proxy` reads the **caller's** row. No
production change expected (`proxy.ts:69` already filters). This test exists so a widening refactor fails
(mutation check 3).

---

## Phase D — step 3's surface

### D1. `M365ConnectionCard` drops `isOperator` — RED then GREEN
`M365ConnectionCard.tsx`: remove the `isOperator` prop (line 63) and the guards at lines 113 and 210,
leaving `entitled` as the only gate. Correct the header comment at line 18 — it still claims connecting is a
platform action an org Admin does not see. **AC-M365SEP-016**: an entitled non-Admin sees the card, Connect
enabled.

### D2. A route any active member can reach (OQ-A)
- `pmo-portal/pages/Integrations.tsx` — renders `M365ConnectionCard` and nothing else.
- `pmo-portal/App.tsx`: lazy import beside line 74; `<Route path="/integrations" element={<IntegrationsPage />} />`
  beside line 138. **This is the route A2 redirects to** — A1 goes green here if it has not already.
- Nav entry per `DESIGN.md` tokens.
- Remove the render at `pages/AdminUsers.tsx:483` and its import at line 37. One home, not two, or they drift.

### D3. FE error copy
`src/lib/m365/connectClient.ts` `describeM365Error` (line 62): add `DISABLED_MEMBER` (access disabled, contact
your administrator) and `ORG_APPROVAL_REQUIRED` (ask your administrator to approve the application) — three
distinguishable messages per NFR-M365SEP-006. Extend `connectClient.test.ts`. **AC-M365SEP-019**: no token,
`oid`, tenant id or raw Microsoft error in any string.

---

## Phase E — step 2, the client admin approves the app for the organisation

### E1. `buildAdminConsentUrl` — RED
`pmo-portal/src/lib/m365/__tests__/graphPkce.test.ts`. Mirror `buildAuthorizeUrl`
(`src/lib/m365/graphPkce.ts:90`): same pinned host, same `validateTenant`, **no PKCE** (consent grants
permissions; it exchanges no code).

Assert: host is `login.microsoftonline.com`; path is `/{tenant}/v2.0/adminconsent`; `client_id` and
`redirect_uri` present; an invalid tenant throws (reuse the existing `validateTenant` cases at line 45).

### E2. GREEN
Add `buildAdminConsentUrl` to `graphPkce.ts` beside `buildAuthorizeUrl`, and re-export it from
`supabase/functions/m365-token-custody/pkce.ts` alongside the existing exports (line 6).

### E3. The `initiate_org_approval` action — RED
New `supabase/functions/m365-token-custody/orgApproval.ts` + tests in
`pmo-portal/src/lib/m365/__tests__/tokenCustody.orgApproval.test.ts`.

- **AC-M365SEP-013** — an org Admin gets a consent URL built from `env.m365TenantId` + `env.m365ClientId`
  (FR-M365SEP-006 — never a caller-supplied value), and **nothing is persisted**: assert no `.from(...)`
  write and no `.rpc(...)` call.
- **AC-M365SEP-014** — a caller who is neither Admin-of-org nor Operator is forbidden. **This action does
  NOT use `authorizeMemberEntitled`** (FR-M365SEP-004) — it uses the ADR-0065 Admin-or-Operator gate. Two
  different questions, two different gates (NFR-M365SEP-001).

### E4. GREEN + route it
Implement the handler; add `case 'initiate_org_approval':` to the `index.ts` switch (beside line 117). The
gate here reads the caller's **real** role from `profiles` plus `platform_operators` service-side — the same
shape ADR-0065 uses for ClickUp/ERPNext connect.

### E5. Surface it beside ClickUp and ERPNext
`src/components/integrations/IntegrationsView.tsx`: add the M365 organisation-approval affordance.
**AC-M365SEP-017** — it renders for an org Admin on the admin integrations surface.
⚠️ Do **not** add `'m365'` to `TIERS` (line 26). M365 is not an adapter tier — it has no
`external_org_bindings` row, no health probe and no SoT domains. Forcing it into that array would give it a
credential-and-health model it does not have. Render it as its own block on the same surface.

### E6. Surface the approval-required error
`describeM365Error` already gains `ORG_APPROVAL_REQUIRED` in D3. Here, map Microsoft's consent-required
error from the callback's existing `?error=` path (`callback.ts:35`) onto that code. **AC-M365SEP-015.**

---

## Phase F — database layer

### F1. pgTAP
New `supabase/tests/0169_m365_member_gate.sql` — confirm the next free number first
(`ls supabase/tests | tail -3`). Each AC id is the leading token of its description:

- **AC-M365SEP-004** — `banned_until` in the future ⇒ `is_active_member()` false ⇒ the `org_features` read
  returns no row. The DB half of the membership rule, which the edge-fn status check cannot express.
- **AC-M365SEP-008** — cross-org isolation on `ms_graph_connections`.
- **AC-M365SEP-010** — a PM cannot enable `m365_integration`; `org_features_write` stays
  `is_operator() and is_active_member()`. Non-regression: the de-gate must not touch entitlement authority.

```
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```
Expect `Result: PASS`. **Never** run those two under separate lock holds.

---

## Phase G — mutation checks, then the gates

### G1. Mutation checks (NFR-M365SEP-009) — break, observe red, revert
1. Data-access gate returns success immediately → **AC-003 / 005 / 011 / 012** red.
2. **Delete only the `status !== 'active'` check** → **AC-003 must still go red.** If green, the test is
   proving the `org_features` RLS side effect rather than the requirement, and NFR-M365SEP-002 is not
   implemented. **The most important check in this plan.**
3. Drop `.eq('user_id', userId)` from the connection lookup → **AC-008 / 009** red.
4. Re-add a `platform_operators` lookup to the data-access gate → **AC-001 / 006** red.
5. Point a callback redirect at a non-existent route → **AC-018** red.
6. Swap step 2's gate for `authorizeMemberEntitled` → **AC-014** red (proves the two gates stayed separate).

Record all six observed results in the PR body. A claim without output is not evidence.

### G2. Gates
```
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
bash scripts/m365-race-probe.sh
bash scripts/m365-deadlock-probe.sh
cd pmo-portal && npm run verify
```
The probes are **not** optional even though this change does not touch the lock order — that claim is
verified, not asserted (a "deadlock-free" claim was disproved once already).

Then **`security-auditor`** on the widened boundary: STRIDE on both gates, the disabled-member path, the new
step-2 endpoint, and cross-org reachability. Then render the two surfaces before opening the PR
(`docs/design-workflow.md`) — a unit test that mounts a card is not a rendered check, and §1.3 is precisely
what unrendered UI hides. PR → `dev`.

**AC-M365SEP-020 (the end-to-end journey) is deliberately NOT here** — it needs a live Microsoft connection,
so it belongs with backlog TBD-3. Including it would make this change look blocked on Microsoft when it is not.

---

## Traceability

| AC | Owning layer | Where |
|---|---|---|
| AC-M365SEP-001, 002, 003, 005, 006, 007, 011, 012 | Unit | `src/lib/m365/__tests__/tokenCustody.auth.test.ts` |
| AC-M365SEP-003 | Unit | same — **plus mutation check 2** |
| AC-M365SEP-009 | Unit | `tokenCustody.proxy.test.ts` |
| AC-M365SEP-013, 014 | Unit | `tokenCustody.orgApproval.test.ts` |
| AC-M365SEP-015, 019 | Unit | `connectClient.test.ts` |
| AC-M365SEP-016 | Unit (RTL) | `components/integrations/__tests__/M365ConnectionCard.test.tsx` |
| AC-M365SEP-017 | Unit (RTL) | `components/integrations/IntegrationsView.test.tsx` |
| AC-M365SEP-018 | Unit | `src/lib/m365/__tests__/tokenCustody.redirect.test.ts` |
| AC-M365SEP-004, 008, 010 | pgTAP | `supabase/tests/0169_m365_member_gate.sql` |
| AC-M365SEP-020 | E2E | deferred to backlog TBD-3 |
