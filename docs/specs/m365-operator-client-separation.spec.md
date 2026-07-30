# M365 — operator/client separation in the authorization gate — spec

> **Status:** Draft for owner review. **NOT BUILT.**
> **Priority:** this is the starred blocker in the M365 entry of [`docs/backlog.md`](../backlog.md) (TBD-2).
> It needs nothing from Microsoft and it blocks the proof reconnect (TBD-3) and document linking (TBD-4).

- **Controlling decision:** [ADR-0063 §3, **second amendment** (2026-07-30)](../adr/0063-microsoft-365-integration-architecture.md)
  — the Graph connection belongs to the **client's** Microsoft 365 and **client users** make it. Four layers,
  four owners. **Related:** ADR-0064 (the app registration stays vendor-owned — unaffected), ADR-0060 (token
  custody controls — unaffected), ADR-0049 (entitlement is Operator-owned — unaffected), ADR-0016 (FE authz is
  UX-only, RLS is the ceiling), ADR-0019 (server-enforced authority), ADR-0010 (test pyramid).
- **Scope:** **who may reach** the M365 token-custody actions. It does **not** change what those actions do,
  what Graph paths are permitted, how tokens are encrypted or stored, the tenant assertion, or the cascade.
- **Out of scope (deliberate, do not add here):** parameterising `M365_TENANT_ID` per org (a seam recorded in
  ADR-0063, needed only under the pooled topology); the SharePoint scope additions (TBD-3); the project↔library
  binding and the drift model ([ADR-0071](../adr/0071-linked-document-content-drift.md)).

---

## 1. Context

The operator/client separation has been the standing intention for M365 throughout. **The shipped code does not
express it.** All four actions of `m365-token-custody` — `initiate_connect`, `graph_proxy`, `disconnect`,
`connection_status` — run through one shared gate, `resolveOrgOrResult` → `authorizeOperatorEntitled`
([`auth.ts:89`](../../supabase/functions/m365-token-custody/auth.ts:89)), which requires a row in
`platform_operators`. A client Project Manager is rejected with `FORBIDDEN` before anything else happens.

**How the gate reached the data path.** A DRY refactor ("quality #6") unified four handlers behind one helper.
Three of them are about *establishing* a connection; one (`graph_proxy`) is about *using* it. Those are two
different authorization questions, and sharing one helper silently gave them one answer. A shared helper is the
right shape; a shared *decision* is not.

**Two facts make this a small change rather than a redesign:**

1. **The per-user permission model is already plumbed.** `graph_proxy` loads
   `.eq('org_id', orgId).eq('user_id', userId)` ([`proxy.ts:69`](../../supabase/functions/m365-token-custody/proxy.ts:69))
   where `userId` comes from `verifyCallerJwt`. Every caller therefore browses with **their own** Microsoft
   token, never a shared one. Only the gate prevents anyone but an Operator reaching it.
2. **Nothing else in this function needs the Operator gate.** Entitlement is toggled elsewhere
   (`operator_toggle_feature` + the `org_features_write` RLS policy). Once the four actions de-gate,
   `authorizeOperatorEntitled` has no caller here.

**⚑ The load-bearing hazard: today's protection against a disabled user is ACCIDENTAL.** Nothing in
`authorizeOperatorEntitled` checks membership status. It survives only because it reads `org_features` through
the **caller-JWT client**, and `org_features_select` is
`using (org_id = auth_org_id() and public.is_active_member())` ([`0070_org_features.sql:32`](../../supabase/migrations/0070_org_features.sql:32)).
A disabled or banned user therefore reads no row and is rejected — but as `NOT_ENTITLED`, which is a false
statement about the org. Two consequences, and both are requirements below:

- The protection is one refactor away from vanishing. Moving that read to the service client — exactly what was
  done for `platform_operators` — would silently un-protect disabled users, with every test still green. This is
  the same class as the M365 defects that passed four security rounds and the full verify.
- The error is mislabeled, so an operator debugging a disabled user is told the wrong thing.

De-gating **widens** who may reach a Graph token path, so it is a change to a security-audited boundary and
carries a mandatory `security-auditor` pass and mutation checks (§4).

---

## 2. Non-functional requirements

- **NFR-M365SEP-001 (two gates, never one decision).** The system shall hold the *activation* question ("may
  this actor perform a platform action?") and the *data-access* question ("may this actor use this org's
  connection?") as **two distinct authorization decisions**. They may share code; they shall not share a
  decision. No future refactor may unify them on the grounds of duplication.
- **NFR-M365SEP-002 (active membership is enforced explicitly).** The data-access gate shall assert the caller
  is an **active member** as an explicit, independently-tested step — **not** as a side effect of reading a
  table whose RLS policy happens to include `is_active_member()`. The disabled-user acceptance criterion shall
  fail if that explicit assertion is removed, whatever the entitlement read does.
- **NFR-M365SEP-003 (no widening of capability).** This change alters **who** may reach an action. It shall not
  alter **what** any action permits: the Graph path gate, the scope gate, the method allowlist, the encryption
  envelope, the tenant assertion, the lock order, and the offboard/disentitlement cascade are all unchanged.
- **NFR-M365SEP-004 (own-row scoping preserved — no shared org token).** `graph_proxy`, `disconnect` and
  `connection_status` shall continue to resolve the connection by the **caller's own** `user_id` from the
  verified JWT. No caller — Operator included — shall be able to act through another user's connection.
- **NFR-M365SEP-005 (error taxonomy tells the truth).** A rejection caused by the caller's membership status
  shall be reported distinctly from a rejection caused by the org's entitlement. A disabled member shall not be
  told the organization is not entitled.
- **NFR-M365SEP-006 (no secret reaches the client).** Unchanged and inherited: no token, `code_verifier`,
  `oid`, tenant id, or raw Microsoft error shall transit or persist client-side, in any new error path.
- **NFR-M365SEP-007 (the gate is mutation-checked).** Each gate condition shall be proven load-bearing by
  breaking it and observing red tests (§4). A suite that stays green while the gate is disabled is not a suite.
- **NFR-M365SEP-008 (FE gate is UX-only).** The connection card's visibility rules are presentation only
  (ADR-0016). Every rule in §3 shall be enforced independently by the edge function, and proven so by a test
  that calls the handler directly.

---

## 3. Functional requirements

### 3.1 The two gates

- **FR-M365SEP-001 (Ubiquitous).** The system shall provide a **data-access gate** — `authorizeMemberEntitled`
  — that resolves the caller's org and authorizes them as an **active member of an entitled org**, and shall
  **not** consult `platform_operators`.
- **FR-M365SEP-002 (Ubiquitous).** The data-access gate shall be composed of three independently-failing
  assertions, in this order, each with its own typed error: (a) the caller's org is resolvable; (b) the caller
  is an **active member**; (c) the org holds the `m365_integration` entitlement.
- **FR-M365SEP-003 (Ubiquitous).** `authorizeOperatorEntitled` shall be **removed** from
  `m365-token-custody` once no action uses it. Operator authority over entitlement is unchanged and lives where
  it belongs — the `org_features_write` RLS policy and `operator_toggle_feature`. A retained-but-unused gate is
  how the wrong gate gets re-applied; dead authorization code is not a safety margin.

### 3.2 Which gate each action uses

- **FR-M365SEP-004 (Event-driven).** When a caller invokes `initiate_connect`, the system shall authorize via
  the **data-access gate**.
- **FR-M365SEP-005 (Event-driven).** When a caller invokes `graph_proxy`, the system shall authorize via the
  **data-access gate**.
- **FR-M365SEP-006 (Event-driven).** When a caller invokes `disconnect`, the system shall authorize via the
  **data-access gate** and shall act on the caller's **own** connection only.
- **FR-M365SEP-007 (Event-driven).** When a caller invokes `connection_status`, the system shall authorize via
  the **data-access gate** and shall report the caller's **own** connection only.

### 3.3 Who is permitted

- **FR-M365SEP-008 (Ubiquitous).** Any **active member of an entitled org** shall be permitted to connect
  their own Microsoft account and to browse through it, **irrespective of PMO role**. Rationale: what a caller
  can see is bounded by their own Microsoft permissions, which Microsoft enforces; a PMO role restriction on
  browsing would be UX-only (ADR-0016) and would add no authority PMO holds. *(See OQ-1.)*
- **FR-M365SEP-009 (Conditional).** Where a caller is both an Operator and an active member of an entitled
  org, they shall pass the data-access gate — Operators are members of their own org and are not excluded.
- **FR-M365SEP-010 (State-driven).** While a caller is not an active member — `profiles.status <> 'active'`,
  or `auth.users.banned_until` in the future ([`0095`](../../supabase/migrations/0095_is_active_member_banned_until.sql:29))
  — the system shall reject every M365 action with a membership error distinct from `NOT_ENTITLED`.
- **FR-M365SEP-011 (State-driven).** While the caller's org does not hold the `m365_integration` entitlement,
  the system shall reject every M365 action with `NOT_ENTITLED` — for members and Operators alike.
- **FR-M365SEP-012 (Ubiquitous).** A caller shall never reach a connection belonging to another org or another
  user, through any action.

### 3.4 Surfaces and audit

- **FR-M365SEP-013 (Ubiquitous).** The `M365ConnectionCard` shall render for any **entitled active member**,
  replacing the current `isOperator` prop gate
  ([`M365ConnectionCard.tsx:63`](../../pmo-portal/src/components/integrations/M365ConnectionCard.tsx:63)).
  Its comment asserting that connecting is a platform action shall be corrected.
- **FR-M365SEP-014 (Ubiquitous).** Connect and disconnect audit events shall continue to record the acting
  user. The shape is unchanged; the **actor may now be a client user**, and no audit path may assume otherwise.
- **FR-M365SEP-015 (Ubiquitous).** `AC-M365-131` shall be **re-specified, not deleted.** It currently asserts
  the superseded rule ("an org Admin who is not an Operator is FORBIDDEN"). Its replacement asserts the new
  boundary: a **non-member** is forbidden. Deleting an AC that encodes a reversed decision loses the proof that
  the boundary is still tested at all.

---

## 4. Acceptance criteria

Each AC is owned by **one** test at the lowest sufficient layer (ADR-0010) and names its id in the test title.

| AC | Statement | Owning layer |
|---|---|---|
| **AC-M365SEP-001** | **Given** an active Project Manager in an entitled org with their own connection, **When** they call `graph_proxy`, **Then** the request is authorized and Graph data is returned. | Unit (edge-fn, mocked `fetch`) |
| **AC-M365SEP-002** | **Given** an active member of an entitled org with **no** connection of their own, **When** they call `graph_proxy`, **Then** they receive `NOT_CONNECTED` — **not** `FORBIDDEN`. | Unit |
| **AC-M365SEP-003** | **Given** a member whose `profiles.status` is not `active`, **When** they call any M365 action, **Then** they are rejected with the **membership** error and **not** with `NOT_ENTITLED`. | Unit |
| **AC-M365SEP-004** | **Given** a member whose `auth.users.banned_until` is in the future, **When** they call any M365 action, **Then** they are rejected with the membership error. | pgTAP (`is_active_member` semantics) |
| **AC-M365SEP-005** | **Given** an active member of an org **without** the `m365_integration` entitlement, **When** they call any M365 action, **Then** they receive `NOT_ENTITLED`. | Unit |
| **AC-M365SEP-006** | **Given** `platform_operators` is **empty**, **When** an active entitled member calls `graph_proxy`, **Then** it still succeeds — proving the data-access gate does not consult it. | Unit |
| **AC-M365SEP-007** | **Given** an active entitled Operator, **When** they call `graph_proxy`, **Then** it succeeds — the de-gate excludes no one. | Unit |
| **AC-M365SEP-008** | **Given** two users in different orgs, each with a connection, **When** user A calls `graph_proxy`/`connection_status`/`disconnect`, **Then** only A's own row is read or written, and B's is untouched. | pgTAP |
| **AC-M365SEP-009** | **Given** an Operator and a client user in the **same** org, both connected, **When** the Operator calls `graph_proxy`, **Then** their own connection is used and the client user's token is never read. | Unit |
| **AC-M365SEP-010** | **Given** an active Project Manager who is **not** an Operator, **When** they attempt to enable the `m365_integration` entitlement, **Then** it is rejected — Operator-only entitlement is a non-regression. | pgTAP |
| **AC-M365SEP-011** | **Given** a caller with no resolvable profile, **When** they call any M365 action, **Then** they receive `BAD_REQUEST` and no membership or entitlement lookup discloses org existence. | Unit |
| **AC-M365SEP-012** (re-specifies `AC-M365-131`) | **Given** an authenticated caller who is **not a member** of any entitled org, **When** they call any M365 action, **Then** they are forbidden. | Unit |
| **AC-M365SEP-013** | **Given** an entitled active Project Manager, **When** the integrations surface renders, **Then** the M365 connection card is visible and its Connect action enabled. | Unit (RTL) |
| **AC-M365SEP-014** | **Given** a disabled member, **When** any rejection renders, **Then** no token, `oid`, tenant id, or raw Microsoft error appears in the DOM or the response body. | Unit |
| **AC-M365SEP-015** | **Given** an Operator has entitled an org, **When** an active member of that org connects, **Then** the journey completes end to end — the e2e owed since Phase 0 (backlog TBD-5). | E2E (Playwright, one curated journey) |

### Mandatory mutation checks (NFR-M365SEP-007)

A change is not done until each of these has been observed to turn tests **red**:

1. Force the data-access gate to return success → **AC-M365SEP-003/005/011/012** go red.
2. Remove the **explicit** active-member assertion, leaving the entitlement read to carry it → **AC-M365SEP-003
   must still go red.** This is the check that prevents NFR-M365SEP-002 regressing to today's accidental
   protection. If it stays green, the requirement is not implemented.
3. Change the connection lookup from the caller's `user_id` to any org-wide selection →
   **AC-M365SEP-008/009** go red.
4. Re-introduce the `platform_operators` check into the data-access gate → **AC-M365SEP-001/006** go red.

### Gates before merge

- `security-auditor` pass on the widened boundary (STRIDE on the gate, the disabled-member path, and cross-org
  reachability). This is a **new** gate for this change, not the 2026-07-24 live audit.
- The two concurrency probes still green — `scripts/m365-{race,deadlock}-probe.sh`. This change does not touch
  the lock order, and the probes are how that claim is verified rather than asserted.
- Full `npm run verify` from `pmo-portal/`.

---

## 5. Open questions

- **OQ-1 (owner).** Should browsing be open to **any** active member (FR-M365SEP-008), or restricted to the
  delivery roles (`Admin` / `Executive` / `Project Manager`)? **Recommendation: any active member.** Microsoft
  bounds what each person can see, so a PMO restriction adds no real authority — but it would reduce how many
  people are prompted to connect an account. A defensible product answer either way; it changes only
  FR-M365SEP-008 and AC-M365SEP-001.
- **OQ-2 (Director).** Name and code for the membership rejection: a new `DISABLED_MEMBER` in `M365ErrorCode`,
  or reuse `FORBIDDEN` with a distinct message? **Recommendation: a new code** — `describeM365Error` maps codes
  to human copy, and "your access has been disabled" is different guidance from "you don't have permission".
- **OQ-3 (deferred, recorded in ADR-0063).** Per-org `M365_TENANT_ID`. Not needed while each client has its own
  deployment; explicitly out of scope here so this change stays small.
