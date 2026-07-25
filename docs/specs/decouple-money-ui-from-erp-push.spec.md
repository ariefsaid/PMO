# Spec: Decouple money-write UI from the ERP push (async push status, no UI freeze)

> **Status:** SIGNED OFF (owner, 2026-07-25) — all §5 open questions resolved; scope is ALL FIVE
> money flows (F1–F5). Author: eng-planner. Date: 2026-07-24.
>
> **Base branch:** `origin/dev` (this spec references ERPNext P2/P3 machinery — `budgets.ts::activateAndPush`,
> `dispatchDomainCommand`, the `adapter-dispatch` edge fn, the `external_command_outbox`, the `erpnext-sweep`
> backstop, and `get_budget_push_status` — which live on `dev`, NOT on the authoring worktree).
>
> **This is a REWIRE of the FE/UI seam, not new backend.** The durable-write + eventual-consistency
> machinery already exists: **ADR-0055** (external adapters — SoT/enhancement/write-through), **ADR-0058**
> (the `external_command_outbox` + `erpnext-sweep` reconciliation backstop that owns eventual consistency),
> and the shared **pending-push behavior** shipped in P0 (`pmo-portal/src/lib/adapterSeam/pendingPush.ts`,
> FR-EAS-060..063). This spec removes the **synchronous blocking `await`** on the external push from the
> money-write UI and replaces it with **enqueue-now + reflect-status-async**.
>
> Conventions (house): EARS requirements (`FR-APU-`/`OBS-APU-`/`NFR-APU-`), Given/When/Then acceptance
> criteria (`AC-APU-###`), ADR-0010 test-pyramid traceability (each AC owned by one test at its lowest
> sufficient layer, AC-id tagged in the test title). Terms used exactly per `docs/glossary.md` §Integration:
> SoT, externally-owned domain, read-model, enhancement, adapter, adapter contract, external tier, outbox,
> sweep.

---

## 0. Job story

> **When I take a money action that must eventually reach ERPNext (activate a budget version, submit a
> sales invoice, record a payment, advance a procurement phase, submit a timesheet), I want the PMO-side
> result to be instant and durable and the app to stay responsive — so a slow or down ERPNext never freezes
> my work — while the app tells me honestly, and separately, whether the push to ERPNext has landed yet.**

The observed failure: money-write UI actions synchronously `await` the external push and hold the confirm
dialog open with disabled buttons until the push resolves. When ERPNext is slow or unreachable the UI
**freezes**. Concretely, activating a budget version (`src/lib/db/budgets.ts::activateAndPush` →
`dispatchDomainCommand` → the `adapter-dispatch` edge fn) leaves the `ConfirmDialog` open and disabled until
the push returns; a down ERPNext freezes budget activation (and every sibling money flow), and this broke CI
e2e **AC-732**. A tactical client+server timeout is being added separately; **this spec is the architectural
fix that removes the freeze class entirely** and demotes the timeout to a safety net (see the companion ADR).

---

## 1. Context (AS-IS) and scope

### 1.1 What already exists (the machinery this rewires onto)

- **Durable local write + eventual push (ADR-0055 §4/§6, ADR-0058).** For an externally-owned money domain
  the PMO-side effect is recorded durably in Supabase (the read-model / the PMO-owned enhancement, e.g. the
  active `budget_versions` row) and the push to ERPNext is captured as an **outbox** entry
  (`external_command_outbox`). The **`erpnext-sweep`** backstop drains the outbox and reconciles the ERP
  answer back into the read-model. Eventual consistency is ALREADY owned here — the UI does not need to
  block to guarantee delivery.
- **Async push-status source.** `get_budget_push_status` (RPC) + the budget push-status mirror already
  expose, per budget/version, whether the ERP push is `pending` / `pushed` / `failed` (or `held`). This is
  the read the UI polls; it is org-scoped by RLS (`auth_org_id()`), no `org_id` from the client.
- **Shared pending-push behavior (P0, FR-EAS-060..063).** `pmo-portal/src/lib/adapterSeam/pendingPush.ts`
  defines the state machine `idle`→`pushing`→`pushed`|`push-failed` and `classifyExternalError(err)` →
  `{ headline, detail }`. `TaskPushBadge` (`pmo-portal/src/components/tasks/TaskPushBadge.tsx`) is the
  presentational precedent (color-not-only, DESIGN.md tokens, aria-labelled) — the money badge is its
  generalization.

### 1.2 What is wrong (AS-IS)

- **OBS-APU-001** (observed) The money-write DAL functions on `dev` (`budgets.ts::activateAndPush`, and the
  sibling SI-submit / PE-submit / procurement-transition / timesheet-submit dispatch call sites) `await
  dispatchDomainCommand(...)` **inline in the mutation**, so the mutation promise does not resolve until the
  external push resolves.
- **OBS-APU-002** (observed) The calling surfaces (`ConfirmDialog` in the budget-activate flow; the money
  submit modals) keep the dialog open with disabled action buttons for the whole duration of the awaited
  push — the user cannot dismiss or continue.
- **OBS-APU-003** (observed) A slow/unreachable ERPNext therefore freezes the PMO action; the PMO-side write
  (which is durable and complete independently of the push) is not acknowledged until the ERP round-trip
  returns; CI e2e AC-732 fails when ERPNext is down/slow in the test environment.

### 1.3 Affected flows (the dispatch call sites — the freeze class)

Every money-write that routes through the ERPNext dispatch is in this class. Enumerated from the ADR-0055 §5
capability map (money that has happened or is committed = externally-owned) and the current dispatch call
sites:

| # | Flow | PMO-side durable fact (returned instantly) | The ERP push (async) | Push-status source |
|---|---|---|---|---|
| F1 | **Budget version activate/push** (`budgets.ts::activateAndPush`) | the active `budget_versions` row (PMO owns versions) | project active version into ERPNext `Budget` object | `get_budget_push_status` + mirror |
| F2 | **Sales Invoice submit** (spine 4 Revenue/AR) | the outbox entry (the SI is ERP-owned; local durable fact = "queued") | create/submit `Sales Invoice` | outbox status (per doc) |
| F3 | **Payment Entry submit** | the outbox entry ("queued") | create/submit `Payment Entry` | outbox status (per doc) |
| F4 | **Procurement chain transition** (PR/RFQ/PO/GR/Invoice/Payment advance) | the PMO procurement record's new phase (ADR-0012/0033) | push the corresponding ERP document | outbox status (per record) |
| F5 | **Timesheet submit/approve** (approve = command, ADR-0055 §5) | the PMO timesheet's submitted/approved state | create/submit ERPNext `Timesheet` | outbox status (per timesheet) |

Adjacent same-class flows (convert under the same pattern when they land; not the freeze that triggered this
spec, but MUST NOT reintroduce a blocking await): **party-master create** (Company/Contact → Customer/
Supplier/Contact) and **sales documents** (Quotation / Sales Order). Listed for completeness; F1–F5 are the
in-scope conversions here.

### 1.4 Scope (locked)

- **IN:** rewiring F1–F5 so the PMO-side write returns immediately and the ERP push is enqueued to the
  existing `external_command_outbox` (never awaited in the mutation); a **generalized async push-status
  indicator** (a `MoneyPushBadge` generalizing `TaskPushBadge`, reading the outbox / `get_budget_push_status`
  status, NOT the write-request lifecycle); the confirm/submit surfaces closing on PMO-write success; the
  **money-honesty invariants** (the four-fact fence, §2.3); the byte-for-byte guarantee for orgs that do NOT
  employ ERPNext.
- **OUT (do NOT build here):** the outbox table, the `erpnext-sweep`, `get_budget_push_status`, or any RLS
  on them (ADR-0058 owns them — referenced, not re-specced); the tactical client+server timeout (a separate
  issue; this spec only reclassifies it as a safety net); any ERPNext API mapping; new money domains;
  party/sales-order conversions (adjacent, §1.3); retry/replay UX beyond a single manual "retry push"
  affordance surfaced from the failed state.

### 1.5 Non-goals / preserved invariants

- The external system remains SoT for its domains (ADR-0055 §3). The read-model is machine-written only;
  users never write it. Decoupling changes **when the UI stops waiting**, not **who owns truth**.
- Eventual delivery is unchanged: the outbox + sweep still guarantee the push lands (or surfaces `failed`).
  This spec does not weaken the delivery guarantee; it removes the UI's participation in it.

---

## 2. Requirements (EARS)

### 2.1 Non-blocking write path

- **FR-APU-001** (event-driven) When the user confirms a money action in F1–F5, the system shall perform the
  PMO-side durable write and **resolve the mutation without awaiting the external push** — the mutation
  promise shall settle on the PMO-side write outcome alone.
- **FR-APU-002** (event-driven) When the PMO-side write of a money action succeeds, the system shall
  **enqueue the ERP push** onto the `external_command_outbox` (the durable hand-off), and shall NOT invoke
  the `adapter-dispatch` edge function inline on the mutation path.
- **FR-APU-003** (state-driven) While ERPNext is slow or unreachable, the success of a money action's
  PMO-side write shall be **unaffected** — no money action's success is gated on ERP reachability
  (removes OBS-APU-003).
- **FR-APU-004** (event-driven) When the PMO-side write of a money action succeeds, the confirm/submit
  surface (e.g. `ConfirmDialog`, the money submit modal) shall **close (or re-enable) immediately** on that
  outcome, never remaining open+disabled pending the push (removes OBS-APU-002).
- **FR-APU-005** (event-driven) When the PMO-side write itself fails (validation, RLS `42501`, FK `23503`,
  etc.), the surface shall surface that failure via the existing `classifyMutationError` path unchanged —
  a PMO-side write failure is NOT a push failure and shall not be enqueued.

### 2.2 Async push-status contract

- **FR-APU-010** (ubiquitous) The system shall expose, per money record with an outstanding or completed ERP
  push, an **async push status** drawn from the states `queued`, `pushing`, `pushed`, `failed`, `held`,
  sourced from the outbox / `get_budget_push_status` (NOT from the write request's lifecycle).
- **FR-APU-011** (ubiquitous) The system shall render the async push status as a **non-blocking indicator**
  (a `MoneyPushBadge`, generalizing `TaskPushBadge`): a distinct label alongside an icon (never color-only,
  DESIGN.md Tinted-Status), never a modal, never a disabled control.
- **FR-APU-012** (event-driven) When a money record has no ERP push outstanding or applicable (e.g. an
  org that does NOT employ ERPNext, or a PMO-owned-only record), the system shall render **no push
  indicator** — the surface stays byte-for-byte the pre-adapter UI (parallels FR-EAS-062 / AC-CUA-061).
- **FR-APU-013** (state-driven) While a push status is `queued` or `pushing`, the indicator shall show an
  in-flight affordance (e.g. "Queued to ERP" / "Pushing…") that conveys the push has NOT yet been confirmed
  by ERPNext.
- **FR-APU-014** (event-driven) When a push status becomes `failed` or `held`, the indicator shall carry the
  classified external-error headline (`classifyExternalError`) and offer a single **manual "retry push"**
  affordance that re-enqueues the outbox entry — without blocking any other UI.
- **FR-APU-015** (ubiquitous) The push-status read shall be **org-scoped by RLS** (`get_budget_push_status`
  / the outbox status RPC resolve org from `auth_org_id()`); the client shall NEVER send `org_id`
  (ADR-0001 seam, NFR parallels FR-BV-PERF-001).
- **FR-APU-016** (event-driven) When the `erpnext-sweep` reconciles a push (success or failure) into the
  read-model, the UI's next push-status read shall reflect the terminal state (`pushed` / `failed`) — the
  indicator converges without a user write.

### 2.3 Money-honesty invariants (the four-fact fence)

The UI must keep four facts **distinct** and never conflate them. Announcing a push that has not happened is
forbidden.

- **FR-APU-020** (ubiquitous) The system shall treat these as four separate facts and never present one as
  another:
  1. **PMO-side write happened** (local durable truth — e.g. "Version activated", "Submission queued");
  2. **Push queued/in-flight** (the outbox holds it — NOT yet ERP-confirmed);
  3. **Push confirmed by ERPNext** (`pushed` — the ERP acknowledged);
  4. **Push failed/held** (the ERP rejected or the outbox could not deliver).
- **FR-APU-021** (event-driven) When a money action's PMO-side write succeeds but the push is not yet
  ERP-confirmed, the system shall NOT display any language asserting ERP acceptance (no "Submitted to
  ERPNext", "Invoice posted", "Budget synced") — it shall assert only fact 1 and fact 2.
- **FR-APU-022** (state-driven) While a flow has NO durable PMO-side truth of its own (F2/F3 — the document
  exists only in ERP), the PMO-side success message shall state the **queued** fact ("Submission queued"),
  never a completion fact ("Submitted").
- **FR-APU-023** (event-driven) When a push status is `pushed`, the system may assert ERP acceptance
  (fact 3) — and only then.
- **FR-APU-024** (ubiquitous) The system shall never mark a money record's ERP push `pushed` from the
  client; only the sweep/read-model reconciliation (ADR-0058) may set the terminal `pushed` fact
  (single-writer-of-truth, ADR-0055 §3).

### 2.4 Non-functional

- **NFR-APU-PERF-001** (ubiquitous) A money action's confirm→acknowledged latency shall be bounded by the
  PMO-side write alone (a single Supabase RPC/insert), independent of ERPNext round-trip time.
- **NFR-APU-A11Y-001** (ubiquitous) The push indicator shall meet AA contrast on its tinted fills (reuse the
  `--status-won-text` / `--status-lost-text` idiom, per `TaskPushBadge`) and expose its state via
  `role="status"` + a descriptive `aria-label`.
- **NFR-APU-REGRESSION-001** (ubiquitous) Orgs that do NOT employ ERPNext, and PMO-owned-only records, shall
  be byte-for-byte the pre-rewire UI (no badge, no polling, no new error surface).
- **NFR-APU-COMPAT-001** (ubiquitous) The DAL/repository signatures for F1–F5 shall not leak external-tier
  concepts into non-ERPNext callers (parallels ADR-0056 decision 2 — push status is composed at the
  hook/surface layer, not threaded through the mutation return type).

---

## 3. Acceptance criteria (Given/When/Then)

> Each AC names its owning layer per ADR-0010; the owning test AC-id-tags the criterion in its title.

### Non-blocking write path

- **AC-APU-001** — Budget activation resolves on the PMO-side write, not the push. *(covers FR-APU-001/002)*
  **Given** a Draft budget version and an `external_command_outbox` enqueue stub,
  **When** `activateAndPush(versionId)` is called,
  **Then** it resolves as soon as the `activate_budget_version` RPC succeeds and enqueues the push to the
  outbox, **and** it never `await`s the `adapter-dispatch` edge function on the mutation path.
  *Owner:* Vitest unit — `pmo-portal/src/lib/db/budgets.activateAndPush.test.ts`.

- **AC-APU-002** — A down/slow ERPNext does not delay a money action's acknowledgement. *(covers FR-APU-003;
  NFR-APU-PERF-001)*
  **Given** the outbox enqueue succeeds and the external push transport is stubbed to never resolve,
  **When** `activateAndPush(versionId)` is called,
  **Then** the returned promise still settles (on the PMO-side write) without waiting on the push.
  *Owner:* Vitest unit — `pmo-portal/src/lib/db/budgets.activateAndPush.test.ts`.

- **AC-APU-003** — The confirm dialog closes on PMO-write success, not on the push. *(covers FR-APU-004)*
  **Given** the budget-activate `ConfirmDialog` open and the push status source stubbed `queued`,
  **When** the user confirms and the `activate_budget_version` write resolves,
  **Then** the dialog closes and its buttons are re-enabled immediately (not gated on a push resolution).
  *Owner:* Vitest + RTL component test — the budget-activate surface test
  (`pmo-portal/pages/**/__tests__/BudgetActivate.dialogClose.test.tsx`).

- **AC-APU-004** — A PMO-side write failure is surfaced as a write error, not enqueued as a push. *(covers
  FR-APU-005)*
  **Given** `activate_budget_version` rejects (e.g. RLS `42501` / not-Draft trigger),
  **When** `activateAndPush(versionId)` is called,
  **Then** it throws the `classifyMutationError`-classified error **and** no outbox enqueue occurs.
  *Owner:* Vitest unit — `pmo-portal/src/lib/db/budgets.activateAndPush.test.ts`.

### Async push-status contract

- **AC-APU-010** — The money push-status indicator renders each state distinctly. *(covers
  FR-APU-011/013/014)*
  **Given** a `MoneyPushBadge` fed each status,
  **When** it renders `queued`/`pushing`/`pushed`/`failed`/`held`,
  **Then** each shows a distinct label+icon (never color-only), and `failed`/`held` carry the classified
  headline + a "retry push" affordance.
  *Owner:* Vitest + RTL — `pmo-portal/src/components/money/MoneyPushBadge.test.tsx`.

- **AC-APU-011** — No indicator + no polling for a non-ERPNext org. *(covers FR-APU-012;
  NFR-APU-REGRESSION-001)*
  **Given** an org whose `external_domain_ownership` does not flip the money domains to ERPNext,
  **When** the budget / money surfaces render,
  **Then** no `MoneyPushBadge` is present and no push-status read is issued.
  *Owner:* Vitest + RTL — the money-surface regression test
  (`pmo-portal/pages/**/__tests__/*.pushIndicator.regression.test.tsx`).

- **AC-APU-012** — Push status converges after the sweep, with no user write. *(covers FR-APU-016)*
  **Given** a version whose push status read returns `queued`, then (after the sweep) `pushed`,
  **When** the surface re-reads `get_budget_push_status`,
  **Then** the badge transitions `queued`→`pushed` without any user action.
  *Owner:* Vitest + RTL (fake timers over the poll) — the budget push-status surface test.

- **AC-APU-013** — The push-status read is org-scoped and sends no `org_id`. *(covers FR-APU-015)*
  **Given** the `get_budget_push_status` RPC (org-scoped by `auth_org_id()`),
  **When** a user of org B reads the push status of org A's budget,
  **Then** RLS returns no row (no cross-org leak) and the client call carries no `org_id` argument.
  *Owner:* pgTAP — `supabase/tests/*_budget_push_status_rls.test.sql` **(reference-only: this RLS is owned by
  ADR-0058; this AC pins that the rewired FE relies on it and passes no `org_id`).**

### Money-honesty (four-fact fence)

- **AC-APU-020** — A PMO-write success never claims ERP acceptance. *(covers FR-APU-020/021)*
  **Given** the budget-activate flow with push status `queued`,
  **When** the write succeeds,
  **Then** the success message asserts only "Version activated" (fact 1) and a "Queued to ERP" push state
  (fact 2), and contains no "synced/posted/submitted to ERPNext" language.
  *Owner:* Vitest + RTL — the budget-activate surface test (asserts copy).

- **AC-APU-021** — A document-only submit (SI/PE) announces "queued", not "submitted". *(covers FR-APU-022)*
  **Given** an SI-submit flow (F2) whose only durable local fact is the outbox entry,
  **When** the submit's PMO-side hand-off succeeds,
  **Then** the acknowledgement reads "Submission queued" (never "Submitted"/"Posted") until push status is
  `pushed`.
  *Owner:* Vitest + RTL — the SI-submit surface test
  (`pmo-portal/pages/**/__tests__/SalesInvoiceSubmit.queuedCopy.test.tsx`).

- **AC-APU-022** — Only the sweep sets `pushed`; the client cannot. *(covers FR-APU-024)*
  **Given** the client dispatch/enqueue path,
  **When** a money action is enqueued,
  **Then** no client code path writes a `pushed` terminal status — the mirror/read-model `pushed` write is
  reachable only from the service-role sweep.
  *Owner:* pgTAP — the outbox/mirror write-policy test **(reference-only, owned by ADR-0058; pinned here as
  a money-honesty guardrail the FE rewire depends on).**

### End-to-end regression (the freeze that triggered this spec)

- **AC-APU-030** — Activating a budget version while ERPNext is down does not freeze the UI. *(covers
  FR-APU-001/003/004; the AC-732 regression)*
  **Given** a Draft budget version and an ERPNext that is unreachable (dispatch/outbox-drain stubbed
  down in the e2e environment),
  **When** the user activates the version,
  **Then** the confirm dialog closes, the version shows Active, the page stays interactive, and a
  non-blocking "Queued to ERP" push indicator is shown (never a frozen disabled dialog).
  *Owner:* Playwright e2e — `pmo-portal/e2e/AC-APU-030-budget-activate-erp-down-no-freeze.spec.ts`
  **(this is the curated cross-stack journey that supersedes the freeze mode AC-732 hit).**

---

## 4. Traceability (AC → requirement → owning layer → test)

| AC | Requirement(s) | Layer (ADR-0010) | Owning test |
|---|---|---|---|
| AC-APU-001 | FR-APU-001, FR-APU-002 | Unit (Vitest) | `pmo-portal/src/lib/db/budgets.activateAndPush.test.ts` |
| AC-APU-002 | FR-APU-003, NFR-APU-PERF-001 | Unit (Vitest) | `pmo-portal/src/lib/db/budgets.activateAndPush.test.ts` |
| AC-APU-003 | FR-APU-004 | Unit (RTL) | `pmo-portal/pages/**/__tests__/BudgetActivate.dialogClose.test.tsx` |
| AC-APU-004 | FR-APU-005 | Unit (Vitest) | `pmo-portal/src/lib/db/budgets.activateAndPush.test.ts` |
| AC-APU-010 | FR-APU-011/013/014 | Unit (RTL) | `pmo-portal/src/components/money/MoneyPushBadge.test.tsx` |
| AC-APU-011 | FR-APU-012, NFR-APU-REGRESSION-001 | Unit (RTL) | `pmo-portal/pages/**/__tests__/*.pushIndicator.regression.test.tsx` |
| AC-APU-012 | FR-APU-016 | Unit (RTL, fake timers) | budget push-status surface test |
| AC-APU-013 | FR-APU-015 | Integration (pgTAP) | `supabase/tests/*_budget_push_status_rls.test.sql` (ref — ADR-0058-owned) |
| AC-APU-020 | FR-APU-020/021 | Unit (RTL) | budget-activate surface test |
| AC-APU-021 | FR-APU-022 | Unit (RTL) | `pmo-portal/pages/**/__tests__/SalesInvoiceSubmit.queuedCopy.test.tsx` |
| AC-APU-022 | FR-APU-024 | Integration (pgTAP) | outbox/mirror write-policy test (ref — ADR-0058-owned) |
| AC-APU-030 | FR-APU-001/003/004 (AC-732 regression) | E2E (Playwright) | `pmo-portal/e2e/AC-APU-030-budget-activate-erp-down-no-freeze.spec.ts` |

> Note: AC-APU-013 and AC-APU-022 own no NEW RLS — the outbox/mirror RLS is owned by ADR-0058's pgTAP. They
> are listed as **reference** proofs that the rewired FE depends on those guarantees (passes no `org_id`,
> never writes `pushed`); the implementing plan should reference the existing pgTAP rather than duplicate it.

---

## 5. Open questions — ✅ ALL RESOLVED (owner, 2026-07-25)

1. **ADR number reconciliation.** ✅ The companion ADR is **ADR-0062**
   (`docs/adr/0062-async-erp-push-ui.md`) — 0061 was the ceiling on `origin/dev` at relocation time.
2. **Conversion order.** ✅ **OWNER: all five flows (F1–F5) convert in this issue** — budget activate,
   sales-invoice submit, payment-entry submit, procurement transition, timesheet submit. NOT an F1-only
   reference conversion. Implementation consequence: the enqueue-and-return pattern must be factored ONCE
   (a shared seam) and applied to all five, not copy-pasted; each flow still owns its own e2e journey per
   ADR-0010. Because a single flawed shared pattern would land on all five money paths simultaneously, the
   plan MUST gate on: (a) the shared seam reviewed before the five call-sites are rewired, (b) a mutation
   check proving a broken seam turns the suite red, (c) `security-auditor` on the full five-flow diff.
3. **Retry-push scope.** ✅ **OWNER: keep the manual "retry push" affordance** (FR-APU-014). The sweep
   remains the real backstop; the button re-enqueues so an operator has an action instead of waiting on an
   invisible cron. Must be idempotent — re-enqueuing an already-`pending` command MUST NOT create a second
   ERP document (dedupe on the outbox key, not on button state).
4. **`held` state semantics.** ✅ **OWNER: `held` and `failed` are presented DISTINCTLY.**
   - `held` = waiting on an upstream policy/approval hold. Neutral styling, no error affordance, copy
     tells the user no action is needed from them. NOT collapsed into `failed`.
   - `failed` = ERPNext rejected the document. Error styling + the retry affordance + the reason.
   Rationale (owner): collapsing them tells someone to fix a problem that is not theirs and that retrying
   cannot resolve.
