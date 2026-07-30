# M365 — the three-step connection model (operator · client admin · individual user) — spec

> **Status:** Draft for owner review. **NOT BUILT.**
> **Priority:** the starred blocker in the M365 entry of [`docs/backlog.md`](../backlog.md) (TBD-2).
> Needs nothing from Microsoft; blocks the proof reconnect (TBD-3) and document linking (TBD-4).

- **Controlling decision:** [ADR-0063 §3, **second amendment** (2026-07-30)](../adr/0063-microsoft-365-integration-architecture.md).
  **Reuses:** [ADR-0065](../adr/0065-external-admin-connect.md) (the admin self-serve connect layer already
  shipped for ClickUp/ERPNext — M365's client-admin step follows its shape and its gate).
  **Unaffected:** ADR-0064 (the app registration stays vendor-owned), ADR-0060 (token custody controls),
  ADR-0049 (entitlement is Operator-owned). **Also:** ADR-0016 (FE authz UX-only, RLS is the ceiling),
  ADR-0010 (test pyramid).
- **Scope:** the three-step model below — who may do what, on which surface — plus one shipped defect the
  exploration uncovered (§1.3). It does **not** change what Graph paths are permitted, how tokens are
  encrypted or stored, the tenant assertion, the lock order, or the cascade.
- **Out of scope (deliberate):** per-org `M365_TENANT_ID` (an ADR-0063 seam, needed only under pooled
  topology); the SharePoint scope additions (backlog TBD-3); the project↔library binding and drift model
  ([ADR-0071](../adr/0071-linked-document-content-drift.md)).

---

## 1. Context

### 1.1 The model (owner, 2026-07-30)

Three steps, three different people, in order. Each is a precondition for the next.

| # | Step | Who | Nature |
|---|---|---|---|
| **1** | Turn the M365 integration on for a client org | **Operator** (vendor) | Commercial / plan gate |
| **2** | Approve the PMO app for the whole organisation | **Client's admin** | A one-time act at Microsoft |
| **3** | Connect my own Microsoft account | **Any active member** | Per-user, repeated per person |

Step 1 is shipped and unchanged (`org_features` / `operator_toggle_feature`, ADR-0049). Steps 2 and 3 are
the subject of this spec.

### 1.2 What exists, and what does not

- **The admin self-serve connect layer is shipped — but only for ClickUp and ERPNext.** `IntegrationsView`
  (`src/components/integrations/IntegrationsView.tsx:26`, `TIERS = ['clickup','erpnext']`) on the
  `/administration` route, gated **Admin-of-org OR Operator** (ADR-0065). **Step 2 belongs on this surface,
  under this gate.** The shape and the gate are precedent; do not invent a parallel one.
- **M365 has no step 2 at all.** No admin-consent code exists anywhere in the repo. The Phase-1 spec
  (`m365-phase1-graph-token-custody.spec.md:607`) records admin consent as *"granted by client IT"* — i.e.
  performed by hand in Microsoft's portal, outside the app.
- **Step 3 exists but is gated to Operators.** All four token-custody actions run through one shared gate,
  `resolveOrgOrResult` → `authorizeOperatorEntitled` ([`auth.ts:89`](../../supabase/functions/m365-token-custody/auth.ts:89)),
  which requires a `platform_operators` row. A client PM is rejected with `FORBIDDEN`.
- **Two facts keep step 3 small.** `graph_proxy` already loads `.eq('org_id', orgId).eq('user_id', userId)`
  from the verified JWT ([`proxy.ts:69`](../../supabase/functions/m365-token-custody/proxy.ts:69)), so every
  caller already browses with **their own** token — the per-user model is plumbed, only the gate blocks it.
  And once the four actions de-gate, `authorizeOperatorEntitled` has no caller left in this function.

**How the gate reached the data path.** A DRY refactor ("quality #6") unified four handlers behind one
helper. Three concern *establishing* a connection; `graph_proxy` concerns *using* one. Those are two
authorization questions, and sharing one helper silently gave them one answer.

### 1.3 ⚑ A shipped defect found while exploring: the callback lands on a page that does not exist

`callback.ts:348` and `:355` redirect to **`/admin/integrations`** on both failure and success. **No such
route exists.** The real route is `/administration` (`App.tsx:138`), and `<Route path="*">`
(`App.tsx:165`) catches the miss, so **every completed Microsoft connect ends on Not Found.** The
connection row is written before the redirect, so the connect *succeeds* while the user sees a 404 and
never receives the success or error message the card is built to display.

**Why no test caught it:** `M365ConnectionCard.test.tsx:83` sets
`initialEntry = '/admin/integrations'` inside a `MemoryRouter`. The test **invents the missing route**, so
it proves the card's behaviour on a path the application does not serve. This is the repo's recurring class
— *a green suite proves the model it mocks, not the boundary where it breaks* — and it must be fixed before
the next live connect or that run will appear broken for the wrong reason.

### 1.4 ⚑ Today's protection against a disabled user is ACCIDENTAL

Nothing in `authorizeOperatorEntitled` checks membership status. It survives only because it reads
`org_features` through the **caller-JWT client**, and `org_features_select` is
`using (org_id = auth_org_id() and public.is_active_member())`
([`0070_org_features.sql:32`](../../supabase/migrations/0070_org_features.sql:32)). `profiles_select` has
**no** status predicate ([`0002_rls.sql:32`](../../supabase/migrations/0002_rls.sql:32)), so a disabled
caller reads their own profile fine. Two consequences, both requirements below: the rejection is mislabeled
`NOT_ENTITLED` (a false statement about the org), and moving that read to the service client — exactly what
was done for `platform_operators` — would silently un-protect disabled users with every test still green.

### 1.5 Why step 2 stores no state

PMO records **nothing** about whether an org has been approved at Microsoft. Microsoft is the authority, and
a stored "approved" flag would drift the moment an admin revokes consent in Entra — the same failure this
programme already reasoned through for linked documents (ADR-0071). Instead: the admin gets a button that
sends them to Microsoft's approval page, and a user who tries to connect before approval is told so by
**Microsoft**, through the `?error=` path the callback already handles (`callback.ts:35`).

---

## 2. Non-functional requirements

- **NFR-M365SEP-001 (two gates, never one decision).** The *activation* question ("may this actor perform a
  platform or org-level action?") and the *data-access* question ("may this actor use this org's
  connection?") shall be **two distinct authorization decisions**. They may share code; they shall not share
  a decision. No future refactor may unify them on the grounds of duplication.
- **NFR-M365SEP-002 (active membership is enforced explicitly).** The data-access gate shall assert active
  membership as an explicit, independently-tested step — **not** as a side effect of reading a table whose
  RLS policy happens to include `is_active_member()`. The disabled-user criterion shall fail if that explicit
  assertion is removed, whatever the entitlement read does.
- **NFR-M365SEP-003 (no widening of capability).** This change alters **who** may reach an action, never
  **what** an action permits. The Graph path gate, scope gate, method allowlist, encryption envelope, tenant
  assertion, lock order and offboard/disentitlement cascade are unchanged.
- **NFR-M365SEP-004 (own-row scoping — no shared org token).** Every action shall resolve the connection by
  the **caller's own** `user_id` from the verified JWT. No caller — Operator or client admin included — shall
  act through another user's connection. Step 2 grants an *organisation* permission at Microsoft; it never
  creates a connection anyone can borrow.
- **NFR-M365SEP-005 (no approval state is mirrored).** PMO shall not persist whether an org has admin
  consent at Microsoft (§1.5). Approval status shall be **derived** from Microsoft's own responses.
- **NFR-M365SEP-006 (error taxonomy tells the truth).** A rejection caused by the caller's membership status,
  one caused by the org's entitlement, and one caused by missing organisation approval at Microsoft shall be
  three distinguishable outcomes with distinct human copy.
- **NFR-M365SEP-007 (no secret reaches the client).** Inherited and unchanged: no token, `code_verifier`,
  `oid`, tenant id, or raw Microsoft error shall transit or persist client-side, in any new path.
- **NFR-M365SEP-008 (route targets are proven against the real router).** Every redirect target the edge
  function emits shall be asserted against the **application's actual route table**, not a router invented
  by a test (§1.3). A test may not supply the route whose existence it is proving.
- **NFR-M365SEP-009 (mutation-checked).** Each gate condition shall be proven load-bearing by breaking it and
  observing red tests (§4). A suite that stays green while the gate is disabled is not a suite.
- **NFR-M365SEP-010 (FE gates are UX-only).** All surface visibility rules are presentation only (ADR-0016);
  each shall be independently enforced by the edge function and proven by a handler-level test.

---

## 3. Functional requirements

### 3.1 The two gates

- **FR-M365SEP-001 (Ubiquitous).** The system shall provide a **data-access gate**,
  `authorizeMemberEntitled`, authorizing the caller as an **active member of an entitled org**, and shall
  **not** consult `platform_operators`.
- **FR-M365SEP-002 (Ubiquitous).** That gate shall comprise three independently-failing assertions, each with
  its own typed error: (a) the caller's org is resolvable; (b) the caller is an **active member**; (c) the org
  holds the `m365_integration` entitlement.
- **FR-M365SEP-003 (Ubiquitous).** `authorizeOperatorEntitled` shall be **removed** from
  `m365-token-custody` once no action uses it. Operator authority over entitlement is unchanged and lives in
  `org_features_write` RLS + `operator_toggle_feature`. A retained-but-unused gate is how the wrong gate gets
  re-applied; dead authorization code is not a safety margin.
- **FR-M365SEP-004 (Ubiquitous).** The **step-2** action shall use the **Admin-of-org OR Operator** gate that
  ADR-0065 already applies to ClickUp/ERPNext connect — not the Operator gate, and not the member gate.

### 3.2 Step 2 — the client admin approves the app for the organisation

- **FR-M365SEP-005 (Event-driven).** When a client admin requests organisation approval, the system shall
  return a Microsoft **admin-consent URL** for the configured tenant and app registration, and the client
  shall navigate to it at top level (never in an iframe).
- **FR-M365SEP-006 (Ubiquitous).** The admin-consent URL shall be constructed server-side from the same
  configured tenant and client id used by `initiate_connect`, so the two can never disagree about which app
  is being approved.
- **FR-M365SEP-007 (Ubiquitous).** The system shall persist **no** record of the approval outcome
  (NFR-M365SEP-005). Microsoft's redirect back shall be acknowledged to the user without being stored.
- **FR-M365SEP-008 (Event-driven).** When Microsoft returns an error to the callback indicating that
  organisation approval is required, the system shall surface reviewed copy telling the user to ask their
  administrator to approve the application — distinct from a permission error and from an entitlement error.
- **FR-M365SEP-009 (Ubiquitous).** The step-2 affordance shall live on the existing admin integrations
  surface alongside ClickUp and ERPNext, and shall be visible only to an Admin-of-org or Operator.

### 3.3 Step 3 — an individual connects their own account

- **FR-M365SEP-010 (Event-driven).** When a caller invokes `initiate_connect`, `graph_proxy`, `disconnect`,
  or `connection_status`, the system shall authorize via the **data-access gate**.
- **FR-M365SEP-011 (Ubiquitous).** Any **active member of an entitled org** shall be able to connect their
  own Microsoft account and browse through it, **irrespective of PMO role** (owner, 2026-07-30). What a
  caller can see is bounded by their own Microsoft permissions, which Microsoft enforces; a PMO role
  restriction on browsing would be UX-only and would add no authority PMO holds.
- **FR-M365SEP-012 (Conditional).** Where a caller is both an Operator and an active member of an entitled
  org, they shall pass the data-access gate — the de-gate excludes no one.
- **FR-M365SEP-013 (State-driven).** While a caller is not an active member — `profiles.status <> 'active'`
  or `auth.users.banned_until` in the future
  ([`0095`](../../supabase/migrations/0095_is_active_member_banned_until.sql:29)) — the system shall reject
  every M365 action with a membership error **distinct from** `NOT_ENTITLED`.
- **FR-M365SEP-014 (State-driven).** While the caller's org lacks the `m365_integration` entitlement, the
  system shall reject every M365 action with `NOT_ENTITLED` — for members and Operators alike.
- **FR-M365SEP-015 (Ubiquitous).** A caller shall never reach a connection belonging to another org or
  another user, through any action.
- **FR-M365SEP-016 (Ubiquitous).** The personal connect affordance shall be reachable by **any active
  member** — i.e. not on the Admin-only `/administration` route (`AdminUsers.tsx:483` today). The card is
  already per-user in substance (`connection_status` is own-row scoped); it appeared org-level only because
  Operators were its sole permitted users.

### 3.4 The redirect defect (§1.3)

- **FR-M365SEP-017 (Ubiquitous).** The callback's success and failure redirects shall target a route the
  application actually serves, and the personal-connect surface shall consume the callback's query
  parameters there.
- **FR-M365SEP-018 (Ubiquitous).** A test shall assert that each redirect target emitted by
  `callback.ts` resolves to a real route in the application's route table — failing if a target matches only
  the catch-all. Per NFR-M365SEP-008, this test may not construct the route itself.

### 3.5 Audit and re-specification

- **FR-M365SEP-019 (Ubiquitous).** Connect and disconnect audit events shall continue to record the acting
  user. The shape is unchanged; the **actor may now be a client user**, and no audit path may assume
  otherwise.
- **FR-M365SEP-020 (Ubiquitous).** `AC-M365-131` shall be **re-specified, not deleted.** It asserts the
  superseded rule ("an org Admin who is not an Operator is FORBIDDEN"). Its replacement asserts the new
  boundary: a **non-member** is forbidden. Deleting an AC that encodes a reversed decision loses the proof
  that the boundary is tested at all.

---

## 4. Acceptance criteria

Each AC is owned by **one** test at the lowest sufficient layer (ADR-0010) and names its id in its title.

| AC | Statement | Owning layer |
|---|---|---|
| **AC-M365SEP-001** | **Given** an active Project Manager in an entitled org with their own connection, **When** they call `graph_proxy`, **Then** the request is authorized and Graph data is returned. | Unit |
| **AC-M365SEP-002** | **Given** an active member of an entitled org with **no** connection, **When** they call `graph_proxy`, **Then** they receive `NOT_CONNECTED` — **not** `FORBIDDEN`. | Unit |
| **AC-M365SEP-003** | **Given** a member whose `profiles.status` is not `active`, **When** they call any M365 action, **Then** they are rejected with the **membership** error and **not** `NOT_ENTITLED`. | Unit |
| **AC-M365SEP-004** | **Given** a member whose `banned_until` is in the future, **When** the entitlement read runs, **Then** `is_active_member()` is false and no row is returned. | pgTAP |
| **AC-M365SEP-005** | **Given** an active member of a **non-entitled** org, **When** they call any M365 action, **Then** they receive `NOT_ENTITLED`. | Unit |
| **AC-M365SEP-006** | **Given** `platform_operators` is **empty**, **When** an active entitled member calls `graph_proxy`, **Then** it still succeeds — the data-access gate never queries that table. | Unit |
| **AC-M365SEP-007** | **Given** an active entitled Operator, **When** they call `graph_proxy`, **Then** it succeeds. | Unit |
| **AC-M365SEP-008** | **Given** two users in different orgs, each connected, **When** user A calls `graph_proxy` / `connection_status` / `disconnect`, **Then** only A's row is read or written. | pgTAP |
| **AC-M365SEP-009** | **Given** an Operator and a client user in the **same** org, both connected, **When** the Operator calls `graph_proxy`, **Then** their own connection is used and the client user's token is never read. | Unit |
| **AC-M365SEP-010** | **Given** an active Project Manager who is not an Operator, **When** they attempt to enable `m365_integration`, **Then** it is rejected — Operator-only entitlement, a non-regression. | pgTAP |
| **AC-M365SEP-011** | **Given** a caller with no resolvable profile, **When** they call any M365 action, **Then** they receive `BAD_REQUEST`, disclosing nothing about org existence. | Unit |
| **AC-M365SEP-012** *(re-specifies `AC-M365-131`)* | **Given** an authenticated caller who is **not a member** of an entitled org, **When** they call any M365 action, **Then** they are forbidden. | Unit |
| **AC-M365SEP-013** | **Given** an org Admin, **When** they request organisation approval, **Then** a Microsoft admin-consent URL for the configured tenant and client id is returned, and nothing is persisted. | Unit |
| **AC-M365SEP-014** | **Given** a caller who is neither Admin-of-org nor Operator, **When** they request organisation approval, **Then** they are forbidden — step 2 does not use the member gate. | Unit |
| **AC-M365SEP-015** | **Given** Microsoft returns an approval-required error to the callback, **When** the surface renders, **Then** the user is told to ask their administrator to approve the application — distinct copy from a permission or entitlement error. | Unit |
| **AC-M365SEP-016** | **Given** an entitled active non-Admin member, **When** the personal connect surface renders, **Then** the M365 card is visible with Connect enabled. | Unit (RTL) |
| **AC-M365SEP-017** | **Given** an org Admin, **When** the admin integrations surface renders, **Then** the M365 organisation-approval affordance appears beside ClickUp and ERPNext. | Unit (RTL) |
| **AC-M365SEP-018** | **Given** every redirect target emitted by `callback.ts`, **When** each is resolved against the application's real route table, **Then** each matches a concrete route and none falls through to the catch-all. | Unit |
| **AC-M365SEP-019** | **Given** any rejection reaching a surface, **When** it renders, **Then** no token, `oid`, tenant id, or raw Microsoft error appears in the DOM or response body. | Unit |
| **AC-M365SEP-020** | **Given** an Operator has entitled an org and its admin has approved the app, **When** an active member connects, **Then** the journey completes end to end. | E2E — **deferred to TBD-3** (needs a live connection) |

### Mandatory mutation checks (NFR-M365SEP-009)

Not satisfiable by reading code. Break each, observe red, revert:

1. Data-access gate returns success immediately → **AC-003 / 005 / 011 / 012** red.
2. **Delete only the explicit `status !== 'active'` check** → **AC-003 must still go red.** If it stays
   green, the test is proving the `org_features` RLS side effect rather than the requirement, and
   NFR-M365SEP-002 is not implemented. **The most important check here** — it is what prevents regressing to
   today's accidental protection (§1.4).
3. Drop `.eq('user_id', userId)` from the connection lookup → **AC-008 / 009** red.
4. Re-add a `platform_operators` lookup to the data-access gate → **AC-001 / 006** red.
5. Point a callback redirect at a non-existent route → **AC-018** red. (If green, §1.3 can recur.)

### Gates before merge

- **`security-auditor` pass** on the widened boundary — STRIDE on both gates, the disabled-member path, the
  new step-2 endpoint, and cross-org reachability. A **new** gate for this change, distinct from the
  2026-07-24 live audit.
- Both concurrency probes green — `scripts/m365-{race,deadlock}-probe.sh`. This change does not touch the
  lock order; that claim is *verified*, not asserted.
- Full `npm run verify` from `pmo-portal/`.

---

## 5. Decisions and open questions

- **✅ Any active member may connect and browse** (owner, 2026-07-30) — FR-M365SEP-011.
- **✅ A disabled member gets its own error code and copy** (owner, 2026-07-30) — FR-M365SEP-013.
- **✅ Step 2 reuses the ADR-0065 admin surface and gate** rather than a new one — FR-M365SEP-004/009.
- **✅ No approval state is stored** — Microsoft is the authority (§1.5, NFR-M365SEP-005).
- **OQ-A (Director, low stakes).** Where does the personal connect card live? Options: a new `/integrations`
  route for any active member; or a personal-settings surface (none exists today, `App.tsx:99-142`).
  **Recommendation: one new route, one card, one nav entry** — extended later if a second personal
  integration appears. Also fixes §1.3 by giving the callback a real target to redirect to.
- **OQ-B (Director).** Does step 2 need its own action on `m365-token-custody`, or does it belong with the
  ADR-0065 `external-connect` family? **Recommendation: a new action on `m365-token-custody`** — it must
  build the consent URL from the same tenant and client id as `initiate_connect` (FR-M365SEP-006), and those
  live in this function's configuration.
- **OQ-C (deferred, ADR-0063).** Per-org `M365_TENANT_ID`. Not needed while each client has its own
  deployment; out of scope so this change stays small.
