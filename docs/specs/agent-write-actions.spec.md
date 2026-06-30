# SDD: Agent Write Actions with Approve/Deny (A3)

**Feature:** Write `AgentAction`s (repository methods / security-definer RPCs) with `confirm:true`
→ `needs-approval` event → panel approve/deny chip → deputy-re-authorized execution. Agent-proposes,
user-disposes — made real.
**Spec ID prefix:** AW
**ADR refs:** ADR-0040 (Option A behind a B-shaped seam; A3 = write AgentActions + confirm:true →
needs-approval approve/deny UX), ADR-0016 (FE authz primitive — `can()` is UX-only, real JWT),
ADR-0017 (repository/API seam — writes through repositories/RPCs), ADR-0019 (server-enforced SoD +
Admin-only delete gating), ADR-0010 (test pyramid), ADR-0001 (org_id seam — stamped by RLS, never
client-sent), ADR-0039 (deputy model + untrusted-output boundary).
**Layer ownership (ADR-0010):**
- Handler approve/deny/idempotency/deputy-reauth logic → Vitest (mocked deps)
- SoD/RLS write-cannot-exceed-permission proof → pgTAP (`supabase test db`)
- Cross-stack approve→write→reflected journey → ONE curated Playwright e2e (mocked edge fn)
**Status:** Draft — 2026-06-30
**Author:** Director (Claude Opus 4.8)

---

## 1. Context and Job Story

### Scope: A3 ONLY

A1 shipped the `AgentRuntime` port + `PmoNativeRuntime` adapter + the `agent-chat` edge function
with a read-only `query_entity` action. A2 shipped the `AssistantPanel` drawer (⌘J, transcript,
streaming, cancellation). A3 extends both: it registers **write `AgentAction`s** (`confirm: true`)
in the handler and wires the panel to show **approve/deny chips** when the handler pauses at
`needs-approval`.

**A3 explicitly does NOT cover** (deferred):

- **Deletes of any kind.** All repository `delete` methods are Admin-only + out of A3 v1 scope
  (ADR-0019 §Admin-only hard-delete; cite: AW-OD-002 gating decision below).
- **Money/SoD-gated writes:** `project.setContractValue`, `document.transition` (approver≠author
  SoD), `procurement.transition`, `timesheet.approve/reject`. These require server-enforced SoD RPCs
  (ADR-0019 §1/§2) where the agent-as-deputy could be the approver of its own proposal — a SoD
  circularity risk deferred to a future issue with explicit SoD-identity checks.
- **`compose_view` tool wired to the I3 renderer** → A4.
- **`AgentNativeRuntime` sidecar adapter** → B-adapter, deferred.
- **Durable run/transcript persistence** → post-A3 (AR-OD-005).
- **Batched multi-step approval** (approve N pending writes at once) → post-A3 (AW-OD-003).

### Job Story

> **When** I'm working in PMO and want to take a quick write action (log a note, update a field) I
> could do myself,
> **a user (any permitted role)** wants to ask their agent to propose it and confirm before it
> executes,
> **so they** get the convenience of the agent's context-gathering without losing control over what
> actually gets written — and without the agent ever writing behind their back.

This is the A3 row in `docs/jtbd.md`'s Agent assistant job: "acts through the same repos/RPCs with
approve/deny (A3)."

---

## 2. The Approve/Deny Lifecycle (the spec's spine)

> **⚑ DIRECTOR RECONCILIATION D-A3-1 (BINDING — supersedes the Option-A wording in §2, §3.1, §3.5,
> NFR-AW-SEC-007 and AW-OD-004 below).** The build follows the **stateless re-POST** model, **not** a
> server-held `waitForApproval` promise or a separate `agent-approve` endpoint:
> - The handler does **not** block on an injected `waitForApproval`. When the model emits a `confirm:true`
>   tool_use, the handler emits the `needs-approval` AgentEvent (carrying `{ toolUseId, actionName,
>   structuredArgs, server-composed humanSummary }`) and **ends the stream** with run status
>   `needs-approval`. No promise is held server-side; the function returns.
> - **Approve/Deny is a normal `followUp` re-POST to `agent-chat`** carrying a `decision` for that
>   `toolUseId` (no second endpoint). On approve, the handler **re-validates `structuredArgs` against the
>   action `inputSchema` and re-derives authorization (`org`/role + `can()`), then executes under the
>   poster's caller JWT** — RLS/SoD is the ceiling (D-A3-2: a tampered decision cannot escalate beyond
>   what the user could already do in the UI). On deny, a `tool_result` "user declined" is appended and
>   the model acknowledges.
> - Idempotency/"already consumed" is **positional** (the trailing unresolved `tool_use` in the replayed
>   transcript) + the UI chip-disable, not an in-memory `consumed` set. AW-OD-005's expiry is realized as
>   chip-disable + graceful "stale decision → rejected", not a server timer.
>
> **The authoritative behavior + tests are in `docs/plans/2026-06-30-agent-write-actions.md` §5. Treat the
> prose below as the lifecycle intent; where it names `waitForApproval`/`agent-approve`, read the plan.**

The entire A3 design pivots on this protocol. Every other requirement is a consequence of it.

```
  [Model emits tool_use for a confirm:true action]
          │
          ▼
  [Handler: pauses the loop]
  emit AgentEvent { type:'status', payload:{ status:'needs-approval',
                    actionName, humanSummary, structuredArgs, pendingId } }
          │
          ▼
  [PmoNativeRuntime: yields the needs-approval event; stores pending state]
          │
          ▼
  [AssistantPanel: renders approve/deny chip]
  "Agent wants to log an activity on Acme Corp — Approve / Deny?"
          │
     ┌────┴────┐
  Approve    Deny
     │          │
     ▼          ▼
  runtime.     runtime.
  control(     control(
  runId,       runId,
  'approve')   'reject')
     │          │
     ▼          ▼
  [Handler resumes]     [Handler skips the write]
  re-validates authz    emit AgentEvent { type:'status',
  executes write via    payload:{ status:'running',
  repository/RPC under  event:'rejected', actionName } }
  caller JWT            loop continues
  emit tool + status    │
  events                ▼
     │          [Model sees rejection tool_result]
     ▼          [Responds with a message; run completes]
  [Write is visible
   in the app — same
   as the user doing it
   themselves]
```

The handler **pauses at the pending write and waits** — it does not complete, error, or time out
while waiting for the user's approval decision. The SSE stream remains open (or the adapter
re-opens it after the control command signals the decision; see FR-AW-006/007). The panel renders
the chip; the user's choice resumes or skips the write.

---

## 3. Functional Requirements (EARS)

Conventions: requirements use EARS (ubiquitous / event-driven `When…` / state-driven `While…` /
optional `Where…`). Tags: **[HANDLER]** edge-function loop · **[PORT]** port/adapter seam ·
**[PANEL]** AssistantPanel chip UI · **[ACTION]** a specific write AgentAction.

### 3.1 The `confirm` Mechanism End-to-End `[HANDLER]` `[PORT]`

**FR-AW-001** (ubiquitous)
The `AgentAction` contract (already in `src/lib/agent/runtime/port.ts`) defines `confirm?: boolean`.
When a write action is registered with `confirm: true`, the handler SHALL treat it as a
**confirm-gated action**: when the model emits a `tool_use` block for that action, the handler
SHALL **pause the tool-use loop** and emit a `needs-approval` event BEFORE executing the write.

**FR-AW-002** (event-driven)
When the handler encounters a `confirm: true` action's `tool_use` block, it SHALL emit an
`AgentEvent` with:
```ts
{
  type: 'status',
  payload: {
    status: 'needs-approval',
    pendingId: string,        // stable UUID for this specific pending write; idempotency key
    actionName: string,       // the action's name (e.g. 'create_activity')
    humanSummary: string,     // a short human-readable description of the proposed write
                              // composed by the handler from the action's args — NOT model-generated
                              // (the model supplies the tool_use args; the handler composes the summary)
    structuredArgs: object,   // the validated (but not yet executed) tool input
  }
}
```
The `pendingId` SHALL be unique per tool_use invocation (minted by the handler via `crypto.randomUUID()`).
The `humanSummary` SHALL be computed deterministically from the action name and validated args
(e.g. `"Log a call activity on contact ${contactId}"`); it SHALL NOT be generated by the model.

**FR-AW-003** (state-driven)
While the handler has emitted a `needs-approval` event and not yet received a resolution
(`approve` or `reject` control command), the handler SHALL hold the pending write in memory
(indexed by `pendingId`) and NOT advance the tool-use loop. The SSE stream SHALL remain open
(the handler is paused, not terminated). The run's `AgentRunStatus` is `needs-approval`.

**FR-AW-004** (ubiquitous)
The handler's `HandlerDeps` interface SHALL be extended with a `waitForApproval` injectable:
```ts
waitForApproval: (pendingId: string) => Promise<'approved' | 'rejected'>
```
This interface enables Vitest to mock the approval signal without a real HTTP round-trip (DI
parity with the existing Anthropic SDK and Supabase mocks). In production (the Deno index), the
implementation signals via a shared in-memory `Map<pendingId, resolver>` written by the
`/approve` or `/reject` sub-request (FR-AW-006).

**FR-AW-005** (event-driven)
When `waitForApproval` resolves `'approved'`:
1. The handler SHALL **re-validate authorization** (FR-AW-010) under the caller JWT before
   executing the write.
2. On pass: execute the write via the repository method or security-definer RPC under the caller-JWT
   Supabase client (`ctx.supabase`).
3. Emit a `tool` `AgentEvent` with `payload: { name: actionName, pendingId, result: <write result> }`.
4. Append the tool result to the Anthropic messages array and resume the loop.

When `waitForApproval` resolves `'rejected'`:
1. The handler SHALL NOT execute the write.
2. Emit a `status` `AgentEvent` with `payload: { status: 'running', event: 'rejected', actionName, pendingId }`.
3. Append a tool_result to the messages that signals the rejection to the model
   (e.g. `"Write action rejected by user."`) so the model can respond gracefully.
4. Resume the loop (the model typically responds with a message and completes).

**FR-AW-006** (event-driven — approve control)
When `PmoNativeRuntime.control(runId, 'approve')` is called (currently a no-op in A1/A2), it
SHALL resolve the pending `waitForApproval(pendingId)` promise with `'approved'`. The adapter
SHALL know the current `pendingId` from the most recent `needs-approval` event it has seen on
that run's stream.

**FR-AW-007** (event-driven — reject control)
When `PmoNativeRuntime.control(runId, 'reject')` is called, it SHALL resolve the pending
`waitForApproval(pendingId)` promise with `'rejected'`.

**FR-AW-008** (ubiquitous — idempotency / double-approve guard)
Once a `pendingId` has been resolved (approved OR rejected), the handler SHALL mark it as
`consumed` (in-memory). Any subsequent `waitForApproval` call for the same `pendingId` SHALL
immediately return `'rejected'` (the write is a no-op; the guard fires). This ensures that a
double-click on the Approve chip, a network retry, or a race between two browser tabs cannot
execute the same write twice.

**FR-AW-009** (ubiquitous — no silent writes)
The handler SHALL NEVER execute a write `AgentAction` (`confirm: true`) without first emitting a
`needs-approval` event and receiving a resolved `waitForApproval` promise. There is NO code path
where the loop dispatches a `confirm: true` action's `run` method without an intervening approval.
This invariant SHALL be auditable by reading `handler.ts`: the `dispatch_action` helper SHALL gate
on `action.confirm` before calling `run`.

### 3.2 Deputy Re-Authorization at Execute Time `[HANDLER]`

**FR-AW-010** (event-driven)
When a write is approved, the handler SHALL re-validate the caller's authorization **at execution
time** before calling the action's `run` method, using the following checks in order:

1. **JWT freshness:** verify the caller JWT via `supabase.auth.getUser(jwt)` is still valid and the
   `userId` matches the run's authenticated `userId`. If the JWT has expired or the user has changed,
   reject with `'rejected'` and emit an `errored` status event (`error: 'AUTH_EXPIRED'`).
2. **Org seam:** re-derive `orgId` from `profiles` under the caller JWT (same as the handler's gate
   at run start, FR-AR-016). If the org lookup fails (e.g. user deprovisioned mid-run), reject.
3. **`can()` preflight (UX guard, not authority):** call `can(action, entity, ctx)` from
   `src/auth/policy.ts` with the real JWT role. If `can()` returns `false`, emit a `status` event
   with `error: 'PERMISSION_DENIED'` and treat the write as rejected. This is a UX gate — it
   surfaces a friendly message before the DB rejects it — but RLS is the authority (ADR-0016).

After these checks, the write goes through the repository/RPC under the caller-JWT client so
**RLS + SoD + FK-block fire exactly as if the user clicked the button themselves**.

**FR-AW-011** (ubiquitous — the deputy invariant)
All write `AgentAction.run` calls SHALL receive a `DeputyContext` where `supabase` is the caller-JWT
Supabase client (identical to the read actions in A1). The handler's `HandlerDeps` interface SHALL
NOT gain a service-role client field. An approved write has **exactly the same privilege ceiling**
as the authenticated user acting directly — no more, no less.

### 3.3 The `needs-approval` Event Payload Shape `[PORT]`

**FR-AW-012** (ubiquitous)
The `AgentEvent` type already supports `payload?: unknown`. A3 narrows the payload when
`type === 'status'` and the embedded `status === 'needs-approval'`:

```ts
interface NeedsApprovalPayload {
  status: 'needs-approval';
  pendingId: string;       // unique per tool_use call; idempotency key
  actionName: string;      // e.g. 'create_activity', 'update_task_status'
  humanSummary: string;    // handler-composed, human-readable; NOT model-generated
  structuredArgs: object;  // validated tool input (the args the model supplied, post-Zod/schema check)
}
```

This type SHALL be exported from `src/lib/agent/runtime/port.ts` alongside the existing types so
the panel (A2's `AssistantPanel`) and `PmoNativeRuntime` can narrow it without importing a
concrete adapter. No change to the `AgentEvent` base type is required.

**FR-AW-013** (ubiquitous — audit trail)
When the handler resolves an approval (either direction), it SHALL emit an additional `system`
`AgentEvent` with:
```ts
{
  type: 'system',
  text: '<approved|rejected>',
  payload: {
    event: 'write_resolved',
    decision: 'approved' | 'rejected',
    actionName: string,
    pendingId: string,
    // NO args values, NO result rows, NO PII — audit of the decision, not the data
  }
}
```
This event is rendered by the panel as a quiet inline notice (e.g. "Write approved ✓" or "Write
denied") and provides a lightweight in-session audit trail. It SHALL NOT log the structured args or
the write result to Supabase logs (NFR-AW-SEC-004).

### 3.4 The v1 Write Actions `[ACTION]`

**FR-AW-014** (ubiquitous — first write action: `create_activity`)
A3 SHALL register one primary write `AgentAction`: **`create_activity`** — log a CRM activity
(call / email / meeting / note) on a contact. This maps to `contact.createActivity(input, loggedById)`
in the existing `ContactRepository`.

Selection rationale:
- **Low risk, non-destructive:** `crm_activities` has no SoD constraint, no money field, no
  lifecycle-advance implication; it is a simple insert with `logged_by` stamped from the caller.
- **Exists as a repository method today:** `contact.createActivity` in `src/lib/repositories/`.
- **No deletion:** creating an activity note is reversible conceptually; hard-delete of an activity
  is Admin-only and deferred.
- **org_id: trigger-stamped** from the parent contact row (ADR-0019 §5); the agent never supplies
  it.
- **RLS:** `crm_activities` is governed by the caller's org RLS; MASTER_DATA roles write it; the
  RLS is the authority.

The action schema SHALL accept: `contactId` (UUID, required), `kind` (enum: `call | email | meeting | note`,
required), `subject` (string, max 200 chars, required), `body` (string, max 2000 chars, optional),
`occurredAt` (ISO-8601 date string, optional; defaults to now on the server if omitted).

**FR-AW-015** (ubiquitous — second write action: `update_task_status`)
A3 SHALL register a second write `AgentAction`: **`update_task_status`** — advance a task's
status field. This maps to `task.updateStatus(id, status)` in the existing `TaskRepository`.

Selection rationale:
- **Column-pinned write (ADR-0019 §4):** `updateStatus` is the narrowest task mutation — it touches
  only the `status` column. Engineers may update their own tasks (`assignee_id = auth.uid()`); PMs
  and above may update any task in their org. The RLS `WITH CHECK` enforces this at the DB level.
- **No SoD:** unlike approval flows or `contract_value`, task-status has no approver≠author rule.
- **Non-destructive:** advancing a status is reversible (status can be set back).
- **No money:** no `contract_value`, budget, or financial field is touched.

The action schema SHALL accept: `taskId` (UUID, required), `status` (enum: the valid `TaskStatus`
values: `To Do | In Progress | Done | Blocked`, required).

**FR-AW-016** (ubiquitous — deferred write actions)
The following write categories SHALL be **explicitly deferred** from A3 v1:

| Write | Reason deferred | Authority |
|---|---|---|
| `project.create`, `project.updateHeader` | Moderate complexity; no urgent agent need | ADR-0019 RLS |
| `project.setContractValue` | SoD (pre-win: PM; post-win: Exec/Finance) — agent as deputy could be both sides; SoD-identity check needed | ADR-0019 §1 |
| `document.transition` | SoD: approver≠author is a MUST at the RPC level; agent circularity risk | ADR-0019 §2 |
| `timesheet.approve`, `timesheet.reject` | SoD: approver cannot be the submitter | ADR-0019 |
| `procurement.*` lifecycle transitions | Multi-SoD, money-sensitive, complex phase rules | ADR-0019 §1/§2 |
| ALL `delete` / `archive` writes | Admin-only (hard delete) or destructive-blast-radius; explicitly out of A3 | ADR-0019 §3 / ADR-0018 |
| `task.update` (structural fields) | Needs entity resolution (name/dates/assignee from model) — higher ambiguity; deferred | — |

Every deferred write is a future A3+ issue requiring its own SoD-identity checks and pgTAP proofs.

### 3.5 `control('approve'|'reject')` Semantics `[PORT]` `[PANEL]`

**FR-AW-017** (event-driven)
When `AssistantPanel` renders an `AgentEvent` with `payload.status === 'needs-approval'`, it SHALL
display an **approval chip** in the transcript at the position of the `needs-approval` event,
containing:
- The `humanSummary` text (truncated to 120 chars if necessary).
- An "Approve" button (primary style) and a "Deny" button (secondary/destructive style).
- A "pending" state indicator while the approve/reject call is in flight.

The chip SHALL replace itself with a resolved notice ("Approved ✓" or "Denied") after the control
command is sent. The chip SHALL be disabled after resolution (no re-approval).

**FR-AW-018** (ubiquitous)
When the user clicks "Approve" on the chip, the panel SHALL call
`runtime.control(runId, 'approve')` and transition the chip to a pending state. When the panel
receives a subsequent `tool` event with the matching `pendingId` in the payload, it SHALL render
the chip in "Approved ✓" state and re-enable the composer (if the run completes after this). When
the user clicks "Deny", the panel SHALL call `runtime.control(runId, 'reject')` and render the
chip in "Denied" state.

**FR-AW-019** (state-driven)
While a run is in `needs-approval` state, the composer textarea and Send button SHALL remain
`disabled` (identical to `running` state — the user cannot submit a new message while a write
decision is pending). The Stop control SHALL remain available (cancelling the run also rejects the
pending write via the `AbortController` path: when the fetch is aborted, `waitForApproval` rejects
and the handler treats it as a rejection).

**FR-AW-020** (event-driven — adapter control signaling)
When `PmoNativeRuntime.control(runId, 'approve' | 'reject')` is called, it SHALL signal the
pending write resolution through one of two mechanisms (the choice is owner-flagged AW-OD-004):
- **Default (AW-OD-004 A): out-of-band POST to a second `agent-approve` endpoint** that matches
  `pendingId` → resolution, with the same caller-JWT `Authorization` header. The SSE stream
  remains open; the handler's `waitForApproval` resolves when the POST arrives.
- **Alternative (AW-OD-004 B): client re-POST to `agent-chat` with a `controlCmd` field** in
  `AgentChatRequest`, appending the approve/reject as a new "turn" the handler reads from the
  message stream. Requires a stateful (or re-assembled) handler.

The AW-OD-004 default is A (separate endpoint) because it keeps the SSE stream clean and avoids
re-assembling the full conversation. See AW-OD-004 for full trade-off.

---

## 4. Non-Functional Requirements

### Security — `NFR-AW-SEC-###`

**NFR-AW-SEC-001** — **No silent writes — ever.**
The handler SHALL have NO code path that executes a `confirm: true` action's `run` without a prior
`needs-approval` event and a resolved `waitForApproval('approved')`. This is auditable by reading
`handler.ts`: the dispatch helper's `if (action.confirm)` branch is the ONLY gate. A static code
review or a grep for the `run(` invocation in the write action path confirms it.

**NFR-AW-SEC-002** — **Deputy path, no privilege escalation.**
Write `AgentAction`s inherit the A1 deputy invariant: the `run` function receives only
`ctx.supabase` (the caller-JWT Supabase client). The action NEVER receives a service-role key, a
raw `ANTHROPIC_API_KEY`, or any elevated credential. The `HandlerDeps` shape has no service-role
field by construction (auditable). The agent is the user's deputy, not an admin.

**NFR-AW-SEC-003** — **RLS/SoD/FK-block are the authorities; `can()` is UX-only.**
Every approved write goes through `repository.method()` which calls the DAL function which calls
Supabase under the caller JWT. The Postgres RLS policies, security-definer RPCs (for SoD rules),
and FK constraints fire exactly as if the user acted directly (ADR-0016, ADR-0019). `can()` in the
handler's re-auth (FR-AW-010) is a pre-flight UX clarity check — not the security boundary. If
`can()` is wrong but RLS is correct, the DB rejects the write; the error propagates as a
`classifyMutationError`-style `AppError` (code `42501` for RLS denial, `23503` for FK block), and
the handler emits an `errored` tool result to the model rather than crashing the run.

**NFR-AW-SEC-004** — **No secret/PII in logs or events.**
The `needs-approval` event payload SHALL carry `structuredArgs` only for rendering the confirm chip
— NOT persisted in server logs. The audit `system` event (FR-AW-013) contains the `pendingId`,
`actionName`, and `decision` only — no args values, no row data, no PII. The handler SHALL NOT
`console.log` the tool args or the write result (mirrors NFR-AR-SEC-005).

**NFR-AW-SEC-005** — **Model args are untrusted input.**
The `structuredArgs` from the model's `tool_use` block SHALL be validated against the action's
`inputSchema` (JSON Schema) before the `needs-approval` event is emitted. If validation fails, the
handler SHALL return a structured error tool-result to the model (the same pattern as A1's
`query_entity` entity-whitelist check) and NOT emit a `needs-approval` event for an invalid write.
This prevents the model from proposing a structurally malformed write that the user might
inadvertently approve.

**NFR-AW-SEC-006** — **Denied/expired approvals NEVER execute.**
Once a `pendingId` is resolved as `'rejected'` (explicit deny, abort, or double-approve guard),
the write is unconditionally skipped. There is no retry, no fallback, no "try anyway" path. The
idempotency guard (FR-AW-008) ensures a consumed `pendingId` always returns `'rejected'`.

**NFR-AW-SEC-007** — **Approve/reject is authenticated as the same caller; no CSRF/replay.**
The `agent-approve` sub-request (AW-OD-004 A) SHALL require `Authorization: Bearer <caller JWT>`
matching the run's authenticated `userId`. A request with a different JWT SHALL be rejected 403. A
`pendingId` from a different run's `userId` SHALL never resolve. The `pendingId` is a UUID
(unguessable), time-limited by the run's lifetime (AW-OD-005 expiry), and single-use (idempotency
guard, FR-AW-008).

**NFR-AW-SEC-008** — **Deletes Admin-only and deferred.**
No write `AgentAction` in A3 shall include a `delete` operation of any kind. The `AgentAction`
registry in `handler.ts` SHALL NOT register any action whose `run` calls a `.delete(...)` or
`archiveXxx(...)` repository method. This is enforced at code review; a future A3+ issue will add
destructive actions with an Admin-role gate + explicit SoD-identity check.

### Performance — `NFR-AW-PERF-###`

**NFR-AW-PERF-001** — **Approval wait time bounded by AW-OD-005 expiry.**
The `waitForApproval` Promise SHALL time out after the configurable approval expiry window
(AW-OD-005 default: 5 minutes). On timeout, the pending write is treated as `'rejected'` and the
run progresses accordingly (the model is informed; the run may complete). This prevents an
indefinitely-open SSE stream.

**NFR-AW-PERF-002** — **Write actions are fast; no additional polling loop.**
Each write action (`create_activity`, `update_task_status`) is a single repository method call
with an existing Supabase RLS path — sub-500ms typical latency. The approve/deny interstitial
adds one user-interaction round-trip (intentional UX gate, not a perf concern). The handler emits
events immediately before and after each step.

### Accessibility — `NFR-AW-A11Y-###`

**NFR-AW-A11Y-001** — **Approval chip keyboard operability.**
The Approve and Deny buttons in the approval chip SHALL be fully keyboard-operable (Tab to each;
Enter/Space to activate). The chip SHALL have `aria-live="assertive"` so the pending write proposal
is announced by screen readers without requiring the user to focus the chip explicitly.

**NFR-AW-A11Y-002** — **Resolved chip state announced.**
After approval or denial, the chip SHALL update its text ("Approved ✓" / "Denied") and the change
SHALL be communicated to assistive technology via an `aria-live` update (the chip is in the
transcript's existing `aria-live="polite"` region from A2's NFR-AP-A11Y-003).

**NFR-AW-A11Y-003** — **Disabled composer during approval.**
While in `needs-approval` state, the `aria-disabled` attribute on the composer textarea and Send
button SHALL be set and the disabled state SHALL be communicated via a descriptive label ("A write
action awaits your decision") on the panel's status indicator.

---

## 5. Acceptance Criteria

All AC are Given/When/Then, tagged to their lowest sufficient owning layer (ADR-0010). The edge
function handler and action logic are tested in **Vitest** with the Anthropic SDK, Supabase client,
and `waitForApproval` mocked. The SoD/RLS write-ceiling proof is owned by **pgTAP**. The
cross-stack journey is ONE curated **Playwright** e2e with `page.route` mocking the edge function
(no live Anthropic, no Supabase edge fn deploy in CI).

### Handler — approve/deny/idempotency/deputy-reauth (Unit — Vitest, mocked)

**AC-AW-001** (Unit) — *Happy path: approve → write executes.*
Given a verified `userId`, a mocked Anthropic model that emits `create_activity` as a `tool_use`
block (action has `confirm: true`), and `waitForApproval` that resolves `'approved'`
When `agentChatHandler` runs
Then the handler:
- emits `user` → `needs-approval status` event (with `pendingId`, `actionName: 'create_activity'`,
  `humanSummary`, `structuredArgs`) → `tool` event (write result) → `assistant` text → terminal
  `completed` status
- calls the mocked `create_activity` run function exactly once, under the caller-JWT client
- does NOT call the write before `waitForApproval` resolves.
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

**AC-AW-002** (Unit) — *Deny → no write; model informed.*
Given the same setup but `waitForApproval` resolves `'rejected'`
When `agentChatHandler` runs
Then:
- the handler emits `needs-approval status` → `status { event:'rejected' }` events
- the mocked `create_activity` run function is NEVER called
- the Anthropic messages array includes a `tool_result` turn with rejection content so the model
  can respond gracefully
- the run eventually completes.
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

**AC-AW-003** (Unit) — *Double-approve guard: second approve → no second write.*
Given a `pendingId` that has already been resolved `'approved'` (write executed once)
When `control('approve')` is called again for the same `pendingId`
Then `waitForApproval` immediately returns `'rejected'` (consumed guard fires);
the write action's `run` method is called exactly once total.
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

**AC-AW-004** (Unit) — *Deputy re-auth: JWT expired at execution time → write aborted.*
Given `waitForApproval` resolves `'approved'` but the mocked JWT re-verification call returns
an error (expired token)
When the handler attempts to execute the write
Then the handler emits a `status` event with `error: 'AUTH_EXPIRED'`, does NOT call the write
action's `run`, and terminates the run as `errored`.
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

**AC-AW-005** (Unit) — *Schema validation rejects malformed tool args before needs-approval.*
Given the mocked model emits `create_activity` with structurally invalid args (missing required
`contactId`)
When the handler processes the `tool_use` block
Then it returns a structured error tool-result to the model (no `needs-approval` event emitted)
and the write action's `run` is NOT called.
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

**AC-AW-006** (Unit) — *`confirm: false` action (read) bypasses approve/deny entirely.*
Given the mocked model emits `query_entity` (a `confirm: false` action)
When the handler dispatches the action
Then no `needs-approval` event is emitted; `waitForApproval` is never called; the read runs
immediately and the loop continues.
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

**AC-AW-007** (Unit) — *Approval expiry: timeout → write treated as rejected.*
Given `waitForApproval` times out (the injectable timer fires before the user decides)
When the handler's approval wait expires
Then the handler treats the pending write as `'rejected'`, emits a `status` event with
`error: 'APPROVAL_EXPIRED'`, and continues the loop (model informed; run completes gracefully).
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

**AC-AW-008** (Unit) — *`can()` preflight denial → write aborted with friendly error.*
Given `waitForApproval` resolves `'approved'` but the mocked `can()` call returns `false`
When the handler attempts the deputy re-auth (FR-AW-010)
Then the handler emits a `status` event with `error: 'PERMISSION_DENIED'`, does NOT call the
write action's `run`, and emits a model-readable tool-result.
Test file: `pmo-portal/src/lib/agent/agentChatHandler.test.ts`

### SoD / RLS proof — write cannot exceed caller permission (Integration — pgTAP)

**AC-AW-009** (Integration — pgTAP) — *RLS gates `create_activity` to writer roles; denies the under-privileged role.*
*(Reconciliation R-A3-7: `crm_activities` write is gated to Admin/Exec/PM/Finance — an Engineer is **denied**,
per AC-CRM-012. The success case therefore uses a **PM**, and the Engineer is the under-privileged-denied case.)*
Given a **PM** (user A) and an **Engineer** (user C) both in org X, with `create_activity` invoked under each
user's own JWT calling `crm_activities` INSERT
When the underlying Supabase operation runs (the exact call path the write action uses)
Then the PM's INSERT **succeeds** for a contact within org X;
AND the Engineer's INSERT **returns ZERO rows** (RLS denies the non-writer role);
AND the PM's **cross-tenant** INSERT (an org Y contact) returns ZERO rows (RLS `WITH CHECK` blocks it).
Test file: `supabase/tests/agent_write_create_activity_rls.test.sql`

**AC-AW-010** (Integration — pgTAP) — *`update_task_status` is column-pinned to assignee for Engineer.*
Given user B has role `engineer` and is the `assignee_id` on task T1 in org X
When `updateStatus(T1, 'Done')` is called under user B's JWT
Then the update succeeds.
AND when user B attempts `updateStatus(T2, 'Done')` on a task T2 where `assignee_id ≠ user B`
Then the update returns zero rows updated (column-pinned RLS `WITH CHECK`, ADR-0019 §4).
Test file: `supabase/tests/agent_write_update_task_status_rls.test.sql`

**AC-AW-011** (Integration — pgTAP) — *SoD-gated write (deferred) cannot be bypassed at the DB layer.*
Given `setContractValue` is explicitly deferred from A3
When a direct UPDATE to `projects.contract_value` is attempted via a non-RPC path under a PM role JWT
Then Postgres rejects the direct column UPDATE with `42501` (the column grant is revoked — ADR-0019 §1).
(This test proves the SoD fence is at the DB, confirming A3's deferral of money writes is safe.)
Test file: `supabase/tests/agent_write_sod_contract_value.test.sql`

### Cross-stack approve→write→reflected journey (E2E — Playwright, mocked edge fn)

**AC-AW-012** (E2E — Playwright) — *Full approve journey: agent proposes activity log, user approves, write is reflected.*

Given CI with `VITE_FEATURES_AGENT_ASSISTANT=true` and `page.route` intercepting
`**/functions/v1/agent-chat` to emit:
```
{ type:'user',   text:'Log a call with Acme contact',        ... }
{ type:'status', payload:{ status:'needs-approval',
                           pendingId:'abc-123',
                           actionName:'create_activity',
                           humanSummary:'Log a call activity on contact XYZ',
                           structuredArgs:{ contactId:'...', kind:'call', subject:'Follow-up' } }, ... }
```
then, after the approve control call is detected (via a second intercepted request or a POST to
`/agent-approve`), continues with:
```
{ type:'tool',   payload:{ name:'create_activity', pendingId:'abc-123', result:{ id:'act-1' } }, ... }
{ type:'assistant', text:'Done — I\'ve logged the call activity.',  ... }
{ type:'status', payload:{ status:'completed' },                    ... }
```

**Journey:**
1. User logs in, opens the panel (⌘J).
2. User types "Log a call with the Acme contact" and presses Enter.
3. Composer is disabled; transcript shows the user bubble.
4. Approve/deny chip appears: "Log a call activity on contact XYZ" — Approve / Deny buttons.
5. User clicks "Approve".
6. Chip transitions to pending state briefly, then "Approved ✓".
7. Assistant bubble: "Done — I've logged the call activity."
8. Composer re-enables.

**Assertions:**
- After step 4: `getByRole('button', { name: /approve/i })` and `getByRole('button', { name: /deny/i })` are visible.
- After step 4: composer Send button is `disabled` (`needs-approval` state).
- After step 5: `runtime.control(runId, 'approve')` is called (verified via the intercepted control request).
- After step 7: assistant bubble matches `/logged the call activity/i`.
- After step 8: Send button is enabled.

**Negative assertion (same test or companion):** clicking Deny instead yields "Denied" on the chip;
no `create_activity` write call reaches the mocked edge fn; assistant text contains a denial
acknowledgment.

Test file: `pmo-portal/e2e/AC-AW-012-agent-write-approve-deny.spec.ts`
CI gate: PR→`dev` (`verify` lane — Playwright with `--project=chromium` against the Vite dev
server; edge fn mocked via `page.route`; no live Anthropic; no Supabase edge fn deploy).

### Panel chip UI (Unit — Vitest/RTL)

**AC-AW-013** (Unit) — *`needs-approval` event renders approve/deny chip.*
Given a mocked `AgentRuntime` that emits a `needs-approval` status event with `humanSummary`
"Log a call activity on contact XYZ"
When `AssistantPanel` renders the transcript
Then a chip is visible in the transcript containing "Log a call activity on contact XYZ";
an "Approve" button and a "Deny" button are present; the composer Send button is disabled.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AW-014** (Unit) — *Approve click calls control('approve'); chip resolves.*
Given the approve/deny chip is visible
When the user clicks "Approve"
Then `runtime.control(runId, 'approve')` is called; the chip transitions to a loading state;
when the subsequent `tool` event with matching `pendingId` arrives, the chip shows "Approved ✓".
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AW-015** (Unit) — *Deny click calls control('reject'); chip resolves; composer re-enables.*
Given the approve/deny chip is visible
When the user clicks "Deny"
Then `runtime.control(runId, 'reject')` is called; the chip shows "Denied"; the composer
re-enables after the run's terminal `completed` status event.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AW-016** (Unit) — *Resolved chip is disabled (no re-approval).*
Given the chip has been approved (shows "Approved ✓")
When the Approve button in the chip is inspected
Then it is `disabled` or absent; clicking has no effect.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AW-017** (Unit) — *axe-core: zero violations on the chip in all states.*
Given the panel rendered with the approval chip in: (a) pending state, (b) approved state, (c)
denied state
When `axe` runs on the panel subtree
Then zero violations are reported.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

---

## 6. Owner-Decision Flags (defaults applied — nothing blocks the plan)

| Flag | Decision | Default Applied | Rationale / Impact |
|---|---|---|---|
| **AW-OD-001** | Which v1 write actions ship | `create_activity` + `update_task_status` | Lowest-risk non-destructive writes with existing repository methods; no SoD; covers CRM note-taking + task progress (the two most natural agent actions). |
| **AW-OD-002** | Deletes in A3 v1 | **All deletes deferred** | Admin-only + irreversible + high blast-radius; require an additional Admin-role gate that the approve/deny UX alone doesn't fully satisfy (the agent could be asked to "delete all tasks" and a careless approve would be catastrophic). |
| **AW-OD-003** | Approval granularity: per-tool-call vs. batched | **Per-tool-call** (each `confirm: true` action triggers its own chip) | Batched approval would require the user to review N writes at once, which risks approving inattentively. Per-call ensures each write is a conscious user decision. Batching is a later UX enhancement once single-call approve is proven. |
| **AW-OD-004** | Approve/reject signaling mechanism | **Out-of-band POST to `agent-approve` endpoint (Option A)** | Keeps the SSE stream clean; the pending write waits in memory indexed by `pendingId`; the approve POST arrives on a separate HTTP channel with the caller JWT. Alternative (Option B: re-POST to `agent-chat` with `controlCmd`) requires the handler to re-assemble the conversation state from the control message — more complex. A can be built with a new Deno edge function `agent-approve` (same pattern). |
| **AW-OD-005** | Approval expiry timeout | **5 minutes** | Prevents indefinitely-open SSE streams if the user navigates away or doesn't act; 5 minutes is generous for a chip visible in the panel. On expiry the write is treated as rejected and the run completes gracefully. Configurable as `APPROVAL_TIMEOUT_MS` in the handler. |
| **AW-OD-006** | Whether the approved write is reflected in the transcript | **Yes — a system event "Write approved ✓" + the tool event shows the result** | Gives the user a clear in-session audit record; the `system` event (FR-AW-013) is the lightweight version. Full result display (e.g. show the created activity row) is owned by the design-plan. |

---

## 7. Traceability Table (ADR-0010)

Each AC is owned by ONE test at the lowest sufficient layer. The owning test names its `AC-AW-###`
in its title for `grep`-able traceability.

| AC-### | Assertion | Layer | Tool | Intended test file |
|---|---|---|---|---|
| AC-AW-001 | Happy approve → write executes | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-002 | Deny → no write; model informed | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-003 | Double-approve guard → single write | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-004 | JWT expired at execution → write aborted | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-005 | Malformed args → no needs-approval; error to model | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-006 | `confirm: false` action bypasses approve/deny | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-007 | Approval expiry → write rejected gracefully | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-008 | `can()` false → write aborted | Unit | Vitest (mocked) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AW-009 | RLS denies cross-tenant activity insert | Integration | pgTAP | `supabase/tests/agent_write_create_activity_rls.test.sql` |
| AC-AW-010 | `update_task_status` column-pinned to assignee | Integration | pgTAP | `supabase/tests/agent_write_update_task_status_rls.test.sql` |
| AC-AW-011 | SoD-deferred contract_value blocked at DB | Integration | pgTAP | `supabase/tests/agent_write_sod_contract_value.test.sql` |
| AC-AW-012 | Full approve journey cross-stack (mocked edge fn) | E2E | Playwright | `pmo-portal/e2e/AC-AW-012-agent-write-approve-deny.spec.ts` |
| AC-AW-013 | needs-approval event → chip renders | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AW-014 | Approve click → control('approve'); chip resolves | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AW-015 | Deny click → control('reject'); chip resolves | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AW-016 | Resolved chip is disabled (no re-approval) | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AW-017 | axe-core: zero violations on chip states | Unit | Vitest/RTL + jest-axe | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |

**CI placement:**
- AC-AW-001 → AC-AW-008, AC-AW-013 → AC-AW-017: `npm run verify` (typecheck + lint + Vitest) — PR→`dev` fast lane.
- AC-AW-009 → AC-AW-011: pgTAP (`supabase test db`) — PR→`main` `integration` job.
- AC-AW-012: Playwright, PR→`dev` fast lane (Vite dev server, edge fn mocked via `page.route`). Also PR→`main` integration.

**Coverage note:** ≥80% line coverage on all new files under `supabase/functions/agent-chat/`
handler additions, `src/lib/agent/runtime/` adapter changes, and `src/components/panel/` chip
component required to merge (binding project gate, CLAUDE.md).

---

## 8. Open Questions for the Director (≤5, each with a recommendation)

**AW-OQ-001 — Approval signaling mechanism (AW-OD-004): out-of-band POST vs. re-POST.**
The default (AW-OD-004 A) requires a new `agent-approve` Deno edge function. Is the second
deployable acceptable, or should we use the simpler Option B (re-POST to `agent-chat` with a
`controlCmd` field, closing the SSE stream and resuming via a new connection)?
**Recommendation: Option A (separate endpoint).** The SSE stream stays alive; the UX is snappier
(the chip resolves and the next event arrives without re-opening a stream). The `agent-approve`
endpoint is tiny (verify JWT → match `pendingId` → signal). Confirm before eng-planner writes the
plan.

**AW-OQ-002 — `humanSummary` composition: handler-composed vs. model-generated.**
FR-AW-002 requires the handler to compose `humanSummary` deterministically from the validated args
(not model-generated). For `create_activity` this is straightforward ("Log a {kind} on contact
{id}"). For future write actions with richer schemas, handler-generated summaries may be terse or
awkward.
**Recommendation: keep handler-composed for A3 v1** (two simple actions, deterministic summary is
sufficient and safer than trusting the model's self-description of a proposed write). For richer
future actions, revisit allowing the model to supply a summary (bounded to 120 chars, rendered
as-is by the chip). Flag this as AW-OD-006+ for A3+.

**AW-OQ-003 — Should `update_task_status` be scoped to "own tasks" only in A3 v1?**
The DB RLS (ADR-0019 §4) allows Engineers to update ONLY their assigned tasks and PMs/above to
update any. But the agent's tool schema doesn't know which tasks belong to the caller without a
prior `query_entity` read. Should the tool reject `taskId`s that don't belong to the caller (to
avoid the user having to approve an obviously-invalid write)?
**Recommendation: let RLS handle it.** The agent uses `query_entity` to find tasks, then proposes
an update. If the proposed `taskId` is not the caller's assignee (for an Engineer), the DB returns
zero rows updated — which the handler surfaces as a tool-result error to the model, which then
informs the user. No pre-validation needed; RLS is the authority. The approve/deny chip is already
the UX safeguard. Confirm.

**AW-OQ-004 — Approval expiry (AW-OD-005 default: 5 minutes): is this the right duration?**
5 minutes is generous for an in-panel interaction but may be too short if the user steps away from
the computer. Should the expiry be longer (e.g. 15 minutes) or session-lifetime?
**Recommendation: keep 5 minutes** for v1 — a panelled write confirmation is an active interaction;
if the user is away for 5 minutes, expiring is the safe default. The SSE stream timeout also bounds
this. Configurable via `APPROVAL_TIMEOUT_MS` so it can be raised in production without a code
change. Confirm.

**AW-OQ-005 — Should the approve/deny chip also show the `structuredArgs` to the user?**
FR-AW-002 includes `structuredArgs` in the `needs-approval` event payload. The panel renders
`humanSummary` but could optionally expand to show the raw args (e.g. in a collapsible "Details"
section) so technically-inclined users can verify the exact write before approving.
**Recommendation: v1 chip shows `humanSummary` only.** `structuredArgs` are present in the
payload for future expansion but not surfaced by default — the summary is sufficient for the two v1
actions. The design-plan owns the IxD (expandable details toggle). Flag as an owner-optional UX
enhancement for the design-plan to address.

---

## 9. Out of Scope (explicit — owned by later issues)

- **All deletes and archives** → explicitly deferred (AW-OD-002).
- **SoD-gated writes** (contract_value-on-won, document status transition, timesheet approve/reject,
  procurement lifecycle transitions) → A3+ with SoD-identity checks + additional pgTAP proofs.
- **Structural task/project/company writes** (create project, update project header, etc.) → A3+.
- **`compose_view` as an `AgentAction`** → A4.
- **`AgentNativeRuntime` sidecar adapter** → B-adapter, deferred.
- **Durable approval log** (persisting approved/denied decisions to a DB table for audit) → post-A3
  (the in-session `system` event is the A3 audit trail; a persistent log is a compliance feature).
- **Batched multi-write approval** (approve multiple pending writes at once) → post-A3 (AW-OD-003).
- **Rich `structuredArgs` display in the chip** → design-plan decision / later enhancement.
