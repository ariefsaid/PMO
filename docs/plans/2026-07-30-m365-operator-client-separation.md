# Plan — M365 operator/client separation in the authorization gate (2026-07-30)

- **Spec:** [`docs/specs/m365-operator-client-separation.spec.md`](../specs/m365-operator-client-separation.spec.md)
- **Decision:** [ADR-0063 §3, second amendment](../adr/0063-microsoft-365-integration-architecture.md)
- **Branch:** `feat/m365-doc-linking` (already cut from `dev`; rename if this ships separately from linking)
- **Blocks:** backlog TBD-3 (the proof reconnect) and TBD-4 (document linking)
- **⚠️ Gated on OQ-4** — the card has no non-Admin home. **Phase D does not start until the owner rules.**
  Phases A–C and E are unaffected and can complete regardless.

**Strict TDD throughout: write the failing test, watch it fail for the right reason, then make it pass.**
Every task is 2–5 minutes. Run the fast loop from `pmo-portal/`:
`npx vitest run src/lib/m365` — and the full gate before any push (Phase F).

---

## Phase A — the error code (no behaviour yet)

### A1. `DISABLED_MEMBER` enters the taxonomy — RED
`pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts`, new `describe` block:

```ts
import { ERROR_STATUS } from '../../../../../supabase/functions/m365-token-custody/types';

describe('AC-M365SEP-003 — DISABLED_MEMBER is its own wire code', () => {
  it('AC-M365SEP-003: DISABLED_MEMBER maps to 403 and is distinct from NOT_ENTITLED', () => {
    expect(ERROR_STATUS.DISABLED_MEMBER).toBe(403);
    expect(Object.keys(ERROR_STATUS)).toContain('NOT_ENTITLED');
  });
});
```
Expect a **type error** on `ERROR_STATUS.DISABLED_MEMBER` — that is the red.

### A2. GREEN
`supabase/functions/m365-token-custody/types.ts`: add `| 'DISABLED_MEMBER'` to `M365ErrorCode` (after
`'NOT_ENTITLED'`, line 124) and `DISABLED_MEMBER: 403,` to `ERROR_STATUS` (after line 138). Adding the union
member makes `ERROR_STATUS` incomplete → `tsc` forces the second edit. Run `npm run typecheck:edge`.

---

## Phase B — the data-access gate

### B1. The gate does not exist — RED
Same test file. `mockClient` is the existing helper in `./m365MockDeps`; follow the shape already used by the
`authorizeOperatorEntitled` tests at line 54.

```ts
import { authorizeMemberEntitled } from '../../../../../supabase/functions/m365-token-custody/auth';

describe('AC-M365SEP — authorizeMemberEntitled (member + active + entitled)', () => {
  it('AC-M365SEP-001: an active Project Manager in an entitled org is authorized', async () => { /* … */ });
  it('AC-M365SEP-005: a member of a non-entitled org gets NOT_ENTITLED', async () => { /* … */ });
  it('AC-M365SEP-003: a member whose status is not active gets DISABLED_MEMBER, NOT NOT_ENTITLED', async () => { /* … */ });
  it('AC-M365SEP-011: an unresolvable profile gets BAD_REQUEST', async () => { /* … */ });
  it('AC-M365SEP-006: platform_operators is never queried', async () => { /* … */ });
});
```

For **AC-M365SEP-006**, assert on the mock: the gate must make **no** call against `platform_operators`. Record
the table names the mock is asked for and assert `platform_operators` is absent — an assertion on *absence of a
query* is what makes the de-gate provable rather than incidental.

### B2. GREEN — write the gate
`supabase/functions/m365-token-custody/auth.ts`. Three independently-failing assertions per FR-M365SEP-002.

**The status read must be explicit (NFR-M365SEP-002).** Select `status` alongside `org_id, role` from
`profiles` and assert it, rather than letting the `org_features` read carry it via
`org_features_select`'s `is_active_member()`. `profiles_select` is `using (org_id = auth_org_id())` with **no**
status predicate (`0002_rls.sql:32`), so the caller can read their own row while disabled — which is exactly why
the assertion has to live here and be its own test.

```ts
export async function authorizeMemberEntitled(deps: {
  callerClient: M365SupabaseLike;
  userId: string;
  requiredEntitlement?: string;
}): Promise<{ orgId: string; role: string }> {
  const entitlement = deps.requiredEntitlement ?? 'm365_integration';
  const { callerClient, userId } = deps;

  // (a) org resolvable
  const { data: profile, error: profileError } = await callerClient
    .from('profiles').select('org_id, role, status').eq('id', userId).single();
  if (profileError || !profile) throw new M365HandlerError('BAD_REQUEST', 'org not resolvable for caller');
  const { org_id: orgId, role, status } = profile as { org_id: string; role: string; status: string };

  // (b) active member — EXPLICIT, not inherited from org_features' RLS. See NFR-M365SEP-002:
  // profiles_select carries no status predicate, so a disabled caller reads this row fine.
  // `banned_until` is covered by is_active_member() in the DB layer (AC-M365SEP-004, pgTAP).
  if (status !== 'active') throw new M365HandlerError('DISABLED_MEMBER', 'account access has been disabled');

  // (c) entitled
  const { data: feature, error: featureError } = await callerClient
    .from('org_features').select('enabled').eq('org_id', orgId).eq('feature_key', entitlement).single();
  if (featureError || (feature as { enabled?: boolean } | null)?.enabled !== true) {
    throw new M365HandlerError('NOT_ENTITLED', 'organization not entitled for this integration');
  }
  return { orgId, role };
}
```

Note it takes **no `serviceClient`** — the absence of that parameter is itself a structural guarantee that the
gate cannot consult `platform_operators`.

### B3. Repoint the shared resolver — RED then GREEN
`auth.ts:89` `resolveOrgOrResult`: call `authorizeMemberEntitled({ callerClient, userId })`. Update the doc
comment: it must say the four handlers share **the data-access decision**, and record NFR-M365SEP-001 — an
activation gate and a data-access gate may share code, never one decision. All four actions
(`initiate_connect`, `graph_proxy`, `disconnect`, `connection_status`) inherit this with no handler edits.

### B4. Delete the operator gate (FR-M365SEP-003)
Remove `authorizeOperatorEntitled` from `auth.ts`. `grep -rn authorizeOperatorEntitled supabase pmo-portal`
must return nothing but the tests being rewritten in B5. Do not keep it — a retained gate is how the wrong gate
gets re-applied.

### B5. Re-specify `AC-M365-131` (FR-M365SEP-015)
In the same test file, replace the two `AC-M365-131` cases (lines 76 and 93 — *"an org Admin who is NOT an
Operator is forbidden"* and *"a non-Admin, non-Operator caller is forbidden"*) with **AC-M365SEP-012**: an
authenticated caller who is **not a member** of any entitled org is rejected. Also fix the stale header comment
at line 4 (*"Admin gate"*). Add **AC-M365SEP-007**: an active entitled Operator still passes — the de-gate
excludes no one.

### B6. Own-row scoping is unchanged — AC-M365SEP-009
`pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts`: with two connections in the same org, assert
`graph_proxy` reads the **caller's** row. No production change expected — `proxy.ts:69` already filters
`.eq('user_id', userId)`. This test exists to make a refactor that widens it fail (mutation check 3).

---

## Phase C — database layer

### C1. pgTAP — `banned_until`, cross-org, entitlement non-regression
New `supabase/tests/0169_m365_member_gate.sql` (confirm the next free number first:
`ls supabase/tests | tail -3`). Three ACs, each naming its id as the leading token of the description:

- **AC-M365SEP-004** — a member with `auth.users.banned_until` in the future fails `is_active_member()`, so the
  `org_features` read returns no row. Proves the DB half of the membership rule, which the edge-fn status check
  cannot express.
- **AC-M365SEP-008** — cross-org isolation on `ms_graph_connections`: org A's user cannot reach org B's row.
- **AC-M365SEP-010** — a Project Manager cannot enable `m365_integration`; `org_features_write` remains
  `is_operator() and is_active_member()`. Non-regression: the de-gate must not touch entitlement authority.

Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` — expect `Result: PASS`.
**Never run the two commands under separate lock holds.**

---

## Phase D — the surface ⚠️ BLOCKED ON OQ-4

Do not start until the owner rules on where the card lives. Under the recommended answer (one `/integrations`
route for any active member):

### D1. `M365ConnectionCard` drops `isOperator` — RED then GREEN
`pmo-portal/src/components/integrations/M365ConnectionCard.tsx`: remove the `isOperator` prop (line 63) and the
two guards at lines 113 and 210, leaving `entitled` as the only gate. Correct the header comment at line 18 —
it still says connecting is a platform action that an org Admin does not see. Test **AC-M365SEP-013**: an
entitled non-Admin sees the card with Connect enabled.

### D2. New route
`pmo-portal/App.tsx`: `<Route path="/integrations" element={<IntegrationsPage />} />` beside line 138, plus the
lazy import beside line 74. New `pmo-portal/pages/Integrations.tsx` renders the card and nothing else. Nav entry
per `DESIGN.md` tokens. Remove the render at `pages/AdminUsers.tsx:483` and its import at line 37 — one home,
not two, or the two will drift.

### D3. FE error copy
`pmo-portal/src/lib/m365/connectClient.ts` `describeM365Error` (line 62): add `DISABLED_MEMBER` →
reviewed human copy stating the user's access has been disabled and to contact their administrator. Extend the
existing `connectClient.test.ts` mapping test. **NFR-M365SEP-006:** no token, `oid`, tenant id or raw Microsoft
error in the string — **AC-M365SEP-014**.

---

## Phase E — mutation checks (NFR-M365SEP-007)

Not optional, and not satisfiable by reading the code. Break each, observe red, revert:

1. `authorizeMemberEntitled` returns `{ orgId: 'x', role: 'Admin' }` immediately →
   **AC-M365SEP-003/005/011/012** red.
2. **Delete the `status !== 'active'` check only** → **AC-M365SEP-003 must still go red.** If it stays green the
   test is proving the `org_features` RLS side effect instead of the requirement, and NFR-M365SEP-002 is not
   implemented. **This is the most important check in the plan** — it is the one that prevents regressing to
   today's accidental protection.
3. Change `proxy.ts:69` to drop `.eq('user_id', userId)` → **AC-M365SEP-008/009** red.
4. Re-add a `platform_operators` lookup to the gate → **AC-M365SEP-006** red.

Record the four observed results in the PR body. A claim without the output is not evidence.

---

## Phase F — gates before the PR

```
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
bash scripts/m365-race-probe.sh
bash scripts/m365-deadlock-probe.sh
cd pmo-portal && npm run verify
```

The two probes are **not** optional even though this change does not touch the lock order — that claim is
verified, not asserted (the Director's "deadlock-free" claim was disproved once already).

Then: **`security-auditor` pass on the widened boundary** — STRIDE on the gate, the disabled-member path, and
cross-org reachability. Mandatory per the spec; distinct from the 2026-07-24 live audit. PR → `dev`.

**AC-M365SEP-015 (the e2e journey, backlog TBD-5) is deliberately NOT in this plan.** It needs a live Microsoft
connection, so it belongs with TBD-3 rather than here. Filing it inside this plan would make this change look
blocked on Microsoft when it is not.

---

## Traceability

| AC | Owning layer | Where |
|---|---|---|
| AC-M365SEP-001, 002, 005, 006, 007, 011, 012, 014 | Unit | `pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts` |
| AC-M365SEP-003 | Unit | same file — **plus mutation check 2** |
| AC-M365SEP-009 | Unit | `tokenCustody.proxy.test.ts` |
| AC-M365SEP-004, 008, 010 | pgTAP | `supabase/tests/0169_m365_member_gate.sql` |
| AC-M365SEP-013 | Unit (RTL) | `src/components/integrations/__tests__/M365ConnectionCard.test.tsx` |
| AC-M365SEP-015 | E2E | deferred to TBD-3 (needs a live connection) |
